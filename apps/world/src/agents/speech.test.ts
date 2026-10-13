import { describe, expect, it } from "vitest";
import { ROOM_PLAN, arrangeBubbles, balancedLines, pageAt, paginate, planSpeech, typedAt, typedPerLine, typeMs, wrapLines, type BubbleBox } from "./speech.ts";

describe("wrapLines", () => {
  it("keeps a short line whole", () => {
    expect(wrapLines("Rusty. Faster. Properly. Both.", 30)).toEqual(["Rusty. Faster. Properly. Both."]);
  });

  it("breaks on words and never runs past the width", () => {
    const lines = wrapLines("I edited the file you were in. You're welcome. Or sorry.", 30);
    expect(lines).toEqual(["I edited the file you were in.", "You're welcome. Or sorry."]);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(30);
  });

  it("cuts a word longer than a line across lines", () => {
    expect(wrapLines("a supercalifragilistic b", 8)).toEqual(["a", "supercal", "ifragili", "stic b"]);
  });

  it("collapses whitespace and handles empty text", () => {
    expect(wrapLines("  one   two \n three ", 40)).toEqual(["one two three"]);
    expect(wrapLines("   ", 10)).toEqual([]);
  });
});

describe("balancedLines", () => {
  it("evens the lines out instead of leaving a lone word behind", () => {
    expect(wrapLines("Rusty. Faster. Properly. Both.", 24)).toEqual(["Rusty. Faster. Properly.", "Both."]);
    expect(balancedLines("Rusty. Faster. Properly. Both.", 24)).toEqual(["Rusty. Faster.", "Properly. Both."]);
  });

  it("keeps the line count and the width of a plain wrap", () => {
    const text = "On it. Conveyor's jammed again, but the crates still look gorgeous and that's what counts, right?";
    const plain = wrapLines(text, 30);
    const even = balancedLines(text, 30);
    expect(even).toHaveLength(plain.length);
    expect(even.join(" ")).toBe(plain.join(" "));
    for (const l of even) expect(l.length).toBeLessThanOrEqual(30);
  });

  it("leaves a single line alone", () => {
    expect(balancedLines("Small.", 24)).toEqual(["Small."]);
  });
});

describe("paginate", () => {
  it("splits lines into pages of the given size", () => {
    expect(paginate(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(paginate([], 2)).toEqual([]);
  });
});

describe("planSpeech", () => {
  it("fits a short line on one page that starts at once", () => {
    const plan = planSpeech("Logged it. Sized it. Small.", 4200, ROOM_PLAN);
    expect(plan.pages).toHaveLength(1);
    expect(plan.starts).toEqual([0]);
    expect(plan.exitAt).toBe(4200 - 380);
  });

  it("pages a long line, a couple of short lines at a time, in order", () => {
    const text = "On it. Conveyor's jammed again, but the crates still look gorgeous and that's what counts, right?";
    const plan = planSpeech(text, 9400, ROOM_PLAN);
    expect(plan.pages.length).toBeGreaterThan(1);
    for (const page of plan.pages) expect(page.length).toBeLessThanOrEqual(ROOM_PLAN.maxLines);
    expect(plan.pages.flat().map((l) => l.text).join(" ")).toBe(text);
    for (let i = 1; i < plan.starts.length; i++) expect(plan.starts[i]!).toBeGreaterThan(plan.starts[i - 1]!);
    // Every page gets time to be typed and read before the bubble leaves.
    expect(plan.starts[plan.starts.length - 1]!).toBeLessThan(plan.exitAt);
  });

  it("gives each page at least the time it takes to type it", () => {
    const plan = planSpeech("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen", 11000, ROOM_PLAN);
    for (let i = 1; i < plan.starts.length; i++) {
      const chars = plan.pages[i - 1]!.reduce((n, l) => n + l.text.length, 0);
      expect(plan.starts[i]! - plan.starts[i - 1]!).toBeGreaterThanOrEqual(typeMs(chars, ROOM_PLAN.cps));
    }
  });

  it("squeezes the pages in when the line is up too briefly", () => {
    const plan = planSpeech("x ".repeat(200), 3000, ROOM_PLAN);
    expect(plan.starts[plan.starts.length - 1]!).toBeLessThan(plan.exitAt);
  });

  it("puts the voice's afterword on its own, fainter lines", () => {
    const plan = planSpeech("That was funny.", 5000, ROOM_PLAN, "(Humour setting: 75%.)");
    const lines = plan.pages.flat();
    expect(lines[0]).toEqual({ text: "That was funny." });
    expect(lines[lines.length - 1]).toEqual({ text: "(Humour setting: 75%.)", aside: true });
  });

  it("never plans an empty bubble", () => {
    expect(planSpeech("", 4200, ROOM_PLAN).pages).toEqual([[{ text: "…" }]]);
  });
});

describe("pageAt and typing", () => {
  const plan = { pages: [[{ text: "abc" }], [{ text: "de" }]], starts: [0, 1000], exitAt: 2000 };

  it("finds the page showing at a moment", () => {
    expect(pageAt(plan, 0)).toBe(0);
    expect(pageAt(plan, 999)).toBe(0);
    expect(pageAt(plan, 1000)).toBe(1);
    expect(pageAt(plan, 5000)).toBe(1);
  });

  it("types characters out at the given speed, and all at once without motion", () => {
    const page = [{ text: "hello" }, { text: "world" }];
    expect(typedAt(page, 0, 50)).toBe(0);
    expect(typedAt(page, 100, 50)).toBe(5);
    expect(typedAt(page, 10_000, 50)).toBe(10);
    expect(typedAt(page, 0, 0)).toBe(10);
  });

  it("spreads typed characters over the lines in order", () => {
    const page = [{ text: "hello" }, { text: "world" }];
    expect(typedPerLine(page, 3)).toEqual([3, 0]);
    expect(typedPerLine(page, 7)).toEqual([5, 2]);
    expect(typedPerLine(page, 99)).toEqual([5, 5]);
  });
});

describe("arrangeBubbles", () => {
  const box = (id: string, x: number, y: number, order: number): BubbleBox => ({ id, x, y, w: 160, h: 50, order });
  const lifts = (spots: Record<string, { lift: number }>) => Object.fromEntries(Object.entries(spots).map(([k, s]) => [k, s.lift]));
  const pip = { w: 30, h: 26 };

  it("leaves bubbles that don't touch where they are", () => {
    expect(arrangeBubbles([box("a", 100, 300, 1), box("b", 400, 300, 2)])).toEqual({ a: { lift: 0, tucked: false }, b: { lift: 0, tucked: false } });
    expect(lifts(arrangeBubbles([box("a", 100, 300, 1), box("b", 100, 100, 2)]))).toEqual({ a: 0, b: 0 });
  });

  it("raises the later bubble just clear of the earlier one", () => {
    const spots = arrangeBubbles([box("b", 150, 310, 2), box("a", 100, 300, 1)], { gap: 6 });
    expect(spots.a).toEqual({ lift: 0, tucked: false });
    // b's bottom must sit `gap` above a's top (300 - 50 - 6 = 244): 310 - 244 = 66.
    expect(spots.b).toEqual({ lift: 66, tucked: false });
  });

  it("stacks three talkers in a column", () => {
    const spots = arrangeBubbles([box("a", 100, 300, 1), box("b", 110, 300, 2), box("c", 120, 300, 3)], { gap: 6, maxLift: 500 });
    expect(lifts(spots)).toEqual({ a: 0, b: 56, c: 112 });
  });

  it("breaks ties between bubbles that start together by id, so every bubble agrees", () => {
    const one = arrangeBubbles([box("b", 100, 300, 1), box("a", 100, 300, 1)]);
    const two = arrangeBubbles([box("a", 100, 300, 1), box("b", 100, 300, 1)]);
    expect(one).toEqual(two);
    expect(one.a!.lift).toBe(0);
  });

  it("tucks a bubble into a pip when there's no room within the lift cap", () => {
    const spots = arrangeBubbles([box("a", 100, 300, 1), box("b", 100, 300, 2), box("c", 100, 300, 3)], { gap: 6, maxLift: 80, pip });
    expect(spots.b).toEqual({ lift: 56, tucked: false });
    expect(spots.c!.tucked).toBe(true);
    expect(spots.c!.lift).toBeLessThanOrEqual(80);
  });

  it("tucks a lifted bubble that would rise under the top bar, but never the first one", () => {
    const spots = arrangeBubbles([box("a", 100, 90, 1), box("b", 120, 95, 2)], { gap: 6, minTop: 40, pip });
    expect(spots.a).toEqual({ lift: 0, tucked: false });
    expect(spots.b!.tucked).toBe(true);
  });

  it("gives a tucked pip clear air of its own", () => {
    const spots = arrangeBubbles([box("a", 100, 300, 1), box("b", 100, 300, 2)], { gap: 6, maxLift: 40, pip });
    expect(spots.b!.tucked).toBe(true);
    // The pip can't clear a in 40px either, so it sits at the cap rather than flying off.
    expect(spots.b!.lift).toBe(40);
  });
});
