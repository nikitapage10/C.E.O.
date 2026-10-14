#!/usr/bin/env node
/**
 * Visual QA's review (#91): sends each room's clip from scripts/room-tour.mjs to Gemini and writes what it found.
 * The logic (prompt, schema, parsing, spend cap, the second look at each finding (#137), issue text) is api/_visualqa/review.ts; this file only does the I/O.
 *
 * Usage: node scripts/visual-qa.mjs   (after scripts/room-tour.mjs)
 * Reads test-results/visual-qa/manifest.json and the clips; writes findings.json and issues.json next to them.
 *
 * Environment:
 *   GEMINI_API_KEY        the key (repo Actions secret). Without it the review is skipped and this exits 0.
 *   VISUAL_QA_MAX_USD     a lower spend cap for one run (never above the built-in $0.50).
 *   VISUAL_QA_RUNS_TODAY  set by the workflow; past the day's limit a pushed run skips the review.
 *   VISUAL_QA_DIR         where the clips are, if not test-results/visual-qa/.
 *   GITHUB_*              set by Actions: the commit, the run's link, the step summary and outputs.
 *
 * Gemini being down, slow or refusing never fails this script: it exits 0 and the report says what happened. The key
 * is never printed: every line goes through `redact`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planIssues, redact, runReview, summaryMarkdown, summaryName } from "../api/_visualqa/review.ts";

const env = process.env;
/** Where the clips are: test-results/visual-qa/, or VISUAL_QA_DIR (the tests point it at a temporary folder). */
const DIR = env.VISUAL_QA_DIR || new URL("../test-results/visual-qa/", import.meta.url).pathname;
const key = env.GEMINI_API_KEY;
const say = (line) => console.log(redact(line, key));
const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : "";

function output(name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

let report = null;
try {
  const manifestPath = join(DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    say("Visual QA: no clips (run scripts/room-tour.mjs first); nothing to review.");
  }
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { rooms: [] };
  const clips = (Array.isArray(manifest.rooms) ? manifest.rooms : [])
    .filter((r) => r && typeof r.room === "string" && typeof r.file === "string" && /^[a-z]+\.webm$/.test(r.file))
    .map((r) => ({ room: r.room, seconds: Number(r.seconds) || 0, mime: "video/webm", bytes: new Uint8Array(readFileSync(join(DIR, r.file))) }));
  report = await runReview({ fetch: (url, init) => fetch(url, init), env, clips, log: say });
} catch (e) {
  // Never fail the run over the review: say what went wrong (without the key) and carry on.
  say(`Visual QA: the review stopped early (${e instanceof Error ? e.message : "unknown error"}).`);
}

report ??= {
  version: 1,
  at: new Date().toISOString(),
  model: "",
  commit: "",
  review: "unavailable",
  note: "The review stopped early; see the log.",
  rooms: [],
  findings: [],
  confirmation: { asked: 0, limit: 0 },
  cost: { usd: 0, capUsd: 0, inputTokens: 0, outputTokens: 0 },
};
mkdirSync(DIR, { recursive: true });
const issues = planIssues(report.findings, { commit: env.GITHUB_SHA ?? "", runUrl });
writeFileSync(join(DIR, "findings.json"), redact(JSON.stringify(report, null, 2), key));
writeFileSync(join(DIR, "issues.json"), redact(JSON.stringify(issues, null, 2), key));
output("summary", summaryName(report));
output("issues", redact(JSON.stringify(issues), key));
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, redact(summaryMarkdown(report, runUrl), key) + "\n");
say(`Visual QA: ${report.review}; ${report.findings.length} findings; $${report.cost.usd.toFixed(4)} spent.`);
