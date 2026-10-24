/**
 * The Desk's Keys form (#330, docs/SECURITY.md, "Setting keys from the Desk"): set or replace an allowlisted key in
 * the Key Vault without Cloud Shell. Write-only: nothing here can read a value back, list values or delete one.
 * Azure only: azure/src/index.ts registers it at /api/keys behind the same site gate as every function, and the vault
 * client (api/_keys/vault.ts) exists only there.
 *
 *   GET  /api/keys                        passkey session: each allowlisted key's name, label, whether the vault has
 *                                         it, when its current version was written and when it was last set from the
 *                                         Desk. Never a value, a length or a hash.
 *   POST /api/keys { action: "options", h }
 *                                         passkey session: the step-up's passkey request, for this session's own
 *                                         passkey, good for two minutes (a `__Host-` challenge cookie), and bound to
 *                                         one write: h = sha256(name + "\n" + value), hex, value trimmed (writeHash).
 *   POST /api/keys { action: "set", name, value, response }
 *                                         passkey session AND that fresh passkey answer, for that same name and
 *                                         value: writes `value` as the new version of `name`. → { ok, name,
 *                                         updated }, never the value.
 *
 * Every POST is JSON only, from the Desk's own pages (requireSession's same-origin check; the JSON content type also
 * forces a CORS preflight), at most 16 KB, and the value at most 4 KB of one-line text. A stolen session cookie alone
 * can't set anything: each write needs the device's own unlock again, and that answer is good for the one name and
 * value it was asked for (the challenge carries their hash), once: the challenge is spent with an atomic
 * create-if-absent write in the store before the vault is called, so two requests racing with one answer can't both
 * write. Failed step-ups count against the sign-in's
 * lockout (api/_desk/limits.ts); writes have their own limit (six in a row, then a wait). The trail and the log keep
 * the key's name and the time, never the value.
 *
 * Refusals: 401 { error: "signed-out" } with no session, 401 { error: "step-up" } without a good fresh passkey answer,
 * 400 { error: "not-allowed" } for a name off the allowlist, 400 { error: "bad-value" }, 413, 415, 429 { error:
 * "locked", wait }, 403 from another site, 503 { error: "not-set-up" | "no-vault" }, 502 { error: "vault" }.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { checkAssertion } from "../_desk/assert.js";
import { deskKeyFor } from "../_desk/keys.js";
import { addressOf, Gate, type Attempt } from "../_desk/limits.js";
import { CHALLENGE_COOKIE, challengeOf, cookie, readCookie, requireSession, signToken, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore, type AuthStore } from "../_desk/store.js";
import { SETTABLE_KEYS, cleanValue, settable } from "./allowlist.js";
import { pickKeyTrail, type KeyTrail } from "./trail.js";
import { pickKeyWriter, type KeyWriter } from "./vault.js";

/**
 * What a step-up is bound to (#330): sha256(name + "\n" + value), hex, over the value as it will be stored (trimmed).
 * The Desk computes the same in the browser (apps/world/src/desk/security/keys.ts, writeHash).
 */
export function writeHash(name: string, value: string): string {
  return createHash("sha256").update(`${name}\n${value}`).digest("hex");
}
const HASH = /^[a-f0-9]{64}$/;
/** The hash as the challenge cookie keeps it: keyed, so the cookie never carries a plain hash of a value. */
const sealHash = (key: Buffer, h: string) => createHmac("sha256", key).update(`keys-h:${h}`).digest("hex");
const sameHash = (sealed: string | undefined, want: string) => typeof sealed === "string" && sealed.length === want.length && timingSafeEqual(Buffer.from(sealed), Buffer.from(want));

/** A step-up is good for this long (seconds): the passkey answer has to be fresh. */
export const STEPUP_S = 120;
/** The most a request body may be (bytes). */
export const MAX_BODY = 16 * 1024;

type Env = Record<string, string | undefined>;

export interface KeysDeps {
  desk: DeskDeps;
  writer: KeyWriter | null;
  trail: KeyTrail | null;
  /** Where the name-and-time lines go (the Function's log). */
  log: (line: string) => void;
}

export function liveKeysDeps(env: Env = process.env): KeysDeps {
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    writer: pickKeyWriter(env),
    trail: pickKeyTrail(env),
    log: (line) => console.log(line),
  };
}

function json(body: unknown, status = 200, cookies: string[] = [], extra: Record<string, string> = {}): Response {
  const res = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...extra } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

function locked(wait: number, cookies: string[]): Response {
  const s = Math.ceil(wait / 1000);
  return json({ error: "locked", wait: s }, 429, cookies, { "Retry-After": String(s) });
}

const site = (request: Request) => {
  const url = new URL(request.url);
  return { origin: url.origin, rpID: url.hostname };
};

async function gate(desk: DeskDeps & { store: AuthStore }, attempt: Attempt, request: Request): Promise<Gate> {
  return Gate.open(desk.store, attempt, addressOf(request), await deskKeyFor(desk.deskKey, "client"), desk.now);
}

/** What the Desk is shown about each key: whether it is set and when, never anything of the value. */
export interface KeyView {
  name: string;
  label: string;
  from: string;
  set: boolean | null;
  updated: number | null;
  lastSet: number | null;
}

export async function handleGet(request: Request, deps: KeysDeps = liveKeysDeps()): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const trail = await (deps.trail?.list() ?? Promise.resolve([])).catch(() => []);
  const lastSet = (name: string) => trail.find((e) => e.name === name)?.at ?? null;
  let dates: Awaited<ReturnType<KeyWriter["dates"]>> | null = null;
  let vault: "ok" | "none" | "error" = deps.writer ? "ok" : "none";
  if (deps.writer) dates = await deps.writer.dates().catch(() => ((vault = "error"), null));
  const keys: KeyView[] = SETTABLE_KEYS.map((k) => {
    const d = dates?.get(k.secret);
    return { name: k.secret, label: k.label, from: k.from, set: dates ? Boolean(d?.enabled && !d.placeholder) : null, updated: d?.updated ?? null, lastSet: lastSet(k.secret) };
  });
  return json({ vault, stepUpSeconds: STEPUP_S, keys }, 200, [signed.cookie]);
}

export async function handlePost(request: Request, deps: KeysDeps = liveKeysDeps()): Promise<Response> {
  const desk = deps.desk;
  if (!desk.deskKey || !desk.store) return json({ error: "not-set-up" }, 503);
  const store = desk.store;
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "too-big" }, 413);
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return json({ error: "too-big" }, 413);
  // The session first: no session, no answer about anything else (not even whether a name is allowed).
  const signed = await requireSession(request, desk);
  if (!signed.ok) return signed.response;
  const keep = [signed.cookie];
  type Body = { action?: unknown; name?: unknown; value?: unknown; response?: unknown; h?: unknown };
  const body = ((): Body | null => {
    try {
      const got: unknown = JSON.parse(text);
      return got && typeof got === "object" && !Array.isArray(got) ? (got as Body) : null;
    } catch {
      return null;
    }
  })();
  if (!body) return json({ error: "bad-request" }, 400, keep);
  const { origin, rpID } = site(request);
  const challengeKey = await deskKeyFor(desk.deskKey, "challenge");
  const full = { ...desk, store };
  const clearChallenge = cookie(CHALLENGE_COOKIE.keys, "", 0);

  if (body.action === "options") {
    const signin = await gate(full, "signin", request);
    const wait = signin.wait();
    if (wait > 0) return locked(wait, keep);
    // The write this step-up is for, by hash: the name and value themselves aren't sent until the set.
    if (typeof body.h !== "string" || !HASH.test(body.h)) return json({ error: "bad-request" }, 400, keep);
    const p = signed.passkey;
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: STEPUP_S * 1000, allowCredentials: [{ id: p.id, ...(p.transports && { transports: p.transports as never }) }] });
    const challenge = cookie(CHALLENGE_COOKIE.keys, signToken(challengeKey, { t: "keys", ch: options.challenge, e: Math.floor(desk.now / 1000) + STEPUP_S, h: sealHash(challengeKey, body.h) }), STEPUP_S);
    return json(options, 200, [challenge, ...keep]);
  }

  if (body.action !== "set") return json({ error: "bad-request" }, 400, keep);
  const key = settable(body.name);
  if (!key) return json({ error: "not-allowed" }, 400, keep);
  const value = cleanValue(body.value);
  if (value === null) return json({ error: "bad-value" }, 400, keep);
  if (!deps.writer) return json({ error: "no-vault" }, 503, keep);

  const uses = await gate(full, "keys", request);
  const signin = await gate(full, "signin", request);
  const wait = Math.max(uses.wait(), signin.wait());
  if (wait > 0) return locked(wait, keep);

  // The step-up: a fresh answer from this session's own passkey to the challenge handed out in the last two minutes,
  // for this very name and value.
  const challenge = challengeOf(challengeKey, readCookie(request, CHALLENGE_COOKIE.keys), "keys", desk.now);
  const bound = challenge !== null && sameHash(challenge.h, sealHash(challengeKey, writeHash(key.secret, value)));
  const checked = challenge && bound && !signin.spent(challenge.ch) ? await checkAssertion({ response: body.response as AuthenticationResponseJSON | undefined, challenge: challenge.ch, origin, rpID, passkey: signed.passkey }) : { ok: false as const };
  // Spent before anything acts on it, atomically: of two requests racing with this answer, only one gets past here.
  const claimed = checked.ok && challenge ? await signin.claim(challenge.ch, challenge.e * 1000) : false;
  if (!checked.ok || !challenge || !claimed) {
    await signin.fail();
    deps.log(`keys: step-up refused for ${key.secret}`);
    return json({ error: "step-up" }, 401, [clearChallenge, ...keep]);
  }
  await signin.pass(challenge.ch, challenge.e * 1000);
  const list = await store.passkeys();
  await store.savePasskeys(list.map((p) => (p.id === signed.passkey.id ? { ...p, counter: checked.counter } : p)));

  let updated: number | null;
  try {
    ({ updated } = await deps.writer.set(key.secret, value));
  } catch {
    // Only the name: a vault error's text is never passed on or logged, in case it carries anything of the request.
    deps.log(`keys: ${key.secret} not set (the vault refused)`);
    return json({ error: "vault" }, 502, [clearChallenge, ...keep]);
  }
  // The write counts against the form's own limit, read afresh so the spent challenge above is kept.
  await (await gate(full, "keys", request)).count();
  const at = desk.now;
  await deps.trail?.add({ name: key.secret, at }).catch(() => undefined);
  deps.log(`keys: set ${key.secret} at ${new Date(at).toISOString()}`);
  return json({ ok: true, name: key.secret, updated: updated ?? at }, 200, [clearChallenge, ...keep]);
}

export const GET = (request: Request) => handleGet(request);
export const POST = (request: Request) => handlePost(request);
