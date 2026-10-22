/**
 * The Desk's sign-in (#132, docs/THREAT-MODEL.md, R3; docs/SECURITY.md, "Signing in to the Desk"), as a Vercel
 * function. Nikita unlocks the Desk with a passkey on a device enrolled once; the Desk key is asked for only to
 * enrol a new device. A sign-in opens a short session (api/_desk/session.ts), and failed tries slow down and then
 * lock out (api/_desk/limits.ts).
 *
 * GET                                    → { ready, signedIn, until?, hardUntil?, device?, devices? }: whether sign-in
 *                                          is set up, whether this browser is signed in (and the session, renewed
 *                                          by the call), and the enrolled devices when it is.
 * POST { action: "signin-options" }      → the passkey request for navigator.credentials.get() (fetched ahead of a
 *                                          tap; nothing checked or counted).
 * POST { action: "signin", response }    → checks the passkey's answer; opens a session.
 * POST { action: "enrol-options", key, label } → with the Desk key, the request for navigator.credentials.create().
 * POST { action: "enrol", response }     → checks the new passkey, stores its public part, opens a session.
 * POST { action: "remove", id }          → signed in: removes an enrolled device (and its sessions and pings).
 * POST { action: "signout", endpoint? }  → ends this browser's session, and drops this device's pings (#135) when
 *                                          the Desk sends its push endpoint.
 *
 * Refusals: 401 { error: "wrong-key" | "failed" | "signed-out" }, 429 { error: "locked", wait } with Retry-After,
 * 403 from another site, 503 { error: "not-set-up" } without the Desk key or the Blob store.
 *
 * WebAuthn is checked by SimpleWebAuthn (@simplewebauthn/server): origin, site, challenge, signature, user
 * verification and the signature counter. Passkeys are discoverable and always ask for the device's own unlock
 * (fingerprint, face or PIN).
 *
 * The locked site (#238): while the site is locked, a successful `signin` or `enrol` also sets the 180-day site cookie
 * (api/_site/login.ts, passkeySiteCookie), so the Desk passkey is the way into the whole site. The site's login page
 * uses these same two ceremonies, and the gate lets /api/desk-auth through for them (api/_site/gate.ts).
 *
 * GET/POST ?site=login | ?site=password → the site password's sign-in and its Desk control (#236; vercel.json rewrites
 *                                          /api/site-login and /api/site-password here): api/_site/login.ts, control.ts.
 *
 * Environment: FOUNDRY_DESK_KEY (the enrolment secret, and the root of every signing key), BLOB_STORE_ID (the private
 * Blob store that keeps the passkeys and the counters).
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { deskKeyFor, keyMatches } from "./_desk/keys.js";
import { addressOf, Gate, type Attempt } from "./_desk/limits.js";
import { CHALLENGE_COOKIE, CHALLENGE_S, MAX_S, SESSION_COOKIE, challengeOf, clearSession, cookie, newSession, readCookie, renewed, requireSession, sameOrigin, sessionCookie, sessionOf, signToken, type Challenge, type DeskDeps } from "./_desk/session.js";
import { dropEndpoint, dropPasskey } from "./_desk/pings.js";
import { MAX_PASSKEYS, pickAuthStore, type AuthStore, type Passkey } from "./_desk/store.js";
import * as siteControl from "./_site/control.js";
import * as siteLogin from "./_site/login.js";
import { pickSiteStore, type SiteStore } from "./_site/state.js";

/** The Desk's sign-in, and (#238) the site lock it also opens: with no `site`, no site cookie is ever set. */
export interface AuthDeps extends DeskDeps {
  env?: Record<string, string | undefined>;
  site?: SiteStore | null;
}

const RP_NAME = "C.E.O. Desk";
/** Every Desk passkey belongs to the one Desk account; nothing personal in it. */
const USER_ID = new TextEncoder().encode("ceo-desk");
const USER_NAME = "Desk";

function json(body: unknown, status = 200, cookies: string[] = [], extra: Record<string, string> = {}): Response {
  const res = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

const live = (): AuthDeps => ({ deskKey: process.env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(), now: Date.now(), env: process.env, site: pickSiteStore() });

/** The site cookie to add to a passkey sign-in or a new device, when the site is locked (#238). */
async function siteCookieFor(deps: AuthDeps): Promise<string[]> {
  if (!deps.env || deps.site === undefined) return [];
  const line = await siteLogin.passkeySiteCookie(deps.env, deps.site, deps.now);
  return line ? [line] : [];
}

/** The device's name as stored: plain words, short. */
export function cleanLabel(given: unknown): string {
  const text = typeof given === "string" ? given.replace(/[^\p{L}\p{N} .,'()&+-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return text || "A device";
}

/** What the Desk is shown about a device: never its key. */
const deviceView = (p: Passkey, current: string | null) => ({ id: p.id, label: p.label, added: p.added, used: p.used ?? null, current: p.id === current });

const site = (request: Request) => {
  const url = new URL(request.url);
  return { origin: url.origin, rpID: url.hostname };
};

const toBytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64url"));

async function gateFor(deps: DeskDeps & { store: AuthStore }, attempt: Attempt, request: Request): Promise<Gate> {
  return Gate.open(deps.store, attempt, addressOf(request), await deskKeyFor(deps.deskKey, "client"), deps.now);
}

function locked(wait: number): Response {
  const s = Math.ceil(wait / 1000);
  return json({ error: "locked", wait: s }, 429, [], { "Retry-After": String(s) });
}

export async function handleGet(request: Request, deps: DeskDeps = live()): Promise<Response> {
  if (!deps.deskKey || !deps.store) return json({ ready: false, signedIn: false });
  const store = deps.store;
  const given = readCookie(request, SESSION_COOKIE);
  const session = sessionOf(await deskKeyFor(deps.deskKey, "session"), given, deps.now);
  const passkeys = session || !given ? await store.passkeys() : [];
  const mine = session ? passkeys.find((p) => p.id === session.c) : undefined;
  if (session && mine) {
    const next = renewed(session, deps.now);
    return json(
      { ready: true, signedIn: true, until: next.e * 1000, hardUntil: (next.s + MAX_S) * 1000, device: mine.label, devices: passkeys.map((p) => deviceView(p, mine.id)) },
      200,
      [await sessionCookie(deps.deskKey, next, deps.now)],
    );
  }
  // Signed out. (A lockout is told on the try itself, as a 429, so a plain visit to the Desk reads nothing more.)
  return json({ ready: true, signedIn: false }, 200, given ? [clearSession()] : []);
}

export async function handlePost(request: Request, deps: AuthDeps = live()): Promise<Response> {
  if (!deps.deskKey || !deps.store) return json({ error: "not-set-up" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross-site" }, 403);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const body = (await request.json().catch(() => null)) as { action?: unknown; key?: unknown; label?: unknown; response?: unknown; id?: unknown; endpoint?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "bad-request" }, 400);
  const store = deps.store;
  const full = { ...deps, store };
  const { origin, rpID } = site(request);
  const challengeKey = await deskKeyFor(deps.deskKey, "challenge");
  const challengeCookie = (c: Challenge) => cookie(CHALLENGE_COOKIE[c.t], signToken(challengeKey, c), CHALLENGE_S);
  const clearChallenge = (step: Challenge["t"]) => cookie(CHALLENGE_COOKIE[step], "", 0);
  const challengeFor = (step: Challenge["t"]) => challengeOf(challengeKey, readCookie(request, CHALLENGE_COOKIE[step]), step, deps.now);
  const until = () => Math.floor(deps.now / 1000) + CHALLENGE_S;

  switch (body.action) {
    case "signout":
      // Signing out of a device stops its pings (#135). The endpoint is the device's own: only it knows it.
      await dropEndpoint(store, body.endpoint);
      return json({ ok: true }, 200, [clearSession()]);

    case "remove": {
      const signed = await requireSession(request, deps);
      if (!signed.ok) return signed.response;
      const list = await store.passkeys();
      if (typeof body.id !== "string" || !list.some((p) => p.id === body.id)) return json({ error: "not-found" }, 404, [signed.cookie]);
      await store.savePasskeys(list.filter((p) => p.id !== body.id));
      await dropPasskey(store, body.id);
      // Removing the device in hand ends this session too; any other device's sessions end at their next use.
      return json({ ok: true }, 200, [body.id === signed.session.c ? clearSession() : signed.cookie]);
    }

    case "signin-options": {
      // Nothing is checked or counted here (the Desk fetches these ahead of a tap); the lockout is on the answer.
      const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: 120_000 });
      return json(options, 200, [challengeCookie({ t: "signin", ch: options.challenge, e: until() })]);
    }

    case "signin": {
      const gate = await gateFor(full, "signin", request);
      const wait = gate.wait();
      if (wait > 0) return locked(wait);
      const challenge = challengeFor("signin");
      const response = body.response as AuthenticationResponseJSON | undefined;
      const list = await store.passkeys();
      const passkey = response && typeof response.id === "string" ? list.find((p) => p.id === response.id) : undefined;
      let ok = false;
      let counter = 0;
      if (challenge && !gate.spent(challenge.ch) && response && passkey) {
        try {
          const result = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challenge.ch,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: { id: passkey.id, publicKey: toBytes(passkey.publicKey), counter: passkey.counter, transports: passkey.transports },
            requireUserVerification: true,
          });
          ok = result.verified;
          counter = result.authenticationInfo.newCounter;
        } catch {
          ok = false;
        }
      }
      if (!ok || !passkey || !challenge) {
        await gate.fail();
        return json({ error: "failed" }, 401, [clearChallenge("signin")]);
      }
      await gate.pass(challenge.ch, challenge.e * 1000);
      await store.savePasskeys(list.map((p) => (p.id === passkey.id ? { ...p, counter, used: new Date(deps.now).toISOString() } : p)));
      const session = newSession(passkey.id, deps.now);
      return json({ ok: true, device: passkey.label }, 200, [clearChallenge("signin"), await sessionCookie(deps.deskKey, session, deps.now), ...(await siteCookieFor(deps))]);
    }

    case "enrol-options": {
      const gate = await gateFor(full, "enrol", request);
      const wait = gate.wait();
      if (wait > 0) return locked(wait);
      if (!keyMatches(body.key, deps.deskKey)) {
        await gate.fail();
        return json({ error: "wrong-key" }, 401);
      }
      const list = await store.passkeys();
      if (list.length >= MAX_PASSKEYS) return json({ error: "too-many" }, 409);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID,
        userName: USER_NAME,
        userDisplayName: RP_NAME,
        userID: USER_ID,
        timeout: 120_000,
        attestationType: "none",
        excludeCredentials: list.map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      });
      // The key was right: the signed challenge carries that forward to the second step, for five minutes.
      return json(options, 200, [challengeCookie({ t: "enrol", ch: options.challenge, e: until(), label: cleanLabel(body.label) })]);
    }

    case "enrol": {
      const gate = await gateFor(full, "enrol", request);
      const wait = gate.wait();
      if (wait > 0) return locked(wait);
      const challenge = challengeFor("enrol");
      const response = body.response as RegistrationResponseJSON | undefined;
      let added: Passkey | null = null;
      if (challenge && !gate.spent(challenge.ch) && response) {
        try {
          const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge.ch, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
          if (result.verified) {
            const c = result.registrationInfo.credential;
            added = { id: c.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter, ...(c.transports?.length && { transports: c.transports.slice(0, 6) }), label: challenge.label ?? "A device", added: new Date(deps.now).toISOString() };
          }
        } catch {
          added = null;
        }
      }
      if (!added || !challenge) {
        await gate.fail();
        return json({ error: "failed" }, 401, [clearChallenge("enrol")]);
      }
      await gate.pass(challenge.ch, challenge.e * 1000);
      const list = (await store.passkeys()).filter((p) => p.id !== added.id);
      if (list.length >= MAX_PASSKEYS) return json({ error: "too-many" }, 409, [clearChallenge("enrol")]);
      await store.savePasskeys([...list, added]);
      return json({ ok: true, device: added.label }, 200, [clearChallenge("enrol"), await sessionCookie(deps.deskKey, newSession(added.id, deps.now), deps.now), ...(await siteCookieFor(deps))]);
    }

    default:
      return json({ error: "bad-request" }, 400);
  }
}

/**
 * The site password's two routes (#236) live in this function on Vercel, so they add none to the deployment:
 * vercel.json rewrites /api/site-login to ?site=login and /api/site-password to ?site=password.
 */
export function siteRoute(request: Request): "login" | "password" | null {
  const url = new URL(request.url);
  const site = url.searchParams.get("site");
  if (site === "login" || url.pathname === "/api/site-login") return "login";
  if (site === "password" || url.pathname === "/api/site-password") return "password";
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const site = siteRoute(request);
  if (site === "login") return siteLogin.GET(request);
  if (site === "password") return siteControl.GET(request);
  return handleGet(request);
}

export async function POST(request: Request): Promise<Response> {
  const site = siteRoute(request);
  if (site === "login") return siteLogin.POST(request);
  if (site === "password") return siteControl.POST(request);
  return handlePost(request);
}
