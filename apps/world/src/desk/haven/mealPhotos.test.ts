import { describe, expect, it } from "vitest";
import { fakeMeals } from "../../../../../api/_haven/meals.fixture.ts";
import { applyEdit } from "../../../../../api/_haven/mealShape.ts";
import { confirmPhotos, photoStates, shootOf } from "./mealPhotos.ts";

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
