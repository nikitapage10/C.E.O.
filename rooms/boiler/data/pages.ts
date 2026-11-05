import type { LinkState } from "../../../apps/world/src/systems.ts";
import { readClaudeCode, readSpend, type Trail } from "../../../apps/world/src/usage.ts";
import type { SecurityFeed } from "./feed.ts";
import { EVAL_AREAS, EVALS, NIST_AI_RMF, OWASP_LLM, SAIF, statusOf, type RiskStatus } from "./model.ts";
import { actionOf, type MeterTone } from "./controls.ts";

/**
 * The Boiler Room's Controls, Security and Compliance pages as one screen each (#746; Nikita, 2026-11-05 00:12Z, the
 * C3, S3 and P3 concepts): the plain reads behind their "Needs you" column and their charts. A page with nothing that
 * needs Nikita drops the column entirely and runs full width. Every chart reads real data only; one with no history
 * says what it waits for.
 */

export type NeedTone = "leak" | "shut" | "late";

/** What a need's button does: open a circuit on the page, connect Gmail, or open a link. */
export type NeedGo = { kind: "circuit"; id: string; label: string } | { kind: "gmail"; label: string } | { kind: "url"; href: string; label: string };

/** One thing waiting on Nikita, at the head of the page. */
export interface Need {
  id: string;
  tone: NeedTone;
  title: string;
  /** When it started or was last seen, in words. */
  when: string | null;
  /** When it happened (ms), for the page to say how long ago. */
  at?: number;
  body: string;
  /** Its one button; null when it needs the passkey and nobody is signed in. */
  go: NeedGo | null;
  /** What a signed-out viewer is told instead of a button. */
  locked?: string;
}

const RANK: Record<NeedTone, number> = { leak: 0, shut: 1, late: 2 };
export const byTone = (a: Need, b: Need) => RANK[a.tone] - RANK[b.tone];

/** Whether the page shows its Needs column at all: only with something in it. */
export const needsLayout = (needs: readonly Need[]): "split" | "full" => (needs.length ? "split" : "full");

/* ── Controls ── */

export interface LinkRow {
  id: string;
  label: string;
  what: string;
  room: string;
  state: LinkState;
  lastSeen: number | null;
  word?: string;
}

export interface MeterRead {
  id: string;
  name: string;
  tone: MeterTone;
  /** The share of its cap, signed in only. */
  share: number | null;
}

const SIGN_IN = "Sign in on the Desk to fix this one.";

/** Controls' needs: a link that's down, and a meter near or at its cap. */
export function controlsNeeds(links: readonly LinkRow[], meters: readonly MeterRead[], signedIn: boolean): Need[] {
  const out: Need[] = [];
  for (const l of links) {
    if (l.state !== "down") continue;
    const action = actionOf(l.id);
    const go: NeedGo =
      action.kind === "gmail" ? { kind: "gmail", label: `Reconnect ${l.label}` } : action.kind === "key" ? { kind: "circuit", id: "ct-keys", label: `Replace ${l.label}'s key` } : { kind: "circuit", id: "ct-links", label: `Reconnect ${l.label}` };
    out.push({
      id: `link-${l.id}`,
      tone: "leak",
      title: `${l.label} is down`,
      when: null,
      body: l.word ? `${l.word}. ${l.what}.` : `${l.what}. It stopped answering.`,
      go: signedIn ? go : null,
      ...(!signedIn && { locked: SIGN_IN }),
    });
  }
  for (const m of meters) {
    if (m.tone !== "warn" && m.tone !== "over") continue;
    const pct = m.share !== null ? `${Math.round(m.share * 100)}% of its cap` : m.tone === "over" ? "at its cap" : "near its cap";
    out.push({
      id: `meter-${m.id}`,
      tone: m.tone === "over" ? "shut" : "late",
      title: `${m.name} is ${m.share !== null ? `at ${pct}` : pct}`,
      when: "this month",
      body: m.tone === "over" ? "It has stopped spending until the month turns or the cap goes up." : "At this pace it reaches its cap before the month ends.",
      go: { kind: "circuit", id: "ct-meters", label: "See the meter" },
    });
  }
  return out.sort(byTone);
}

/** Live, waiting and down, for the connections donut: under load counts as live. */
export function linkTally(rows: readonly { state: LinkState }[]): { live: number; waiting: number; down: number } {
  const t = { live: 0, waiting: 0, down: 0 };
  for (const r of rows) {
    if (r.state === "down") t.down++;
    else if (r.state === "off") t.waiting++;
    else t.live++;
  }
  return t;
}

const DAY = 86_400_000;

/**
 * A daily series over the last `days` days, oldest first, from the Foundry's trails: Rivet's shaping calls, or the
 * crew's Claude Code tokens. Null when nothing in the window was recorded, so the chart says it waits instead of
 * drawing a flat line.
 */
export function dailySeries(trails: readonly Trail[], now: number, kind: "shaping-calls" | "code-tokens", days = 30): number[] | null {
  const end = Math.floor(now / DAY) * DAY + DAY;
  const start = end - days * DAY;
  const out = new Array<number>(days).fill(0);
  let seen = false;
  for (const t of trails) {
    const at = Date.parse(t.at);
    if (!(at >= start && at < end)) continue;
    const i = Math.floor((at - start) / DAY);
    if (kind === "shaping-calls") {
      if (!t.body.startsWith("**Trail · Shaped:**") || !readSpend(t.body)) continue;
      out[i] = (out[i] ?? 0) + 1;
      seen = true;
    } else {
      if (!t.body.startsWith("**Trail · Shipped:**")) continue;
      const uses = readClaudeCode(t.body);
      if (!uses.length) continue;
      out[i] = (out[i] ?? 0) + uses.reduce((a, u) => a + u.tokens, 0);
      seen = true;
    }
  }
  return seen ? out : null;
}

/** Where a link's last sync sits on a strip of the last `span` ms (0 = the far left, 1 = now); null when older or never. */
export function syncMark(lastSeen: number | null, now: number, span = DAY): number | null {
  if (lastSeen === null || !(lastSeen <= now) || now - lastSeen > span) return null;
  return 1 - (now - lastSeen) / span;
}

/** "since Nov 1": when a month ledger started counting. */
export function monthSince(now: number): string {
  const d = new Date(now);
  return `since ${new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/* ── Security ── */

type Alerts = SecurityFeed["alerts"];

/** Security's needs: a failing scan, a critical or high alert, an eval area that stopped passing. */
export function securityNeeds(feed: SecurityFeed | null, evals = EVALS): Need[] {
  const out: Need[] = [];
  for (const w of feed?.workflows ?? []) {
    if (w.state !== "fail") continue;
    out.push({ id: `scan-${w.id}`, tone: "leak", title: `${w.name} is failing`, when: null, ...(w.at && Number.isFinite(Date.parse(w.at)) && { at: Date.parse(w.at) }), body: w.scope === "pull request" ? "Its latest pull request's run failed." : "Its last run on main failed.", go: w.url ? { kind: "url", href: w.url, label: "Open the run" } : null });
  }
  const kinds: [keyof Alerts, string, string][] = [
    ["codeScanning", "code scanning", "https://github.com/nikitapage10/C.E.O./security/code-scanning"],
    ["dependabot", "Dependabot", "https://github.com/nikitapage10/C.E.O./security/dependabot"],
  ];
  for (const [k, name, href] of kinds) {
    const c = feed?.alerts[k];
    if (!c || !c.open) continue;
    const sev = c.severity;
    const hot = sev ? sev.critical + sev.high : null;
    if (hot === 0) continue;
    out.push({
      id: `alerts-${k}`,
      tone: sev && sev.critical ? "leak" : "shut",
      title: hot === null ? `${c.open} open ${name} alert${c.open === 1 ? "" : "s"}` : `${hot} ${sev!.critical ? "critical or high" : "high"} ${name} alert${hot === 1 ? "" : "s"}`,
      when: null,
      body: hot === null ? "GitHub didn't say how severe. The details stay on the Security tab." : "Counts only here. The details stay on the Security tab.",
      go: { kind: "url", href, label: "Open the Security tab" },
    });
  }
  for (const a of evals.areas) {
    if (a.passing + a.expectedFail >= a.cases) continue;
    out.push({ id: `eval-${a.id}`, tone: "leak", title: `${EVAL_AREAS.find((x) => x.id === a.id)?.area ?? a.id}: injection evals failing`, when: null, body: `${a.cases - a.passing - a.expectedFail} of ${a.cases} cases fail.`, go: null });
  }
  return out.sort(byTone);
}

/**
 * The open alerts someone can act on: code findings (CodeQL) and vulnerable packages (Dependabot). Scorecard's posture
 * checks (`alerts.posture`: branch protection, reviews, fuzzing…) are not counted, since they grade how the repo is run
 * and most close only from GitHub's settings (#901). Null when neither kind was reported.
 */
export function actionableAlerts(alerts: Alerts | undefined | null): { open: number; code: number; deps: number; more: boolean } | null {
  const cs = alerts?.codeScanning ?? null;
  const dep = alerts?.dependabot ?? null;
  if (!cs && !dep) return null;
  return { open: (cs?.open ?? 0) + (dep?.open ?? 0), code: cs?.open ?? 0, deps: dep?.open ?? 0, more: !!cs?.more || !!dep?.more };
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Security's headline, honest about what's open (#901): the scans' last runs first, then any actionable findings.
 * `lead` is the plain part and `em` the coloured part; `tone` picks the colour.
 */
export function securityHeadline(feed: SecurityFeed | null): { tone: "wait" | "fail" | "warn" | "pass"; lead: string; em: string } {
  const reported = feed?.workflows.filter((w) => w.state === "pass" || w.state === "fail") ?? [];
  if (!feed || !reported.length) return { tone: "wait", lead: "Waiting on", em: "GitHub's scans." };
  const failing = reported.filter((w) => w.state === "fail").length;
  if (failing) return { tone: "fail", lead: `${COUNT_WORDS[failing] ?? failing} ${failing === 1 ? "scan is" : "scans are"}`, em: "failing." };
  const a = actionableAlerts(feed.alerts);
  if (a && a.open) {
    const parts = [a.code ? plural(a.code, "code finding", "code findings") : "", a.deps ? plural(a.deps, "package alert", "package alerts") : ""].filter(Boolean);
    return { tone: "warn", lead: "Scans pass ·", em: `${parts.join(", ")} open.` };
  }
  return { tone: "pass", lead: "Every scan is", em: "passing." };
}

/** Each scan's trend: its marks oldest first, or null when the feed sent none (an older answer). */
export function scanTrend(w: SecurityFeed["workflows"][number] | undefined): { state: "pass" | "fail" | "other"; at: string }[] | null {
  return w?.recent && w.recent.length ? w.recent : null;
}

/** Open alerts by severity across both kinds; null when no kind reported a split. */
export function severityTotals(alerts: Alerts | undefined): Record<"critical" | "high" | "medium" | "low", number> | null {
  const kinds = [alerts?.codeScanning, alerts?.dependabot].filter((c) => !!c?.severity);
  if (!kinds.length) return null;
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const c of kinds) for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += c!.severity![k];
  return out;
}

/* ── Compliance ── */

export const STATUS_ORDER: RiskStatus[] = ["covered", "tracked", "open", "accepted", "not-applicable"];

export interface FrameworkBar {
  id: "owasp" | "nist" | "saif" | "regulation";
  name: string;
  /** Controls per status, in STATUS_ORDER. */
  counts: Record<RiskStatus, number>;
  total: number;
  /** In place: covered, and tracked (covered with more planned). */
  inPlace: number;
}

const zero = (): Record<RiskStatus, number> => ({ covered: 0, tracked: 0, open: 0, accepted: 0, "not-applicable": 0 });

/** One bar per framework the threat model maps, plus regulation, which maps nothing yet. */
export function frameworkBars(): FrameworkBar[] {
  const owasp = zero();
  for (const r of OWASP_LLM) owasp[statusOf(r.controls, r.tracking)]++;
  const all = (n: number) => ({ ...zero(), covered: n });
  return [
    { id: "owasp", name: "OWASP LLM", counts: owasp, total: OWASP_LLM.length, inPlace: owasp.covered + owasp.tracked },
    { id: "nist", name: "NIST AI RMF", counts: all(NIST_AI_RMF.length), total: NIST_AI_RMF.length, inPlace: NIST_AI_RMF.length },
    { id: "saif", name: "Google SAIF", counts: all(SAIF.length), total: SAIF.length, inPlace: SAIF.length },
    { id: "regulation", name: "Regulation", counts: zero(), total: 0, inPlace: 0 },
  ];
}

/** Compliance's needs: an OWASP risk that's open (no control and nothing tracking it). */
export function complianceNeeds(risks = OWASP_LLM): Need[] {
  return risks
    .filter((r) => statusOf(r.controls, r.tracking) === "open")
    .map((r) => ({ id: `owasp-${r.id}`, tone: "leak" as const, title: `${r.id} ${r.name} is open`, when: null, body: r.residual, go: { kind: "url" as const, href: "https://github.com/nikitapage10/C.E.O./blob/main/docs/THREAT-MODEL.md", label: "Open the threat model" } }));
}
