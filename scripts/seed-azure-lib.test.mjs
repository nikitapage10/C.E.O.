import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedTarget } from "./seed-azure-lib.mjs";

const root = "/tmp/seed";

describe("the Azure seed's file names", () => {
  it("keep the world, its stories and the idea pictures under the same names", () => {
    expect(seedTarget(root, "world/state.json")).toBe(join(root, "world/state.json"));
    expect(seedTarget(root, "world/days/2026-10-21.json")).toBe(join(root, "world/days/2026-10-21.json"));
    expect(seedTarget(root, "world/stories/2026-10-21.wav")).toBe(join(root, "world/stories/2026-10-21.wav"));
    expect(seedTarget(root, "foundry/ideas/1760000000000-AbC.jpg")).toBe(join(root, "foundry/ideas/1760000000000-AbC.jpg"));
  });

  it("leave the Desk's sign-ins and everything else behind", () => {
    expect(seedTarget(root, "desk/auth/passkeys.json")).toBeNull();
    expect(seedTarget(root, "desk/skippy/spend.json")).toBeNull();
    expect(seedTarget(root, "other.json")).toBeNull();
    expect(seedTarget(root, "world/")).toBeNull();
  });

  it("refuse names that could step outside the folder", () => {
    expect(seedTarget(root, "world/../../etc/passwd")).toBeNull();
    expect(seedTarget(root, "world/./state.json")).toBeNull();
    expect(seedTarget(root, "world//state.json")).toBeNull();
    expect(seedTarget(root, "world\\..\\x")).toBeNull();
    expect(seedTarget(root, "/world/state.json")).toBeNull();
    expect(seedTarget(root, "world/a\nb.json")).toBeNull();
    expect(seedTarget(root, undefined)).toBeNull();
  });
});
