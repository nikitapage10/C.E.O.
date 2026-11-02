import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One three.js for the whole Lattice (#597). The meshes React Three Fiber builds come from the copy of three it
 * imports; StillFurniture (stillFurniture.ts) and DetailLevels compare them against the prototypes of the copy the app
 * imports. With two copies installed (Dependabot's #595 moved the app to three 0.187 while postprocessing still capped
 * three below 0.187, so npm kept 0.186.1 for the libraries) every mesh looked like it had a custom render hook and
 * shader, nothing merged, and each room drew its props one by one. This fails the checks when that happens again.
 */
const appRequire = createRequire(fileURLToPath(new URL("../../package.json", import.meta.url)));
const threeFrom = (req: NodeRequire) => realpathSync(dirname(req.resolve("three")));

describe("three.js", () => {
  it("is one copy, shared by the app and the 3D libraries it draws with", () => {
    const app = threeFrom(appRequire);
    for (const lib of ["@react-three/fiber", "@react-three/drei", "@react-three/postprocessing", "postprocessing"]) {
      const libRequire = createRequire(appRequire.resolve(lib));
      expect(threeFrom(libRequire), `${lib} resolves its own three.js`).toBe(app);
    }
  });
});
