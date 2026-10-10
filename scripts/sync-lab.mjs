/* global process, console */
/**
 * Copies the app's motion code into the motion lab (github.com/nikitapage10/models, lab/), so the lab runs exactly
 * what ships. TypeScript in, plain ES modules out; run after changing any of the files below.
 *
 *   node scripts/sync-lab.mjs        (expects the models repo at ../models, or set CEO_MODELS)
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repo = path.resolve(import.meta.dirname, "..");
const models = path.resolve(process.env.CEO_MODELS ?? path.join(repo, "..", "models"));
const out = path.join(models, "lab", "motion");
const FILES = ["ik.ts", "rockyPose.ts", "hanarPose.ts", "synthClips.ts"];

fs.mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const src = fs.readFileSync(path.join(repo, "apps/world/src/agents/bodies", f), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const header = `// Generated from C.E.O. apps/world/src/agents/bodies/${f} by scripts/sync-lab.mjs. Don't edit here.\n`;
  fs.writeFileSync(path.join(out, f.replace(/\.ts$/, ".js")), header + js.replace(/from "\.\/(\w+)\.ts"/g, 'from "./$1.js"'));
  console.log("lab/motion/" + f.replace(/\.ts$/, ".js"));
}
