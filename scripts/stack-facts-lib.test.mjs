/* global URL */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { databasesOf, languagesOf, lockedPackagesOf, renderStackDeps, renderStackFacts, stackFacts, topLevelOf } from "./stack-facts-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const file = (name) => readFileSync(new URL(`../api/_skippy/${name}`, import.meta.url), "utf8");

describe("Desk Skippy's stack sheet (#312)", () => {
  it("api/_skippy/stack.ts is up to date with the repo (run `npm run stack:facts` after changing it)", () => {
    expect(file("stack.ts")).toBe(renderStackFacts(root));
  });

  it("api/_skippy/stackDeps.ts matches the lockfile (npm ci and the build write it)", () => {
    expect(file("stackDeps.ts")).toBe(renderStackDeps(root));
  });

  it("reads the repo's real languages, runtime and hosts", () => {
    const f = stackFacts(root);
    expect(f.languages.present).toContain("TypeScript");
    for (const lang of f.languages.absent) expect(f.languages.present).not.toContain(lang);
    expect(f.node.engines).toMatch(/\d/);
    expect(f.hosts.join(" ")).toMatch(/Vercel/);
    expect(f.hosts.join(" ")).toMatch(/Azure Functions/);
    expect(f.services).toContain("GitHub API");
    expect(f.services).toContain("Anthropic Claude API");
    expect(f.services).toContain("OSV.dev");
  });

  it("tells a PHP, Python or Java file from the rest, by extension or manifest", () => {
    expect(languagesOf(["api/a.ts", "scripts/b.mjs"]).absent).toEqual(expect.arrayContaining(["PHP", "Python", "Java"]));
    expect(languagesOf(["x/index.php"]).present).toContain("PHP");
    expect(languagesOf(["tools/requirements.txt"]).present).toContain("Python");
    expect(languagesOf(["svc/pom.xml"]).present).toContain("Java");
  });

  it("resolves each workspace's own dependencies to their locked versions, runtime and dev apart", () => {
    const lock = {
      packages: {
        "": { dependencies: { a: "^1" }, devDependencies: { b: "^2", "@types/x": "1" } },
        "apps/w": { dependencies: { a: "^0", "@ceo/core": "0.1.0", c: "^3" } },
        "node_modules/a": { version: "1.2.3" },
        "apps/w/node_modules/a": { version: "0.9.0" },
        "node_modules/b": { version: "2.0.1", dev: true },
        "node_modules/c": { version: "3.1.0" },
        "node_modules/@ceo/core": { link: true, resolved: "packages/core" },
        "node_modules/@types/x": { version: "1.0.0", dev: true },
        "node_modules/c/node_modules/b": { version: "1.0.0" },
      },
    };
    expect(topLevelOf(lock)).toEqual({ runtime: ["a 0.9.0", "a 1.2.3", "c 3.1.0"], dev: ["b 2.0.1"] });
    const pkgs = lockedPackagesOf(lock);
    expect(pkgs.find((p) => p.name === "b" && p.version === "2.0.1")?.dev).toBe(true);
    expect(pkgs.find((p) => p.name === "b" && p.version === "1.0.0")?.dev).toBe(false);
    expect(pkgs.some((p) => p.name === "@ceo/core")).toBe(false);
    expect(databasesOf([{ name: "pg" }, { name: "react" }])).toEqual(["pg"]);
  });

  it("holds public facts only: no keys, tokens, links or account names", () => {
    const text = renderStackFacts(root) + renderStackDeps(root);
    for (const bad of [/https?:\/\//, /sk-[A-Za-z0-9]/, /gh[pousr]_[A-Za-z0-9]/, /BEGIN [A-Z ]*PRIVATE KEY/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /kv-ceo-\w/, /func-ceo-\w/, /stceo\w/, /AccountKey=/i]) {
      expect(text).not.toMatch(bad);
    }
  });
});
