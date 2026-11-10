import { describe, expect, it } from "vitest";
import { careerMove, type Job, type JobsProfile } from "./jobs.ts";

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
});
