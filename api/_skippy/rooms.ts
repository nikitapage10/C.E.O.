/**
 * What Skippy knows about the live rooms (#478): a line or two per room in LIVE_ROOMS (packages/simulator/src/live.ts)
 * besides the Foundry, which context.ts already covers, from the same reads the Desk's room pages use. The Green:
 * Sleeper's matchup and record, the top start/sit calls (FantasyPros decides) and the Commentator's latest weekly take.
 * Relay: counts only, never a subject, a sender, a name or a contact. The Exchange: how many positions are open, and
 * their value and P&L, which only ever reach a signed-in Desk's answers (the Lattice never sees them). The Boiler
 * Room: its pipes, as which of those reads answered and how the main branch's checks and the world clock stand.
 *
 * Each room's read runs on its own, inside one time budget: a room that fails or is slow is left out (or said to be
 * quiet) and never takes the others with it. Every line goes through `line` (scrubbed, no angle brackets, short), so
 * the block stays cheap and carries nothing private. Both chats use it: typed Desk Skippy in <desk> (api/skippy.ts)
 * and voice Skippy in the `desk` variable (api/skippy-voice.ts). Pure apart from the reads handed in.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { line } from "./context.js";
import type { GreenAnalysis, GreenBoard } from "../_green/types.js";
import type { EmailStatus } from "../_email/status.js";

/** How long all the rooms' reads may take together before the chat goes on without the slow ones. */
export const ROOMS_BUDGET_MS = 2_500;
/** The most start/sit calls told. */
export const CALLS_MAX = 3;

/** The Exchange as Skippy is told it: counts and totals, never a market's amount on its own. */
export interface ExchangeRead {
  open: number;
  value: number;
  pnl: number;
}

/** One run of a workflow on main, as the Boiler Room reads it. */
export interface CheckRead {
  name: string;
  conclusion: string | null;
  status: string;
}

/** The reads, each optional: one left out is a room not connected here. */
export interface RoomReads {
  green?: () => Promise<GreenBoard | null>;
  take?: () => Promise<GreenAnalysis | null>;
  relay?: () => Promise<EmailStatus | null>;
  exchange?: () => Promise<ExchangeRead | null>;
  checks?: () => Promise<CheckRead[]>;
  /** When the world last stepped (ISO), or null. */
  clock?: () => Promise<string | null>;
}

type Got<T> = { ok: true; value: T } | { ok: false };

/** One read, never throwing, cut off at the deadline. */
async function within<T>(read: (() => Promise<T>) | undefined, ms: number): Promise<Got<T> | null> {
  if (!read) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Got<T>>((done) => {
    timer = setTimeout(() => done({ ok: false }), Math.max(0, ms));
  });
  try {
    return await Promise.race([read().then((value): Got<T> => ({ ok: true, value }), (): Got<T> => ({ ok: false })), late]);
  } finally {
    clearTimeout(timer);
  }
}

const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(1) : "?");
const money = (n: number) => `${n < 0 ? "minus " : ""}${Math.abs(n).toFixed(2)} dollars`;

/** The Green: the week, record and rank, the matchup, and the top calls. */
export function greenLines(b: GreenBoard): string[] {
  const m = b.matchup;
  const head = `Green (week ${b.week}): record ${b.me.record}, ${b.me.rank ? `rank ${b.me.rank} of ${b.league.teams}` : "unranked"}${m?.them ? `; this week projected ${num(m.me.proj)} to ${num(m.them.proj)}${m.win != null ? `, win chance ${Math.round(m.win * 100)}%` : ""}${m.live ? ", game on" : ""}` : m ? "; bye this week" : ""}${b.stale ? " (Sleeper's last good read)" : ""}.`;
  const calls = (b.calls ?? [])
    .slice(0, CALLS_MAX)
    .map((c) => `${c.slot} ${c.change ? "start" : "keep"} ${c.start.name} over ${c.sit.name} (edge ${num(Math.abs(c.edge))}${c.sleeper === "disagrees" ? ", Sleeper disagrees" : ""})`);
  const out = [line(head, 240)];
  if (calls.length) out.push(line(`Green start/sit (${b.sources.calls === "fp" ? "FantasyPros decides" : "on form, FantasyPros waiting"}): ${calls.join("; ")}.`, 300));
  return out;
}

/** The Commentator's latest weekly take: its headline only. */
export const takeLine = (a: GreenAnalysis) => line(`Green, the Commentator's take (week ${a.week}): ${a.headline}`, 240);

/** Relay: counts and states only. */
export function relayLine(s: EmailStatus): string {
  if (s.gmail !== "connected") return `Relay: Gmail ${s.gmail === "refused" ? "needs reconnecting" : "not connected yet"}.`;
  return line(`Relay: ${s.needsYou} need Nikita, ${s.fyi} FYI, ${s.newToday} new today, ${s.noise} noise, ${s.skipped} skipped as private; the agent is ${s.agent}.`, 200);
}

/** The Exchange: the open positions' count, value and P&L (signed-in answers only). */
export const exchangeLine = (e: ExchangeRead) =>
  `Exchange: ${e.open} open ${e.open === 1 ? "position" : "positions"} on Polymarket${e.open ? `, worth ${money(e.value)}, P&L ${money(e.pnl)}` : ""}.`;

const age = (iso: string | null, now: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "not running";
  const min = Math.max(0, Math.round((now - t) / 60_000));
  return min < 90 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

/** The Boiler Room's pipes: which reads answered, main's checks, and the world clock. */
export function boilerLine(pipes: Record<string, "ok" | "quiet" | "off">, checks: CheckRead[] | null, clock: string | null | undefined, now: number): string {
  const named = Object.entries(pipes).map(([k, v]) => `${k} ${v === "ok" ? "flowing" : v === "quiet" ? "not answering" : "not connected"}`);
  const runs = checks?.length ? checks.map((c) => `${c.name} ${c.status === "completed" ? (c.conclusion ?? "done") : c.status}`).join(", ") : null;
  const bits = [named.length ? `pipes: ${named.join(", ")}` : "", runs ? `main: ${runs}` : "", clock !== undefined ? `world step ${age(clock, now)}` : ""].filter(Boolean);
  return line(`Boiler Room: ${bits.join("; ") || "no pipes read"}.`, 300);
}

/** All the live rooms as lines, each read on its own inside `budgetMs`. Empty when nothing is connected. */
export async function roomLines(reads: RoomReads, now: number, budgetMs = ROOMS_BUDGET_MS): Promise<string> {
  const [green, take, relay, exchange, checks, clock] = await Promise.all([
    within(reads.green, budgetMs),
    within(reads.take, budgetMs),
    within(reads.relay, budgetMs),
    within(reads.exchange, budgetMs),
    within(reads.checks, budgetMs),
    within(reads.clock, budgetMs),
  ]);
  const out: string[] = [];
  const pipes: Record<string, "ok" | "quiet" | "off"> = {};
  const state = <T>(g: Got<T | null> | null) => (g === null ? "off" : g.ok && g.value !== null ? "ok" : "quiet");
  const safe = (f: () => string[]) => {
    try {
      out.push(...f());
    } catch {
      /* a shape this didn't expect: the room is left out */
    }
  };
  if (green) {
    pipes.Sleeper = state(green);
    if (green.ok && green.value) {
      const b = green.value;
      pipes.FantasyPros = b.sources?.fantasypros === "live" ? "ok" : "quiet";
      safe(() => greenLines(b));
    } else out.push("Green: Sleeper isn't answering right now.");
  }
  if (take?.ok && take.value) {
    const a = take.value;
    safe(() => [takeLine(a)]);
  }
  if (relay) {
    pipes.Gmail = relay.ok && relay.value?.gmail === "connected" ? "ok" : relay.ok && relay.value ? "off" : "quiet";
    if (relay.ok && relay.value) {
      const s = relay.value;
      safe(() => [relayLine(s)]);
    } else out.push("Relay: its counts aren't answering right now.");
  }
  if (exchange) {
    pipes.Polymarket = state(exchange);
    if (exchange.ok && exchange.value) {
      const e = exchange.value;
      safe(() => [exchangeLine(e)]);
    } else out.push("Exchange: Polymarket isn't answering right now.");
  }
  if (Object.keys(pipes).length || checks || clock) {
    safe(() => [boilerLine(pipes, checks?.ok ? checks.value : null, clock?.ok ? clock.value : clock ? null : undefined, now)]);
  }
  return out.join("\n");
}
