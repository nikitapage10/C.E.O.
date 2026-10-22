import { create } from "zustand";
import type { CallSource, FpParts, FpState, GreenBoard, GreenPickup, GreenPlayer, GreenSide, GreenSlot, GreenStanding, GreenSwap } from "../../../../../api/_green/types.ts";
import { useSystems, type LinkState } from "../../systems.ts";

/**
 * Nikita's Sleeper league for the Green (#252), browser side: reads GET /api/green-league (Sleeper's public data, and
 * FantasyPros' where its key is set, put together and cached on the server) every two minutes while the tab is
 * showing. Feeds the Desk's Green page, the Green's room in the Lattice, the Today page's Green thread, and the Sleeper
 * and FantasyPros links on Systems and in the Boiler Room. Read-only: the moves are made in Sleeper.
 */

export type { CallSource, FpParts, FpState, GreenBoard, GreenPickup, GreenPlayer, GreenSide, GreenSlot, GreenStanding, GreenSwap };

const PATH = "/api/green-league";
const POLL_MS = 120_000;

/** "idle" before the first answer; "off" where the route doesn't exist (a local preview); "absent" when Nikita has no team in the league. */
export type GreenStatus = "idle" | "ready" | "off" | "failed" | "absent";

const isNum = (n: unknown, lo = -1e6, hi = 1e6) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
const isStr = (s: unknown, max = 120) => typeof s === "string" && s.length <= max;
const POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

/** Just enough of a check that a player has the board's shape before he is drawn. */
export function isPlayer(v: unknown): v is GreenPlayer {
  const p = v as Partial<GreenPlayer> | null;
  return !!p && typeof p === "object" && isStr(p.id, 12) && isStr(p.name) && POS.has(p.pos as string) && (p.proj === null || isNum(p.proj, -50, 150)) && (p.avg === null || isNum(p.avg, -50, 150)) && (p.ecr === null || isNum(p.ecr, 1, 5000));
}

const isSlot = (v: unknown): v is GreenSlot => {
  const s = v as Partial<GreenSlot> | null;
  return !!s && isStr(s.slot, 12) && (s.player === null || isPlayer(s.player)) && isNum(s.pts, -100, 300);
};

const side = (v: unknown): GreenSide | null => {
  const s = v as Partial<GreenSide> | null;
  if (!s || typeof s !== "object" || !isStr(s.team) || !isNum(s.pts) || !isNum(s.proj) || !Array.isArray(s.starters)) return null;
  return { rosterId: Number(s.rosterId) || 0, team: s.team!, record: isStr(s.record, 12) ? s.record! : "", pts: s.pts!, proj: s.proj!, starters: s.starters.filter(isSlot) };
};

const count = (n: unknown) => (isNum(n, 0, 100_000) ? Math.round(n as number) : 0);

/** FantasyPros' diagnostics as the server sent them: counts, and short part names with a status. */
export function readParts(v: unknown): FpParts | null {
  const p = v as Partial<FpParts> | null;
  if (!p || typeof p !== "object") return null;
  const errors = (Array.isArray(p.errors) ? p.errors : [])
    .filter((e): e is FpParts["errors"][number] => !!e && isStr(e.part, 40) && /^[A-Za-z ]+$/.test(e.part) && (isNum(e.status, 100, 599) || e.status === "timeout" || e.status === "error"))
    .slice(0, 20)
    .map((e) => ({ part: e.part, status: e.status }));
  return { proj: count(p.proj), weekly: count(p.weekly), ros: count(p.ros), injuries: count(p.injuries), errors };
}

/** "FantasyPros: live · 312 projections · 290 ranked this week", and any part that failed with its status. */
export function fpLine(b: GreenBoard): string {
  const fp = b.sources.fantasypros;
  const head = `FantasyPros: ${fp === "live" ? "live" : fp === "failed" ? "not answering" : "waiting"}`;
  const p = b.sources.fpParts;
  if (!p) return head;
  const bits = [`${p.proj} projections`, `${p.weekly} ranked this week`, `${p.ros} rest of season`, `${p.injuries} injuries`];
  const errs = p.errors.map((e) => `${e.part} ${e.status}`);
  return [head, ...bits, ...(errs.length ? [`failed: ${errs.join(", ")}`] : [])].join(" · ");
}

/** The board as the server sent it, anything off-shape dropped; null when it isn't a board. */
export function readGreen(v: unknown): GreenBoard | null {
  const b = v as Partial<GreenBoard> | null;
  if (!b || typeof b !== "object" || b.ok !== true || typeof b.at !== "string" || !isNum(b.week, 0, 25) || !b.me || !b.league || !b.roster || !Array.isArray(b.roster.starters)) return null;
  const me = side(b.matchup?.me);
  const fp: FpState = b.sources?.fantasypros === "live" || b.sources?.fantasypros === "failed" ? b.sources.fantasypros : "waiting";
  return {
    ok: true,
    at: b.at,
    season: isStr(b.season, 8) ? b.season! : "",
    week: b.week!,
    league: { id: /^\d{1,24}$/.test(b.league.id ?? "") ? b.league.id : "", name: isStr(b.league.name) ? b.league.name : "The league", teams: Number(b.league.teams) || 0, scoring: isStr(b.league.scoring, 20) ? b.league.scoring : "", faab: isNum(b.league.faab, 0, 10000) ? b.league.faab : null },
    me: {
      rosterId: Number(b.me.rosterId) || 0,
      team: isStr(b.me.team) ? b.me.team : "Your team",
      record: isStr(b.me.record, 12) ? b.me.record : "",
      rank: Number(b.me.rank) || 0,
      pf: isNum(b.me.pf) ? b.me.pf : 0,
      pa: isNum(b.me.pa) ? b.me.pa : 0,
      benchLeft: isNum(b.me.benchLeft, 0) ? b.me.benchLeft : null,
      faabLeft: isNum(b.me.faabLeft, 0) ? b.me.faabLeft : null,
      streak: isStr(b.me.streak, 4) ? b.me.streak : null,
    },
    roster: { starters: b.roster.starters.filter(isSlot), bench: (b.roster.bench ?? []).filter(isPlayer), reserve: (b.roster.reserve ?? []).filter(isPlayer) },
    matchup: b.matchup && me ? { week: Number(b.matchup.week) || b.week!, me, them: side(b.matchup.them), win: isNum(b.matchup.win, 0, 1) ? b.matchup.win : null, live: b.matchup.live === true } : null,
    swaps: (b.swaps ?? []).filter((s): s is GreenSwap => !!s && isPlayer(s.in) && (s.out === null || isPlayer(s.out)) && isNum(s.gain) && isStr(s.why, 200)),
    pickups: (b.pickups ?? []).filter((p): p is GreenPickup => !!p && isPlayer(p.player) && isNum(p.adds, 0, 1e9) && isStr(p.why, 300) && (p.drop === null || isPlayer(p.drop))),
    standings: (b.standings ?? []).filter((s): s is GreenStanding => !!s && isStr(s.team) && isNum(s.wins, 0, 30) && isNum(s.losses, 0, 30) && isNum(s.pf)),
    dropping: (b.dropping ?? []).filter((d) => !!d && isPlayer(d.player) && isNum(d.drops, 0, 1e9)),
    byes: Array.isArray(b.byes) ? b.byes.filter((t): t is string => typeof t === "string" && /^[A-Z]{2,3}$/.test(t)).slice(0, 32) : [],
    sources: { sleeper: "live", fantasypros: fp, fpAt: typeof b.sources?.fpAt === "string" ? b.sources.fpAt : null, calls: b.sources?.calls === "fp" ? "fp" : "form", fpParts: readParts(b.sources?.fpParts) },
    ...(b.stale === true && { stale: true }),
  };
}

/** Whether a player sits out this week because his team has no game. */
export const onBye = (p: GreenPlayer | null | undefined, week: number) => !!p && p.bye !== null && p.bye === week;

/** Where the start-or-sit calls come from, in words. */
export const callsWord = (b: GreenBoard) => (b.sources.calls === "fp" ? "Calls from FantasyPros" : `Calls from form here (FantasyPros ${b.sources.fantasypros === "failed" ? "not answering" : b.sources.fantasypros === "live" ? "has no projections for this week yet" : "waiting"})`);

/* ── how the numbers read ── */

export const pts = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(1));
export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** "1st", "2nd", "11th", "23rd". */
export function ordinal(n: number): string {
  const t = n % 100;
  const suffix = t >= 11 && t <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Where the ball sits for a win chance: a field from your goal line (0%) to theirs (100%). */
export function yardLine(win: number): { x: number; words: string } {
  const yd = Math.round(win * 100);
  if (yd === 50) return { x: 0.5, words: "Ball at midfield" };
  if (yd >= 100) return { x: 1, words: "In the end zone" };
  if (yd <= 0) return { x: 0, words: "Backed up in your own end zone" };
  return { x: yd / 100, words: yd > 50 ? `Ball on their ${100 - yd}` : `Ball on your own ${yd}` };
}

const ONES = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
/** 0..100 in capitals, as the Commentator says them: "SEVENTY-ONE". */
export function sayNumber(n: number): string {
  const k = Math.max(0, Math.min(100, Math.round(n)));
  if (k === 100) return "ONE HUNDRED";
  if (k < 20) return ONES[k]!;
  return TENS[Math.floor(k / 10)]! + (k % 10 ? `-${ONES[k % 10]}` : "");
}

/** The Commentator's call on this week, from the real numbers: one or two short lines, in capitals when it's excited. */
export function commentatorCall(b: GreenBoard): string {
  const m = b.matchup;
  if (!m) return `No game on the board in week ${b.week}, folks. The Commentator is calling the standings instead: ${b.me.team}, ${b.me.record}.`;
  if (!m.them) return `A BYE WEEK. Dead air. The Commentator's least favourite thing. ${b.me.team} rests at ${b.me.record}.`;
  const lead = round1(m.me.proj - m.them.proj);
  const call = m.win === null ? "" : m.win >= 0.8 ? `${sayNumber(m.win * 100)} PERCENT! THIS ONE'S IN THE BAG, FOLKS!` : m.win >= 0.6 ? `${sayNumber(m.win * 100)} PERCENT. ${b.me.team.toUpperCase()} IS DRIVING.` : m.win > 0.4 ? `A COIN FLIP! ${sayNumber(m.win * 100)} PERCENT! THE CROWD IS ON ITS FEET!` : `${sayNumber(m.win * 100)} PERCENT. It's a long field, folks. Long. Field.`;
  const live = m.live ? ` Live: ${pts(m.me.pts)} to ${pts(m.them.pts)}.` : ` Projected ${pts(m.me.proj)} to ${pts(m.them.proj)}${lead ? `, ${lead > 0 ? "up" : "down"} ${Math.abs(lead).toFixed(1)}` : ""}.`;
  const swap = b.swaps[0];
  const tail = swap ? ` And a call from the booth: start ${swap.in.name}${swap.out ? ` over ${swap.out.name}` : ""}.` : "";
  return `${call}${live}${tail}`.trim();
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ── the Lattice's Green room (rooms/Green.tsx) ── */

/** The scoreboard's line from Nikita's real matchup (#252): the live score once a game is on, else the week and the win chance. */
export function scoreboardLine(board: GreenBoard | null): string {
  const m = board?.matchup;
  if (!board || !m) return board ? `WEEK ${board.week} · NO GAME` : "-- · --";
  if (!m.them) return `WEEK ${m.week} · BYE`;
  if (m.live) return `US ${m.me.pts.toFixed(1)} · THEM ${m.them.pts.toFixed(1)}`;
  return m.win === null ? `WEEK ${m.week} · KICKOFF` : `WEEK ${m.week} · WIN ${Math.round(m.win * 100)}%`;
}

/** A claim worth making: a pickup that clearly beats someone on the bench, or covers an injured starter. */
export function claimWaiting(board: GreenBoard | null): boolean {
  return !!board?.pickups.some((p) => p.drop !== null || p.why.startsWith("Covers for"));
}

/** The links' states for Systems and the Boiler Room's pipes. */
export function greenLinks(status: GreenStatus, board: GreenBoard | null): { sleeper: LinkState; fantasypros: LinkState } {
  if (status === "failed") return { sleeper: "down", fantasypros: "off" };
  if (status !== "ready" || !board) return { sleeper: status === "absent" ? "down" : "off", fantasypros: "off" };
  const fp = board.sources.fantasypros;
  return { sleeper: board.stale ? "slow" : "ok", fantasypros: fp === "live" ? "ok" : fp === "failed" ? "down" : "off" };
}

/** Sleeper's own page for the league, where the moves are made. */
export const sleeperLeagueUrl = (b: GreenBoard) => (b.league.id ? `https://sleeper.com/leagues/${b.league.id}` : "https://sleeper.com");

/* ── the store ── */

interface GreenStore {
  status: GreenStatus;
  board: GreenBoard | null;
  checkedAt: number | null;
  refresh: () => Promise<void>;
}

function syncLinks(): void {
  const { status, board } = useGreen.getState();
  const l = greenLinks(status, board);
  const seen = board ? Date.parse(board.at) : null;
  const set = useSystems.getState().setLink;
  set("sleeper", { state: l.sleeper, load: board ? Math.min(1, 0.3 + board.pickups.length / 12) : 0, lastSeen: seen, note: l.sleeper === "ok" ? (board?.matchup?.live ? "GAME ON" : "LEAGUE LIVE") : undefined });
  set("fantasypros", { state: l.fantasypros, load: l.fantasypros === "ok" ? 0.6 : 0, lastSeen: board?.sources.fpAt ? Date.parse(board.sources.fpAt) : null, note: l.fantasypros === "ok" ? "PROJECTIONS" : undefined });
}

export const useGreen = create<GreenStore>((set) => ({
  status: "idle",
  board: null,
  checkedAt: null,
  refresh: async () => {
    try {
      const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const json = (res.headers.get("content-type") ?? "").includes("json");
      // A local preview serves the app's HTML for /api/…
      if (!json) set({ status: "off", checkedAt: Date.now() });
      else if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        set({ status: body?.error === "not-in-league" ? "absent" : "off", checkedAt: Date.now() });
      } else if (!res.ok) set({ status: "failed", checkedAt: Date.now() });
      else {
        const board = readGreen(await res.json());
        set(board ? { status: "ready", board, checkedAt: Date.now() } : { status: "failed", checkedAt: Date.now() });
      }
    } catch {
      set({ status: "failed", checkedAt: Date.now() });
    }
    syncLinks();
  },
}));

let started = false;

/** Start reading the league (once per page): every two minutes while the tab is showing, and straight away on return. */
export function startGreen(): void {
  if (started || typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (q.has("offline") || q.has("demo") || q.get("boiler") === "demo") return;
  started = true;
  void useGreen.getState().refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") void useGreen.getState().refresh();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    const { checkedAt } = useGreen.getState();
    if (document.visibilityState === "visible" && (!checkedAt || Date.now() - checkedAt > POLL_MS / 2)) void useGreen.getState().refresh();
  });
}
