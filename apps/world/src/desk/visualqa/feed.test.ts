import { describe, expect, it } from "vitest";
import { describeRun, isVisualQaFeed, type VisualQaRun } from "./feed.ts";

const run: VisualQaRun = { at: "2026-10-13T20:00:00Z", url: "https://github.com/nikitapage10/C.E.O./actions/runs/7", run: "pass", review: "reviewed", rooms: 9, findings: 0, blockers: 0 };

describe("the Visual QA panel", () => {
  it("accepts the feed's shape, with or without a run", () => {
    expect(isVisualQaFeed({ at: "x", latest: null })).toBe(true);
    expect(isVisualQaFeed({ at: "x", latest: run })).toBe(true);
  });

  it("refuses anything else: a foreign link, odd counts, unknown states", () => {
    for (const bad of [null, {}, { at: "x" }, { at: "x", latest: { ...run, url: "https://evil.example/runs/7" } }, { at: "x", latest: { ...run, rooms: -1 } }, { at: "x", latest: { ...run, review: "great" } }, { at: "x", latest: { ...run, run: "?" } }]) {
      expect(isVisualQaFeed(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("waits for the first run rather than showing anything made up", () => {
    expect(describeRun(null)).toMatchObject({ tone: "off", line: "Waiting for the first run" });
  });

  it("reads a run in plain words", () => {
    expect(describeRun(run)).toMatchObject({ tone: "ok", pill: "All clear" });
    expect(describeRun({ ...run, findings: 3, blockers: 1 })).toMatchObject({ tone: "down", pill: "1 blocker" });
    expect(describeRun({ ...run, findings: 2 })).toMatchObject({ tone: "ok", pill: "Notices only" });
    expect(describeRun({ ...run, review: "skipped", rooms: 0 })).toMatchObject({ pill: "Not reviewed" });
    expect(describeRun({ ...run, review: "unavailable", rooms: 0 })).toMatchObject({ pill: "Gemini unavailable" });
    expect(describeRun({ ...run, run: "fail" })).toMatchObject({ tone: "down", pill: "Tour failed" });
  });
});
