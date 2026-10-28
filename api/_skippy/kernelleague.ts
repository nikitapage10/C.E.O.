/**
 * The always-on responder's read-only look at Nikita's Sleeper league (#507): standings and week-by-week matchups for
 * any past or current week, not just this week's context. Public Sleeper endpoints for one fixed league, no keys.
 * The model passes only a closed read and two week numbers; every URL is built here from api/_green/sleeper.ts, so
 * nothing the model (or a page) says can point it elsewhere. The answer is plain lines of team names and points.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { GreenBoard, GreenPlayer, GreenPos } from "../_green/types.js";
import { lineupAlert } from "./voicereads.js";
import { LEAGUE_ID, USER_ID, cleanText, getJson, shapeMatchups, shapeRosters, shapeState, shapeTeamNames, lineupSlots, urls, type Fetcher } from "../_green/sleeper.js";

export const LEAGUE_READS = ["standings", "weeks", "week", "roster"] as const;
export type LeagueRead = (typeof LEAGUE_READS)[number];
export interface LeagueArgs {
  read: LeagueRead;
  from?: number;
  to?: number;
  /** For read "week": the week, and a team name (part of it is enough; Nikita's own team when left out). */
  week?: number;
  team?: string;
}

/** Player names by Sleeper id, from the Green's kept copy of the players list (never a 15 MB read here). */
export type PlayerNames = () => Promise<Record<string, { n: string; pos: string; team: string | null; inj?: string | null }>>;

/** The most weeks one read covers, and the most text it returns. */
export const WEEKS_MAX = 8;
export const LEAGUE_TEXT_MAX = 6_000;
const LAST_WEEK = 18;

const week = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= LAST_WEEK ? v : null);
const pts = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** The league's text for a read, or a plain sentence when Sleeper doesn't answer. Never throws. */
export async function leagueText(args: unknown, fetcher: Fetcher, players: PlayerNames = async () => ({})): Promise<string> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const read: LeagueRead = a.read === "standings" || a.read === "week" || a.read === "roster" ? a.read : "weeks";
  try {
    const [usersRaw, rostersRaw, stateRaw] = await Promise.all([getJson(fetcher, urls.users(LEAGUE_ID)), getJson(fetcher, urls.rosters(LEAGUE_ID)), getJson(fetcher, urls.state()).catch(() => null)]);
    const names = shapeTeamNames(usersRaw);
    const rosters = shapeRosters(rostersRaw);
    const team = (rosterId: number) => {
      const r = rosters.find((x) => x.rosterId === rosterId);
      return cleanText((r?.ownerId && names[r.ownerId]) || `Team ${rosterId}`, 40);
    };
    if (read === "standings") {
      const rows = [...rosters].sort((x, y) => y.wins - x.wins || y.pf - x.pf);
      return rows.map((r, i) => `${i + 1}. ${team(r.rosterId)} ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}, scored ${pts(r.pf)}, allowed ${pts(r.pa)}${r.streak ? `, streak ${r.streak}` : ""}`).join("\n").slice(0, LEAGUE_TEXT_MAX);
    }
    if (read === "roster") {
      const slots = lineupSlots(await getJson(fetcher, urls.league(LEAGUE_ID)).catch(() => null));
      return rosterText(rosters.find((r) => r.ownerId === USER_ID || r.coOwners.includes(USER_ID)), await players().catch(() => ({})), stateRaw ? shapeState(stateRaw).week : 0, slots);
    }
    if (read === "week") return await oneWeek(week(a.week), typeof a.team === "string" ? a.team : "", { fetcher, rosters, team, players, nowWeek: stateRaw ? shapeState(stateRaw).week : null });
    const now = stateRaw ? shapeState(stateRaw).week : null;
    const last = week(a.to) ?? Math.max(1, Math.min(LAST_WEEK, (now ?? 7) - 1));
    const first = Math.max(week(a.from) ?? last - 5, last - WEEKS_MAX + 1, 1);
    const weeks = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    const raws = await Promise.all(weeks.map((w) => getJson(fetcher, urls.matchups(LEAGUE_ID, w)).catch(() => null)));
    const out: string[] = [];
    weeks.forEach((w, i) => {
      const rows = shapeMatchups(raws[i]).filter((m) => m.matchupId !== null);
      if (!rows.length || rows.every((m) => m.points === 0)) {
        out.push(`Week ${w}: not played yet, or nothing scored.`);
        return;
      }
      const byId = new Map<number, typeof rows>();
      for (const m of rows) byId.set(m.matchupId!, [...(byId.get(m.matchupId!) ?? []), m]);
      for (const [, pair] of [...byId].sort((x, y) => x[0] - y[0])) {
        const [p, q] = pair;
        if (!p || !q) continue;
        const result = p.points === q.points ? "tie" : `${team((p.points > q.points ? p : q).rosterId)} won`;
        out.push(`Week ${w}: ${team(p.rosterId)} ${pts(p.points)} vs ${team(q.rosterId)} ${pts(q.points)} (${result})`);
      }
    });
    return out.join("\n").slice(0, LEAGUE_TEXT_MAX) || "Sleeper has no matchups for those weeks.";
  } catch {
    return "Sleeper isn't answering right now.";
  }
}

interface WeekCtx {
  fetcher: Fetcher;
  rosters: ReturnType<typeof shapeRosters>;
  team: (rosterId: number) => string;
  players: PlayerNames;
  nowWeek: number | null;
}

/** One team's whole week: opponent, both totals, its starters and its bench with each player's points. */
async function oneWeek(w: number | null, wanted: string, c: WeekCtx): Promise<string> {
  const wk = w ?? Math.max(1, Math.min(LAST_WEEK, c.nowWeek ?? 1));
  const mine = c.rosters.find((r) => r.ownerId === USER_ID);
  const needle = cleanText(wanted, 40).toLowerCase();
  const roster = needle ? c.rosters.find((r) => c.team(r.rosterId).toLowerCase().includes(needle)) : mine;
  if (!roster) return needle ? "No team in the league matches that name." : "Couldn't tell which team is Nikita's.";
  const [raw, names] = await Promise.all([getJson(c.fetcher, urls.matchups(LEAGUE_ID, wk)).catch(() => null), c.players().catch(() => ({}))]);
  const rows = shapeMatchups(raw);
  const me = rows.find((m) => m.rosterId === roster.rosterId);
  if (!me || me.matchupId === null || me.points === 0) return `Week ${wk}: ${c.team(roster.rosterId)} has no score yet, or didn't play.`;
  const opp = rows.find((m) => m.matchupId === me.matchupId && m.rosterId !== me.rosterId);
  const who = (id: string) => {
    const p = (names as Record<string, { n: string; pos: string; team: string | null } | undefined>)[id];
    return p ? `${p.n} (${p.pos}${p.team ? `, ${p.team}` : ""})` : `player ${id}`;
  };
  const starters = me.starters.map((id, i) => (id === "0" ? null : `${who(id)} ${pts(me.startersPoints[i] ?? me.playerPoints[id] ?? 0)}`)).filter((x): x is string => x !== null);
  const started = new Set(me.starters);
  const bench = Object.entries(me.playerPoints)
    .filter(([id]) => !started.has(id))
    .sort((x, y) => y[1] - x[1])
    .map(([id, p]) => `${who(id)} ${pts(p)}`);
  const result = !opp ? "bye" : me.points === opp.points ? "tie" : me.points > opp.points ? "won" : "lost";
  return [
    `Week ${wk}: ${c.team(me.rosterId)} ${pts(me.points)}${opp ? ` vs ${c.team(opp.rosterId)} ${pts(opp.points)}` : ""} (${result})`,
    `Starters: ${starters.join("; ") || "none listed"}`,
    `Bench: ${bench.join("; ") || "none listed"}`,
  ]
    .join("\n")
    .slice(0, LEAGUE_TEXT_MAX);
}

const INJ_WORD: Record<string, string> = { O: "Out", IR: "on IR", D: "Doubtful", Q: "Questionable", SUS: "suspended", PUP: "on the PUP list", NA: "not active" };

/**
 * Sleeper's roster split into disjoint groups (#544): starter slots read strictly from `starters[]` in order, each
 * labelled by the league's `roster_positions` (an empty slot is "0"); the reserve (IR) is `reserve[]` and the taxi
 * squad `taxi[]`; the bench is everyone else on `players[]`. A player lands in exactly one group.
 */
export function rosterGroups(r: { players: string[]; starters: string[]; reserve: string[]; taxi?: string[] }, slots: string[]): { starters: { slot: string; id: string | null }[]; bench: string[]; reserve: string[]; taxi: string[] } {
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const s of slots) total.set(s, (total.get(s) ?? 0) + 1);
  const label = (i: number): string => {
    const base = slots[i];
    if (!base) return `Slot ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return (total.get(base) ?? 0) > 1 ? `${base}${n}` : base;
  };
  const used = new Set<string>();
  const starters = r.starters.map((id, i) => {
    const slot = label(i);
    if (id === "0" || used.has(id)) return { slot, id: null };
    used.add(id);
    return { slot, id };
  });
  const take = (list: string[]) => list.filter((id) => !used.has(id) && (used.add(id), true));
  const reserve = take(r.reserve);
  const taxi = take(r.taxi ?? []);
  const bench = take(r.players);
  return { starters, bench, reserve, taxi };
}

/**
 * Nikita's roster from Sleeper's own starters and bench (#526), every player with his injury status, led by the
 * lineup heads-up the voice uses (lineupAlert). Projections play no part, so an Out player is never left out.
 * Slots come from `starters[]` against the league's roster_positions (#544); the injury tag is Sleeper's feed, which
 * can differ from what the Sleeper app shows.
 */
export function rosterText(r: ReturnType<typeof shapeRosters>[number] | undefined, names: Awaited<ReturnType<PlayerNames>>, week: number, slots: string[] = []): string {
  if (!r) return "Couldn't tell which team is Nikita's.";
  const mk = (id: string): GreenPlayer => {
    const n = names[id];
    const inj = n?.inj && n.inj in INJ_WORD ? (n.inj as GreenPlayer["inj"]) : null;
    return { id, name: cleanText(n?.n || `Player ${id}`, 40), pos: (n?.pos ?? "WR") as GreenPos, team: n?.team ?? null, inj, proj: null, src: "none", avg: null, last: null, wk: null, ecr: null, posRank: null, bye: null } as GreenPlayer;
  };
  const g = rosterGroups(r, slots);
  const slotted = g.starters.map((s) => ({ slot: s.slot, player: s.id ? mk(s.id) : null }));
  const bench = g.bench.map(mk);
  const reserve = g.reserve.map(mk);
  const taxi = g.taxi.map(mk);
  const board = { week, roster: { starters: slotted.map((s) => ({ slot: s.slot, player: s.player, pts: 0 })), bench, reserve } } as unknown as GreenBoard;
  const tag = (p: GreenPlayer) => `${p.name} ${p.pos}${p.team ? ` ${p.team}` : ""}${p.inj ? ` ${INJ_WORD[p.inj]} (per Sleeper feed)` : ""}`;
  const alert = lineupAlert(board);
  return [
    alert,
    `Nikita's starters, slot by slot: ${slotted.map((s) => `${s.slot} ${s.player ? tag(s.player) : "empty"}`).join("; ") || "none listed"}.`,
    `Bench (not starting): ${bench.map(tag).join("; ") || "none"}.`,
    reserve.length ? `Reserve/IR slot: ${reserve.map(tag).join("; ")}.` : "",
    taxi.length ? `Taxi squad: ${taxi.map(tag).join("; ")}.` : "",
    "A player is in one group only. Injury tags are Sleeper's players feed, which can differ from the Sleeper app; say \"per the Sleeper feed\". Byes are not checked here.",
  ].filter(Boolean).join("\n").slice(0, LEAGUE_TEXT_MAX);
}
