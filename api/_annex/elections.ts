/**
 * The Annex's first pop-up, Election night (#618): live results for the 2026-11-03 US general election, from civicAPI
 * (civicapi.org; free, no key; its terms ask for a link or its name, which the page shows). Pull-on-request: nothing
 * here runs on a timer. A request that finds the copy older than FRESH_MS starts one read of civicAPI (never two at
 * once) and every viewer shares it, so civicAPI is read at most about once a minute however many people watch, and
 * not at all when nobody does. When civicAPI doesn't answer, the last good copy stands, marked stale, and nothing is
 * ever made up: a race shows only the numbers civicAPI sent.
 *
 * The board comes from civicAPI's list of every race on the date (fullUrl, served from its shared copy); when that
 * fails, from two searches, `election_type=General` (the US Senate and House races) and `election_type=Statewide` (the
 * governors and the statewide ballot measures), which can take 15 to 20 seconds, so each has its own timeout. The search rows carry no update time, so the Senate and governor races are
 * also read one by one (a race's own record has `last_updated`), at most every DETAIL_MS, a few at a time; that time is
 * what the page shows as "updated", and the gap between it and our read is the freshness the debug view reports.
 *
 * Pure apart from the fetcher and the clock, which tests pass in.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export const ELECTION_DATE = "2026-11-03";
export const CIVIC = "https://civicapi.org/api/v2";
/** How long a read stands before the next request starts a new one. */
export const FRESH_MS = 45_000;
/** How long the Senate and governor races' own records stand before they are read again. */
export const DETAIL_MS = 120_000;
/** How long a last good copy may stand in when civicAPI doesn't answer. */
export const STALE_MS = 6 * 3_600_000;
/** One search's timeout: civicAPI's searches are slow (15 to 20 s seen on the night). */
export const SEARCH_TIMEOUT_MS = 40_000;
export const DETAIL_TIMEOUT_MS = 20_000;
/** The whole night's list (fullUrl) usually answers in 2 to 4 seconds from civicAPI's shared copy. */
export const FULL_TIMEOUT_MS = 25_000;
/** How long a request waits on a read in flight before it answers with the copy it has. */
export const WAIT_MS = 8_000;
const DETAIL_CONCURRENCY = 8;

export type Office = "senate" | "governor" | "house" | "measure";
export type PartyKey = "D" | "R" | "I" | "O";

export interface Candidate {
  name: string;
  party: string;
  key: PartyKey;
  votes: number;
  /** Share of the vote, 0 to 100, as civicAPI sent it. */
  pct: number;
  winner: boolean;
  incumbent?: boolean;
}

export interface Race {
  id: number;
  office: Office;
  /** Two-letter state or territory. */
  state: string;
  district: string | null;
  name: string;
  /** Share of the expected vote counted, 0 to 100. */
  reporting: number;
  candidates: Candidate[];
  /** Whether civicAPI has called it (a candidate marked winner). */
  called: boolean;
  /** civicAPI's own update time for this race (ISO), where its record was read. */
  updated?: string;
  /** When polls close there (ISO), where its record was read. */
  pollsClose?: string;
  /** When our reads first saw this race's numbers as they are now (ISO). */
  moved?: string;
}

export interface Tally {
  /** Races on the ballot tonight in this set. */
  total: number;
  /** Called so far, by the winner's party. */
  called: Record<PartyKey, number>;
}

export type SourceState = "ok" | "stale" | "down" | "waiting";

export interface ElectionBoard {
  date: string;
  /** When this copy was read from civicAPI (ISO), or null before the first good read. */
  at: string | null;
  source: { state: SourceState; note?: string; lastTry: string | null };
  races: Race[];
  tally: Record<"senate" | "governor" | "house", Tally>;
}

/* ── normalising civicAPI's rows ── */

const str = (v: unknown, max = 160) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, lo = 0, hi = 1e9) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

/** civicAPI's race type to our office, or null for a race the board doesn't carry. */
export function officeOf(type: unknown, electionType: unknown): Office | null {
  const t = str(type).toLowerCase();
  const e = str(electionType).toLowerCase();
  if (e === "primary" || e === "local") return null;
  if (t === "us senate") return "senate";
  if (t === "house of representatives") return "house";
  if (t === "governor") return "governor";
  if (e === "statewide" && (t === "referendum" || t === "proposition" || t === "ballot measure")) return "measure";
  return null;
}

/** A party's name to its side: Democratic (and Minnesota's DFL), Republican, independent, or other. */
export function partyKey(party: unknown): PartyKey {
  const p = str(party).toLowerCase();
  if (/^(democrat|democratic)/.test(p) || p.includes("farmer-labor") || p.includes("farmer labor")) return "D";
  if (p.startsWith("republican") || p === "gop") return "R";
  if (p.startsWith("independent")) return "I";
  return "O";
}

const iso = (v: unknown): string | undefined => {
  const s = str(v, 40);
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : undefined;
};

/** One search row (or a race's own record) as a Race, or null when it isn't one the board carries or is malformed. */
export function normaliseRace(raw: unknown, idHint?: number): Race | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const id = typeof r.id === "number" ? r.id : idHint;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  // A race's own record names the office in election_type and the round in election_scope; a search row in type and election_type.
  const office = r.election_scope !== undefined ? officeOf(r.election_type, r.election_scope) : officeOf(r.type, r.election_type);
  if (!office) return null;
  const state = str(r.province, 4).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  if (r.date !== undefined || r.election_date !== undefined) {
    const d = str(r.election_date ?? r.date, 40);
    if (d && !d.startsWith(ELECTION_DATE)) return null;
  }
  const candidates: Candidate[] = (Array.isArray(r.candidates) ? r.candidates : [])
    .map((c): Candidate | null => {
      const x = c as Record<string, unknown> | null;
      const name = str(x?.name, 80);
      if (!x || !name) return null;
      const party = str(x.party, 60);
      return {
        name,
        party,
        key: office === "measure" ? "O" : partyKey(party),
        votes: Math.round(num(x.votes, 0, 2e8)),
        pct: Math.round(num(x.percent, 0, 100) * 10) / 10,
        winner: x.winner === true,
        ...(typeof x.incumbent === "boolean" && { incumbent: x.incumbent }),
      };
    })
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.votes - a.votes || Number(b.winner) - Number(a.winner) || a.name.localeCompare(b.name))
    .slice(0, 12);
  // civicAPI writes a House district as "IN-08": the state is already ours, and the number reads without its zero.
  const district = r.district === null || r.district === undefined ? null : str(String(r.district), 8).toUpperCase().replace(/^[A-Z]{2}-/, "").replace(/^0+(?=\d)/, "") || null;
  return {
    id,
    office,
    state,
    district: office === "house" ? (district && district !== state ? district : null) : null,
    name: str(r.election_name, 120) || `${state} ${office}`,
    reporting: Math.round(num(r.percent_reporting, 0, 100) * 10) / 10,
    candidates,
    called: candidates.some((c) => c.winner),
    ...(iso(r.last_updated) && { updated: iso(r.last_updated) }),
    ...(iso(r.polls_close) && { pollsClose: iso(r.polls_close) }),
  };
}

/** A search answer's races the board carries, one per id. */
export function normaliseSearch(body: unknown): Race[] {
  const races = (body as { races?: unknown } | null)?.races;
  if (!Array.isArray(races)) throw new Error("bad-shape");
  const seen = new Map<number, Race>();
  for (const raw of races) {
    const race = normaliseRace(raw);
    if (race && !seen.has(race.id)) seen.set(race.id, race);
  }
  return [...seen.values()];
}

/** Called races by the winner's party, per office. Calls only: an uncalled race counts toward total, nowhere else. */
export function tallyOf(races: Race[]): ElectionBoard["tally"] {
  const one = (office: Office): Tally => {
    const set = races.filter((r) => r.office === office);
    const called: Record<PartyKey, number> = { D: 0, R: 0, I: 0, O: 0 };
    for (const r of set) {
      const w = r.candidates.find((c) => c.winner);
      if (w) called[w.key] += 1;
    }
    return { total: set.length, called };
  };
  return { senate: one("senate"), governor: one("governor"), house: one("house") };
}

/* ── reading civicAPI ── */

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function getJson(fetcher: Fetcher, url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "ceo.nikita.page (Annex election night)" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(ctrl.signal.aborted ? "timeout" : e instanceof Error ? e.message.slice(0, 60) : "error", { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The whole night in one answer: every race on the date (about 39,000, some 20 MB before compression). It looks heavy,
 * but it is the query civicAPI's own results page makes, so civicAPI serves it from a shared copy kept 15 seconds
 * (`max-age=15`, coalesced): it comes back in 2 to 4 seconds and costs civicAPI almost nothing. The filtered searches
 * below are uncached and take 15 to 20 seconds each (one answered 503 under the night's load), so they are the
 * fallback, not the first try.
 */
export const fullUrl = () => `${CIVIC}/race/search?startDate=${ELECTION_DATE}&endDate=${ELECTION_DATE}&limit=50000`;
export const searchUrl = (electionType: "General" | "Statewide") => `${CIVIC}/race/search?startDate=${ELECTION_DATE}&endDate=${ELECTION_DATE}&country=US&election_type=${electionType}&limit=5000`;
export const raceUrl = (id: number) => `${CIVIC}/race/${id}`;

/* ── what a warm instance keeps, and how fresh it is ── */

export interface Freshness {
  /** Reads of the two searches, and how many failed. */
  reads: number;
  failed: number;
  lastRead: { at: string; ms: number; ok: boolean; note?: string } | null;
  /** Race records (Senate and governor) read so far. */
  details: number;
  /**
   * Seconds from civicAPI's last_updated to our read, per race, for the latest read of each. A race whose numbers
   * haven't changed keeps its old last_updated, so these measure "since civicAPI last changed it", not delay;
   * `newestAgeS` (how long before our read civicAPI changed any of them) is the feed's freshness.
   */
  sinceUpdateS: { n: number; median: number | null; p90: number | null; max: number | null; newestAgeS: number | null };
}

interface Kept {
  board: ElectionBoard | null;
  /** Each race's numbers as last seen, and when they first looked like that. */
  moved: Map<number, { sig: string; at: string }>;
  detail: Map<number, { at: number; updated?: string; pollsClose?: string; incumbents: string[]; sinceUpdateS?: number }>;
  detailAt: number;
  inflight: Promise<void> | null;
  lastTry: number;
  reads: number;
  failed: number;
  lastRead: Freshness["lastRead"];
  details: number;
}

const blank = (): Kept => ({ board: null, moved: new Map(), detail: new Map(), detailAt: 0, inflight: null, lastTry: 0, reads: 0, failed: 0, lastRead: null, details: 0 });
let kept: Kept = blank();

/** For tests: forget everything this instance read. */
export function forgetElections(): void {
  kept = blank();
}

/** A copy written elsewhere (the shared store, on a cold start) to stand in until the first read here. */
export function seedElections(board: ElectionBoard): void {
  if (!kept.board && board && Array.isArray(board.races)) kept.board = board;
}

export interface ElectionDeps {
  fetcher: Fetcher;
  now: () => number;
  /** Called with each good copy (to keep it in the shared store); failures are ignored. */
  save?: (board: ElectionBoard) => Promise<void>;
}

const sigOf = (r: Race) => `${r.reporting}|${r.candidates.map((c) => `${c.votes}${c.winner ? "w" : ""}`).join(",")}`;

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))]!;
}

export function freshness(now: number): Freshness {
  const lags = [...kept.detail.values()].map((d) => d.sinceUpdateS).filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
  const newest = [...kept.detail.values()].map((d) => (d.updated ? Date.parse(d.updated) : NaN)).filter(Number.isFinite);
  return {
    reads: kept.reads,
    failed: kept.failed,
    lastRead: kept.lastRead,
    details: kept.details,
    sinceUpdateS: { n: lags.length, median: quantile(lags, 0.5), p90: quantile(lags, 0.9), max: lags.length ? lags[lags.length - 1]! : null, newestAgeS: newest.length ? Math.round((now - Math.max(...newest)) / 1000) : null },
  };
}

async function readDetails(races: Race[], deps: ElectionDeps): Promise<void> {
  const now = deps.now();
  // Races already called with everything counted don't move again; the rest are read in turn, a few at a time.
  const todo = races.filter((r) => (r.office === "senate" || r.office === "governor") && !(r.called && r.reporting >= 99 && kept.detail.has(r.id)));
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const race = todo[i++]!;
      try {
        const raw = await getJson(deps.fetcher, raceUrl(race.id), DETAIL_TIMEOUT_MS);
        const at = deps.now();
        const r = raw as Record<string, unknown>;
        const updated = iso(r?.last_updated);
        const pollsClose = iso(r?.polls_close);
        const incumbents = (Array.isArray(r?.candidates) ? r.candidates : []).filter((c) => (c as { incumbent?: unknown })?.incumbent === true).map((c) => str((c as { name?: unknown }).name, 80));
        kept.detail.set(race.id, { at, updated, pollsClose, incumbents, ...(updated && { sinceUpdateS: Math.max(0, Math.round((at - Date.parse(updated)) / 1000)) }) });
        kept.details += 1;
      } catch {
        // One race's record not answering leaves its last one standing.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, todo.length) }, worker));
  kept.detailAt = now;
}

function withDetail(r: Race): Race {
  const d = kept.detail.get(r.id);
  const m = kept.moved.get(r.id);
  return {
    ...r,
    ...(d?.updated && { updated: d.updated }),
    ...(d?.pollsClose && { pollsClose: d.pollsClose }),
    ...(m && { moved: m.at }),
    candidates: d?.incumbents.length ? r.candidates.map((c) => (d.incumbents.includes(c.name) ? { ...c, incumbent: true } : c)) : r.candidates,
  };
}

/** One read of civicAPI: both searches, then the Senate and governor records when theirs are due. Never throws. */
export async function readElections(deps: ElectionDeps): Promise<void> {
  const started = deps.now();
  kept.lastTry = started;
  kept.reads += 1;
  try {
    let found: Race[];
    try {
      found = normaliseSearch(await getJson(deps.fetcher, fullUrl(), FULL_TIMEOUT_MS));
      if (!found.length) throw new Error("no races");
    } catch {
      const [general, statewide] = await Promise.all([getJson(deps.fetcher, searchUrl("General"), SEARCH_TIMEOUT_MS), getJson(deps.fetcher, searchUrl("Statewide"), SEARCH_TIMEOUT_MS)]);
      found = [...normaliseSearch(general), ...normaliseSearch(statewide)];
    }
    const byId = new Map<number, Race>();
    for (const r of found) if (!byId.has(r.id)) byId.set(r.id, r);
    const races = [...byId.values()];
    if (!races.length) throw new Error("no races");
    const at = new Date(deps.now()).toISOString();
    for (const r of races) {
      const sig = sigOf(r);
      const was = kept.moved.get(r.id);
      if (!was || was.sig !== sig) kept.moved.set(r.id, { sig, at });
    }
    const order: Record<Office, number> = { senate: 0, governor: 1, house: 2, measure: 3 };
    const build = (): ElectionBoard => ({
      date: ELECTION_DATE,
      at,
      source: { state: "ok", lastTry: new Date(started).toISOString() },
      races: races.map(withDetail).sort((a, b) => order[a.office] - order[b.office] || a.state.localeCompare(b.state) || (a.district ?? "").localeCompare(b.district ?? "", undefined, { numeric: true }) || a.id - b.id),
      tally: tallyOf(races),
    });
    // The numbers go out at once; the races' own records (slower, one call each) fill in their update times after.
    kept.board = build();
    kept.lastRead = { at, ms: deps.now() - started, ok: true };
    if (deps.now() - kept.detailAt >= DETAIL_MS) {
      await readDetails(races, deps);
      kept.board = build();
    }
    await deps.save?.(kept.board).catch(() => {});
  } catch (e) {
    kept.failed += 1;
    kept.lastRead = { at: new Date(deps.now()).toISOString(), ms: deps.now() - started, ok: false, note: e instanceof Error ? e.message.slice(0, 60) : "error" };
  }
}

/** The board as it stands now: the latest good copy, marked by how the source is doing. */
export function currentBoard(now: number): ElectionBoard {
  const b = kept.board;
  const lastTry = kept.lastTry ? new Date(kept.lastTry).toISOString() : null;
  const failing = kept.lastRead !== null && !kept.lastRead.ok;
  if (!b || !b.at) {
    return { date: ELECTION_DATE, at: null, source: { state: failing ? "down" : "waiting", lastTry, ...(failing && { note: "Results source not answering" }) }, races: [], tally: tallyOf([]) };
  }
  const age = now - Date.parse(b.at);
  if (age > STALE_MS) return { ...b, races: [], tally: tallyOf([]), source: { state: "down", lastTry, note: "Results source not answering" } };
  const stale = failing || age > FRESH_MS * 4;
  return { ...b, source: stale ? { state: "stale", lastTry, note: "Results source not answering; showing the last good results" } : { state: "ok", lastTry } };
}

/**
 * The board for a request: the copy as it stands when it is fresh; otherwise one read is started (or joined) and the
 * request waits up to WAIT_MS for it before answering with what there is.
 */
export async function electionBoard(deps: ElectionDeps, waitMs = WAIT_MS): Promise<ElectionBoard> {
  const now = deps.now();
  const fresh = kept.board?.at && now - Date.parse(kept.board.at) < FRESH_MS;
  // After a failed read, wait a little before knocking again, so a down source isn't hammered.
  const backoff = kept.lastRead && !kept.lastRead.ok && now - kept.lastTry < FRESH_MS / 3;
  if (!fresh && !backoff && !kept.inflight) {
    kept.inflight = readElections(deps).finally(() => {
      kept.inflight = null;
    });
  }
  if (kept.inflight) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([kept.inflight, new Promise<void>((r) => (timer = setTimeout(r, waitMs)))]);
    clearTimeout(timer);
  }
  return currentBoard(deps.now());
}
