// The room boundary's known crossings only shrink (#617, step 14; scripts/eslint-rooms.mjs): every listed read must
// still be there, so an entry goes the moment its import does. The same holds for the Desk package's reads of
// apps/world (WORLD_SHARED), and ceo/desk-package is checked against a few imports.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import rooms, { KNOWN_CROSSINGS, WORLD_SHARED } from "./eslint-rooms.mjs";

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

describe("WORLD_SHARED", () => {
  it("lists only apps/world files, each still imported by the Desk's package", () => {
    const files = readdirSync(join(ROOT, "apps/desk"), { recursive: true }).map(String).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("node_modules"));
    const imported = new Set(files.flatMap((f) => importsOf(`apps/desk/${f.split(sep).join("/")}`)));
    for (const file of WORLD_SHARED) {
      expect(file).toMatch(/^apps\/world\/src\//);
      expect(imported, `${file} is no longer imported by the Desk: take it off WORLD_SHARED`).toContain(file);
    }
  });
});

// ceo/desk-package: the Desk's package reaches another app only for a WORLD_SHARED file.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" } });
const deskFile = join(ROOT, "apps/desk/src/kit/thing.ts");
const specTo = (path) => relative(dirname(deskFile), join(ROOT, path)).split(sep).join("/");

tester.run("ceo/desk-package", rooms.rules["desk-package"], {
  valid: [
    { filename: deskFile, code: `import { x } from "./other.ts";` },
    { filename: deskFile, code: `import { x } from "${specTo("apps/desk/src/Desk.tsx")}";` },
    { filename: deskFile, code: `import { x } from "@ceo/engine/web/SignIn.tsx";` },
    { filename: deskFile, code: `import { nav } from "${specTo("rooms/green/nav.ts")}";` },
    { filename: deskFile, code: `import type { T } from "${specTo("api/_boot/types.ts")}";` },
    { filename: deskFile, code: `import { S } from "${specTo("packages/simulator/src/subminds.ts")}";` },
    // Only the Desk's own files are judged.
    { filename: join(ROOT, "apps/world/src/main.tsx"), code: `import { x } from "./App.tsx";` },
    ...WORLD_SHARED.map((file) => ({ filename: deskFile, code: `import { x } from "${specTo(file)}";` })),
  ],
  invalid: [
    { filename: deskFile, code: `import { x } from "${specTo("apps/world/src/not-shared.ts")}";`, errors: [{ messageId: "app" }] },
    { filename: deskFile, code: `const m = import("${specTo("apps/world/src/App.tsx")}");`, errors: [{ messageId: "app" }] },
    { filename: deskFile, code: `export { x } from "${specTo("apps/hub/src/index.ts")}";`, errors: [{ messageId: "app" }] },
    { filename: deskFile, code: `import { x } from "@ceo/world/src/route.ts";`, errors: [{ messageId: "world" }] },
  ],
});
