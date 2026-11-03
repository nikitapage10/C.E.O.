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
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../_blob.js";
import { requireSession, sameOrigin, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { electionBoard, freshness, seedElections, type ElectionBoard, type ElectionDeps } from "./elections.js";
import { cleanFollows, isPopup, isStatus, pickAnnexStore, type AnnexState, type AnnexStore } from "./state.js";

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
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return withCookie(json({ error: "bad-status" }, 400), signed);
    state.popups[body.popup] = { status: body.status, at: new Date(deps.now).toISOString() };
  }
  if (body.follows !== undefined) state.follows[body.popup] = cleanFollows(body.follows);
  await deps.store.write(state);
  stateKept = { at: deps.now, state };
  return withCookie(json({ popups: state.popups, follows: state.follows, signedIn: true }), signed);
}

export async function getElections(request: Request, deps: AnnexDeps = liveAnnexDeps()): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("debug") === "fresh") return json({ fresh: freshness(deps.elections.now()), now: new Date(deps.elections.now()).toISOString() });
  const state = await stateOf(deps).catch(() => null);
  // On the Shelf: nothing is read and nothing runs until it is revived.
  if (state?.popups.elections.status === "archived") return json({ archived: true });
  if (!seeded && deps.seed) {
    seeded = true;
    const copy = await deps.seed().catch(() => null);
    if (copy) seedElections(copy);
  }
  const board = await electionBoard(deps.elections);
  // The edge may keep it briefly too; every viewer is served the same shared copy.
  return json(board, 200, "public, max-age=15");
}

/** The two endpoints, by path (azure/src/index.ts registers both on this module). */
export async function GET(request: Request): Promise<Response> {
  return new URL(request.url).pathname === ELECTIONS_PATH ? getElections(request) : getAnnex(request);
}

export async function POST(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === ELECTIONS_PATH) return json({ error: "method" }, 405);
  return postAnnex(request);
}
