/**
 * The Annex (#618): the Desk's staging room for pop-ups, short-lived projects on the C.E.O. engine that may graduate
 * into a room of their own. Azure only (azure/src/index.ts), behind the same site gate, with two endpoints:
 *
 * GET  /api/annex                 → { popups, follows?, signedIn }: each pop-up's status (public); the followed races
 *                                   only in a Desk session.
 * POST /api/annex                 { popup, status }   archive, revive, end or graduate a pop-up (Desk session)
 *                                 { popup, follows }  the followed races (Desk session)
 * GET  /api/annex-elections       → ElectionBoard (api/_annex/elections.ts): Election night's results from civicAPI,
 *                                   shared by every viewer and read at most about once a minute. Public: election
 *                                   results are public, so the site gate lets this one through (api/_site/gate.ts).
 *                                   { archived: true } and no read at all while the pop-up is on the Shelf.
 * GET  /api/annex-elections?debug=fresh → how fresh civicAPI's numbers are: our reads and failures, how long each
 *                                   took, and the seconds since civicAPI last changed each Senate and governor race
 *                                   (and any of them). Counts and seconds only.
 *
 * GET  /api/annex-jobs           → the Job search (#1000, api/_annex/jobs.ts): Desk session only, read and changed
 * POST /api/annex-jobs              there; runs the saved searches on SerpApi on demand (a daily timer runs them too),
 *                                   and checks a job's fit with Claude Sonnet on a tap (api/_annex/fit.ts, #1025).
 *
 * Shelving stops a pop-up whole (#1079). Every timer and every route that runs a pop-up's scheduled work or calls its
 * outside services asks `gateOf` first (state.ts `schedulesOn` and `connectionsOn`), so a shelved one runs nothing and
 * calls nothing: its timers skip it, a hand run or fit check answers 409 { error: "shelved" }, and its other routes work
 * with its connections switched off (jobs.ts `pausedJobs`). Nothing is deleted or revoked; re-spinning turns it all back
 * on. Shelving and re-spinning are kept in the Council (the "kernel" room's log), the pop-up's name and the change only.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../_blob.js";
import { requireSession, sameOrigin, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { BlobRoomLog, type RoomLog } from "../_skippy/log.js";
import { electionBoard, freshness, seedElections, type ElectionBoard, type ElectionDeps } from "./elections.js";
import { claudeKey } from "../_world/claude.js";
import { liveFitAI } from "./fit.js";
import { budgetOf, changeJobs, fitTick, JOBS_PATH, pausedJobs, pickJobsStore, runJobs, viewOf, type FitTick, type JobsDeps } from "./jobs.js";
import { cleanFollows, connectionsOn, isPopup, isShelved, isStatus, pickAnnexStore, schedulesOn, type AnnexState, type AnnexStore, type PopupId, type PopupStatus } from "./state.js";

export const ANNEX_PATH = "/api/annex";
export const ELECTIONS_PATH = "/api/annex-elections";
const BOARD_PATH = "desk/annex/elections.json";
/** How long a warm instance trusts its copy of the Annex's record. */
const STATE_MS = 15_000;

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}

export interface AnnexDeps {
  store: AnnexStore;
  desk: DeskDeps;
  elections: ElectionDeps;
  /** A copy of the board another instance kept, for a cold start; null when there is none. */
  seed?: () => Promise<ElectionBoard | null>;
  /** The Council (the "kernel" room's log), where shelving and re-spinning are kept; null without a store. */
  council?: RoomLog | null;
  now: number;
}

export function liveAnnexDeps(): AnnexDeps {
  const env = process.env;
  const blob = pickBlob(env);
  return {
    store: pickAnnexStore(env),
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    elections: {
      fetcher: (url, init) => fetch(url, init),
      now: () => Date.now(),
      save: blob ? async (board) => void (await blob.put(BOARD_PATH, JSON.stringify(board), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 })) : undefined,
    },
    seed: blob
      ? async () => {
          const found = await blob.get(BOARD_PATH).catch(() => null);
          return found ? ((await new Response(found.stream).json().catch(() => null)) as ElectionBoard | null) : null;
        }
      : undefined,
    council: blob ? new BlobRoomLog(blob) : null,
    now: Date.now(),
  };
}

let stateKept: { at: number; state: AnnexState } | null = null;
let seeded = false;

/** For tests: forget the record and the seed this instance read. */
export function forgetAnnex(): void {
  stateKept = null;
  seeded = false;
}

async function stateOf(deps: AnnexDeps): Promise<AnnexState> {
  if (stateKept && deps.now - stateKept.at < STATE_MS) return stateKept.state;
  const state = await deps.store.read();
  stateKept = { at: deps.now, state };
  return state;
}

/** What a pop-up may do right now (#1079): run its scheduled work, and call its outside services. */
export interface Gate {
  shelved: boolean;
  schedules: boolean;
  connections: boolean;
}

/** The one gate every timer and route asks before a pop-up runs or reaches out. An unreadable record allows nothing. */
export async function gateOf(id: PopupId, deps: AnnexDeps): Promise<Gate> {
  const state = await stateOf(deps).catch(() => null);
  return { shelved: isShelved(state, id), schedules: schedulesOn(state, id), connections: connectionsOn(state, id) };
}

/** A timer's run for one pop-up: skipped ("shelved") unless the pop-up is live. */
export async function whenScheduled<T>(id: PopupId, deps: AnnexDeps, run: () => Promise<T>): Promise<T | "shelved"> {
  return (await gateOf(id, deps)).schedules ? run() : "shelved";
}

const NAMES: Record<PopupId, string> = { elections: "Election night", jobs: "Job search" };

/** What the Council keeps when a pop-up goes on or off the Shelf: its name and the change, nothing of its contents. */
export function shelfTurn(id: PopupId, from: PopupStatus, to: PopupStatus): { question: string; answer: string } | null {
  const name = NAMES[id];
  if (to === "archived" && from !== "archived")
    return { question: `Shelve ${name}`, answer: `${name} is on the Shelf: paused, no scheduled runs, connections off. Its keys and settings are kept.` };
  if (from === "archived" && to !== "archived")
    return { question: `Re-spin ${name}`, answer: `${name} is back${to === "live" ? " in its bed" : ""}: its schedules and connections are on again.` };
  return null;
}

/** Whether a Desk session came with the request, without answering for it. */
async function signedIn(request: Request, deps: AnnexDeps) {
  if (!request.headers.get("cookie")) return null;
  const s = await requireSession(request, deps.desk).catch(() => null);
  return s && s.ok ? s : null;
}

export async function getAnnex(request: Request, deps: AnnexDeps = liveAnnexDeps()): Promise<Response> {
  const state = await stateOf(deps).catch(() => null);
  if (!state) return json({ error: "store" }, 503);
  const signed = await signedIn(request, deps);
  const body = { popups: state.popups, signedIn: !!signed, ...(signed && { follows: state.follows }) };
  return signed ? withCookie(json(body), signed) : json(body);
}

export async function postAnnex(request: Request, deps: AnnexDeps = liveAnnexDeps()): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "cross-site" }, 403);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const body = (await request.json().catch(() => null)) as { popup?: unknown; status?: unknown; follows?: unknown } | null;
  if (!body || !isPopup(body.popup)) return withCookie(json({ error: "bad-request" }, 400), signed);
  const state = await deps.store.read();
  const was = state.popups[body.popup].status;
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return withCookie(json({ error: "bad-status" }, 400), signed);
    state.popups[body.popup] = { status: body.status, at: new Date(deps.now).toISOString() };
  }
  if (body.follows !== undefined) state.follows[body.popup] = cleanFollows(body.follows);
  await deps.store.write(state);
  stateKept = { at: deps.now, state };
  const turn = shelfTurn(body.popup, was, state.popups[body.popup].status);
  if (turn && deps.council) await deps.council.add({ at: new Date(deps.now).toISOString(), ...turn, room: "kernel", model: "annex" }, deps.now).catch(() => undefined);
  return withCookie(json({ popups: state.popups, follows: state.follows, signedIn: true }), signed);
}

export async function getElections(request: Request, deps: AnnexDeps = liveAnnexDeps()): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("debug") === "fresh") return json({ fresh: freshness(deps.elections.now()), now: new Date(deps.elections.now()).toISOString() });
  // On the Shelf (or its record unreadable): civicAPI isn't called and nothing runs until it is revived.
  if (!(await gateOf("elections", deps)).connections) return json({ archived: true });
  if (!seeded && deps.seed) {
    seeded = true;
    const copy = await deps.seed().catch(() => null);
    if (copy) seedElections(copy);
  }
  const board = await electionBoard(deps.elections);
  // The edge may keep it briefly too; every viewer is served the same shared copy.
  return json(board, 200, "public, max-age=15");
}

export function liveJobsDeps(): JobsDeps {
  const env = process.env;
  // The fit check (#1025) reads the Claude key the Desk chat already reads; without it the check is paused.
  return { store: pickJobsStore(env), fetcher: (url, init) => fetch(url, init), key: (env.SERPAPI_KEY ?? "").trim(), budget: budgetOf(env), now: Date.now(), ai: liveFitAI(claudeKey(env)) };
}

/** The Job search's record (#1000): a Desk session only, since a job search is private. */
export async function getJobs(request: Request, deps: AnnexDeps = liveAnnexDeps(), jobs: JobsDeps = liveJobsDeps()): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const [state, resume, gate] = await Promise.all([jobs.store.read(), jobs.store.readResume().catch(() => ""), gateOf("jobs", deps)]);
  return withCookie(json(jobsView(viewOf(state, jobs, !!resume), gate)), signed);
}

/** The view, marked shelved with no next run while it is on the Shelf. */
const jobsView = (view: ReturnType<typeof viewOf>, gate: Gate) => (gate.shelved ? { ...view, shelved: true, nextRun: null } : view);

export async function postJobs(request: Request, deps: AnnexDeps = liveAnnexDeps(), jobs: JobsDeps = liveJobsDeps()): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "cross-site" }, 403);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return withCookie(json({ error: "bad-request" }, 400), signed);
  const gate = await gateOf("jobs", deps);
  // Shelved: no search and no fit check; marks, the profile and the resume are still kept, with every outside call off.
  if ((body.action === "run" || body.action === "fit") && !gate.connections) return withCookie(json({ error: "shelved" }, 409), signed);
  const live = gate.connections ? jobs : pausedJobs(jobs);
  if (body.action === "run") {
    const { result, state } = await runJobs(live, "hand");
    const resume = await jobs.store.readResume().catch(() => "");
    return withCookie(json({ ...jobsView(viewOf(state, jobs, !!resume), gate), result }), signed);
  }
  const done = await changeJobs(live, body);
  if ("error" in done) return withCookie(json(done, 400), signed);
  return withCookie(json(jobsView(viewOf(done.state, jobs, done.hasResume), gate)), signed);
}

/** The daily run (azure/src/index.ts, `annex_jobs_daily`): nothing while the pop-up is on the Shelf. The new jobs'
 * fit check goes out as a batch straight after. */
export async function runJobsDaily(deps: AnnexDeps = liveAnnexDeps(), jobs: JobsDeps = liveJobsDeps()): Promise<string> {
  return whenScheduled("jobs", deps, async () => {
    const { result } = await runJobs(jobs, "schedule");
    if (result === "ran") await fitTick(jobs).catch(() => null);
    return result;
  });
}

/** The fit check's timer (azure/src/index.ts, `annex_jobs_fit`): reads back a finished batch and sends the jobs still
 * due a check (the first tick after #1025 shipped is the backfill). Nothing while the pop-up is on the Shelf. */
export async function runJobsFit(deps: AnnexDeps = liveAnnexDeps(), jobs: JobsDeps = liveJobsDeps()): Promise<FitTick | "shelved"> {
  return whenScheduled("jobs", deps, () => fitTick(jobs));
}

/** The endpoints, by path (azure/src/index.ts registers each on this module). */
export async function GET(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  return path === ELECTIONS_PATH ? getElections(request) : path === JOBS_PATH ? getJobs(request) : getAnnex(request);
}

export async function POST(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === ELECTIONS_PATH) return json({ error: "method" }, 405);
  return path === JOBS_PATH ? postJobs(request) : postAnnex(request);
}
