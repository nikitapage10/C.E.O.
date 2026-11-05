import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_GYM_PLAN } from "../../../api/_haven/gymShape.ts";
import { demoUrl, frameUrl, readIndex, refFor } from "./gymRef.ts";

/** The Gym's exercise reference (#729): the vendored free-exercise-db entries and how the plan's names find them. */
const root = new URL("../../../apps/world/public/gym/exercises/", import.meta.url);
const list = readIndex(JSON.parse(readFileSync(new URL("index.json", root), "utf8")));

describe("the exercise reference", () => {
  it("vendors every entry with its steps, muscles and both frames on disk", () => {
    expect(list.length).toBeGreaterThan(20);
    for (const r of list) {
      expect(r.instructions.length).toBeGreaterThan(0);
      expect(r.primary.length).toBeGreaterThan(0);
      for (let k = 0; k < r.frames; k++) expect(existsSync(new URL(`${r.id}/${k}.jpg`, root))).toBe(true);
    }
  });

  it("finds the default plan's exercises: the same movement, the closest one, or none", () => {
    const got = Object.fromEntries(DEFAULT_GYM_PLAN.sessions.flatMap((s) => s.exercises).map((e) => [e.name, refFor(e.name, list)]));
    expect(got["Dead bugs"]).toMatchObject({ ref: { id: "dead-bug" }, exact: true });
    expect(got["Pallof press"]).toMatchObject({ ref: { id: "pallof-press" }, exact: true });
    expect(got["Side plank"]).toMatchObject({ ref: { id: "side-bridge" }, exact: true });
    expect(got["Front plank"]).toMatchObject({ ref: { id: "plank" }, exact: true });
    expect(got["Ab wheel rollouts"]).toMatchObject({ ref: { id: "ab-roller" }, exact: true });
    expect(got["Cable woodchops"]).toMatchObject({ ref: { id: "standing-cable-wood-chop" }, exact: true });
    expect(got["Hanging knee raises"]).toMatchObject({ ref: { id: "hanging-leg-raise" }, exact: false });
    expect(got["Bird dogs"]).toBeNull();
    expect(refFor("Plank", list)?.ref.id).toBe("plank");
    expect(refFor("Juggling", list)).toBeNull();
  });

  it("serves frames from the Desk's own files and links a demo search, never an embed", () => {
    expect(frameUrl("dead-bug", 1)).toBe("/gym/exercises/dead-bug/1.jpg");
    expect(demoUrl("Dead bugs")).toBe("https://www.youtube.com/results?search_query=Dead%20bugs%20exercise%20form");
    expect(readIndex({ exercises: [{ id: "../x", name: "Bad" }, { id: "ok", name: "Ok", frames: 9 }] })).toEqual([
      { id: "ok", name: "Ok", level: "", equipment: "", category: "", primary: [], secondary: [], instructions: [], frames: 2 },
    ]);
  });
});
