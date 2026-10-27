/**
 * What Skippy and his subminds can look up mid-call (#479): each live room read on demand, from the same reads the
 * Desk's room pages use, and cut down to short spoken-length lines for the voice agent's LLM.
 *
 *   green              the Green's league board (api/_green/route.ts): the matchup and win chance, the start/sit
 *                      calls (FantasyPros decides, Sleeper beside it), the lineup, pickups and FAAB bids, the trade
 *                      idea, the playoff odds. Team and player names and football numbers only.
 *   exchange           the Exchange's public odds board (api/_exchange/route.ts): questions and probabilities.
 *   exchange_positions Nikita's own Polymarket US book (api/_exchange/positions.ts), with its dollars. Private: this
 *                      tool exists only on the call (the Bookie's agent and Skippy's), never on a public route or in
 *                      the world.
 *   relay              the email agent's counts (api/_email/status.ts): waiting on Nikita, FYI, noise, new today.
 *                      Counts only: never a message's words, a sender, a subject or a contact.
 *   boiler             the links the Boiler Room watches, as the server sees them: the scheduled jobs on GitHub, the
 *                      world clock, Gmail, Sleeper, FantasyPros and Polymarket.
 *   foundry            the Foundry's board (api/_skippy/context.ts, the typed chat's own read) and its open pull
 *                      requests with their checks.
 *   voice_bill         the month's ElevenLabs ledger (api/_world/story.ts): the talk's minutes and dollars against its
 *                      share and the $10 cap. Private, like the positions.
 *
 * Every line from outside (a market's question, a player's name, an issue's title) goes through `scrub` as the public
 * feeds do (api/_world/digest.ts): no emails, links, keys, phone numbers or amounts. Only the two private reads write a
 * dollar figure, from numbers, never from text.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { scrub } from "../_world/digest.js";
import type { GreenBoard, GreenPlayer } from "../_green/types.js";
import type { PmBoard, PmPositions } from "../_exchange/types.js";
import type { EmailStatus } from "../_email/status.js";
import type { JobRun, OpenPull } from "../foundry-feed.js";
import type { StoryMonth } from "../_world/story.js";

/** The reads the tools offer, by the name the webhook passes (`?read=`). */
export const READS = ["green", "exchange", "exchange_positions", "relay", "boiler", "foundry", "voice_bill"] as const;
export type ReadName = (typeof READS)[number];
export const isRead = (v: unknown): v is ReadName => typeof v === "string" && (READS as readonly string[]).includes(v);

/** The reads that carry money: only ever answered on the call. */
export const PRIVATE_READS: readonly ReadName[] = ["exchange_positions", "voice_bill"];

/** The most one answer says (characters): about 600 tokens for the call's LLM. */
export const READ_MAX = 2_400;

/** One outside string as the call may hear it: scrubbed, no braces or angle brackets, one line, short. */
export function said(text: unknown, max = 90): string {
  const t = scrub(typeof text === "string" ? text.slice(0, 600) : "").replace(/[{}<>＜＞]/g, "");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const pts = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : "no projection");
const pct = (p: number | null | undefined) => (typeof p === "number" && Number.isFinite(p) ? `${Math.round(p * 100)} percent` : "unknown");
const usd = (n: number) => `${n < 0 ? "minus " : ""}$${Math.abs(Math.round(n * 100) / 100).toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Lines cut to the cap, whole lines only. */
export function capLines(lines: string[], max = READ_MAX): string {
  const out: string[] = [];
  let size = 0;
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (!l) continue;
    if (size + l.length + 1 > max) break;
    out.push(l);
    size += l.length + 1;
  }
  return out.join("\n");
}

const who = (p: GreenPlayer) => `${said(p.name, 40)} (${p.pos}${p.inj ? `, ${p.inj}` : ""}, FantasyPros ${pts(p.fp ?? p.proj)}${p.sl !== undefined ? `, Sleeper ${pts(p.sl)}` : ""})`;

/** The Green, for Skippy and the Commentator. */
/**
 * Which week the matchup is, said plainly (#506): a week whose games are over is "final", never "this week"; Sleeper's
 * next week is "up next" until it starts; a week under way is "live". Nikita heard last week's final as "this week you're
 * at 128 to 75" on a Tuesday call.
 */
export function weekFrame(b: GreenBoard): { final: boolean; line: string } {
  const m = b.matchup;
  const week = m?.week ?? b.week;
  const final = b.nflWeek !== undefined && b.nflWeek > week;
  const next = final ? ` Week ${b.nflWeek} is up next and hasn't started.` : "";
  if (!m) return { final, line: `No matchup in week ${week}.${next}` };
  if (!m.them) return { final, line: `Week ${week}: bye for the C.E.O.'s team.${next}` };
  const vs = `against ${said(m.them.team, 40)} (${m.them.record})`;
  if (final) {
    const how = m.me.pts > m.them.pts ? "a win" : m.me.pts < m.them.pts ? "a loss" : "a tie";
    return { final, line: `Week ${week} is final: ${pts(m.me.pts)} to ${pts(m.them.pts)} ${vs}, ${how}.${next}` };
  }
  const odds = `projected ${pts(m.me.proj)} to ${pts(m.them.proj)}, win chance ${pct(m.win)}`;
  if (m.live) return { final, line: `Week ${week}, live now ${vs}: ${pts(m.me.pts)} to ${pts(m.them.pts)} so far, ${odds}.` };
  if (!m.me.pts && !m.them.pts) return { final, line: `Week ${week}, upcoming ${vs}: no games yet, ${odds}.` };
  return { final, line: `Week ${week} ${vs}, between games: ${pts(m.me.pts)} to ${pts(m.them.pts)} so far, ${odds}.` };
}

const INJ_WORD: Record<string, string> = { O: "Out", IR: "on IR", D: "Doubtful", SUS: "suspended", PUP: "on the PUP list", NA: "not active", Q: "Questionable" };
const GRIM = new Set(["O", "IR", "D", "SUS", "PUP", "NA"]);

/**
 * The start/sit sanity flag (#520): every starter who is Out, on IR, Doubtful or on bye this week, said first, with the
 * healthy bench player at his position. Built from Sleeper's starters and bench, never from a projection, so an Out
 * player FantasyPros has no line on still shows. "" when the lineup is sound.
 */
export function lineupAlert(b: GreenBoard): string {
  const week = b.week;
  const bad = (b.roster?.starters ?? []).flatMap((s) => (s.player && (s.player.inj && GRIM.has(s.player.inj) || (s.player.bye !== null && s.player.bye === week)) ? [{ slot: s.slot, p: s.player }] : []));
  if (!bad.length) return "";
  const used = new Set<string>();
  const out = bad.slice(0, 3).map(({ slot, p }) => {
    const why = p.inj && GRIM.has(p.inj) ? INJ_WORD[p.inj] : "on bye this week";
    const alt = [...(b.roster?.bench ?? [])].filter((x) => x.pos === p.pos && !used.has(x.id) && !(x.inj && GRIM.has(x.inj)) && !(x.bye !== null && x.bye === week)).sort((x, y) => (y.proj ?? -1) - (x.proj ?? -1))[0];
    if (alt) used.add(alt.id);
    return `your starting ${p.pos === "DEF" ? "D/ST" : slot.includes("FLEX") ? `${slot} ${p.pos}` : p.pos} ${said(p.name, 30)} is ${why}.${alt ? ` ${said(alt.name, 30)} is on your bench.` : ` No healthy ${p.pos} on your bench.`}`;
  });
  return `Heads up: ${out.join(" Also ")}`;
}

/** Every rostered player Sleeper lists with an injury, starters, bench and reserve alike. */
function injuredRoster(b: GreenBoard): string {
  const all = [...b.roster.starters.flatMap((s) => (s.player ? [s.player] : [])), ...(b.roster.bench ?? []), ...(b.roster.reserve ?? [])].filter((p) => p.inj);
  return all.map((p) => `${said(p.name, 30)} ${p.pos} ${INJ_WORD[p.inj!] ?? p.inj}`).join("; ");
}

export function greenText(b: GreenBoard | null): string {
  if (!b || b.ok !== true) return "The Green's board isn't answering right now.";
  const m = b.matchup;
  const frame = weekFrame(b);
  const lines = [
    `Green, ${said(b.league.name, 60)}, week ${b.week}${frame.final ? " (final)" : ""}${b.stale ? " (last good read, Sleeper is slow)" : ""}. ${said(b.me.team, 40)} is ${b.me.record}, rank ${b.me.rank} of ${b.league.teams}.`,
    lineupAlert(b),
    frame.line,
    `Start/sit: ${b.sources.calls === "fp" ? "FantasyPros decides, Sleeper beside it" : "form decides while FantasyPros waits"}.`,
  ];
  const starters = b.roster.starters.filter((s) => s.player).map((s) => `${s.slot} ${said(s.player!.name, 30)} ${pts(s.player!.fp ?? s.player!.proj)}${s.player!.inj ? ` ${s.player!.inj}` : ""}${m?.live ? ` (${pts(s.pts)} scored)` : ""}`);
  if (starters.length) lines.push(`Starters: ${starters.join("; ")}.`);
  const bench = b.roster.bench.map((p) => `${said(p.name, 30)} ${p.pos} ${pts(p.fp ?? p.proj)}${p.inj ? ` ${p.inj}` : ""}`);
  if (bench.length) lines.push(`Bench: ${bench.join("; ")}.`);
  const hurt = injuredRoster(b);
  if (hurt) lines.push(`Injury list (Sleeper): ${hurt}.`);
  for (const c of (b.calls ?? []).slice(0, 5)) {
    lines.push(`${c.slot}: ${c.change ? "start" : "keep"} ${who(c.start)} over ${who(c.sit)}, edge ${pts(Math.abs(c.edge))}; Sleeper ${c.sleeper}${c.split ? ", split decision" : ""}${c.tiebreak ? `; tiebreak: ${said(c.tiebreak, 140)}` : ""}${c.lateRisk ? `; late-game risk: ${said(c.lateRisk, 120)}` : ""}.`);
  }
  if (!b.calls?.length) for (const s of b.swaps.slice(0, 3)) lines.push(`${s.slot}: start ${who(s.in)}${s.out ? ` over ${who(s.out)}` : ""}, gains ${pts(s.gain)}.`);
  if (b.byes.length) lines.push(`On bye: ${b.byes.map((t) => said(t, 4)).join(", ")}.`);
  const bids = (b.bids ?? []).slice(0, 3).map((x) => `${said(x.player.name, 30)} ${x.player.pos}, bid ${x.bid} FAAB (${x.low} to ${x.high})${x.drop ? `, drop ${said(x.drop.name, 30)}` : ""}`);
  if (bids.length) lines.push(`Waiver bids${b.me.faabLeft !== null ? ` (${b.me.faabLeft} FAAB left)` : ""}: ${bids.join("; ")}.`);
  else {
    const ups = b.pickups.slice(0, 3).map((x) => `${said(x.player.name, 30)} ${x.player.pos}${x.drop ? `, drop ${said(x.drop.name, 30)}` : ""}`);
    if (ups.length) lines.push(`Pickups: ${ups.join("; ")}.`);
  }
  if (b.trade) lines.push(`Trade idea with ${said(b.trade.team, 40)}: give ${b.trade.give.map((p) => said(p.name, 30)).join(" and ")}, get ${b.trade.get.map((p) => said(p.name, 30)).join(" and ")}. ${said(b.trade.why, 160)}`);
  if (b.odds) lines.push(`Playoff chance ${pct(b.odds.playoff)}, ${plural(b.odds.weeksLeft, "week")} left, top ${b.odds.playoffTeams} make it.${b.odds.swing[0] ? ` Root for ${said(b.odds.swing[0].root, 40)} in ${said(b.odds.swing[0].a, 40)} against ${said(b.odds.swing[0].b, 40)}.` : ""}`);
  const news = (b.news ?? []).filter((n) => n.whose === "mine").slice(0, 2).map((n) => `${said(n.name, 30)}: ${said(n.text, 120)}`);
  if (news.length) lines.push(`News on the C.E.O.'s players: ${news.join("; ")}.`);
  return capLines(lines);
}

/** The Exchange's public odds board: questions and probabilities, never an amount. */
export function exchangeText(b: PmBoard | null): string {
  if (!b || b.ok !== true) return "The Exchange's odds board isn't answering right now.";
  const move = (c: number | null) => (c === null || Math.abs(c) < 0.005 ? "" : `, ${c > 0 ? "up" : "down"} ${Math.round(Math.abs(c) * 100)} points today`);
  const row = (q: PmBoard["top"][number]) => `${said(q.question, 120)}: ${said(q.outcome, 30)} ${pct(q.prob)}${move(q.change24h)}`;
  const lines = [`Exchange odds board (Polymarket, public)${b.stale ? ", last good read" : ""}.`];
  const watch = b.watch.filter((m) => !m.closed).slice(0, 4);
  if (watch.length) lines.push(`Watchlist: ${watch.map(row).join("; ")}.`);
  const top = b.top.filter((m) => !m.closed).slice(0, 5);
  if (top.length) lines.push(`Busiest: ${top.map(row).join("; ")}.`);
  const world = b.world.slice(0, 3);
  if (world.length) lines.push(`World markets: ${world.map(row).join("; ")}.`);
  return capLines(lines);
}

/** Nikita's own book, with its dollars: only on the call. */
export function positionsText(p: PmPositions | null): string {
  if (!p) return "The C.E.O.'s book isn't answering right now.";
  if (p.state === "waiting") return p.reason === "no-key" ? "The C.E.O.'s Polymarket US book isn't connected yet." : "Polymarket US didn't accept its key, so the book can't be read.";
  const t = p.totals;
  const lines = [
    `The C.E.O.'s Polymarket US book${p.stale ? " (last good read)" : ""}: ${plural(t.open, "open position")}, worth ${usd(t.value)} against ${usd(t.cost)} paid, ${t.pnl >= 0 ? "up" : "down"} ${usd(Math.abs(t.pnl))}${p.more ? ", more than the board reads" : ""}.`,
  ];
  for (const x of p.positions.filter((q) => !q.expired).slice(0, 6)) {
    lines.push(`${said(x.market, 100)}, ${x.short ? "short " : ""}${said(x.outcome, 30)}: ${Math.round(x.contracts)} contracts${x.avgPrice !== null ? ` at ${Math.round(x.avgPrice * 100)} cents` : ""}, worth ${usd(x.value)}, ${x.pnl >= 0 ? "up" : "down"} ${usd(Math.abs(x.pnl))}${x.pnlPct !== null ? ` (${Math.round(x.pnlPct)} percent)` : ""}.`);
  }
  const recent = p.activity.filter((a) => a.kind !== "voided").slice(0, 3).map((a) => `${a.kind === "settled" ? "settled" : "traded"} ${said(a.market, 80)}`);
  if (recent.length) lines.push(`Lately: ${recent.join("; ")}.`);
  return capLines(lines);
}

/** Relay: counts only. Built from the checked status (readEmailStatus), so nothing else can ride along. */
export function relayText(s: EmailStatus | null): string {
  if (!s) return "Relay's inbox count isn't answering right now.";
  if (s.gmail !== "connected") return s.gmail === "refused" ? "Relay: Gmail refused its access; the C.E.O. needs to connect it again on the Desk." : "Relay: Gmail isn't connected yet.";
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  const agent = { waiting: "waiting to start", listening: "listening", paused: "paused (its monthly cap)", error: "having trouble" }[s.agent] ?? "unknown";
  const checked = typeof s.lastCheck === "number" ? `, last checked ${Math.max(0, Math.round((s.at - s.lastCheck) / 60_000))} minutes before this read` : "";
  return capLines([
    `Relay (email, counts only): ${plural(n(s.needsYou), "mail")} waiting on the C.E.O., ${n(s.fyi)} FYI, ${n(s.noise)} noise today, ${n(s.newToday)} new today${n(s.unsorted) ? `, ${n(s.unsorted)} not sorted yet` : ""}${n(s.skipped) ? `, ${n(s.skipped)} private ones counted and left alone` : ""}.`,
    `The email agent is ${agent}${checked}; ${Math.round(n(s.budgetPct))} percent of its monthly cap used. Texts aren't connected yet.`,
  ]);
}

export interface BoilerInput {
  jobs: JobRun[] | null;
  open: OpenPull[] | null;
  /** When the world last stepped (ISO), and its hour. */
  world: { step: number; at: string | null } | null;
  email: EmailStatus | null;
  green: GreenBoard | null;
  exchange: PmBoard | null;
  now: number;
}

/** A job's run in a word. */
const runWord = (r: JobRun) => (r.status !== "completed" ? "running" : r.conclusion === "success" ? "green" : r.conclusion === "skipped" ? "skipped" : `red (${said(r.conclusion ?? "unknown", 20)})`);
const ago = (iso: string | null, now: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "never";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 90 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`;
};

/** The Boiler Room: the links that matter, healthy or not, worst first. */
export function boilerText(i: BoilerInput): string {
  const bad: string[] = [];
  const ok: string[] = [];
  const put = (good: boolean, line: string) => (good ? ok : bad).push(line);
  for (const r of i.jobs ?? []) put(runWord(r) === "green" || runWord(r) === "running" || runWord(r) === "skipped", `${said(r.name, 40)} ${runWord(r)}, ${ago(r.run_started_at ?? r.created_at, i.now)}`);
  if (!i.jobs) bad.push("GitHub's job board didn't answer");
  if (i.world) put(!!i.world.at && i.now - Date.parse(i.world.at) < 2 * 3_600_000, `world clock at hour ${i.world.step}, stepped ${ago(i.world.at, i.now)}`);
  else bad.push("world clock not running");
  if (i.email) put(i.email.gmail === "connected" && i.email.agent !== "error", `Gmail ${i.email.gmail}, agent ${i.email.agent}`);
  if (i.green) {
    put(!i.green.stale, `Sleeper ${i.green.stale ? "slow (last good read)" : "live"}`);
    put(i.green.sources.fantasypros !== "failed", `FantasyPros ${i.green.sources.fantasypros}`);
  } else bad.push("Sleeper didn't answer");
  if (i.exchange) put(!i.exchange.stale, `Polymarket ${i.exchange.stale ? "slow (last good read)" : "live"}`);
  else bad.push("Polymarket didn't answer");
  const red = (i.open ?? []).filter((p) => p.checks === "fail").map((p) => `pull request number ${p.number}`);
  if (red.length) bad.push(`red checks on ${red.join(", ")}`);
  return capLines([
    `Boiler Room: ${bad.length ? `${plural(bad.length, "thing")} to look at, ${ok.length} healthy` : `all ${ok.length} healthy`}.`,
    ...(bad.length ? [`Needs a look: ${bad.join("; ")}.`] : []),
    ...(ok.length ? [`Healthy: ${ok.join("; ")}.`] : []),
  ]);
}

/** The Foundry: the typed chat's board lines (already scrubbed) and the open pull requests' checks. */
export function foundryText(board: string, open: OpenPull[] | null): string {
  const prs = (open ?? []).slice(0, 8).map((p) => `number ${p.number}${p.issue ? ` (issue ${p.issue})` : ""}${p.draft ? " draft" : ""}: checks ${p.checks === "pass" ? "green" : p.checks === "fail" ? "red" : p.checks}`);
  const lines = board
    .split("\n")
    .map((l) => said(l, 240))
    .filter(Boolean);
  return capLines([...lines, prs.length ? `Open pull requests: ${prs.join("; ")}.` : "No open pull requests."]);
}

export interface BillInput {
  month: Required<StoryMonth>;
  /** The talk's share and ElevenLabs' whole cap, in dollars. */
  share: number;
  cap: number;
  usdPerMin: number;
  sessionSecs: number;
}

/** The month's ElevenLabs ledger, with its dollars: only on the call. */
export function billText(b: BillInput): string {
  const m = b.month;
  const leftUsd = Math.max(0, Math.min(b.share - m.voiceUsd, b.cap - m.elevenUsd));
  const leftMin = Math.floor((leftUsd / b.usdPerMin) * 10) / 10;
  return capLines([
    `ElevenLabs this month: ${usd(m.elevenUsd)} of the ${usd(b.cap)} cap, the talk ${usd(m.voiceUsd)} of its ${usd(b.share)} share over ${plural(m.voiceCalls, "call")} and ${Math.round(m.voiceSecs / 6) / 10} minutes; the stories ${usd(Math.max(0, m.elevenUsd - m.voiceUsd))}.`,
    `Left for talking: about ${leftMin} minutes. Each call is counted at its longest, ${Math.round(b.sessionSecs / 60)} minutes, until it settles.`,
  ]);
}
