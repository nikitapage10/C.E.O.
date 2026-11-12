import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeMeals } from "../../../api/_haven/meals.fixture.ts";
import { applyEdit } from "../../../api/_haven/mealShape.ts";
import { confirmPhotos, findPhotos, photoStates, shootOf, stepShotsOf } from "./mealPhotos.ts";
import { cookOf } from "./cook.ts";

/** The planner's side of the photo library (#678, #687): what a customized night is sent as, and the answers read as untrusted. */

const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

describe("the meal photos", () => {
  it("sends a customized night as cooked: its components after the swaps, never an empty one", () => {
    const got = applyEdit(fakeMeals(), { op: "customize", day: "mon", part: { index: 1, option: "no-carb" } }, Date.now());
    if (!got.ok) throw new Error(got.error);
    expect(shootOf(got.file, "mon")).toEqual({ meal: "beef-bowl", name: "beef bowl", description: "No jasmine rice", components: ["Ground beef", "Kimchi"], style: "plate" });
  });

  it("keeps only well-formed tickets and states", async () => {
    const got = await confirmPhotos(
      [{ meal: "beef-bowl", name: "x", description: "", components: [], style: "plate" }],
      answer({
        photos: [
          { meal: "beef-bowl", key: "k", id: "beef-bowl-0123abcd", status: "queued" },
          { meal: "x", id: "../etc", status: "ready" },
          { meal: "y", id: "ok-id", status: "weird" },
        ],
        budget: { reached: false, left: 3 },
      }),
    );
    expect(got?.photos).toEqual([{ meal: "beef-bowl", key: "k", id: "beef-bowl-0123abcd", status: "queued" }]);
    expect(got?.budget?.left).toBe(3);
    expect(await confirmPhotos([{ meal: "a-b", name: "x", description: "", components: [], style: "plate" }], answer({ error: "store" }, 503))).toBeNull();
    const states = await photoStates(
      ["beef-bowl-0123abcd", "BAD"],
      answer({
        photos: [
          { id: "beef-bowl-0123abcd", status: "ready" },
          { id: "other", status: "ready" },
        ],
      }),
    );
    expect([...states!]).toEqual([["beef-bowl-0123abcd", "ready"]]);
  });
});

describe("cook mode's step pictures (#1010)", () => {
  it("asks for one per step, as cooked, with what it uses, and none for a part left out", () => {
    const got = applyEdit(fakeMeals(), { op: "customize", day: "wed", part: { index: 1, option: "no-carb" } }, Date.now());
    if (!got.ok) throw new Error(got.error);
    const shots = stepShotsOf(cookOf(got.file, got.file.week!.slots[2]!)!);
    // The pot of water for the pasta (#1041) goes with the pasta.
    expect(shots.map((s) => s.step)).toEqual([1, 4]);
    expect(shots[0]).toEqual({
      step: 1,
      shot: { meal: "sausage-pasta", name: "sausage pasta", description: "Brown the Italian sausage in a wide pan over medium-high heat, breaking it up, until crisp at the edges and no pink remains, 6–8 min.", components: ["Italian sausage"], style: "step" },
    });
  });

  it("cook mode only reads them: it asks the library to find, never to confirm or generate (#1016)", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const f = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ photos: [{ id: "sausage-pasta-0123abcd", key: "0123456789abcdef", status: "ready" }, null] }), { status: 200 });
    }) as unknown as typeof fetch;
    const shots = stepShotsOf(cookOf(fakeMeals(), fakeMeals().week!.slots[2]!)!).slice(0, 2).map((s) => s.shot);
    const got = await findPhotos(shots, f);
    expect(sent.map((b) => b.action)).toEqual(["find"]);
    expect(got).toEqual([{ meal: "sausage-pasta", key: "0123456789abcdef", id: "sausage-pasta-0123abcd", status: "ready" }, null]);
    // A short or odd answer is no answer; nothing is asked twice.
    expect(await findPhotos(shots, answer({ photos: [null] }))).toBeNull();
    expect(await findPhotos(shots, answer({ photos: [{ id: "Bad Id", status: "ready" }, { id: "ok-id", status: "nope" }] }))).toEqual([null, null]);
    expect(await findPhotos([], f)).toEqual([]);
    expect(sent).toHaveLength(1);
    // And cook mode itself holds no way to queue a picture or poll for one.
    const src = readFileSync(new URL("./CookMode.tsx", import.meta.url), "utf8");
    expect(src).toContain("findPhotos(");
    expect(src).not.toMatch(/confirmPhotos|photoStates|setTimeout\(|setInterval\(/);
  });
});
