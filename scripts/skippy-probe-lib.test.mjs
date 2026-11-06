import { describe, expect, it } from "vitest";
import { BUDGET_MS, CASES, MAX_CHARS, MODEL_PER_RUN, failureBody, gradeCase, gradeTurn, pickCases, summary } from "./skippy-probe-lib.mjs";

const ok = (over = {}) => ({ status: 200, ms: 900, tier: "rules", chars: 80, flags: [], looked: ["web"], wrote: [], wouldRun: [], taps: 0, ...over });
const byId = (id) => CASES.find((c) => c.id === id);

describe("the Skippy probe's battery (#955)", () => {
  it("covers what the issue asks for: home questions, an order, web, a follow-up, odd phrasing, on every surface", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    expect(CASES.some((c) => c.kind === "order" && c.surface === "phone")).toBe(true);
    expect(CASES.some((c) => c.kind === "web")).toBe(true);
    expect(CASES.some((c) => c.asks.length === 2)).toBe(true);
    expect(new Set(CASES.map((c) => c.surface))).toEqual(new Set(["desk", "phone", "call"]));
    for (const c of CASES) for (const a of c.asks) expect(a.length).toBeLessThanOrEqual(120);
  });
  it("sends every rules case and MODEL_PER_RUN model cases a run, taking turns", () => {
    const free = CASES.filter((c) => c.rules).length;
    const paid = CASES.filter((c) => !c.rules);
    const seen = new Set();
    for (let run = 1; run <= paid.length; run++) {
      const picked = pickCases(run);
      expect(picked).toHaveLength(free + MODEL_PER_RUN);
      picked.filter((c) => !c.rules).forEach((c) => seen.add(c.id));
    }
    expect(seen.size).toBe(paid.length);
    // A handful of model calls a run at most: the follow-up is two.
    for (let run = 0; run < 20; run++) expect(pickCases(run).filter((c) => !c.rules).reduce((n, c) => n + c.asks.length, 0)).toBeLessThanOrEqual(4);
  });
});

describe("grading a turn by the fixed rules", () => {
  it("passes a quick read with nothing written", () => {
    expect(gradeTurn(byId("vacuum-schedule"), ok(), 900)).toEqual([]);
  });
  it("fails a question that would have acted, and an order that wasn't understood or did more", () => {
    expect(gradeTurn(byId("vacuum-schedule"), ok({ wouldRun: ["home.vacuum.start"] }), 900)).toContain("acted-on-a-question");
    expect(gradeTurn(byId("vacuum-schedule-polite"), ok({ taps: 1 }), 900)).toContain("acted-on-a-question");
    expect(gradeTurn(byId("feed-order-phone"), ok({ wouldRun: ["home.feeder.feed"] }), 900)).toEqual([]);
    expect(gradeTurn(byId("feed-order-phone"), ok(), 900)).toContain("order-not-understood");
    expect(gradeTurn(byId("feed-order-phone"), ok({ wouldRun: ["home.feeder.feed", "home.wet.open"] }), 900)).toContain("order-did-more");
  });
  it("fails the banned phrases, a home ask that left the rules tier or was handed off, no search on a web ask, slow and long", () => {
    expect(gradeTurn(byId("apartment-temp"), ok({ flags: ["sign-in", "cant"] }), 900)).toEqual(["said:sign-in", "said:cant"]);
    expect(gradeTurn(byId("apartment-temp"), ok({ tier: "fast" }), 900)).toEqual(["not-rules-tier:fast"]);
    expect(gradeTurn(byId("odd-litter"), ok({ tier: "fast", handedOff: true }), 900)).toEqual(["handed-off-a-home-ask"]);
    expect(gradeTurn(byId("web-news"), ok({ tier: "talk", looked: [] }), 900)).toEqual(["no-web-search"]);
    expect(gradeTurn(byId("apartment-temp"), ok(), BUDGET_MS.rules + 1)[0]).toMatch(/^slow:/);
    expect(gradeTurn(byId("apartment-temp"), ok({ chars: MAX_CHARS.spoken + 1 }), 900)[0]).toMatch(/^long:/);
    expect(gradeTurn(byId("web-news"), ok({ tier: "talk", chars: MAX_CHARS.spoken + 1 }), 900)).toEqual([]);
  });
  it("reads an error as a failure, and the cap, the pace or the budget line as nothing to grade", () => {
    expect(gradeTurn(byId("web-news"), { status: 502, error: "model" }, 900)).toEqual(["error:model"]);
    expect(gradeTurn(byId("web-news"), { status: 200, skipped: "budget" }, 0)).toEqual([]);
    expect(gradeCase(byId("web-news"), [{ status: 200, skipped: "budget" }], 5)).toMatchObject({ verdict: "skipped", why: "budget" });
    expect(gradeCase(byId("web-news"), [], 5)).toMatchObject({ verdict: "fail", fails: ["no-answer"] });
  });
  it("grades each ask of a follow-up, naming which one failed", () => {
    const c = byId("follow-up");
    expect(gradeCase(c, [ok({ tier: "talk" }), ok({ tier: "talk", flags: ["rephrase"] })], 4000)).toMatchObject({ verdict: "fail", fails: ["ask2:said:rephrase"] });
    expect(gradeCase(c, [ok({ tier: "talk" })], 4000)).toMatchObject({ verdict: "fail", fails: ["stopped-after-ask1"] });
  });
});

describe("what the probe writes", () => {
  const results = [gradeCase(byId("vacuum-schedule"), [ok()], 900), gradeCase(byId("apartment-temp"), [ok({ flags: ["hiccup"] })], 1200)];
  it("summarises by case, with no reply text", () => {
    const md = summary(results, 7);
    expect(md).toContain("1 passed, 1 failed, 0 skipped");
    expect(md).toContain("`said:hiccup`");
  });
  it("files the failures with the public asks and the rules they broke, and links the run", () => {
    const body = failureBody(results, "https://github.com/sample/run/1");
    expect(body).toContain("`apartment-temp`");
    expect(body).toContain("\"what's the temperature in my apartment\"");
    expect(body).toContain("`said:hiccup`");
    expect(body).not.toContain("vacuum-schedule`");
    expect(body).toContain("https://github.com/sample/run/1");
  });
});
