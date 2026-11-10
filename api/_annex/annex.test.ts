import { beforeEach, describe, expect, it } from "vitest";
import { decide, type GateContext } from "../_site/gate.ts";
import { siteKeys, stateOf } from "../_site/state.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { detailsSettled, electionBoard, forgetElections, freshness, FRESH_MS, fullUrl, normaliseRace, normaliseSearch, partyKey, raceUrl, readElections, searchUrl, STALE_MS, tallyOf, type Fetcher } from "./elections.ts";
import { forgetAnnex, getAnnex, getElections, postAnnex, type AnnexDeps } from "./route.ts";
import { MemoryAnnexStore, readState } from "./state.ts";

/** Rows shaped like civicAPI's /race/search answer on the night (names from its public 2026 slate). */
const row = (id: number, type: string, electionType: string, province: string, name: string, cands: [string, string, number, number, boolean][], reporting = 40, district: string | null = null) => ({
  id,
  type,
  country: "US",
  province,
  district,
  municipality: null,
  election_name: name,
  election_type: electionType,
  election_date: "2026-11-03T05:00:00.000Z",
  has_breakdown: true,
  has_map: true,
  percent_reporting: reporting,
  candidates: cands.map(([n, party, votes, percent, winner], i) => ({ name: n, candidate_id: id * 10 + i, party, color: "#888888", votes, percent, winner })),
});

const GENERAL = {
  count: 5,
  races: [
    row(87087, "US Senate", "General", "GA", "Georgia US Senate", [["Mike Collins", "Republican", 410_000, 48.1, false], ["Jon Ossoff", "Democratic", 442_000, 51.9, false]]),
    row(87174, "US Senate", "General", "KY", "Kentucky US Senate", [["Candidate A", "Republican", 800_000, 61.2, true], ["Candidate B", "Democratic", 507_000, 38.8, false]], 92),
    row(90001, "House of Representatives", "General", "MN", "Minnesota US House District 2", [["Candidate C", "Democratic-Farmer-Labor", 120_000, 52, true], ["Candidate D", "Republican", 110_000, 48, false]], 99, "2"),
    row(90002, "State House", "General", "MN", "Minnesota State House 12A", [["X", "Republican", 1, 100, true]]),
    row(87587, "Senate", "Primary", "MA", "Massachusetts US Senate Democratic Primary", [["Edward J. Markey", "Democratic", 572_146, 64, true]]),
  ],
};
const STATEWIDE = {
  count: 3,
  races: [
    row(87100, "Governor", "Statewide", "GA", "Georgia Governor", [["Candidate E", "Republican", 300_000, 50.5, false], ["Candidate F", "Democratic", 293_000, 49.5, false]]),
    row(187012, "Referendum", "Statewide", "GA", "Georgia Constitutional Amendment 3", [["Yes", "Nonpartisan", 0, 0, false], ["No", "Nonpartisan", 0, 0, false]], 0),
    row(187999, "Attorney General", "Statewide", "GA", "Georgia Attorney General", [["Z", "Republican", 1, 100, false]]),
  ],
};
const DETAIL = (id: number) => ({ election_name: "x", election_type: "US Senate", election_scope: "General", province: "GA", last_updated: "2026-11-04T01:59:00.000Z", polls_close: "2026-11-04T00:00:00.000Z", candidates: [{ name: "Jon Ossoff", party: "Democratic", incumbent: true }], id });

const T0 = Date.parse("2026-11-04T02:00:00.000Z");

/** A fake civicAPI: answers by URL, counts calls, and can be switched off. */
function civic() {
  const calls: string[] = [];
  const state = { down: false, fullDown: false, general: GENERAL as unknown };
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (state.down) throw new Error("ECONNREFUSED");
    if (url === fullUrl()) return state.fullDown ? new Response("busy", { status: 503 }) : Response.json({ count: 0, races: [...(state.general as typeof GENERAL).races ?? [], ...STATEWIDE.races] });
    if (url === searchUrl("General")) return Response.json(state.general);
    if (url === searchUrl("Statewide")) return Response.json(STATEWIDE);
    const m = /\/race\/(\d+)$/.exec(url);
    if (m) return Response.json(DETAIL(Number(m[1])));
    return new Response("nope", { status: 404 });
  };
  return { calls, state, fetcher };
}

describe("civicAPI's rows, normalised", () => {
  it("keeps the Senate, House, governor and statewide measure races of the night, and drops the rest", () => {
    const races = [...normaliseSearch(GENERAL), ...normaliseSearch(STATEWIDE)];
    expect(races.map((r) => [r.id, r.office])).toEqual([
      [87087, "senate"],
      [87174, "senate"],
      [90001, "house"],
      [87100, "governor"],
      [187012, "measure"],
    ]);
  });

  it("orders candidates by votes, marks the call, and maps parties to sides", () => {
    const ga = normaliseRace(GENERAL.races[0])!;
    expect(ga.candidates.map((c) => c.name)).toEqual(["Jon Ossoff", "Mike Collins"]);
    expect(ga.candidates[0]).toMatchObject({ key: "D", votes: 442_000, pct: 51.9, winner: false });
    expect(ga.called).toBe(false);
    expect(normaliseRace(GENERAL.races[1])!.called).toBe(true);
    const mn = normaliseRace(GENERAL.races[2])!;
    expect(mn).toMatchObject({ state: "MN", district: "2" });
    expect(normaliseRace({ ...GENERAL.races[2], province: "IN", district: "IN-08" })!.district).toBe("8");
    expect(mn.candidates[0]!.key).toBe("D");
    expect([partyKey("Republican"), partyKey("Independent"), partyKey("Libertarian"), partyKey(undefined)]).toEqual(["R", "I", "O", "O"]);
  });

  it("drops malformed rows and clamps numbers instead of trusting them", () => {
    expect(normaliseRace(null)).toBeNull();
    expect(normaliseRace({ ...GENERAL.races[0], id: "x" })).toBeNull();
    expect(normaliseRace({ ...GENERAL.races[0], province: "Georgia" })).toBeNull();
    expect(normaliseRace({ ...GENERAL.races[0], election_date: "2024-11-05T05:00:00.000Z" })).toBeNull();
    const odd = normaliseRace({ ...GENERAL.races[0], percent_reporting: 140, candidates: [{ name: "A", party: "Republican", votes: -5, percent: "lots" }, { party: "Democratic" }] })!;
    expect(odd.reporting).toBe(100);
    expect(odd.candidates).toEqual([{ name: "A", party: "Republican", key: "R", votes: 0, pct: 0, winner: false }]);
    expect(() => normaliseSearch({ error: "busy" })).toThrow();
  });

  it("tallies calls only, by the winner's side", () => {
    const t = tallyOf([...normaliseSearch(GENERAL), ...normaliseSearch(STATEWIDE)]);
    expect(t.senate).toEqual({ total: 2, called: { D: 0, R: 1, I: 0, O: 0 } });
    expect(t.house).toEqual({ total: 1, called: { D: 1, R: 0, I: 0, O: 0 } });
    expect(t.governor).toEqual({ total: 1, called: { D: 0, R: 0, I: 0, O: 0 } });
  });
});

describe("the shared copy", () => {
  beforeEach(() => forgetElections());

  it("reads civicAPI once for many viewers, then not again until the copy is old", async () => {
    const c = civic();
    let now = T0;
    const deps = { fetcher: c.fetcher, now: () => now };
    const first = await electionBoard(deps);
    expect(first.source.state).toBe("ok");
    expect(first.races).toHaveLength(5);
    const searches = () => c.calls.filter((u) => u.includes("/search")).length;
    expect(searches()).toBe(1);
    await Promise.all([electionBoard(deps), electionBoard(deps), electionBoard(deps)]);
    expect(searches()).toBe(1);
    now += FRESH_MS + 1;
    await electionBoard(deps);
    expect(searches()).toBe(2);
  });

  it("falls back to the two filtered searches when the whole list doesn't answer", async () => {
    const c = civic();
    c.state.fullDown = true;
    const b = await electionBoard({ fetcher: c.fetcher, now: () => T0 });
    expect(b.source.state).toBe("ok");
    expect(b.races).toHaveLength(5);
    expect(c.calls.filter((u) => u.includes("/search"))).toEqual([fullUrl(), searchUrl("General"), searchUrl("Statewide")]);
  });

  it("puts civicAPI's own update time on the Senate and governor races, and reports the lag", async () => {
    const c = civic();
    const first = await electionBoard({ fetcher: c.fetcher, now: () => T0 });
    // The numbers come first; the records follow without holding them up.
    expect(first.races.find((r) => r.id === 87087)!.updated).toBeUndefined();
    await detailsSettled();
    const board = await electionBoard({ fetcher: c.fetcher, now: () => T0 });
    const ga = board.races.find((r) => r.id === 87087)!;
    expect(ga.updated).toBe("2026-11-04T01:59:00.000Z");
    expect(ga.pollsClose).toBe("2026-11-04T00:00:00.000Z");
    expect(ga.candidates.find((x) => x.name === "Jon Ossoff")!.incumbent).toBe(true);
    expect(ga.moved).toBe(new Date(T0).toISOString());
    expect(c.calls).toContain(raceUrl(87100));
    // The House race's record isn't read: it would be hundreds of calls.
    expect(c.calls).not.toContain(raceUrl(90001));
    const f = freshness(T0);
    expect(f.sinceUpdateS).toMatchObject({ n: 3, median: 60, max: 60, newestAgeS: 60 });
    expect(f.reads).toBe(1);
  });

  it("keeps the last good results when civicAPI stops answering, says so, and never fills in numbers", async () => {
    const c = civic();
    let now = T0;
    const deps = { fetcher: c.fetcher, now: () => now };
    const good = await electionBoard(deps);
    c.state.down = true;
    now += FRESH_MS + 1;
    const stale = await electionBoard(deps);
    expect(stale.source.state).toBe("stale");
    expect(stale.source.note).toMatch(/not answering/);
    const numbers = (rs: typeof good.races) => rs.map((r) => [r.id, r.reporting, r.candidates.map((x) => [x.name, x.votes, x.winner])]);
    expect(numbers(stale.races)).toEqual(numbers(good.races));
    expect(stale.at).toBe(good.at);
    expect(freshness(now).failed).toBe(1);
    // Long past its time, the old copy is no longer shown at all.
    now += STALE_MS;
    const gone = await electionBoard(deps);
    expect(gone.source.state).toBe("down");
    expect(gone.races).toEqual([]);
  });

  it("says the source is down, with no races, when the first read fails", async () => {
    const c = civic();
    c.state.down = true;
    const b = await electionBoard({ fetcher: c.fetcher, now: () => T0 });
    expect(b).toMatchObject({ at: null, races: [], source: { state: "down", note: "Results source not answering" } });
    expect(b.tally.senate).toEqual({ total: 0, called: { D: 0, R: 0, I: 0, O: 0 } });
  });

  it("treats an answer of the wrong shape as a failure", async () => {
    const c = civic();
    c.state.fullDown = true;
    c.state.general = { error: "rate limited" };
    await readElections({ fetcher: c.fetcher, now: () => T0 });
    expect(freshness(T0).lastRead).toMatchObject({ ok: false, note: "bad-shape" });
  });

  it("reads the numbers again while a slow round of race records is still out", async () => {
    const c = civic();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow: Fetcher = async (url, init) => (/\/race\/\d+$/.test(url) ? (await gate, c.fetcher(url, init)) : c.fetcher(url, init));
    let now = T0;
    const deps = { fetcher: slow, now: () => now };
    await electionBoard(deps);
    now += FRESH_MS + 1;
    const again = await electionBoard(deps);
    expect(again.at).toBe(new Date(now).toISOString());
    expect(c.calls.filter((u) => u.includes("/search"))).toHaveLength(2);
    release();
    await detailsSettled();
  });

  it("notes when a race's numbers last moved", async () => {
    const c = civic();
    let now = T0;
    const deps = { fetcher: c.fetcher, now: () => now };
    await electionBoard(deps);
    now += FRESH_MS + 1;
    const moved = structuredClone(GENERAL);
    moved.races[0]!.candidates[0]!.votes += 1000;
    c.state.general = moved;
    const b = await electionBoard(deps);
    expect(b.races.find((r) => r.id === 87087)!.moved).toBe(new Date(now).toISOString());
    expect(b.races.find((r) => r.id === 87174)!.moved).toBe(new Date(T0).toISOString());
  });
});

describe("the Annex's endpoints", () => {
  beforeEach(() => {
    forgetElections();
    forgetAnnex();
  });

  const deps = (c = civic(), store = new MemoryAnnexStore()): AnnexDeps => ({ store, desk: { deskKey: "", store: new MemoryAuthStore(), now: T0 }, elections: { fetcher: c.fetcher, now: () => T0 }, now: T0 });

  it("serves the board publicly, and reads nothing while the pop-up is on the Shelf", async () => {
    const c = civic();
    const store = new MemoryAnnexStore();
    const live = await getElections(new Request("https://ceo.test/api/annex-elections"), deps(c, store));
    expect(live.status).toBe(200);
    expect(((await live.json()) as { races: unknown[] }).races).toHaveLength(5);
    forgetElections();
    forgetAnnex();
    store.state.popups.elections = { status: "archived", at: null };
    const before = c.calls.length;
    const shelved = await getElections(new Request("https://ceo.test/api/annex-elections"), deps(c, store));
    expect(await shelved.json()).toEqual({ archived: true });
    expect(c.calls.length).toBe(before);
  });

  it("answers ?debug=fresh with counts and seconds only", async () => {
    const res = await getElections(new Request("https://ceo.test/api/annex-elections?debug=fresh"), deps());
    const body = (await res.json()) as { fresh: { reads: number } };
    expect(body.fresh.reads).toBe(0);
  });

  it("shows the statuses to anyone, the follows only in a session, and takes writes only in a session", async () => {
    const store = new MemoryAnnexStore();
    store.state.follows.elections = [87087];
    const res = await getAnnex(new Request("https://ceo.test/api/annex"), deps(civic(), store));
    expect(await res.json()).toEqual({ popups: { elections: { status: "live", at: null }, jobs: { status: "live", at: null } }, signedIn: false });
    const post = await postAnnex(new Request("https://ceo.test/api/annex", { method: "POST", body: JSON.stringify({ popup: "elections", status: "archived" }) }), deps(civic(), store));
    expect(post.status).toBe(503);
    expect(store.state.popups.elections.status).toBe("live");
  });

  it("reads a stored record defensively", () => {
    expect(readState({ popups: { elections: { status: "exploded" } }, follows: { elections: [1, 1, -2, "x", 3] } })).toEqual({ popups: { elections: { status: "live", at: null }, jobs: { status: "live", at: null } }, follows: { elections: [1, 3], jobs: [] } });
    expect(readState("junk").popups.elections.status).toBe("live");
  });
});

describe("the site gate", () => {
  const DESK = "d".repeat(64);
  const ctx = async (): Promise<GateContext> => ({ state: stateOf({ v: 1, passkey: true, locked: "2026-10-22T00:00:00.000Z", sv: "v" }, {}), keys: (await siteKeys({ FOUNDRY_DESK_KEY: DESK }))!, env: { FOUNDRY_DESK_KEY: DESK }, now: T0 });

  it("lets the public results through a locked site, and nothing else of the Annex", async () => {
    const c = await ctx();
    expect(decide(new Request("https://ceo.test/api/annex-elections"), c)).toEqual({ allow: true, why: "annex-results" });
    expect(decide(new Request("https://ceo.test/api/annex-elections?debug=fresh"), c)).toEqual({ allow: true, why: "annex-results" });
    expect(decide(new Request("https://ceo.test/api/annex"), c).allow).toBe(false);
    expect(decide(new Request("https://ceo.test/api/annex", { method: "POST", body: "{}" }), c).allow).toBe(false);
    expect(decide(new Request("https://ceo.test/api/annex-elections", { method: "POST", body: "{}" }), c).allow).toBe(false);
    // The Job search (#1000) is private: never through the gate without a sign-in.
    expect(decide(new Request("https://ceo.test/api/annex-jobs"), c).allow).toBe(false);
  });
});
