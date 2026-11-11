import { describe, expect, it } from "vitest";
import { logoOf, appliedBefore, appliedOf, tidy, yearsAskedIn, changeJobs, cleanProfile, MemoryJobsStore, nextRunAt, normaliseJob, parsePay, runJobs, scoreJob, searchUrl, type JobsDeps } from "./jobs.ts";

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
    expect(p.searches).toHaveLength(11);
    expect(p.searches[0]).toEqual({ q: "PM", location: "Denver", remote: false });
    expect(p.minSalary).toBe(180_000);
    expect(p.prefer).toEqual(["ai", "platform"]);
    expect(p.avoid).toEqual(["crypto"]);
  });

  it("reads the years of experience a posting asks for", () => {
    expect(yearsAskedIn("You have 8+ years of program management experience and 3 years in AI")).toBe(8);
    expect(yearsAskedIn("5-7 years of experience")).toBe(5);
    expect(yearsAskedIn("at least 10 yrs in security")).toBe(10);
    expect(yearsAskedIn("Founded 20 years ago")).toBe(20);
    expect(yearsAskedIn("No numbers here")).toBeNull();
  });

  it("ranks by experience asked, not the title's level", () => {
    const j = normaliseJob(serpJob("d", "Director, Technical Programs", { description: "8+ years leading programs" }), "q", "t")!;
    expect(j.yearsAsked).toBe(8);
    const p = cleanProfile({ years: 10 });
    expect(scoreJob(j, p).why).toContain("asks 8+ years, fits");
    expect(scoreJob(j, p).hidden).toBeNull();
    expect(scoreJob({ ...j, yearsAsked: 15 }, p).why).toContain("asks 15+ years");
  });

  it("hides jobs under the pay floor or with an avoided word", () => {
    const j = normaliseJob(serpJob("a", "Senior Product Manager"), "Product Manager", "t")!;
    const p = cleanProfile({ searches: [{ q: "Product Manager" }], minSalary: 250_000, prefer: ["roadmap"] });
    const s = scoreJob(j, p);
    expect(s.hidden).toBe("pay under your floor");
    expect(scoreJob(j, cleanProfile({ avoid: ["example"] })).hidden).toBe('has "example"');
    // Whole words only: "lab" never hides "Labs", "ai" never lifts "maintain".
    expect(scoreJob(j, cleanProfile({ avoid: ["lab"] })).hidden).toBeNull();
    expect(scoreJob({ ...j, snippet: "maintain" }, cleanProfile({ prefer: ["ai"] })).why.join()).not.toContain("mentions");
    expect(scoreJob(j, cleanProfile({ companies: ["example labs"] })).why).toContain("on your company list");
    expect(scoreJob(j, cleanProfile({ minSalary: 150_000 })).hidden).toBeNull();
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
    // The resume no longer moves the rules' score: only the AI fit check reads it (fit.test.ts).
    expect("state" in r && r.state.jobs[0]!.why).not.toContain("fits your resume");
  });

  it("rotates a long list, PER_RUN searches a run", async () => {
    const store = new MemoryJobsStore();
    store.state.profile = cleanProfile({ searches: Array.from({ length: 10 }, (_, i) => ({ q: `s${i}` })) });
    const a = deps(store);
    await runJobs(a.d, "hand");
    const qs = (urls: string[]) => urls.filter((u) => u.includes("search.json")).map((u) => new URL(u).searchParams.get("q"));
    expect(qs(a.urls)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
    const b = deps(store, [], { now: NOW + 3_600_000 });
    await runJobs(b.d, "hand");
    expect(qs(b.urls)).toEqual(["s7", "s8", "s9", "s0", "s1", "s2", "s3"]);
    expect(store.state.used).toBe(14);
  });

  it("files roles already applied to under Applied, never as new", () => {
    const applied = appliedOf("Anthropic: Technical Program Manager, Security\nPrivacy only line\nElevenLabs: Privacy Program Manager");
    expect(applied).toHaveLength(2);
    expect(appliedBefore({ company: "Anthropic", title: "Technical Program Manager, Security" }, applied)).toBe(true);
    expect(appliedBefore({ company: "ElevenLabs", title: "Privacy Program Manager, EMEA" }, applied)).toBe(true);
    // Same company, a different TPM role: still a match to look at.
    expect(appliedBefore({ company: "Anthropic", title: "Technical Program Manager, Safeguards" }, applied)).toBe(false);
    expect(appliedBefore({ company: "Figma", title: "Privacy Program Manager" }, applied)).toBe(false);
    const j = normaliseJob(serpJob("x", "Privacy Program Manager", { company_name: "ElevenLabs" }), "q", new Date(NOW).toISOString())!;
    const out = tidy([j], cleanProfile({ applied }), NOW);
    expect(out[0]!.state).toBe("applied");
  });

  it("keeps a logo only as an https image or a small inline raster", () => {
    expect(logoOf("https://encrypted-tbn0.gstatic.com/images?q=x")).toBe("https://encrypted-tbn0.gstatic.com/images?q=x");
    expect(logoOf("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(logoOf("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(logoOf("http://x.test/a.png")).toBeNull();
    expect(logoOf("javascript:alert(1)")).toBeNull();
  });

  it("ranks close-to-home and hybrid above remote", () => {
    const p = cleanProfile({ near: ["Denver", "Boulder"] });
    const at = (location: string, extra: Record<string, unknown> = {}) => scoreJob(normaliseJob(serpJob("n", "Program Manager", { location, ...extra }), "q", "t")!, p);
    const denver = at("Denver, CO");
    const hybrid = at("Boulder, CO", { description: "Hybrid, three days in office" });
    const remote = at("Anywhere", { detected_extensions: { work_from_home: true } });
    expect(denver.why).toContain("near you");
    expect(hybrid.why).toEqual(expect.arrayContaining(["near you, hybrid"]));
    expect(hybrid.score).toBeGreaterThan(denver.score);
    expect(denver.score).toBeGreaterThan(remote.score);
  });

  it("ranks big companies, then rising ones, then the rest", () => {
    const p = cleanProfile({ big: ["Microsoft", "Example Labs"], rising: ["Northwind"] });
    const of = (company: string) => scoreJob(normaliseJob(serpJob("c", "Program Manager", { company_name: company }), "q", "t")!, p);
    expect(of("Example Labs").why).toContain("big company");
    expect(of("Northwind").why).toContain("rising company");
    expect(of("Example Labs").score).toBeGreaterThan(of("Northwind").score);
    expect(of("Northwind").score).toBeGreaterThan(of("Tailspin").score);
  });

  it("names the next daily run", () => {
    const s = { ...new MemoryJobsStore().state, profile: cleanProfile({ searches: [{ q: "a" }] }) };
    expect(nextRunAt(s, NOW)).toBe("2026-11-11T13:00:00.000Z");
    expect(nextRunAt({ ...s, profile: { ...s.profile, daily: false } }, NOW)).toBeNull();
  });
});
