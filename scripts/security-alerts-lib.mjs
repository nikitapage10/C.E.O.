/**
 * The open security alerts as counts for the upkeep tick (#918). The repo is public and so are its Actions logs, so
 * this keeps to what the Desk's security feed shows (api/security-feed.ts, docs/THREAT-MODEL.md TB6): how many are
 * open, by GitHub's own severity word and by the scanner that raised them. Never a rule, file path, package, version
 * or description, since an open alert's details would be a map for an attacker.
 */

export const SEVERITIES = ["critical", "high", "medium", "low"];

/** An alert's severity on GitHub's scale, the same reading as the Desk's feed; null when GitHub gives none. */
export function severityOf(kind, alert) {
  const word = (v) => (v === "critical" || v === "high" || v === "medium" || v === "low" ? v : v === "moderate" ? "medium" : null);
  if (kind === "dependabot") return word(alert?.security_advisory?.severity) ?? word(alert?.security_vulnerability?.severity);
  const sec = word(alert?.rule?.security_severity_level);
  if (sec) return sec;
  const plain = alert?.rule?.severity;
  return plain === "error" ? "high" : plain === "warning" ? "medium" : plain === "note" ? "low" : null;
}

/** The scanner's name, kept only when it is a plain short word (CodeQL, Scorecard): anything else reads "other". */
function toolOf(kind, alert) {
  if (kind === "dependabot") return "Dependabot";
  const name = alert?.tool?.name;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9 ._-]{0,30}$/.test(name.trim()) ? name.trim() : "other";
}

/**
 * Counts for one kind of alert. `alerts` is the list GitHub returned, or a number (the HTTP status) when it refused,
 * which reads as "not reported" with that status and nothing else.
 */
export function summarize(kind, alerts, more = false) {
  if (!Array.isArray(alerts)) return { state: "unreported", status: typeof alerts === "number" ? alerts : null };
  const severity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  let unrated = 0;
  const tools = {};
  for (const a of alerts) {
    const s = severityOf(kind, a);
    if (s) severity[s] += 1;
    else unrated += 1;
    const t = toolOf(kind, a);
    tools[t] = (tools[t] ?? 0) + 1;
  }
  return { state: "read", open: alerts.length, more, severity, unrated, tools };
}

/** A short Markdown table for the job summary. */
export function renderSummary(report) {
  const row = (label, r) =>
    r.state === "read"
      ? `| ${label} | ${r.open}${r.more ? "+" : ""} | ${SEVERITIES.map((s) => r.severity[s]).join(" | ")} | ${Object.entries(r.tools).map(([t, n]) => `${t} ${n}`).join(", ") || "none"} |`
      : `| ${label} | not reported${r.status ? ` (HTTP ${r.status})` : ""} | | | | | |`;
  return [
    "### Open security alerts (counts only)",
    "",
    "| Kind | Open | Critical | High | Medium | Low | By scanner |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    row("Code scanning", report.codeScanning),
    row("Dependabot", report.dependabot),
    "",
  ].join("\n");
}
