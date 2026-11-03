import type { Candidate, ElectionBoard, Office, PartyKey, Race } from "../../../../../../api/_annex/elections.ts";

/**
 * Election night's pure parts (#618): the state tile map, who leads, the filters and the order. No React, so the
 * tests read them directly.
 */

export type { Candidate, ElectionBoard, Office, PartyKey, Race };

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida",
  GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};

/** Each state as one square on a grid shaped like the country (column, row): every state the same size, so small ones can be tapped. */
export const TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [10, 0],
  VT: [9, 1], NH: [10, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], WI: [6, 2], MI: [7, 2], NY: [8, 2], RI: [9, 2], MA: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  HI: [0, 7], TX: [3, 7], FL: [8, 7],
};
export const GRID_W = 11;
export const GRID_H = 8;

export type Tab = Office;
export const TABS: { id: Tab; label: string }[] = [
  { id: "senate", label: "Senate" },
  { id: "governor", label: "Governor" },
  { id: "house", label: "House" },
  { id: "measure", label: "Ballot measures" },
];

export const PARTY_NAME: Record<PartyKey, string> = { D: "Democrat", R: "Republican", I: "Independent", O: "Other" };

/** The leader: the called winner, else the most votes once any are counted; null before the first vote. */
export function leaderOf(r: Race): Candidate | null {
  const w = r.candidates.find((c) => c.winner);
  if (w) return w;
  const top = r.candidates[0];
  return top && top.votes > 0 ? top : null;
}

/** "GA", "GA-2" or "MN-2": the race's short place. */
export const placeOf = (r: Race) => (r.district ? `${r.state}-${r.district}` : r.state);

/** What colours a state's tile on a tab: one race (Senate, governor) by its leader; several (House) by who leads more. */
export type TileFill = { kind: "none" } | { kind: "waiting" } | { kind: "party"; party: PartyKey; called: boolean; split?: boolean } | { kind: "measures"; count: number };

export function tileFill(races: Race[]): TileFill {
  if (!races.length) return { kind: "none" };
  if (races[0]!.office === "measure") return { kind: "measures", count: races.length };
  const leads = races.map(leaderOf).filter((c): c is Candidate => c !== null);
  if (!leads.length) return { kind: "waiting" };
  const by = new Map<PartyKey, number>();
  for (const c of leads) by.set(c.key, (by.get(c.key) ?? 0) + 1);
  const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const [party, n] = ranked[0]!;
  const split = ranked.length > 1 && ranked[1]![1] === n;
  const called = races.every((r) => r.called);
  return { kind: "party", party, called, ...(split && { split: true }) };
}

export interface Filters {
  tab: Tab;
  state: string | null;
  party: PartyKey | null;
  following: boolean;
  query: string;
}

/** Whether a race passes the filters: the tab, the state, who leads, the follows and the search. */
export function matches(r: Race, f: Filters, follows: ReadonlySet<number>): boolean {
  if (r.office !== f.tab) return false;
  if (f.state && r.state !== f.state) return false;
  if (f.following && !follows.has(r.id)) return false;
  if (f.party && r.office !== "measure" && leaderOf(r)?.key !== f.party) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = [r.name, STATE_NAMES[r.state] ?? "", r.state, placeOf(r), ...r.candidates.map((c) => c.name)].join(" ").toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** Followed races first, then the closest uncalled ones with votes in, then the called, then the rest by place. */
export function ordered(races: Race[], follows: ReadonlySet<number>): Race[] {
  const margin = (r: Race) => {
    const [a, b] = r.candidates;
    return a && b ? Math.abs(a.pct - b.pct) : 100;
  };
  const rank = (r: Race) => (follows.has(r.id) ? 0 : !r.called && r.reporting > 0 ? 1 : r.called ? 2 : 3);
  return [...races].sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? margin(a) - margin(b) : 0) || placeOf(a).localeCompare(placeOf(b), undefined, { numeric: true }));
}

/** Ids called in `next` that weren't in `prev`: the calls to flash. */
export function newCalls(prev: Race[] | null, next: Race[]): Set<number> {
  if (!prev) return new Set();
  const was = new Set(prev.filter((r) => r.called).map((r) => r.id));
  return new Set(next.filter((r) => r.called && !was.has(r.id)).map((r) => r.id));
}

/** "just now", "40s ago", "3m ago", "2h ago". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export const votes = (n: number) => n.toLocaleString("en-US");
