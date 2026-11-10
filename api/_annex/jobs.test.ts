import { describe, expect, it } from "vitest";
import { changeJobs, cleanProfile, MemoryJobsStore, nextRunAt, normaliseJob, parsePay, runJobs, scoreJob, searchUrl, type JobsDeps } from "./jobs.ts";

const NOW = Date.parse("2026-11-10T22:00:00Z");

/** A row shaped like SerpApi's google_jobs answer (made-up companies). */
const serpJob = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  job_id: id,
  title,
  company_name: "Example Labs",
  location: "Denver, CO",
  via: "via LinkedIn",
  description: "Lead the roadmap for our platform team, working across engineering and design.",
  detected_extensions: { posted_at: "2 days ago", schedule_type: "Full-time", salary: "160K–210K a year" },
  apply_options: [{ title: "LinkedIn", link: "https://www.linkedin.com/jobs/view/1" }, { title: "Bad", link: "javascript:alert(1)" }],
  ...extra,
});

function deps(store = new MemoryJobsStore(), answers: unknown[] = [], over: Partial<JobsDeps> = {}) {
  const urls: string[] = [];
  let i = 0;
  const d: JobsDeps = {
    store,
    key: "test-key",
    budget: 100,
    now: NOW,
    fetcher: async (url) => {
      urls.push(url);
      if (url.includes("account.json")) return new Response(JSON.stringify({ searches_per_month: 250, total_searches_left: 240 }), { status: 200 });
      return new Response(JSON.stringify(answers[i++] ?? { jobs_results: [] }), { status: 200 });
    },
    ...over,
  };
  return { d, urls, store };
}

describe("the Job search (#1000)", () => {
  it("reads pay in its usual spellings, as a yearly range", () => {
    expect(parsePay("160K–210K a year")).toEqual({ min: 160_000, max: 210_000 });
    expect(parsePay("$150,000 - $180,000 a year")).toEqual({ min: 150_000, max: 180_000 });
    expect(parsePay("45–60 an hour")).toEqual({ min: 93_600, max: 124_800 });
    expect(parsePay("Competitive")).toBeNull();
  });

  it("keeps only https apply links and parses the listing", () => {
    const j = normaliseJob(serpJob("a", "Senior Technical Program Manager"), "Technical Program Manager", "2026-11-10T22:00:00.000Z")!;
    expect(j.apply.map((a) => a.title)).toEqual(["LinkedIn"]);
    expect(j.payMax).toBe(210_000);
    expect(j.via).toBe("LinkedIn");
    expect(normaliseJob({ title: "No company" }, "q", "x")).toBeNull();
  });

  it("cleans a profile from the Desk", () => {
    const p = cleanProfile({ searches: [{ q: " PM ", location: "Denver", remote: "yes" }, { q: "" }, ...Array(10).fill({ q: "x" })], minSalary: "$180,000", prefer: "AI, platform", avoid: ["Crypto", "crypto"] });
    expect(p.searches).toHaveLength(6);
    expect(p.searches[0]).toEqual({ q: "PM", location: "Denver", remote: false });
    expect(p.minSalary).toBe(180_000);
    expect(p.prefer).toEqual(["ai", "platform"]);
    expect(p.avoid).toEqual(["crypto"]);
  });

  it("hides jobs under the pay floor or with an avoided word, and lifts senior ones", () => {
    const j = normaliseJob(serpJob("a", "Senior Product Manager"), "Product Manager", "t")!;
    const p = cleanProfile({ searches: [{ q: "Product Manager" }], minSalary: 250_000, prefer: ["roadmap"] });
    const s = scoreJob(j, p, new Set());
    expect(s.hidden).toBe("pay under your floor");
    expect(s.why).toContain("senior level");
    expect(scoreJob(j, cleanProfile({ avoid: ["example"] }), new Set()).hidden).toBe('has "example"');
    expect(scoreJob(j, cleanProfile({ minSalary: 150_000 }), new Set()).hidden).toBeNull();
  });

  it("sends the key to SerpApi only, with work-from-home as ltype", () => {
    const u = new URL(searchUrl({ q: "TPM", location: "Denver, Colorado", remote: true }, "k"));
    expect(u.origin).toBe("https://serpapi.com");
    expect(u.searchParams.get("engine")).toBe("google_jobs");
    expect(u.searchParams.get("ltype")).toBe("1");
    expect(u.searchParams.get("api_key")).toBe("k");
  });

  it("runs each saved search once, merges repeats and keeps a job's state", async () => {
    const store = new MemoryJobsStore();
    store.state.profile = cleanProfile({ searches: [{ q: "Product Manager" }, { q: "Program Manager" }] });
    const { d, urls } = deps(store, [{ jobs_results: [serpJob("a", "Senior Product Manager"), serpJob("b", "Product Manager")] }, { jobs_results: [serpJob("a", "Senior Product Manager")] }]);
    const first = await runJobs(d, "hand");
    expect(first.result).toBe("ran");
    expect(urls.filter((u) => u.includes("search.json"))).toHaveLength(2);
    expect(first.state.jobs).toHaveLength(2);
    expect(first.state.used).toBe(2);
    expect(first.state.account).toMatchObject({ perMonth: 250, left: 240 });
    expect(first.state.runs[0]).toMatchObject({ by: "hand", searches: 2, found: 3, added: 2 });

    await changeJobs(d, { action: "mark", id: "a", state: "applied" });
    const later = deps(store, [{ jobs_results: [serpJob("a", "Senior Product Manager")] }], { now: NOW + 3_600_000 });
    const second = await runJobs(later.d, "hand");
    expect(second.state.jobs.find((j) => j.id === "a")!.state).toBe("applied");
    expect(second.state.runs[0]!.added).toBe(0);
  });

  it("keeps to the budget, the gaps and the key", async () => {
    const store = new MemoryJobsStore();
    expect((await runJobs(deps(store).d, "schedule")).result).toBe("no-searches");
    store.state.profile = cleanProfile({ searches: [{ q: "a" }, { q: "b" }] });
    expect((await runJobs(deps(store, [], { key: "" }).d, "schedule")).result).toBe("no-key");
    expect((await runJobs(deps(store, [], { budget: 1 }).d, "schedule")).result).toBe("budget");
    expect((await runJobs(deps(store).d, "schedule")).result).toBe("ran");
    expect((await runJobs(deps(store, [], { now: NOW + 3_600_000 }).d, "schedule")).result).toBe("not-due");
    expect((await runJobs(deps(store, [], { now: NOW + 21 * 3_600_000 }).d, "schedule")).result).toBe("ran");
    // A new month starts the count again.
    store.state.used = 100;
    expect((await runJobs(deps(store, [], { now: Date.parse("2026-12-01T13:00:00Z") }).d, "schedule")).state.used).toBe(2);
  });

  it("stops at a bad key instead of spending every search", async () => {
    const store = new MemoryJobsStore();
    store.state.profile = cleanProfile({ searches: [{ q: "a" }, { q: "b" }, { q: "c" }] });
    let n = 0;
    const { d } = deps(store, [], { fetcher: async (url) => (url.includes("search.json") && n++, new Response("{}", { status: 401 })) });
    const r = await runJobs(d, "hand");
    expect(r.result).toBe("failed");
    expect(n).toBe(1);
  });

  it("keeps the resume apart and scores against it", async () => {
    const store = new MemoryJobsStore();
    store.state.jobs = [{ ...normaliseJob(serpJob("a", "Program Manager"), "q", new Date(NOW).toISOString())! }];
    const { d } = deps(store);
    const r = await changeJobs(d, { action: "resume", text: "Led roadmap planning for the platform engineering design team" });
    expect("state" in r && r.hasResume).toBe(true);
    expect(store.resume).toContain("roadmap");
    expect(JSON.stringify(store.state)).not.toContain("roadmap planning");
    expect("state" in r && r.state.jobs[0]!.why).toContain("fits your resume");
  });

  it("names the next daily run", () => {
    const s = { ...new MemoryJobsStore().state, profile: cleanProfile({ searches: [{ q: "a" }] }) };
    expect(nextRunAt(s, NOW)).toBe("2026-11-11T13:00:00.000Z");
    expect(nextRunAt({ ...s, profile: { ...s.profile, daily: false } }, NOW)).toBeNull();
  });
});
