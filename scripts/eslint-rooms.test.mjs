// The room boundary's known crossings only shrink (#617, step 14; scripts/eslint-rooms.mjs): every listed read must
// still be there, so an entry goes the moment its import does.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOWN_CROSSINGS } from "./eslint-rooms.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every relative import in a file, as a repo path. */
function importsOf(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const specs = [...src.matchAll(/(?:from|import\(?)\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  return specs.map((s) => relative(ROOT, resolve(dirname(join(ROOT, file)), s)).split(sep).join("/"));
}

describe("KNOWN_CROSSINGS", () => {
  for (const [file, targets] of Object.entries(KNOWN_CROSSINGS)) {
    it(`${file} still makes each listed read`, () => {
      const imports = importsOf(file);
      for (const t of targets) expect(imports, `${t} is no longer imported: take it off KNOWN_CROSSINGS`).toContain(t);
    });
  }

  it("lists only reads from one room into another", () => {
    const room = (p) => p.match(/^rooms\/([^/]+)\//)?.[1];
    for (const [file, targets] of Object.entries(KNOWN_CROSSINGS)) for (const t of targets) {
      expect(room(file)).toBeTruthy();
      expect(room(t)).toBeTruthy();
      expect(room(t)).not.toBe(room(file));
    }
  });
});
