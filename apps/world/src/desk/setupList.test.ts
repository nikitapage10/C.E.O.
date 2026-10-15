import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isDone, PINGS_PASTE, readSetupStatus, remaining, SETUP_LIST, stepParts, type SetupStatus } from "./setupList.ts";

const all = (state: "done" | "todo" | "unknown"): SetupStatus => ({
  items: { pings: state, app: state, devices: state, ruleset: state, automerge: state },
  pings: { vercel: state, actions: state },
});

describe("the setup list on Today (#164)", () => {
  it("hides once everything is done", () => {
    expect(remaining(all("done"), new Set())).toEqual([]);
    expect(remaining(all("todo"), new Set()).map((i) => i.id)).toEqual(SETUP_LIST.map((i) => i.id));
  });
  it("counts a hand tick only for what the site can't check", () => {
    expect(isDone("unknown", true)).toBe(true);
    expect(isDone("unknown", false)).toBe(false);
    expect(isDone("todo", true)).toBe(false);
    expect(isDone("done", false)).toBe(true);
    const s = { ...all("done"), items: { ...all("done").items, automerge: "unknown" as const, ruleset: "todo" as const } };
    expect(remaining(s, new Set(["automerge", "ruleset"])).map((i) => i.id)).toEqual(["ruleset"]);
  });
  it("reads only the three states, and nothing else", () => {
    expect(readSetupStatus(null)).toBeNull();
    expect(readSetupStatus({ error: "x" })).toBeNull();
    const got = readSetupStatus({ items: { pings: "done", app: "sneaky", devices: "todo", extra: "done" }, pings: { vercel: "done" } })!;
    expect(got.items).toEqual({ pings: "done", app: "unknown", devices: "todo", ruleset: "unknown", automerge: "unknown" });
    expect(got.pings).toEqual({ vercel: "done", actions: "unknown" });
  });
  it("has a link and steps for every item, all doable in a browser", () => {
    for (const item of SETUP_LIST) {
      expect(item.links.length).toBeGreaterThan(0);
      expect(item.steps.length).toBeGreaterThan(0);
      for (const l of item.links) expect(l.route ? l.href.startsWith("/") : l.href.startsWith("https://")).toBe(true);
      const text = [item.title, item.why, item.ticks, ...item.steps].join(" ");
      expect(text).not.toMatch(/\b(he|his|him)\b/i);
      expect(text).not.toMatch(/repo folder|terminal|gh api|npm /i);
    }
  });
  it("hands out the same console paste as docs/SECURITY.md", () => {
    const doc = readFileSync(new URL("../../../../docs/SECURITY.md", import.meta.url), "utf8");
    expect(doc).toContain(PINGS_PASTE);
  });
  it("splits a step into words, names and code", () => {
    expect(stepParts("Open **Settings** and add `X_Y`.")).toEqual([
      { text: "Open ", kind: "plain" },
      { text: "Settings", kind: "bold" },
      { text: " and add ", kind: "plain" },
      { text: "X_Y", kind: "code" },
      { text: ".", kind: "plain" },
    ]);
  });
});
