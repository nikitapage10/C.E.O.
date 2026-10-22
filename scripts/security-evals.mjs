// Writes apps/world/src/desk/security/evals.json: how many cases the injection eval suite (api/_security/) has in
// each area, and how many of them are expected-fail, for the Desk's Security page. It runs the suite (offline, no
// API calls) and counts what actually ran. Run it after changing the suite: `npm run security:evals`.
// `--check` writes nothing and exits 1 when the file is behind; a unit test runs that, so CI keeps it current.
/* global URL, console, process */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { startVitest } from "vitest/node";

const OUT = fileURLToPath(new URL("../apps/world/src/desk/security/evals.json", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The areas, in the order of the table in docs/THREAT-MODEL.md, and the top-level blocks that belong to each. */
const AREAS = [
  { id: "rivet-prompt", file: "injection.test.ts", blocks: ["Rivet's shaping: untrusted text stays in its data blocks"] },
  { id: "rivet-answer", file: "injection.test.ts", blocks: ["Rivet's shaping: nothing outside the schema survives a bad answer"] },
  { id: "desk-write", file: "injection.test.ts", blocks: ["the Desk's write path, with GitHub and Claude stubbed"] },
  {
    id: "world-step",
    file: "injection.test.ts",
    blocks: ["the world step: a hostile hour of events", "scrub, the Lattice's second lock", "the world step: a hostile answer"],
  },
  { id: "builder-input", file: "builder-input.test.ts", blocks: null },
  { id: "skippy-chat", file: "skippy.test.ts", blocks: null },
];

function areaOf(file, block) {
  const area = AREAS.find((a) => a.file === file && (a.blocks === null || a.blocks.includes(block)));
  if (!area) throw new Error(`No area for "${block}" in ${file}: add it to AREAS in scripts/security-evals.mjs (and to docs/THREAT-MODEL.md).`);
  return area.id;
}

/** Every test under a task, with the title of the top-level block it sits in. */
function* tests(task, block) {
  for (const t of task.tasks ?? []) {
    if (t.type === "test") yield { test: t, block };
    else yield* tests(t, block ?? t.name);
  }
}

const check = process.argv.includes("--check");
const vitest = await startVitest(["api/_security/"], { root: ROOT, watch: false, run: true, reporters: [{}], silent: true });
const files = vitest.state.getFiles();
await vitest.close();

const counts = new Map(AREAS.map((a) => [a.id, { id: a.id, file: a.file, cases: 0, passing: 0, expectedFail: 0 }]));
const problems = [];
for (const file of files) {
  const name = basename(file.filepath);
  for (const { test, block } of tests(file)) {
    const state = test.result?.state;
    if (test.mode === "skip" || test.mode === "todo" || state === "skip") {
      // The suite's own "needs jq" marker is skipped whenever the suite can run; anything else skipped means a short count.
      if (!test.name.startsWith("needs jq")) problems.push(`skipped: ${test.name}`);
      continue;
    }
    if (state !== "pass") {
      problems.push(`${state ?? "not run"}: ${test.name}`);
      continue;
    }
    const c = counts.get(areaOf(name, block));
    c.cases += 1;
    if (test.fails) c.expectedFail += 1;
    else c.passing += 1;
  }
}
if (files.length === 0) problems.push("no test files ran");
if (problems.length) {
  console.error(`The eval suite didn't run cleanly, so the counts would be wrong:\n  ${problems.join("\n  ")}`);
  process.exit(2);
}

const areas = [...counts.values()];
const sum = (k) => areas.reduce((n, a) => n + a[k], 0);
const json = `${JSON.stringify({ total: sum("cases"), passing: sum("passing"), expectedFail: sum("expectedFail"), areas }, null, 2)}\n`;

if (check) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    // Missing counts as behind.
  }
  if (current !== json) {
    console.error(`${OUT} is behind the eval suite. Run \`npm run security:evals\` and commit it.\nExpected:\n${json}`);
    process.exit(1);
  }
  console.log("evals.json matches the suite");
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT}`);
}
process.exit(0);
