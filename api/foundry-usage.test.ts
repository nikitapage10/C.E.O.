import { describe, expect, it } from "vitest";
import { isTrail } from "./foundry-usage.ts";

const at = "2026-10-15T10:00:00Z";
const url = "https://api.github.com/repos/nikitapage10/C.E.O./issues/162";
const pics = "**Trail · Pictures:** the Changelog.\n\n![a](https://raw.githubusercontent.com/nikitapage10/C.E.O./foundry-shots/162/a.jpg)";

describe("the usage feed's trail steps", () => {
  it("keeps a Pictures step only from the trail's trusted authors", () => {
    for (const login of ["nikitapage10", "github-actions[bot]", "ceo-foundry[bot]"]) {
      expect(isTrail({ issue_url: url, created_at: at, body: pics, user: { login } }), login).toBe(true);
    }
    for (const user of [{ login: "someone-else" }, { login: "nikitapage10-evil" }, {}, null, undefined]) {
      expect(isTrail({ issue_url: url, created_at: at, body: pics, user })).toBe(false);
    }
  });

  it("reads other steps as before, and nothing that isn't a step", () => {
    expect(isTrail({ issue_url: url, created_at: at, body: "**Trail · Work:** foundry/build/162-x" })).toBe(true);
    expect(isTrail({ issue_url: url, created_at: at, body: `Nice! ${pics}`, user: { login: "nikitapage10" } })).toBe(false);
  });
});
