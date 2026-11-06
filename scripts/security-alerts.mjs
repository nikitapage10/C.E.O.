/**
 * Reads the repo's open code scanning and Dependabot alerts and prints them as counts (#918), for the upkeep tick,
 * whose own GitHub access can't reach the alert APIs. Run by .github/workflows/security-alerts.yml; the upkeep reads
 * the result with scripts/foundry-alerts.sh.
 *
 *   CODE_SCANNING_TOKEN  a token with code scanning read (the workflow's own, `security-events: read`)
 *   DEPENDABOT_TOKEN     a token with Dependabot alerts read (the crew's App, minted read-only); optional
 *   GITHUB_REPOSITORY    owner/repo
 *
 * Prints one line `SECURITY_ALERTS {json}` and, in Actions, a table in the job summary. Counts only (see the lib);
 * a refused read prints its HTTP status and nothing else. Tokens are never printed.
 */
import { appendFileSync } from "node:fs";
import { renderSummary, summarize } from "./security-alerts-lib.mjs";

const repo = process.env.GITHUB_REPOSITORY || "nikitapage10/C.E.O.";
const PER_PAGE = 100;
const MAX_PAGES = 10;

/** Every open alert of one kind, or the HTTP status GitHub refused with (0 when there is no token or no answer). */
async function openAlerts(kind, token) {
  if (!token) return { list: 0, more: false };
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${repo}/${kind}/alerts?state=open&per_page=${PER_PAGE}&page=${page}`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}` },
      });
    } catch {
      return { list: 0, more: false };
    }
    if (!res.ok) return { list: res.status, more: false };
    const batch = await res.json();
    if (!Array.isArray(batch)) return { list: 0, more: false };
    all.push(...batch);
    if (batch.length < PER_PAGE) return { list: all, more: false };
  }
  return { list: all, more: true };
}

const [cs, dep] = await Promise.all([openAlerts("code-scanning", process.env.CODE_SCANNING_TOKEN), openAlerts("dependabot", process.env.DEPENDABOT_TOKEN)]);
const report = {
  at: new Date().toISOString(),
  codeScanning: summarize("code-scanning", cs.list, cs.more),
  dependabot: summarize("dependabot", dep.list, dep.more),
};
console.log(`SECURITY_ALERTS ${JSON.stringify(report)}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderSummary(report));
