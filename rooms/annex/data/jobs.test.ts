import { describe, expect, it } from "vitest";
import { careerMove, loadFilters, NO_FILTERS, passes, sortJobs, tierOf, type Job, type JobsProfile } from "./jobs.ts";

const profile: JobsProfile = {
  searches: [],
  minSalary: 180_000,
  prefer: [],
  avoid: [],
  companies: ["Figma"],
  daily: true,
  years: 10,
  applied: [],
  near: [],
  big: ["Google", "Microsoft"],
  rising: ["Decagon"],
};
const job = (p: Partial<Job>): Job => ({
  id: "x",
  title: "Technical Program Manager",
  company: "Acme",
  location: "",
  via: "",
  posted: null,
  remote: false,
  schedule: null,
  salary: null,
  payMin: null,
  payMax: null,
  link: null,
  apply: [],
  snippet: "",
  highlights: [],
  search: "",
  score: 50,
  why: [],
  hidden: null,
  firstSeen: "",
  lastSeen: "",
  state: "new",
  stateAt: null,
  ...p,
});

describe("careerMove", () => {
  it("calls a senior role at an industry leader paying above the floor a step up", () => {
    const c = careerMove(job({ company: "Google", title: "Senior Technical Program Manager", yearsAsked: 10, payMax: 240_000 }), profile);
    expect(c.verdict).toBe("up");
    expect(c.standing.word).toBe("Industry leader");
  });
  it("calls a junior role at an unknown company paying under the floor a step back", () => {
    const c = careerMove(job({ title: "Associate Program Coordinator", yearsAsked: 2, payMax: 90_000 }), profile);
    expect(c.verdict).toBe("back");
    expect(c.pay?.word).toBe("Pays well under");
  });
  it("knows a rising startup and a lead title without pay", () => {
    const c = careerMove(job({ company: "Decagon", title: "Head of Trust & Safety" }), profile);
    expect(c.standing.word).toBe("Rising startup");
    expect(c.level.word).toBe("Senior / lead role");
    expect(c.pay).toBeNull();
    expect(c.verdict).toBe("up");
  });
  it("takes the AI fit check's level over the title's (#1025)", () => {
    const fit = { fit: "possible" as const, score: 70, met: [], missing: [], reason: "r", resume: "h", at: "" };
    const lead = job({ company: "Decagon", title: "Head of Trust & Safety", fit: { ...fit, level: "down" } });
    expect(careerMove(lead, profile).level.word).toBe("Below your level");
    expect(careerMove(job({ fit: { ...fit, level: "up" } }), profile).level.word).toBe("A step up in scope");
  });
});

describe("sort and filter (#1025)", () => {
  const fit = (f: "strong" | "possible" | "weak", score: number, level: "up" | "level" | "down" = "level") => ({ fit: f, score, met: [], missing: [], reason: "r", level, resume: "h", at: "" });
  const jobs = [
    job({ id: "a", company: "Tailspin", score: 90, firstSeen: "2026-11-01", work: "remote", region: null }),
    job({ id: "b", company: "Google", score: 40, fit: fit("strong", 88, "up"), firstSeen: "2026-11-03", payMax: 250_000, work: "near", region: "UT" }),
    job({ id: "c", company: "acme", score: 60, fit: fit("weak", 30, "down"), firstSeen: "2026-11-05", payMax: 120_000, work: "hybrid", region: "UT" }),
  ];
  it("sorts by AI fit (checked first), newest, pay, level and company", () => {
    expect(sortJobs(jobs, "fit", profile).map((j) => j.id)).toEqual(["b", "c", "a"]);
    expect(sortJobs(jobs, "new", profile).map((j) => j.id)).toEqual(["c", "b", "a"]);
    expect(sortJobs(jobs, "pay", profile).map((j) => j.id)).toEqual(["b", "c", "a"]);
    expect(sortJobs(jobs, "level", profile)[0]!.id).toBe("b");
    expect(sortJobs(jobs, "company", profile).map((j) => j.id)).toEqual(["c", "b", "a"]);
  });
  it("filters by fit, work style, state, pay, tier and level", () => {
    const only = (f: Partial<typeof NO_FILTERS>) => jobs.filter((j) => passes(j, { ...NO_FILTERS, ...f }, profile)).map((j) => j.id);
    expect(only({ fit: "strong" })).toEqual(["b"]);
    expect(only({ fit: "unchecked" })).toEqual(["a"]);
    expect(only({ work: "hybrid" })).toEqual(["c"]);
    expect(only({ region: "UT" })).toEqual(["b", "c"]);
    expect(only({ payClears: true })).toEqual(["b"]);
    expect(only({ tier: "big" })).toEqual(["b"]);
    expect(only({ level: "up" })).toEqual(["b"]);
    expect(tierOf({ company: "Figma" }, profile)).toBe("list");
  });
  it("falls back to the defaults when the browser keeps nothing", () => {
    expect(loadFilters()).toEqual(NO_FILTERS);
  });
});
