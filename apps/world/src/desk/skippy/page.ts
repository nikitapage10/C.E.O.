import type { PmBoard } from "../exchange/polymarket.ts";
import type { GreenBoard, GreenPlayer } from "../green/league.ts";
import { pct, pts } from "../green/league.ts";
import type { Link } from "../../systems.ts";

/**
 * What the Desk page shows, as lines for Skippy (#341): his quick first take comes from these, so he never says he
 * has no data when the page has it. Built in the browser from what it already loaded (no extra reads, so the chat is
 * no slower), sent with the message as `page`, fenced and capped again by the function (api/_skippy/prompt.ts,
 * `readPage`) and never stored.
 *
 * Small on purpose, to keep the chat inside its monthly share: the Green's start/sit calls first (FantasyPros decides,
 * Sleeper beside it), then the Green's lineup, then the other live rooms in a line or two each: the Exchange's public
 * odds board (questions and probabilities, never Nikita's positions or any amount) and the Boiler Room's links that
 * aren't healthy. No money, messages, contacts or keys.
 */

/** The function's own caps (api/_skippy/prompt.ts): at most this many characters and lines. */
export const PAGE_MAX = 1_600;
export const PAGE_LINES = 24;
export const LINE_MAX = 360;

const who = (p: GreenPlayer) => {
  const bits = [p.pos, p.inj ? `${p.inj}` : "", `FP ${pts(p.fp ?? p.proj)}`, p.sl !== undefined ? `Sleeper ${pts(p.sl)}` : "", p.wk ? `${p.pos}${p.wk} this week` : ""].filter(Boolean);
  return `${p.name} (${bits.join(", ")})`;
};

/** The Green's start/sit calls and lineup, calls first. Empty without a board. */
export function greenLines(board: GreenBoard | null): string[] {
  if (!board) return [];
  const out: string[] = [];
  const m = board.matchup;
  const head = `Green, week ${board.week}, ${board.league.scoring}${m?.win != null ? `: win chance ${pct(m.win)}` : ""}${m?.them ? `, projected ${pts(m.me.proj)} to ${pts(m.them.proj)}` : ""}. Start/sit: ${board.sources.calls === "fp" ? "FantasyPros decides" : "form decides while FantasyPros waits"}, Sleeper beside it.`;
  out.push(head);
  for (const c of board.calls ?? []) {
    const verb = c.change ? "start" : "keep";
    const sl = c.sleeper === "unknown" ? "Sleeper has no projection" : `Sleeper ${c.sleeper}`;
    out.push(`Call ${c.slot}: ${verb} ${who(c.start)} over ${who(c.sit)}; FP edge ${pts(Math.abs(c.edge))}; ${sl}${c.split ? "; split decision" : ""}${c.tiebreak ? "; settled by the tiebreak" : ""}.`);
    if (c.tiebreak) out.push(`${c.slot} ${c.tiebreak}`);
    if (c.lateRisk) out.push(`${c.slot} ${c.lateRisk}`);
  }
  if (!board.calls?.length) out.push("No close start/sit calls this week.");
  const starters = board.roster.starters.filter((s) => s.player).map((s) => `${s.slot} ${s.player!.name} FP ${pts(s.player!.fp ?? s.player!.proj)}${s.player!.sl !== undefined ? ` / SLP ${pts(s.player!.sl)}` : ""}${s.player!.inj ? ` ${s.player!.inj}` : ""}`);
  if (starters.length) out.push(`Starters: ${starters.join("; ")}.`);
  const bench = board.roster.bench.slice(0, 6).map((p) => `${p.name} ${p.pos} FP ${pts(p.fp ?? p.proj)}${p.sl !== undefined ? ` / SLP ${pts(p.sl)}` : ""}`);
  if (bench.length) out.push(`Bench: ${bench.join("; ")}.`);
  if (board.byes.length) out.push(`On bye this week: ${board.byes.join(", ")}.`);
  return out;
}

/** The Exchange's public odds board: the top few markets and their probabilities. Never positions or amounts. */
export function exchangeLines(board: PmBoard | null): string[] {
  if (!board) return [];
  const top = [...board.watch, ...board.top].filter((m) => !m.closed).slice(0, 4);
  if (!top.length) return [];
  return [`Exchange odds board (Polymarket): ${top.map((m) => `${m.question} ${m.outcome} ${pct(m.prob)}`).join("; ")}.`];
}

/** The Boiler Room's links: how many are healthy, and the ones that aren't. */
export function boilerLines(links: readonly Link[]): string[] {
  const on = links.filter((l) => l.state !== "off");
  if (!on.length) return [];
  const bad = on.filter((l) => l.state !== "ok");
  return [`Systems: ${on.length - bad.length} of ${on.length} connected links healthy${bad.length ? `; ${bad.map((l) => `${l.label} ${l.state}`).join(", ")}` : ""}.`];
}

export interface PageInput {
  /** The Desk page Nikita is on ("/green", "/exchange", "/"). */
  path: string;
  green: GreenBoard | null;
  exchange: PmBoard | null;
  links: readonly Link[];
}

/**
 * The page block: the Green's start/sit rows first, then the room of the page Nikita is on, then the other live
 * rooms, cut at the caps (whole lines only, so a cut drops the other rooms before the Green's calls).
 */
export function pageContext(input: PageInput): string {
  const rooms: Record<string, string[]> = { exchange: exchangeLines(input.exchange), boiler: boilerLines(input.links) };
  const here = /^\/(exchange|boiler)\b/.exec(input.path)?.[1];
  const order = [greenLines(input.green), ...(here ? [rooms[here]!] : []), ...Object.entries(rooms).filter(([k]) => k !== here).map(([, v]) => v)];
  const out: string[] = [`Nikita is on the Desk's ${input.path === "/" ? "Today" : input.path.replace(/^\//, "").split("/")[0]} page.`];
  let size = out[0]!.length + 1;
  for (const l of order.flat()) {
    const line = l.replace(/\s+/g, " ").trim().slice(0, LINE_MAX);
    if (!line) continue;
    if (size + line.length + 1 > PAGE_MAX || out.length === PAGE_LINES) break;
    out.push(line);
    size += line.length + 1;
  }
  return out.length > 1 ? out.join("\n") : "";
}
