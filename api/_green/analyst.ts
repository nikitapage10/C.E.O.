/**
 * The Green's analyst desk (#276): what the board works out from the whole league, not just Nikita's matchup. Pure: no
 * reads and no clock (the simulation's dice are seeded by the week), so every call is testable.
 *
 *   Calls        FantasyPros decides each start-or-sit (its projection, then its weekly rank). Sleeper's projection
 *                sits beside it, never averaged in: when Sleeper orders the pair the other way, or the two margins
 *                differ by 3 points or more, the call is a split decision. Only when FantasyPros has the two within a
 *                point does the matchup break the tie (#340): the projected underdog leans to the higher ceiling (the
 *                higher of the two projections), the favourite to the steadier floor (the lower of the two); level on
 *                that, the experts' spread decides (the narrower spread is steadier, the better best rank the higher
 *                ceiling). Only between two FantasyPros projects (or, while it waits, two on form), both able to play;
 *                the call is labelled "tiebreak". A questionable or doubtful starter whose game kicks off a window later
 *                than a bench alternative's, with FantasyPros under 1.5 points apart, loses the slot: "late-game risk"
 *                (#370; model.ts's lineupSwaps, byes still first).
 *   Teams        Every roster: what its best lineup projects, positions where it falls short of the league's middle
 *                or has a bye or injury hole coming (needs), and positions where its bench would start for most teams
 *                (surplus). FAAB left from Sleeper.
 *   Bids         Each pickup priced in FAAB: his value (FantasyPros' rest-of-season rank, else how many leagues are
 *                adding him) as a share of the budget, raised when rivals need his position and can pay, lowered when
 *                nobody does; never more than Nikita has, nor much past what the richest rival in need could bid.
 *   Trade        One idea: a rival with surplus where Nikita is thin, and thin where Nikita has surplus, values close.
 *   Odds         The rest of the regular season played out a few thousand times from projections and form; the
 *                playoff and seed chances, and this week's other games that move Nikita's chance most.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { GreenBid, GreenCall, GreenOdds, GreenPlayer, GreenPos, GreenSlot, GreenSwap, GreenSwing, GreenTeam, GreenTrade } from "./types.js";

const round1 = (n: number) => Math.round(n * 10) / 10;
const OUT = new Set(["O", "IR", "SUS", "PUP", "NA"]);
/** The positions a lineup slot accepts; mirrors model.ts's slotTakes (kept here so this file stands alone). */
export function takes(slot: string): GreenPos[] {
  switch (slot) {
    case "FLEX":
    case "WRT":
      return ["RB", "WR", "TE"];
    case "WRRB_FLEX":
      return ["RB", "WR"];
    case "REC_FLEX":
      return ["WR", "TE"];
    case "SUPER_FLEX":
      return ["QB", "RB", "WR", "TE"];
    case "QB":
    case "RB":
    case "WR":
    case "TE":
    case "K":
    case "DEF":
      return [slot];
    default:
      return [];
  }
}

/** Unavailable this week: on bye or out. */
export const sitsOut = (p: GreenPlayer, week: number) => (p.bye !== null && p.bye === week) || (p.inj !== null && OUT.has(p.inj));

/* ── calls ── */

/** The higher of FantasyPros' and Sleeper's projections: what a good day looks like. */
export const ceilingOf = (p: GreenPlayer) => Math.max(p.proj ?? 0, p.sl ?? p.proj ?? 0);
/** The lower of the two: what a quiet day looks like. */
export const floorOf = (p: GreenPlayer) => Math.min(p.proj ?? 0, p.sl ?? p.proj ?? 0);

const fpWord = (p: GreenPlayer) => `${p.name} ${(p.proj ?? 0).toFixed(1)}${p.wk ? ` (${p.pos}${p.wk})` : ""}`;

/**
 * The start-or-sit decisions worth showing: every change the lineup should make (FantasyPros' swaps), and every
 * starter whose best bench alternative is close (within 3 points) or whom Sleeper would bench. Changes first, then
 * splits, then the closest.
 */
export function callsFor(current: GreenSlot[], bench: GreenPlayer[], swaps: GreenSwap[], week: number, win: number | null, locked: (id: string) => boolean): GreenCall[] {
  const out: GreenCall[] = [];
  const used = new Set<string>();
  for (const s of swaps) {
    if (!s.out) continue;
    out.push(judge(s.slot, s.in, s.out, true, week, win, s.why, s.lateRisk ?? null));
    used.add(s.in.id);
    used.add(s.out.id);
  }
  const startingIds = new Set(current.map((c) => c.player?.id).filter(Boolean) as string[]);
  for (const c of current) {
    const p = c.player;
    if (!p || used.has(p.id) || locked(p.id) || sitsOut(p, week)) continue;
    const alt = bench
      .filter((b) => !used.has(b.id) && !startingIds.has(b.id) && !locked(b.id) && !sitsOut(b, week) && takes(c.slot).includes(b.pos))
      .sort((a, b) => (b.proj ?? -1) - (a.proj ?? -1) || (a.wk ?? 9999) - (b.wk ?? 9999))[0];
    if (!alt) continue;
    const edge = (p.proj ?? 0) - (alt.proj ?? 0);
    const slPrefersAlt = p.sl != null && alt.sl != null && alt.sl > p.sl;
    if (edge >= 3 && !slPrefersAlt) continue;
    out.push(judge(c.slot, p, alt, false, week, win, null));
    used.add(alt.id);
  }
  const rank = (c: GreenCall) => (c.change ? 0 : c.split ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || Math.abs(a.edge) - Math.abs(b.edge)).slice(0, 8);
}

/** The experts' spread this week (lower is steadier), Infinity when unknown. */
const spreadOf = (p: GreenPlayer) => p.range?.std ?? Infinity;
/** The best rank any expert gave him this week (lower is a higher ceiling), Infinity when unknown. */
const bestRankOf = (p: GreenPlayer) => p.range?.min ?? Infinity;

/**
 * Whether the favourite/underdog tiebreak may settle a pair: a win chance to go on, both able to play, both projected
 * by the same source (FantasyPros, or form while it waits: start/sit never rests on a form number against a FantasyPros
 * one), and under a point apart.
 */
export function tiebreakApplies(a: GreenPlayer, b: GreenPlayer, week: number, win: number | null): boolean {
  if (win === null || a.proj === null || b.proj === null || sitsOut(a, week) || sitsOut(b, week)) return false;
  if ((a.src === "fp" || b.src === "fp") && a.src !== b.src) return false;
  return Math.abs(a.proj - b.proj) < 1;
}

/** Who the tiebreak picks: the underdog the higher ceiling, the favourite the steadier floor; level, the experts' spread, then `a`. */
export function tiebreakPick(a: GreenPlayer, b: GreenPlayer, win: number): GreenPlayer {
  const under = win < 0.5;
  const key = under ? ceilingOf : floorOf;
  const ka = round1(key(a));
  const kb = round1(key(b));
  if (ka !== kb) return ka > kb ? a : b;
  const sa = under ? bestRankOf(a) : spreadOf(a);
  const sb = under ? bestRankOf(b) : spreadOf(b);
  return sb < sa ? b : a;
}

function judge(slot: string, a: GreenPlayer, b: GreenPlayer, change: boolean, week: number, win: number | null, forcedWhy: string | null, lateRisk: string | null = null): GreenCall {
  let start = a;
  let sit = b;
  let isChange = change;
  let tiebreak: string | null = null;
  // The tiebreak: only between two who can both play and whom FantasyPros has within a point.
  if (!lateRisk && win !== null && tiebreakApplies(a, b, week, win)) {
    const under = win < 0.5;
    const pick = tiebreakPick(a, b, win);
    const other = pick === a ? b : a;
    const who = a.src === "fp" ? "FantasyPros has" : "their form has";
    const level = round1((under ? ceilingOf : floorOf)(pick)) === round1((under ? ceilingOf : floorOf)(other));
    const spread = level
      ? under
        ? ` Level there, so the experts' best rank decides: ${pick.name} ${pick.range?.min != null ? `#${pick.range.min}` : "unranked"}, ${other.name} ${other.range?.min != null ? `#${other.range.min}` : "unranked"}.`
        : ` Level there, so the experts' spread decides: ${pick.name} ${pick.range ? pick.range.std.toFixed(1) : "unknown"}, ${other.name} ${other.range ? other.range.std.toFixed(1) : "unknown"}.`
      : "";
    tiebreak = under
      ? `Tiebreak: ${who} them within a point and you're the underdog (${Math.round(win * 100)}%), so lean ceiling: ${pick.name} tops out at ${ceilingOf(pick).toFixed(1)}, ${other.name} at ${ceilingOf(other).toFixed(1)}.${spread}`
      : `Tiebreak: ${who} them within a point and you're favoured (${Math.round(win * 100)}%), so lean floor: ${pick.name}'s low is ${floorOf(pick).toFixed(1)}, ${other.name}'s ${floorOf(other).toFixed(1)}.${spread}`;
    if (pick !== start) {
      // The tie broke the other way: the call flips, and whether it changes the lineup flips with it.
      start = pick;
      sit = other;
      isChange = !isChange;
    }
  }
  const edge = round1((start.proj ?? 0) - (sit.proj ?? 0));
  const slEdge = start.sl != null && sit.sl != null ? round1(start.sl - sit.sl) : null;
  const opposite = slEdge !== null && ((edge > 0 && slEdge < 0) || (edge < 0 && slEdge > 0));
  const split = slEdge !== null && (opposite || Math.abs(edge - slEdge) >= 3);
  const sleeper: GreenCall["sleeper"] = slEdge === null ? "unknown" : slEdge >= 0 ? "agrees" : "disagrees";
  const fpLine = `FantasyPros: ${fpWord(start)} over ${fpWord(sit)}`;
  const slLine = slEdge === null ? "" : ` · Sleeper: ${(start.sl ?? 0).toFixed(1)} to ${(sit.sl ?? 0).toFixed(1)}`;
  const why = lateRisk ? `${lateRisk} ${fpLine}${slLine}` : forcedWhy && !tiebreak && /bye|out|IR|suspended|empty/.test(forcedWhy) ? `${forcedWhy}. ${fpLine}${slLine}` : `${fpLine}${slLine}`;
  return { slot, start, sit, change: isChange, edge, slEdge, sleeper, split, tiebreak, ...(lateRisk && { lateRisk }), why };
}

/* ── the league's teams ── */

export interface RosterView {
  rosterId: number;
  team: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  faab: number | null;
  players: GreenPlayer[];
  /** Games played this season (for points a game). */
  games: number;
  opp: number | null;
}

/** What a player is worth for comparisons across the league: this week's projection and his season form, blended. */
export function worth(p: GreenPlayer): number {
  if (p.inj && (p.inj === "IR" || p.inj === "SUS" || p.inj === "PUP")) return 0;
  if (p.proj !== null && p.avg !== null) return 0.5 * Math.max(0, p.proj) + 0.5 * p.avg;
  return Math.max(0, p.proj ?? p.avg ?? 0);
}

/** The best lineup by a value, slots filled fixed first then flex; returns the players by slot and the total. */
export function bestLineup(slots: string[], players: GreenPlayer[], value: (p: GreenPlayer) => number): { picks: (GreenPlayer | null)[]; total: number } {
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => takes(a.s).length - takes(b.s).length);
  const used = new Set<string>();
  const picks: (GreenPlayer | null)[] = slots.map(() => null);
  for (const { s, i } of order) {
    const pick = players.filter((p) => !used.has(p.id) && takes(s).includes(p.pos)).sort((a, b) => value(b) - value(a))[0];
    if (pick) {
      picks[i] = pick;
      used.add(pick.id);
    }
  }
  return { picks, total: round1(picks.reduce((t, p) => t + (p ? value(p) : 0), 0)) };
}

const FIXED: GreenPos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Each team's needs and surplus, by position, against the league's middle. */
export function teamsFor(slots: string[], rosters: RosterView[], week: number, upcomingByes: Set<string>[], projOf: Map<number, number | null>, playoff: Map<number, number> | null): GreenTeam[] {
  const positions = FIXED.filter((p) => slots.includes(p));
  // Per team, per position: the starters' worth at that position (by the fixed slots it has).
  const lineups = rosters.map((r) => ({ r, best: bestLineup(slots, r.players, worth) }));
  const at = (l: (typeof lineups)[number], pos: GreenPos) => l.best.picks.reduce((t, p, i) => t + (p && slots[i] === pos ? worth(p) : 0), 0);
  const mid = new Map(positions.map((pos) => [pos, median(lineups.map((l) => at(l, pos)))]));
  // What the weakest starter at each position is worth, league-wide: a bench player above it "would start for most teams".
  const startLine = new Map(positions.map((pos) => [pos, median(lineups.flatMap((l) => l.best.picks.filter((p, i) => p && slots[i] === pos).map((p) => worth(p!))))]));
  return lineups.map(({ r, best }) => {
    const needs: string[] = [];
    const surplus: string[] = [];
    const starting = new Set(best.picks.filter(Boolean).map((p) => p!.id));
    for (const pos of positions) {
      const mine = at({ r, best }, pos);
      const slotsAt = slots.filter((s) => s === pos).length;
      // A hole soon: in the next two weeks, fewer players able to play at this position than slots that need it.
      const hole = upcomingByes.slice(0, 2).some((byes) => r.players.filter((p) => p.pos === pos && !(p.team && byes.has(p.team)) && !(p.inj && OUT.has(p.inj))).length < slotsAt);
      if (pos !== "K" && pos !== "DEF" && (mine < 0.85 * (mid.get(pos) ?? 0) || hole)) needs.push(pos);
      else if ((pos === "K" || pos === "DEF") && hole) needs.push(pos);
      // A bench player within a few points of the league's typical starter there would start for many teams.
      const benchGood = r.players.filter((p) => !starting.has(p.id) && p.pos === pos && worth(p) >= 0.8 * (startLine.get(pos) ?? Infinity) && worth(p) > 0);
      if (benchGood.length && pos !== "K" && pos !== "DEF") surplus.push(pos);
    }
    const posRank: Record<string, number> = {};
    for (const pos of positions) posRank[pos] = 1 + lineups.filter((l) => at(l, pos) > at({ r, best }, pos)).length;
    return {
      rosterId: r.rosterId,
      team: r.team,
      posRank,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pf: round1(r.pf),
      faab: r.faab,
      needs,
      surplus,
      opp: r.opp,
      proj: projOf.get(r.rosterId) ?? null,
      playoff: playoff?.get(r.rosterId) ?? null,
    };
  });
}

/* ── FAAB bids ── */

export interface BidInput {
  player: GreenPlayer;
  adds: number;
  drop: GreenPlayer | null;
  /** He covers an injured or on-bye starter of Nikita's. */
  covers: boolean;
}

/** How much a pickup is worth, 0..1: FantasyPros' rest-of-season rank when there is one, else how many leagues are adding him. */
export function pickupValue(p: GreenPlayer, adds: number): number {
  if (p.ecr !== null) return Math.max(0.03, Math.min(1, (220 - p.ecr) / 200));
  if (adds <= 0) return 0.03;
  return Math.max(0.03, Math.min(0.9, Math.log10(adds) / 5.3 - 0.4));
}

/**
 * A FAAB bid for each pickup. `budget` is the league's season budget (null: no FAAB, claims by priority), `mine` what
 * Nikita has left. `rank` is each team's place in the standings (1 first).
 */
export function bidsFor(picks: BidInput[], teams: GreenTeam[], meId: number, budget: number | null, mine: number | null, rank: Map<number, number>, history: number[]): GreenBid[] {
  const myRank = rank.get(meId) ?? 0;
  const me = teams.find((t) => t.rosterId === meId);
  // What winning claims went for in this league lately: the middle one caps a bid nobody else is chasing.
  const paid = history.filter((b) => b > 0);
  const typical = paid.length ? median(paid) : null;
  return picks.map(({ player, adds, drop, covers }) => {
    const rivals = teams.filter((t) => t.rosterId !== meId && t.needs.includes(player.pos) && (budget === null || (t.faab ?? 0) > 0));
    const value = pickupValue(player, adds);
    const blocker = rivals
      .filter((t) => Math.abs((rank.get(t.rosterId) ?? 99) - myRank) <= 2 || t.rosterId === me?.opp)
      .sort((a, b) => Math.abs((rank.get(a.rosterId) ?? 99) - myRank) - Math.abs((rank.get(b.rosterId) ?? 99) - myRank))[0];
    const bits: string[] = [];
    if (covers) bits.push("fills a hole in your lineup");
    if (player.ecr !== null) bits.push(`FantasyPros #${player.ecr}${player.posRank ? ` (${player.posRank})` : ""} rest of season`);
    else if (adds > 0) bits.push(`added in ${adds >= 1000 ? `${Math.round(adds / 100) / 10}k` : adds} leagues today`);
    bits.push(rivals.length ? `${rivals.length} rival${rivals.length === 1 ? " needs" : "s need"} a ${player.pos}` : `no rival is short at ${player.pos}`);
    if (blocker) bits.push(`taking him keeps him from ${blocker.team}`);
    if (budget === null || mine === null) {
      return { player, bid: 0, low: 0, high: 0, rivals: rivals.map((t) => t.team), blocks: blocker?.team ?? null, drop, why: capital(bits.join(" · ")) };
    }
    const comp = rivals.length === 0 ? 0.5 : rivals.length === 1 ? 0.9 : rivals.length <= 3 ? 1.15 : 1.3;
    let bid = budget * (0.02 + 0.28 * value ** 1.5) * comp * (covers ? 1.2 : 1) * (blocker ? 1.1 : 1);
    const richest = Math.max(0, ...rivals.map((t) => t.faab ?? 0));
    if (rivals.length) bid = Math.min(bid, richest + 1);
    else if (typical !== null) bid = Math.min(bid, Math.max(1, typical));
    bid = Math.max(budget > 0 ? 1 : 0, Math.min(mine, Math.round(bid)));
    const low = Math.max(budget > 0 ? 1 : 0, Math.min(bid, Math.round(bid * 0.7)));
    const high = Math.min(mine, Math.max(bid, Math.round(bid * 1.35) + 1));
    return { player, bid, low, high, rivals: rivals.map((t) => t.team), blocks: blocker?.team ?? null, drop, why: capital(bits.join(" · ")) };
  });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ── a trade idea ── */

/**
 * One trade: Nikita gives a bench player at a position where he has surplus and the rival is thin, and gets the
 * rival's bench (or flex) player at a position where Nikita is thin and the rival has surplus, worth about the same.
 */
export function tradeFor(slots: string[], me: RosterView, rivals: RosterView[], teams: GreenTeam[]): GreenTrade | null {
  const mine = teams.find((t) => t.rosterId === me.rosterId);
  if (!mine) return null;
  const myStart = new Set(bestLineup(slots, me.players, worth).picks.filter(Boolean).map((p) => p!.id));
  let best: { score: number; trade: GreenTrade } | null = null;
  const n = teams.length;
  const rankOf = (t: GreenTeam, pos: string) => t.posRank?.[pos] ?? Math.ceil(n / 2);
  const positions = [...new Set(slots)].filter((p) => ["QB", "RB", "WR", "TE"].includes(p));
  // Nikita's thin spots: his needs, then any position where his starters rank in the bottom half. His spare: his
  // surplus, then any position where he ranks in the top third with a bench player behind the starters.
  const thin = [...new Set([...mine.needs, ...positions.filter((p) => rankOf(mine, p) > n / 2).sort((a, b) => rankOf(mine, b) - rankOf(mine, a))])];
  const spare = [...new Set([...mine.surplus, ...positions.filter((p) => rankOf(mine, p) <= Math.ceil(n / 3) && me.players.some((x) => x.pos === p && !myStart.has(x.id) && worth(x) > 0))])].filter((p) => rankOf(mine, p) <= n / 2 && !thin.includes(p));
  for (const r of rivals) {
    const t = teams.find((x) => x.rosterId === r.rosterId);
    if (!t) continue;
    const theirStart = new Set(bestLineup(slots, r.players, worth).picks.filter(Boolean).map((p) => p!.id));
    for (const needPos of thin) {
      if (!t.surplus.includes(needPos) && rankOf(t, needPos) > Math.ceil(n / 3)) continue;
      for (const givePos of spare) {
        if (givePos === needPos || (!t.needs.includes(givePos) && rankOf(t, givePos) <= n / 2)) continue;
        const gets = r.players.filter((p) => p.pos === needPos && !theirStart.has(p.id) && worth(p) > 0).sort((a, b) => worth(b) - worth(a));
        const gives = me.players.filter((p) => p.pos === givePos && !myStart.has(p.id) && worth(p) > 0).sort((a, b) => worth(b) - worth(a));
        for (const g of gets.slice(0, 2)) {
          for (const p of gives.slice(0, 2)) {
            const gap = Math.abs(worth(g) - worth(p)) / Math.max(1, worth(g), worth(p));
            if (gap > 0.25) continue;
            const score = worth(g) - gap * 4;
            if (!best || score > best.score) {
              best = {
                score,
                trade: {
                  team: t.team,
                  give: [p],
                  get: [g],
                  why: `${t.team} has ${needPos} to spare and ranks ${ordinalOf(rankOf(t, givePos))} of ${n} at ${givePos}; you rank ${ordinalOf(rankOf(mine, needPos))} at ${needPos}. ${p.name} (${worth(p).toFixed(1)} a week) for ${g.name} (${worth(g).toFixed(1)}), on this week's projection and season form.`,
                },
              };
            }
          }
        }
      }
    }
  }
  return best?.trade ?? null;
}

const ordinalOf = (k: number) => {
  const t = k % 100;
  return `${k}${t >= 11 && t <= 13 ? "th" : (["th", "st", "nd", "rd"][k % 10] ?? "th")}`;
};

/** Which free agents to price: the best by value, weighted by whether Nikita can use the position. */
export function bidCandidates(free: GreenPlayer[], adds: Record<string, number>, me: GreenTeam | undefined, mine: GreenPlayer[], slots: string[], week: number): GreenPlayer[] {
  const fixed = (pos: string) => slots.filter((s) => s === pos).length;
  const flex = (pos: string) => slots.filter((s) => takes(s).includes(pos as GreenPos) && s !== pos).length;
  const fit = (p: GreenPlayer) => {
    const depth = mine.filter((x) => x.pos === p.pos && !sitsOut(x, week)).length;
    if (me?.needs.includes(p.pos)) return 1.4;
    if (["QB", "TE", "K", "DEF"].includes(p.pos)) return depth >= fixed(p.pos) + 1 ? 0.35 : 1.2;
    return depth >= fixed(p.pos) + flex(p.pos) + 3 ? 0.6 : 1;
  };
  const ranked = free
    .filter((p) => !(p.inj && OUT.has(p.inj)) && (p.ecr !== null || (adds[p.id] ?? 0) > 0))
    .map((p) => ({ p, s: pickupValue(p, adds[p.id] ?? 0) * fit(p) }))
    .sort((a, b) => b.s - a.s);
  // At most two a position, so the wire shows the choices across the lineup.
  const per = new Map<string, number>();
  const out: GreenPlayer[] = [];
  for (const { p } of ranked) {
    if ((per.get(p.pos) ?? 0) >= 2) continue;
    per.set(p.pos, (per.get(p.pos) ?? 0) + 1);
    out.push(p);
    if (out.length === 5) break;
  }
  return out;
}

/* ── playoff odds ── */

/** A small seeded random source (mulberry32), so the same week always plays out the same way. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (rnd: () => number) => {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

export interface OddsTeam {
  rosterId: number;
  team: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  /** Expected points in a future week, and its spread. */
  mean: number;
  sd: number;
}

export interface OddsGame {
  a: number;
  b: number;
  /** This week only: expected finals and spreads (live points included). */
  aMean?: number;
  bMean?: number;
  aSd?: number;
  bSd?: number;
}

/**
 * Plays the rest of the regular season `sims` times. `weeks[0]` is this week (its games may carry their own means);
 * the rest use each team's mean. Seeds by wins, then points for. Returns every team's playoff chance, Nikita's seed
 * chances, and this week's other games that move Nikita's chance most.
 */
export function simulate(teams: OddsTeam[], weeks: OddsGame[][], meId: number, playoffTeams: number, seed: number, sims = 3000): { odds: GreenOdds; byTeam: Map<number, number> } | null {
  if (!teams.length || !weeks.length || playoffTeams <= 0 || !teams.some((t) => t.rosterId === meId)) return null;
  const rnd = seeded(seed);
  const idx = new Map(teams.map((t, i) => [t.rosterId, i]));
  const made = new Array<number>(teams.length).fill(0);
  const seeds = new Array<number>(teams.length).fill(0);
  const me = idx.get(meId)!;
  const first = weeks[0] ?? [];
  const others = first.filter((g) => g.a !== meId && g.b !== meId);
  // For each of this week's other games: [made when a wins, a-wins count, made when b wins, b-wins count].
  const cond = others.map(() => [0, 0, 0, 0]);
  const wins = new Float64Array(teams.length);
  const pf = new Float64Array(teams.length);
  const order = teams.map((_, i) => i);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < teams.length; i++) {
      wins[i] = teams[i]!.wins + teams[i]!.ties / 2;
      pf[i] = teams[i]!.pf;
    }
    const firstWinners: number[] = [];
    weeks.forEach((games, w) => {
      for (const g of games) {
        const ia = idx.get(g.a);
        const ib = idx.get(g.b);
        if (ia === undefined || ib === undefined) continue;
        const ta = teams[ia]!;
        const tb = teams[ib]!;
        const sa = (w === 0 && g.aMean !== undefined ? g.aMean : ta.mean) + gauss(rnd) * (w === 0 && g.aSd !== undefined ? g.aSd : ta.sd);
        const sb = (w === 0 && g.bMean !== undefined ? g.bMean : tb.mean) + gauss(rnd) * (w === 0 && g.bSd !== undefined ? g.bSd : tb.sd);
        pf[ia]! += sa;
        pf[ib]! += sb;
        if (sa >= sb) wins[ia]! += 1;
        else wins[ib]! += 1;
        if (w === 0) firstWinners.push(sa >= sb ? g.a : g.b);
      }
    });
    order.sort((x, y) => wins[y]! - wins[x]! || pf[y]! - pf[x]!);
    order.forEach((t, place) => {
      if (place < playoffTeams) made[t]! += 1;
      if (t === me) seeds[place]! += 1;
    });
    const mineIn = order.indexOf(me) < playoffTeams ? 1 : 0;
    others.forEach((g, k) => {
      const aWon = firstWinners.includes(g.a);
      const c = cond[k]!;
      if (aWon) {
        c[0]! += mineIn;
        c[1]! += 1;
      } else {
        c[2]! += mineIn;
        c[3]! += 1;
      }
    });
  }
  const name = (id: number) => teams[idx.get(id)!]!.team;
  const swing: GreenSwing[] = others
    .map((g, k) => {
      const c = cond[k]!;
      const ifA = c[1]! ? c[0]! / c[1]! : 0;
      const ifB = c[3]! ? c[2]! / c[3]! : 0;
      const rootA = ifA >= ifB;
      return { a: name(g.a), b: name(g.b), root: rootA ? name(g.a) : name(g.b), ifWin: round3(rootA ? ifA : ifB), ifLose: round3(rootA ? ifB : ifA) };
    })
    .filter((s) => s.ifWin - s.ifLose >= 0.01)
    .sort((x, y) => y.ifWin - y.ifLose - (x.ifWin - x.ifLose))
    .slice(0, 3);
  const byTeam = new Map(teams.map((t, i) => [t.rosterId, round3(made[i]! / sims)]));
  return {
    odds: { playoff: round3(made[me]! / sims), seeds: seeds.slice(0, Math.min(teams.length, Math.max(playoffTeams, 1))).map((n) => round3(n / sims)), playoffTeams, weeksLeft: weeks.length, sims, swing },
    byTeam,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
