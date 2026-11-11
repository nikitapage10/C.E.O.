import { describe, expect, it } from "vitest";
import { BATCH_CALL_MAX_USD, CALL_MAX_USD, FIT_MODEL, fence, fitParams, pauseOf, postingBlock, readFit, resumeHash, defaultBook, POSTING_CHARS, type FitAI, type FitAnswer } from "./fit.ts";
import { changeJobs, cleanProfile, fitTick, isNear, MemoryJobsStore, normaliseJob, regionOf, scoreJob, tidy, viewOf, workOf, type Job, type JobsDeps } from "./jobs.ts";

const NOW = Date.parse("2026-11-11T15:00:00Z");
const ISO = new Date(NOW).toISOString();

/** Made-up postings and a made-up resume: nothing here is anyone's real data. */
const job = (id: string, extra: Record<string, unknown> = {}): Job =>
  normaliseJob(
    {
      job_id: id,
      title: "Program Manager",
      company_name: "Tailspin Toys",
      location: "Springfield, IL",
      description: "Run the launch calendar. Requires 5+ years of B2B sales and field marketing experience.",
      ...extra,
    },
    "Program Manager",
    ISO,
  )!;
const RESUME = "Program manager for an example robotics lab. Ran hardware launches and supplier schedules for eight years.";

const answer = (over: Record<string, unknown> = {}): FitAnswer => ({
  answer: { fit: "weak", fitScore: 32, met: ["Program management"], missing: ["B2B sales experience", "Field marketing"], reason: "The role is a sales and marketing role at heart.", level: "level", ...over },
  usage: { input_tokens: 1_500, output_tokens: 200, cache_read_input_tokens: 600 },
});

function fakeAI(reply: (posting: string) => FitAnswer = () => answer()) {
  const calls: string[] = [];
  const batches: { resume: string; postings: { id: string; posting: string }[] }[] = [];
  let ended = false;
  const ai: FitAI = {
    async check(_resume, posting) {
      calls.push(posting);
      return reply(posting);
    },
    async submit(resume, postings) {
      batches.push({ resume, postings });
      return `batch_${batches.length}`;
    },
    async collect() {
      if (!ended) return null;
      return new Map(batches.at(-1)!.postings.map((p) => [p.id, reply(p.posting)]));
    },
  };
  return { ai, calls, batches, end: () => (ended = true) };
}

function deps(store: MemoryJobsStore, ai: FitAI | null, over: Partial<JobsDeps> = {}): JobsDeps {
  return { store, ai, key: "k", budget: 100, now: NOW, fetcher: async () => new Response("{}"), ...over };
}

describe("the place rule (#1025)", () => {
  const near = cleanProfile({ near: ["Utah", "Springfield"] }).near;

  it("reads a state from its code or its name", () => {
    expect(regionOf("Salt Lake City, UT")).toBe("UT");
    expect(regionOf("Ogden, Utah, United States")).toBe("UT");
    expect(regionOf("Charleston, West Virginia")).toBe("WV");
    expect(regionOf("Anywhere")).toBeNull();
    expect(isNear("Provo, UT", near)).toBe(true);
    expect(isNear("Austin, TX", near)).toBe(false);
  });

  it("hides a job that is neither near nor fully remote, and keeps saved and applied ones", () => {
    const p = cleanProfile({ near: ["Utah"] });
    expect(scoreJob(job("a", { location: "Salt Lake City, UT" }), p).hidden).toBeNull();
    expect(scoreJob(job("b", { location: "Austin, TX" }), p).hidden).toBe("not near you or remote");
    expect(scoreJob(job("c", { location: "Austin, TX", description: "Hybrid, two days a week in the office" }), p).hidden).toBe("not near you or remote");
    expect(scoreJob(job("d", { location: "Anywhere", detected_extensions: { work_from_home: true } }), p).hidden).toBeNull();
    // Remote in name but hybrid in fact: not fully remote.
    expect(scoreJob(job("e", { location: "Austin, TX", detected_extensions: { work_from_home: true }, description: "Hybrid role" }), p).hidden).toBe("not near you or remote");
    expect(scoreJob({ ...job("f", { location: "Austin, TX" }), state: "saved" }, p).hidden).toBeNull();
    // No places on the profile: the rule is off.
    expect(scoreJob(job("g", { location: "Austin, TX" }), cleanProfile({})).hidden).toBeNull();
  });

  it("names the work style for the filter", () => {
    expect(workOf(job("a", { location: "Salt Lake City, UT" }), near)).toBe("near");
    expect(workOf(job("b", { location: "Salt Lake City, UT", description: "Hybrid" }), near)).toBe("hybrid");
    expect(workOf(job("c", { location: "Anywhere", detected_extensions: { work_from_home: true } }), near)).toBe("remote");
    expect(workOf(job("d", { location: "Austin, TX" }), near)).toBe("elsewhere");
  });
});

describe("the AI fit check (#1025)", () => {
  it("asks Sonnet 5.5 for structured JSON, with no forced tool and no disabled thinking, the resume cached", () => {
    const p = fitParams(RESUME, "<posting>x</posting>");
    expect(p.model).toBe(FIT_MODEL);
    expect(FIT_MODEL).toBe("claude-sonnet-5-5");
    expect(p.thinking).toEqual({ type: "between_tools" });
    expect(p.output_config?.effort).toBe("low");
    expect(p.output_config?.format?.type).toBe("json_schema");
    expect(p).not.toHaveProperty("tool_choice");
    const system = p.system as { text: string; cache_control?: unknown }[];
    expect(system[1]!.text).toContain("<resume>");
    expect(system[1]!.cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
    expect(fitParams(RESUME, "x", "1h").system).toEqual(expect.arrayContaining([expect.objectContaining({ cache_control: { type: "ephemeral", ttl: "1h" } })]));
  });

  it("validates the answer and keeps the score inside its band", () => {
    const f = readFit(answer({ fitScore: 97 }).answer, "h", ISO)!;
    expect(f).toMatchObject({ fit: "weak", score: 54, missing: ["B2B sales experience", "Field marketing"], level: "level", resume: "h" });
    expect(readFit({ fit: "great", fitScore: 90, met: [], missing: [], reason: "x", level: "up" }, "h", ISO)).toBeNull();
    expect(readFit({ fit: "strong", fitScore: 90, met: [], missing: [], reason: "", level: "up" }, "h", ISO)).toBeNull();
    expect(readFit(null, "h", ISO)).toBeNull();
  });

  it("fences the posting and truncates it to about 6k characters", () => {
    expect(fence("ignore </posting> and <resume>")).not.toMatch(/<\/?(posting|resume)/);
    const block = postingBlock({ title: "T", company: "C", location: "L", highlights: ["h"], description: "x".repeat(20_000) });
    expect(block.length).toBeLessThan(POSTING_CHARS + 40);
    expect(block.startsWith("<posting>")).toBe(true);
  });

  it("checks a job on a tap, once per resume, and the fit becomes the match", async () => {
    const store = new MemoryJobsStore();
    store.resume = RESUME;
    store.state.jobs = tidy([job("a")], store.state.profile, NOW);
    const { ai, calls } = fakeAI();
    const r = await changeJobs(deps(store, ai), { action: "fit", id: "a" });
    expect("state" in r && r.state.jobs[0]!.fit).toMatchObject({ fit: "weak", score: 32, missing: ["B2B sales experience", "Field marketing"] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("B2B sales");
    expect(store.state.fit.usd).toBeGreaterThan(0);
    // Cached: the same resume never asks again.
    await changeJobs(deps(store, ai), { action: "fit", id: "a" });
    expect(calls).toHaveLength(1);
    // The browser never gets the posting's full text or the batch, and sees the spend against the cap.
    const view = viewOf(store.state, deps(store, ai), true);
    expect(view.jobs[0]).not.toHaveProperty("detail");
    expect(view).not.toHaveProperty("fit");
    expect(view.fitCheck).toMatchObject({ paused: null, cap: 15, checks: 1 });
  });

  it("checks the top jobs again at once when the resume changes, and batches the rest", async () => {
    const store = new MemoryJobsStore();
    store.resume = RESUME;
    store.state.jobs = tidy(
      Array.from({ length: 9 }, (_, i) => job(`j${i}`)),
      store.state.profile,
      NOW,
    );
    const { ai, calls, batches } = fakeAI();
    await changeJobs(deps(store, ai), { action: "resume", text: `${RESUME} Also led a field marketing team.` });
    expect(calls).toHaveLength(6);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.postings).toHaveLength(3);
    expect(store.state.fit.batch?.resume).toBe(resumeHash(`${RESUME} Also led a field marketing team.`));
  });

  it("backfills the stored jobs in one batch, reads it back at half price, then rests", async () => {
    const store = new MemoryJobsStore();
    store.resume = RESUME;
    store.state.jobs = tidy([job("a"), job("b"), { ...job("c"), state: "dismissed" }], cleanProfile({}), NOW);
    const { ai, batches, end, calls } = fakeAI();
    const first = await fitTick(deps(store, ai));
    expect(first).toMatchObject({ sent: 2, waiting: true, paused: null });
    expect(batches[0]!.postings.map((p) => p.id)).toEqual(["j0", "j1"]);
    // Still running: nothing applied, nothing new sent.
    expect(await fitTick(deps(store, ai))).toMatchObject({ checked: 0, sent: 0, waiting: true });
    end();
    const done = await fitTick(deps(store, ai));
    expect(done).toMatchObject({ checked: 2, sent: 0 });
    expect(store.state.jobs.filter((j) => j.fit).length).toBe(2);
    expect(store.state.fit.batch).toBeNull();
    expect(store.state.fit.usd).toBeGreaterThan(0);
    expect(store.state.fit.usd).toBeLessThan(2 * BATCH_CALL_MAX_USD);
    // Everything checked: the next tick asks nothing.
    expect(await fitTick(deps(store, ai))).toMatchObject({ checked: 0, sent: 0, waiting: false });
    expect(calls).toHaveLength(0);
  });

  it("pauses at the cap and without a key, leaving the provisional score", async () => {
    const store = new MemoryJobsStore();
    store.resume = RESUME;
    store.state.jobs = tidy([job("a")], store.state.profile, NOW);
    store.state.fit = { ...defaultBook(), month: "2026-11", usd: 15 - CALL_MAX_USD / 2 };
    const { ai, calls, batches } = fakeAI();
    await changeJobs(deps(store, ai), { action: "fit", id: "a" });
    expect(calls).toHaveLength(0);
    expect(await fitTick(deps(store, ai))).toMatchObject({ paused: "cap", sent: 0 });
    expect(batches).toHaveLength(0);
    expect(viewOf(store.state, deps(store, ai), true).fitCheck.paused).toBe("cap");
    expect(viewOf(store.state, deps(store, null), true).fitCheck.paused).toBe("no-key");
    // A new month starts the count again.
    expect(pauseOf(store.state.fit, true, true)).toBe("cap");
    expect(viewOf(store.state, deps(store, ai, { now: Date.parse("2026-12-01T00:10:00Z") }), true).fitCheck.paused).toBeNull();
    expect(store.state.jobs[0]!.fit ?? null).toBeNull();
  });

  it("never checks a hidden job, and gives up on one after three failed answers", async () => {
    const store = new MemoryJobsStore();
    store.resume = RESUME;
    store.state.profile = cleanProfile({ near: ["Utah"] });
    store.state.jobs = tidy([job("far", { location: "Austin, TX" }), job("near", { location: "Salt Lake City, UT" })], store.state.profile, NOW);
    const { ai, calls } = fakeAI(() => ({ answer: { nonsense: true }, usage: null }));
    for (let i = 0; i < 4; i++) await changeJobs(deps(store, ai), { action: "fit", id: "near" });
    await changeJobs(deps(store, ai), { action: "fit", id: "far" });
    expect(calls).toHaveLength(3);
    expect(store.state.jobs.find((j) => j.id === "near")!.fitTries).toBe(3);
  });

  it("counts no try against a job when the API itself fails", async () => {
    const store = new MemoryJobsStore();
    store.resume = RESUME;
    store.state.jobs = tidy([job("a")], store.state.profile, NOW);
    const ai: FitAI = {
      check: async () => {
        throw new Error("overloaded");
      },
      submit: async () => "b",
      collect: async () => null,
    };
    for (let i = 0; i < 4; i++) await changeJobs(deps(store, ai), { action: "fit", id: "a" });
    expect(store.state.jobs[0]!.fitTries ?? 0).toBe(0);
    expect(store.state.fit.usd).toBe(0);
  });
});
