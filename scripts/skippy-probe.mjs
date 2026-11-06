// The Skippy probe's runner (#955): the upkeep run's first step (docs/FOUNDRY.md, "The Skippy probe"), run by
// .github/workflows/skippy-probe.yml. Sends this run's battery (scripts/skippy-probe-lib.mjs) to live Skippy's dry-run
// probe endpoint (POST /api/skippy-probe, api/_skippy/probe.ts) and grades the verdicts it gets back.
//
//   SKIPPY_PROBE_TOKEN=… node scripts/skippy-probe.mjs --url=https://<site> [--run=<n>] [--out=<file.json>]
//
// The token comes from the environment only (the workflow reads `skippy-probe-token` from the Key Vault, masked) and
// is sent only to the site, in the Authorization header; it is never printed. The server never sends Skippy's words
// back, so nothing printed here, written to --out or put in the job summary holds a reply, a device reading or
// anything private: case ids, verdicts, rule ids, timings and lengths only.
//
// Exits 0 when every case passed or was skipped, 1 when one failed, 2 when the probe couldn't run (no token, the
// endpoint isn't set up, the site didn't answer).

import { appendFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { gradeCase, pickCases, summary } from "./skippy-probe-lib.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const site = (arg("url") ?? process.env.SITE ?? "").replace(/\/+$/, "");
const run = Number(arg("run") ?? process.env.GITHUB_RUN_NUMBER ?? 0);
const out = arg("out");
const token = process.env.SKIPPY_PROBE_TOKEN?.trim() ?? "";
/** Skippy's pace is eight asks a minute; a gap between cases keeps the probe well inside it. */
const GAP_MS = Number(process.env.PROBE_GAP_MS ?? 8_000);

if (!/^https:\/\/[a-z0-9.-]+$/i.test(site)) {
  console.error("Give the site as --url=https://<host>.");
  process.exit(2);
}
if (token.length < 32) {
  console.log("No SKIPPY_PROBE_TOKEN: the probe is off (docs/AZURE.md, \"The Skippy probe's key\").");
  process.exit(2);
}

async function ask(c) {
  const started = performance.now();
  const res = await fetch(`${site}/api/skippy-probe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ asks: c.asks, surface: c.surface }),
    signal: AbortSignal.timeout(120_000),
  });
  const ms = performance.now() - started;
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ms };
}

const cases = pickCases(run);
const results = [];
for (const [i, c] of cases.entries()) {
  if (i > 0) await sleep(GAP_MS);
  let got;
  try {
    got = await ask(c);
  } catch (e) {
    results.push({ id: c.id, surface: c.surface, verdict: "fail", fails: [`unreachable:${e?.name ?? "error"}`], ms: 0 });
    continue;
  }
  // Not set up or not let in: nothing after this would answer either.
  if (got.status === 503 || got.status === 401) {
    console.log(`The probe endpoint answered ${got.status}${got.body?.error ? ` (${got.body.error})` : ""}: it isn't set up on the site yet.`);
    process.exit(2);
  }
  const turns = Array.isArray(got.body?.turns) ? got.body.turns : [];
  const r = got.status === 200 ? gradeCase(c, turns, got.ms) : { id: c.id, surface: c.surface, verdict: "fail", fails: [`http:${got.status}`], ms: got.ms };
  results.push(r);
  console.log(`${r.verdict.padEnd(7)} ${c.id} (${c.surface}) ${(r.ms / 1000).toFixed(1)} s${r.tier ? ` ${r.tier}` : ""}${r.fails?.length ? `  ${r.fails.join(", ")}` : ""}${r.why ? `  ${r.why}` : ""}`);
}

const md = summary(results, run || undefined);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
if (out) writeFileSync(out, `${JSON.stringify({ run, results }, null, 2)}\n`);
process.exit(results.some((r) => r.verdict === "fail") ? 1 : 0);
