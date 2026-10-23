// Writes Desk Skippy's stack sheet (#312; scripts/stack-facts-lib.mjs):
//   api/_skippy/stack.ts      the repo's facts, committed; a test fails when it falls behind
//   api/_skippy/stackDeps.ts  the lockfile's packages and versions, not committed: written at every install and build
// `npm run stack:facts` writes both, and the build runs it first. `--deps` writes only stackDeps.ts (npm ci's
// postinstall, so the committed file is never quietly fixed before the tests look at it). `--check` writes nothing
// and fails when stack.ts is behind.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderStackDeps, renderStackFacts } from "./stack-facts-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const at = (name) => fileURLToPath(new URL(`../api/_skippy/${name}`, import.meta.url));
const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const write = (path, text) => {
  if (read(path) === text) return console.log(`${path} is current`);
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
};

if (process.argv.includes("--check")) {
  if (read(at("stack.ts")) !== renderStackFacts(root)) {
    console.error("api/_skippy/stack.ts is behind the repo: run `npm run stack:facts`");
    process.exit(1);
  }
  console.log("api/_skippy/stack.ts is current");
} else {
  write(at("stackDeps.ts"), renderStackDeps(root));
  if (!process.argv.includes("--deps")) write(at("stack.ts"), renderStackFacts(root));
}
