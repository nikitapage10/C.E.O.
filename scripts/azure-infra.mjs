#!/usr/bin/env node
/* global process, console */
// The infra job's helper in deploy-azure.yml (#330; the logic is in azure-infra-lib.mjs). Node built-ins only, so the
// job needs no npm install. Prints names, plain values and paths, never a secret (the template takes none).
//
//   node scripts/azure-infra.mjs oid                     reads an access token on stdin, prints its object id
//   node scripts/azure-infra.mjs can-assign <roles.json> exit 0 when one of the role names can write assignments
//   node scripts/azure-infra.mjs params --main main.json --bicep infra/resources.bicep --live live.json
//        --names names.json [--cap 0.2] [--deployer <id>] [--github <id>] --out params.json
//        writes the parameters file; exits 3 (and writes nothing) when the run would drop a live app setting
//   node scripts/azure-infra.mjs whatif <whatif.json>    prints the summary; exits 4 if anything would be deleted
import { readFileSync, writeFileSync } from "node:fs";
import { buildParams, canAssign, droppedSettings, templateSettings, tokenObjectId, whatIfSummary } from "./azure-infra-lib.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] ?? "" : "";
};
const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

if (cmd === "oid") {
  const token = readFileSync(0, "utf8").trim();
  process.stdout.write(tokenObjectId(token));
} else if (cmd === "can-assign") {
  process.exit(canAssign(readJson(rest[0], [])) ? 0 : 1);
} else if (cmd === "params") {
  const main = readJson(flag("main"), null);
  if (!main) throw new Error("no compiled infra/main.bicep");
  const names = readJson(flag("names"), null);
  if (!Array.isArray(names) || !names.length) {
    console.error("Couldn't read the Function App's settings; nothing is applied.");
    process.exit(2);
  }
  const dropped = droppedSettings(names, templateSettings(readFileSync(flag("bicep"), "utf8")));
  if (dropped.length) {
    console.log(`The template would remove ${dropped.length === 1 ? "this app setting" : "these app settings"}, set outside it: ${dropped.join(", ")}.`);
    console.log("Nothing is applied. Add each to infra/resources.bicep (a secret as a Key Vault reference), or remove it in the portal.");
    process.exit(3);
  }
  const live = Object.fromEntries((readJson(flag("live"), []) ?? []).filter((s) => s && typeof s.name === "string").map((s) => [s.name, s.value]));
  const { file, notes } = buildParams({ main, live, cap: flag("cap"), deployer: flag("deployer"), github: flag("github") });
  writeFileSync(flag("out"), JSON.stringify(file, null, 2));
  for (const n of notes) console.log(n);
} else if (cmd === "whatif") {
  const { head, lines, deletes } = whatIfSummary(readJson(rest[0], {}));
  console.log(`What-if: ${head}`);
  for (const l of lines) console.log(l);
  if (deletes) {
    console.log(`The run would delete ${deletes}; nothing is applied.`);
    process.exit(4);
  }
} else {
  console.error("usage: azure-infra.mjs oid | can-assign <roles.json> | params … | whatif <whatif.json>");
  process.exit(2);
}
