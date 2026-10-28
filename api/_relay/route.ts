/**
 * Relay's texts line on the site (#535, docs/RELAY-PRIVACY.md). Azure only: azure/src/index.ts registers the three
 * routes behind the site gate, which lets the hub's calls through on its own token and the installer's pair call on
 * its one-time code.
 *
 * The Desk (a passkey session, same origin):
 *   GET  /api/relay?view=status   the public counts (RelayStatus): the Lattice, Today and Systems. No session.
 *   GET  /api/relay               the Relay page's Texts panel: the counts, the pairing, the who's-waiting list
 *                                 (names, Dialtone's gist, Blasto's drafts), the requests and whether this device's
 *                                 send unlock is on.
 *   POST /api/relay { action }
 *          "pair-code"        → { code, until }: a one-time code for the installer (10 minutes, 5 tries); needs
 *                                the send unlock, since a paired Mac can push the list and poll for sends
 *          "unpair"           → forgets the pairing (the hub's token stops working at once) and clears the list
 *          "unlock-options"   → a passkey request for this session's own passkey (2 minutes)
 *          "unlock", response → the fresh passkey answer: sets this device's send unlock (an HttpOnly cookie, 72 hours)
 *          "lock"             → clears it
 *          "send", thread, draftAt, text   → a send request (needs the unlock; see "The send path" below)
 *          "resend", rid      → a new send request for one that expired (the Mac was offline) or failed
 *          "later" | "done", thread        → a request to push a thread to the next nudge, or mark it handled
 *          "restyle", thread, text         → Nikita's dictated words, for Blasto to put in his style
 *
 * The hub (Authorization: Bearer <hub token>; api/_relay/tokens.ts):
 *   POST /api/relay-pair { code }      the installer: trades an open code for the hub token and send key, once
 *   POST /api/relay-hub                its status: parseRelayStatus (4 KB, the allowlist), kept whole or not at all
 *   POST /api/relay-hub?view=texts     its who's-waiting list (TextsView, read by hand, sealed at rest, 7 days)
 *   POST /api/relay-hub?view=sort|draft  one placeholdered, trimmed snippet for Dialtone or Blasto (./models.ts):
 *                                      Claude with the Key Vault key, under the texts line's own $10 (./budget.ts).
 *                                      The snippet is never stored or logged.
 *   GET  /api/relay-hub?view=requests  the Desk's waiting requests, each handed out once (then "taken")
 *   POST /api/relay-hub?view=results   what became of the requests it took
 *   GET  /api/relay-hub?view=skip      the private skip list's terms (EMAIL_SKIP_TERMS), memory only on the Mac
 *   POST /api/relay-hub?view=unpair    the wipe: forgets this pairing, clears the list and the requests, shows "wiped"
 *
 * The send path (the part to review hardest). Nothing sends without Nikita's tap:
 *   1. Unlock, once per device: a fresh passkey answer (the device's own unlock, user verification required) to a
 *      challenge made for this session's own passkey, spent atomically so it works once. It sets `__Host-ceo-relay-unlock`,
 *      HttpOnly, Secure, SameSite=Strict, signed with a key derived from the Desk key, naming that passkey, good 72
 *      hours. It is checked on every send together with the session: the same passkey, unexpired. Another device, or
 *      this one after 72 hours, or after "lock", has to unlock again.
 *   2. Send: one tap writes one request: a random id, the thread, the draft it was made from (`draftAt`), the text,
 *      10 minutes to live, signed with the pairing's send key over all of those. The thread must be on the hub's
 *      latest list, one-to-one, still owed, with that very draft. One send at a time per thread.
 *   3. The hub polls; each waiting, unexpired request is handed out once and marked taken in the same conditional
 *      write, so a second poll never gets it. The hub checks the signature, the 10 minutes, that it never saw the id,
 *      and the thread and draft again on its own list, then sends through BlueBubbles and reports sent or failed.
 *   4. Not taken within 10 minutes (the Mac was offline): it is "expired", never sent late. The Desk says "Not sent,
 *      the Mac was offline" with Resend, which makes a new request (steps 2 and 3 again, the unlock still needed).
 * No model output, message or webhook can make a request: only these Desk actions do.
 *
 * Nothing here logs. Underscore folder: never served as a function.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { emptyRelayStatus, parseRelayStatus, type RelayStatus } from "../../packages/core/src/relay.ts";
import { checkAssertion } from "../_desk/assert.js";
import { deskKeyFor } from "../_desk/keys.js";
import { addressOf, Gate } from "../_desk/limits.js";
import { isQuiet, liveSubs, type PingText } from "../_desk/pings.js";
import { CHALLENGE_COOKIE, challengeOf, cookie, readCookie, readToken, requireSession, signToken, withCookie, type DeskDeps, type Signed } from "../_desk/session.js";
import { pickAuthStore, type AuthStore } from "../_desk/store.js";
import { deliver, webPushSend } from "../desk-pings.js";
import { skipTermsFrom } from "../_email/filter.js";
import { pickBlob } from "../_blob.js";
import { BlobSpendStore, monthSpend, relayBudget, reserveSpend, settleSpend, type SpendStore } from "./budget.js";
import { liveClaude } from "./claude.js";
import { claudeProvider, DRAFT_MODEL, readDraftInput, readSortInput, SORT_MODEL, type ClaudeCall } from "./models.js";
import { pickRelayStore, update, type PrivateState, type RelayStore, type RequestEntry } from "./store.js";
import { DICTATED_MAX, readTextsView, RESULTS, RID, SEND_MAX, type RequestKind, type RequestResult, type RequestState, type TextItem, type TextRequest } from "./texts.js";
import { bearer, hubKey, hubTokenPair, mintPairCode, mintPairing, normalCode, PAIR_CODE_MS, PAIR_TRIES, REQUEST_MS, sendKeyFor, sha256, showCode, signRequest, UNLOCK_MS } from "./tokens.js";

export const RELAY_PATH = "/api/relay";
export const PAIR_PATH = "/api/relay-pair";
export const HUB_PATH = "/api/relay-hub";
export const UNLOCK_COOKIE = "__Host-ceo-relay-unlock";
/** The unlock's passkey request is good for this long (s). */
export const STEPUP_S = 120;
/** A taken request with no result this long after it ended shows as failed. */
export const RESULT_GRACE_MS = 5 * 60_000;
/** The most a hub's texts list may be (bytes). */
export const MAX_TEXTS_BYTES = 128 * 1024;

type Env = Record<string, string | undefined>;

export interface RelayRouteDeps {
  desk: DeskDeps;
  store: RelayStore | null;
  spend: SpendStore | null;
  /** One Claude call with the Key Vault's key, or null without one. */
  claude: ClaudeCall | null;
  budget: number;
  skipTerms: string[];
  /** Sends one ping to every device that turned pings on (counts only); how many took it. */
  ping: (text: PingText) => Promise<number>;
  now: number;
}

export function liveRelayDeps(env: Env = process.env): RelayRouteDeps {
  const blob = pickBlob(env);
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    store: pickRelayStore(env),
    spend: blob && blob.kind === "azureblob" ? new BlobSpendStore(blob) : null,
    claude: liveClaude(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || ""),
    budget: relayBudget(env.RELAY_BUDGET_USD),
    skipTerms: skipTermsFrom(env.EMAIL_SKIP_TERMS),
    ping: async (text) => {
      const auth = pickAuthStore(env);
      if (!auth || !env.DESK_VAPID_PUBLIC_KEY || !env.DESK_VAPID_PRIVATE_KEY) return 0;
      const [state, passkeys] = await Promise.all([auth.pings(), auth.passkeys()]);
      const subs = liveSubs(state.subs, passkeys);
      return subs.length ? deliver(auth, subs, text, webPushSend) : 0;
    },
    now: Date.now(),
  };
}

function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const res = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

const sameHash = (a: string, b: string) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === 32 && y.length === 32 && timingSafeEqual(x, y);
};

/** The words of a nudge ping: a count, never a name. Safe on a lock screen. */
export function relayPing(owed: number): PingText {
  return { title: "C.E.O. Desk", body: owed === 1 ? "1 reply owed" : `${owed} replies owed`, url: "/relay" };
}

/** A request's state as the Desk sees it now: a waiting one past its 10 minutes is expired, never sent late. */
export function shownState(e: RequestEntry, now: number): RequestState {
  if (e.state === "waiting" && e.req.until <= now) return "expired";
  if (e.state === "taken" && e.req.until + RESULT_GRACE_MS <= now) return "failed";
  return e.state;
}

/** The hub's token, checked: signed by this Desk key, for the pairing on record, with the hash on record. */
async function hubOf(request: Request, deps: RelayRouteDeps): Promise<{ pairId: string } | null> {
  const token = bearer(request);
  const pairId = hubTokenPair(token, deps.desk.deskKey);
  if (!token || !pairId || !deps.store) return null;
  const hub = await deps.store.hub().catch(() => null);
  return hub && hub.pairId === pairId && sameHash(sha256(token), hub.tokenHash) ? { pairId } : null;
}

async function publicStatus(deps: RelayRouteDeps): Promise<RelayStatus> {
  return (deps.store ? await deps.store.status().catch(() => null) : null) ?? emptyRelayStatus(deps.now, "off");
}

/* ── The send unlock ── */

/** Until when this device's send unlock holds for this session's passkey (ms), or null. */
export async function unlockedUntil(request: Request, deskKey: string, passkey: string, now: number): Promise<number | null> {
  const p = readToken(await deskKeyFor(deskKey, "relay"), readCookie(request, UNLOCK_COOKIE));
  if (!p || p.t !== "relay-unlock" || p.c !== passkey || typeof p.e !== "number") return null;
  const until = p.e * 1000;
  // Never longer than the unlock's own life, whatever a cookie says.
  return until > now && until <= now + UNLOCK_MS ? until : null;
}

async function unlockCookie(deskKey: string, passkey: string, now: number): Promise<{ cookie: string; until: number }> {
  const e = Math.floor((now + UNLOCK_MS) / 1000);
  const token = signToken(await deskKeyFor(deskKey, "relay"), { t: "relay-unlock", c: passkey, e });
  return { cookie: `${UNLOCK_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(UNLOCK_MS / 1000)}`, until: e * 1000 };
}
const clearUnlock = () => `${UNLOCK_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/* ── GET ── */

export async function GET(request: Request, deps: RelayRouteDeps = liveRelayDeps()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === HUB_PATH) return hubGet(request, url, deps);
  if (url.pathname !== RELAY_PATH) return json({ error: "not-found" }, 404);
  if (url.searchParams.get("view") === "status") {
    return new Response(JSON.stringify({ ok: true, status: await publicStatus(deps) }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if ([...url.searchParams.keys()].length) return withCookie(json({ error: "bad-request" }, 400), signed);
  try {
    const hub = deps.store ? await deps.store.hub() : null;
    const priv = deps.store ? (await deps.store.load()).state : { texts: null, requests: [] };
    const spent = deps.spend ? (await deps.spend.load().catch(() => ({ ledger: null }))).ledger : null;
    return withCookie(
      json({
        ok: true,
        status: await publicStatus(deps),
        ready: deps.store !== null && hubKey(deps.desk.deskKey) !== null,
        paired: hub !== null,
        pairedAt: hub?.pairedAt ?? null,
        lastSeen: hub?.lastSeen ?? null,
        unlockedUntil: await unlockedUntil(request, deps.desk.deskKey, signed.passkey.id, deps.now),
        texts: hub ? (priv.texts?.items ?? []) : [],
        textsAt: hub ? (priv.texts?.at ?? null) : null,
        requests: priv.requests.map((e) => ({ rid: e.req.rid, kind: e.req.kind, thread: e.req.thread, text: e.req.kind === "send" ? e.req.text : "", created: e.req.created, until: e.req.until, state: shownState(e, deps.now) })),
        spend: { usd: spent ? Math.round(monthSpend(spent, deps.now).usd * 10_000) / 10_000 : 0, budget: deps.budget },
      }),
      signed,
    );
  } catch {
    return withCookie(json({ error: "store" }, 502), signed);
  }
}

async function hubGet(request: Request, url: URL, deps: RelayRouteDeps): Promise<Response> {
  const view = url.searchParams.get("view");
  if ([...url.searchParams.keys()].length !== 1 || (view !== "skip" && view !== "requests")) return json({ error: "bad-request" }, 400);
  if (!(await hubOf(request, deps)) || !deps.store) return json({ error: "unauthorized" }, 401);
  if (view === "skip") return json({ ok: true, terms: deps.skipTerms });
  // Single-use: every waiting, unexpired request is handed out in the same conditional write that marks it taken.
  const now = deps.now;
  const taken = await update(deps.store, (s) => {
    const out: TextRequest[] = [];
    const requests = s.requests.map((e) => {
      if (e.state !== "waiting") return e;
      if (e.req.until <= now) return { ...e, state: "expired" as const };
      out.push(e.req);
      return { ...e, state: "taken" as const, takenAt: now };
    });
    return { next: { ...s, requests }, result: out };
  });
  return json({ ok: true, requests: taken ?? [] });
}

/* ── POST ── */

export async function POST(request: Request, deps: RelayRouteDeps = liveRelayDeps()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === HUB_PATH) return hubPost(request, url, deps);
  if (url.pathname === PAIR_PATH) return pairHub(request, deps);
  if (url.pathname !== RELAY_PATH) return json({ error: "not-found" }, 404);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const raw = await request.text().catch(() => "");
  if (raw.length > 16 * 1024) return json({ error: "too-big" }, 413);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  let body: Record<string, unknown> | null = null;
  try {
    const got: unknown = JSON.parse(raw);
    body = got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  const store = deps.store;
  const key = hubKey(deps.desk.deskKey);
  if (!store || !key || !deps.desk.store) return withCookie(json({ error: "not-set-up" }, 503), signed);
  const keep = [signed.cookie];
  const action = body?.action;

  if (action === "pair-code") {
    // Pairing hands a Mac the right to push the list and poll for sends, so it needs the send unlock, like a send.
    if ((await unlockedUntil(request, deps.desk.deskKey, signed.passkey.id, deps.now)) === null) return json({ error: "locked" }, 401, keep);
    // Never silently replaces a paired Mac: Unpair first.
    if (await store.hub()) return json({ error: "paired" }, 409, keep);
    const code = mintPairCode();
    const until = deps.now + PAIR_CODE_MS;
    await store.savePair({ codeHash: sha256(code), until, tries: 0 });
    return json({ ok: true, code: showCode(code), until }, 200, keep);
  }
  if (action === "unpair") {
    await store.saveHub(null);
    await store.savePair(null);
    await update(store, () => ({ next: { texts: null, requests: [] }, result: true }));
    await store.saveStatus(emptyRelayStatus(deps.now, "off"));
    return json({ ok: true }, 200, keep);
  }
  if (action === "unlock-options" || action === "unlock") return unlock(request, body ?? {}, signed, { ...deps.desk, store: deps.desk.store }, keep);
  if (action === "lock") return json({ ok: true }, 200, [clearUnlock(), ...keep]);

  const hub = await store.hub();
  if (!hub) return json({ error: "not-paired" }, 409, keep);
  const sendKey = sendKeyFor(key, hub.pairId);

  if (action === "send" || action === "resend") {
    // The unlock first: no send request without this device's fresh-passkey unlock for this very passkey.
    if ((await unlockedUntil(request, deps.desk.deskKey, signed.passkey.id, deps.now)) === null) return json({ error: "locked" }, 401, keep);
    const made = await update(store, (s) => {
      let fields: { thread: unknown; draftAt: unknown; text: unknown } = { thread: body?.thread, draftAt: body?.draftAt, text: body?.text };
      if (action === "resend") {
        const old = typeof body?.rid === "string" && RID.test(body.rid) ? s.requests.find((e) => e.req.rid === body!.rid) : undefined;
        const shown = old ? shownState(old, deps.now) : null;
        if (!old || old.req.kind !== "send" || (shown !== "expired" && shown !== "failed")) return { next: s, result: { error: "no-resend" as const } };
        fields = { thread: old.req.thread, draftAt: old.req.draftAt, text: old.req.text };
      }
      return makeRequest(s, sendKey, "send", fields, deps.now);
    });
    return requestAnswer(made, keep);
  }
  if (action === "later" || action === "done" || action === "restyle") {
    const made = await update(store, (s) => makeRequest(s, sendKey, action, { thread: body?.thread, draftAt: body?.draftAt ?? 0, text: action === "restyle" ? body?.text : "" }, deps.now));
    return requestAnswer(made, keep);
  }
  return json({ error: "bad-request" }, 400, keep);
}

type Made = { rid: string; until: number } | { error: "no-thread" | "changed" | "busy" | "bad-text" | "no-resend" };

function requestAnswer(made: Made | null, keep: string[]): Response {
  if (!made) return json({ error: "store" }, 502, keep);
  if ("error" in made) return json({ error: made.error }, made.error === "bad-text" ? 400 : 409, keep);
  return json({ ok: true, rid: made.rid, until: made.until }, 200, keep);
}

/**
 * One request, bound to a thread on the hub's latest list and to the draft it was made from, signed, 10 minutes.
 * The checks a send must pass on this side (the hub checks again on its own list).
 */
export function makeRequest(s: PrivateState, sendKey: Buffer, kind: RequestKind, given: { thread: unknown; draftAt: unknown; text: unknown }, now: number): { next: PrivateState; result: Made } {
  const no = (error: Exclude<Made, { rid: string }>["error"]) => ({ next: s, result: { error } as Made });
  const item: TextItem | undefined = typeof given.thread === "string" ? s.texts?.items.find((i) => i.id === given.thread) : undefined;
  if (!item) return no("no-thread");
  const draftAt = typeof given.draftAt === "number" && Number.isInteger(given.draftAt) ? given.draftAt : -1;
  const text = typeof given.text === "string" ? given.text.replace(/\r\n?/g, "\n").replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? "\n" : "")).trim() : "";
  if (kind === "send" || kind === "restyle") {
    if (item.group) return no("no-thread");
    if (!text || text.length > (kind === "send" ? SEND_MAX : DICTATED_MAX)) return no("bad-text");
  }
  if (kind === "send") {
    if (item.state === "settled") return no("no-thread");
    // Bound to the draft on screen: a newer draft (or none) since the Desk last read the list refuses it.
    if (draftAt !== (item.draft?.at ?? 0)) return no("changed");
  }
  if (s.requests.some((e) => e.req.thread === item.id && e.req.kind === kind && (shownState(e, now) === "waiting" || shownState(e, now) === "taken"))) return no("busy");
  const fields = { rid: randomBytes(12).toString("hex"), kind, thread: item.id, draftAt: kind === "send" ? draftAt : 0, text: kind === "send" || kind === "restyle" ? text : "", until: now + REQUEST_MS };
  const req: TextRequest = { ...fields, created: now, sig: signRequest(sendKey, fields) };
  return { next: { ...s, requests: [...s.requests, { req, state: "waiting", takenAt: null, doneAt: null }] }, result: { rid: req.rid, until: req.until } };
}

/** The step-up for the send unlock, the Keys form's way (api/_keys/route.ts): this passkey, fresh, once. */
async function unlock(request: Request, body: Record<string, unknown>, signed: Extract<Signed, { ok: true }>, desk: DeskDeps & { store: AuthStore }, keep: string[]): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const rpID = url.hostname;
  const challengeKey = await deskKeyFor(desk.deskKey, "challenge");
  const signin = await Gate.open(desk.store, "signin", addressOf(request), await deskKeyFor(desk.deskKey, "client"), desk.now);
  const wait = signin.wait();
  if (wait > 0) return json({ error: "locked-out", wait: Math.ceil(wait / 1000) }, 429, keep);
  const p = signed.passkey;
  if (body.action === "unlock-options") {
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: STEPUP_S * 1000, allowCredentials: [{ id: p.id, ...(p.transports && { transports: p.transports as never }) }] });
    const challenge = cookie(CHALLENGE_COOKIE.relay, signToken(challengeKey, { t: "relay", ch: options.challenge, e: Math.floor(desk.now / 1000) + STEPUP_S }), STEPUP_S);
    return json(options, 200, [challenge, ...keep]);
  }
  const clearChallenge = cookie(CHALLENGE_COOKIE.relay, "", 0);
  const challenge = challengeOf(challengeKey, readCookie(request, CHALLENGE_COOKIE.relay), "relay", desk.now);
  const checked = challenge && !signin.spent(challenge.ch) ? await checkAssertion({ response: body.response as AuthenticationResponseJSON | undefined, challenge: challenge.ch, origin, rpID, passkey: p }) : { ok: false as const };
  // Spent before anything acts on it, atomically: of two requests racing with one answer, only one gets past here.
  const claimed = checked.ok && challenge ? await signin.claim(challenge.ch, challenge.e * 1000) : false;
  if (!checked.ok || !challenge || !claimed) {
    await signin.fail();
    return json({ error: "step-up" }, 401, [clearChallenge, ...keep]);
  }
  await signin.pass(challenge.ch, challenge.e * 1000);
  const list = await desk.store.passkeys();
  await desk.store.savePasskeys(list.map((k) => (k.id === p.id ? { ...k, counter: checked.counter } : k)));
  const { cookie: unlockSet, until } = await unlockCookie(desk.deskKey, p.id, desk.now);
  return json({ ok: true, unlockedUntil: until }, 200, [clearChallenge, unlockSet, ...keep]);
}

/** The installer's trade: an open pair code for the hub's token and send key, once. */
async function pairHub(request: Request, deps: RelayRouteDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  // A page in a browser can't pair: the installer sends no Origin.
  if (request.headers.get("origin")) return json({ error: "cross-site" }, 403);
  const raw = await request.text().catch(() => "");
  if (raw.length > 256) return json({ error: "bad-request" }, 413);
  let code: string | null;
  try {
    code = normalCode((JSON.parse(raw) as { code?: unknown }).code);
  } catch {
    code = null;
  }
  const store = deps.store;
  if (!store || !hubKey(deps.desk.deskKey)) return json({ error: "not-set-up" }, 503);
  const open = await store.pair();
  if (!open || open.until <= deps.now || open.tries >= PAIR_TRIES) {
    if (open) await store.savePair(null);
    return json({ error: "no-code" }, 404);
  }
  if (!code || !sameHash(sha256(code), open.codeHash)) {
    const tries = open.tries + 1;
    await store.savePair(tries >= PAIR_TRIES ? null : { ...open, tries });
    return json({ error: "wrong-code", left: Math.max(0, PAIR_TRIES - tries) }, 403);
  }
  const minted = mintPairing(deps.desk.deskKey);
  if (!minted) return json({ error: "not-set-up" }, 503);
  await store.savePair(null);
  await store.saveHub({ pairId: minted.pairId, tokenHash: sha256(minted.token), pairedAt: deps.now, lastSeen: null });
  // A new pairing starts with an empty list: nothing of an earlier Mac carries over.
  await update(store, () => ({ next: { texts: null, requests: [] }, result: true }));
  return json({ ok: true, token: minted.token, sendKey: minted.sendKey });
}

async function hubPost(request: Request, url: URL, deps: RelayRouteDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const view = url.searchParams.get("view");
  if ([...url.searchParams.keys()].length > 1 || (url.search && !["texts", "results", "sort", "draft", "unpair"].includes(view ?? ""))) return json({ error: "bad-request" }, 400);
  if (!(await hubOf(request, deps)) || !deps.store) return json({ error: "unauthorized" }, 401);
  const store = deps.store;
  const raw = await request.text().catch(() => "");

  if (!view) {
    const read = parseRelayStatus(raw);
    if (!read.ok) return json({ error: "refused", problems: read.problems }, 422);
    const before = await store.status().catch(() => null);
    await store.saveStatus(read.status);
    const hub = await store.hub();
    if (hub) await store.saveHub({ ...hub, lastSeen: deps.now }).catch(() => undefined);
    // Dialtone's nudge: once, when the nudge time the hub last reported has passed; a count, never in quiet hours.
    const s = read.status;
    if (before?.nextNudgeAt && before.nextNudgeAt <= s.at && s.owed > 0 && s.hub === "listening" && !isQuiet(deps.now)) await deps.ping(relayPing(s.owed)).catch(() => 0);
    return json({ ok: true });
  }

  if (view === "unpair") {
    // The wipe on the Mac (`relay wipe`): the hub forgets itself on the site too. Its token stops working, and the
    // list and the requests go, as with Unpair on the Desk.
    await store.saveHub(null);
    await update(store, () => ({ next: { texts: null, requests: [] }, result: true }));
    await store.saveStatus(emptyRelayStatus(deps.now, "wiped"));
    return json({ ok: true });
  }

  if (raw.length > MAX_TEXTS_BYTES) return json({ error: "too-big" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad-request" }, 400);
  }

  if (view === "texts") {
    const texts = readTextsView(body, deps.now);
    if (!texts) return json({ error: "refused" }, 422);
    await update(store, (s) => ({ next: { ...s, texts }, result: true }));
    return json({ ok: true });
  }

  if (view === "results") {
    const list = (body as { results?: unknown })?.results;
    if (!Array.isArray(list) || list.length > 50) return json({ error: "bad-request" }, 400);
    const results = new Map<string, RequestResult>();
    for (const r of list as Record<string, unknown>[]) if (typeof r?.rid === "string" && RID.test(r.rid) && (RESULTS as readonly string[]).includes(r.result as string)) results.set(r.rid, r.result as RequestResult);
    // Only a request the hub took, once: a result for anything else changes nothing.
    await update(store, (s) => ({ next: { ...s, requests: s.requests.map((e) => (e.state === "taken" && results.has(e.req.rid) ? { ...e, state: results.get(e.req.rid)!, doneAt: deps.now } : e)) }, result: true }));
    return json({ ok: true });
  }

  // A model call: the hub's placeholdered snippet, read again, trimmed, under the texts line's own cap. The worst case
  // is reserved on the ledger before the call (a conditional write), then settled to the real cost.
  if (!deps.claude || !deps.spend) return json({ error: "not-set-up" }, 503);
  const spend = deps.spend;
  const sortInput = view === "sort" ? readSortInput(body) : null;
  const draftInput = view === "draft" ? readDraftInput(body) : null;
  if (!sortInput && !draftInput) return json({ error: "bad-request" }, 400);
  const model = sortInput ? SORT_MODEL : DRAFT_MODEL;
  if (!(await reserveSpend(spend, model, deps.budget, deps.now).catch(() => false))) return json({ ok: false, paused: true });
  const provider = claudeProvider(deps.claude);
  try {
    const got = sortInput ? await provider.sort(sortInput) : await provider.draft(draftInput!);
    await settleSpend(spend, model, got.usage, deps.now).catch(() => undefined);
    return json({ ok: true, answer: got.answer });
  } catch (e) {
    // Released only when Anthropic answered with an error status (not billed). A timeout or a dropped connection may
    // have been billed, so its reservation (the worst case) stays on the ledger.
    if (typeof (e as { status?: unknown } | null)?.status === "number") await settleSpend(spend, model, null, deps.now).catch(() => undefined);
    return json({ error: "model" }, 502);
  }
}
