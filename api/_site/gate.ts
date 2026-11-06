/**
 * The whole-site gate (#236, #238; docs/SECURITY.md, "The site lock"): who may reach a page or an API route once the
 * site is locked. The Desk passkey is the only way in (#238). The same decision runs in front of everything on
 * Vercel (middleware.ts, Routing Middleware) and in front of every Azure function (azure/src/index.ts).
 *
 * In order:
 *   1. Not locked (or SITE_GATE=off): everything passes, as before.
 *   2. The ways in pass:
 *        /api/site-login (any method)          the login page, its script (?part=script) and its sign-out
 *        /api/desk-auth, GET, HEAD and POST, without a `site` query other than "login"
 *                                             the Desk's passkey ceremony: sign-in and "Add this device" (#238). The
 *                                             function guards itself: a sign-in needs a passkey, an enrolment the Desk
 *                                             key, removing a device a Desk session; its GET says only whether this
 *                                             browser is signed in. ?site=password (the lock's control) stays gated.
 *   3. Static files built from the public repo pass on GET or HEAD: the hashed bundles (/assets/), the models
 *      (/models/), the Desk's and the Lattice's images (/desk/, /tide/), the PWA manifest and the service worker. They
 *      hold nothing that isn't already public on GitHub, the manifest and its icons are fetched without cookies by
 *      the browser, and keeping them out of the gate saves a check per model.
 *   4. Machine callers with their own key:
 *        POST /api/world-step                 the hourly step: open by design (calling it more often changes nothing,
 *                                             docs/WORLD.md), and its answer says only whether it stepped and when
 *        POST /api/desk-pings + Authorization: Bearer <DESK_PINGS_SECRET>   the pings scan, checked here too
 *        POST /api/skippy-answer + Authorization: Bearer <SUBMIND_FEED_TOKEN>   a hand-off's answer from Skippy's or a
 *                                             submind's thread (#312), checked here too and again in api/skippy.ts
 *        POST /api/skippy-probe + Authorization: Bearer <SKIPPY_PROBE_TOKEN>   the upkeep run's Skippy probe (#955): a
 *                                             dry run (no device moves, nothing kept), checked here too and again in
 *                                             api/skippy.ts
 *        any request + x-ceo-site-bypass: <SITE_BYPASS_TOKEN>   the live watch (it reads site-bypass-token from the
 *                                             Key Vault, #313; Vercel's copy also served the public-mode seed)
 *        GET /api/haven-plan, /api/haven-meals, /api/haven-photos + x-ceo-builder-key: <BUILDER_READ_KEY>   the Builder reading
 *                                             the Haven's private files (#800, api/_site/builderkey.ts): GET or HEAD only
 *        GET <a room read> + x-ceo-room-key: <SUBMIND_LOG_TOKEN>    a submind thread reading its room's data
 *        POST /api/room-feed + x-ceo-room-key: <SUBMIND_FEED_TOKEN> a submind thread posting a room event
 *        POST /api/setup-asks + x-ceo-room-key: <SUBMIND_FEED_TOKEN> a submind thread posting or closing a setup ask (#324)
 *                                             (or either as Authorization: Bearer)
 *        GET or POST /api/skippy-tools + x-ceo-voice-tool: <a live call's tool token>   a Talk call's tool, from ElevenLabs
 *                                             (#479): signed by the Desk key and unexpired, checked here with the
 *                                             environment alone; api/_skippy/toolroute.ts checks it is kept and live
 *                                             (#281, api/_site/roomkeys.ts: each key opens only its own exact
 *                                             method, path and query; the handlers check the key again)
 *        POST /api/relay-hub (?view=texts|results|sort|draft|learn|unpair|photo|photos), or GET ?view=skip|requests|photo-key,
 *                                             + Authorization: Bearer
 *                                             <a hub token>   Relay's Mac hub
 *                                             (#535): signed by this Desk key (api/_relay/tokens.ts), checked here with
 *                                             the environment alone; api/_relay/route.ts checks it is the pairing on record
 *        POST /api/relay-pair                 the Relay installer trading a one-time pair code (#535). The code is the
 *                                             key: 10 minutes, 5 tries, made only in a Desk session with the send unlock
 *        GET /api/relay?view=status            Relay's public counts (#535: RelayStatus, counts and states only, public
 *                                             by design), for `relay status` and `relay wipe --verify` on the Mac
 *        GET /api/annex-elections             the Annex's Election night (#618): public election results from civicAPI,
 *                                             and its freshness counts (?debug=fresh); nothing private is in either
 *        POST /api/capture + x-ceo-phone-key: <a phone key> (or Authorization: Bearer)   Hey Skippy from the iPhone (#627): only a key of
 *                                             the right shape passes here; api/_haven/route.ts checks it against the
 *                                             stored hashes (unknown or revoked: 401) and paces it
 *        GET /api/capture?a=<signed audio link>   that answer's audio (#627): signed by this Desk key and unexpired,
 *                                             checked here with the environment alone; served once (api/_haven/audio.ts)
 *        GET /api/haven/devices, POST /api/haven/devices/action + x-ceo-phone-key (or Bearer)   the home devices
 *                                             (#632): the same phone-key shape check; api/_haven/devices/route.ts checks
 *                                             it against the stored hashes and paces it with the captures
 *        GET /api/hey-skippy, /hey-skippy/hello.mp3   the shortcut's greeting clips (#627): a few spoken words, public
 *   5. A good site session cookie (api/_site/session.ts) for the current version, renewed once a day of use.
 *   6. Anything else: an API route gets 401 { error: "site-locked" }; a page gets the login page, with 401.
 *
 * Every refusal carries `x-ceo-site-gate: locked`, which the Desk and the Lattice look for (apps/world/src/siteGate.ts)
 * to send the browser to the login page when only the API is gated (Azure).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { readCookie } from "../_desk/session.js";
import { LOGIN_CSP, loginPage } from "./page.js";
import { SITE_COOKIE, renewedSite, sessionFits, siteCookie, siteSessionOf } from "./session.js";
import { roomKeyPass } from "./roomkeys.js";
import { builderReads } from "./builderkey.js";
import { TOOL_HEADER, toolTokenSigned } from "../_skippy/voicetoken.js";
import { hubTokenPair } from "../_relay/tokens.js";
import { audioIdOf, KEY_SHAPE, phoneKeyOf } from "../_haven/links.js";
import { PROBE_PATH, probeToken } from "../_skippy/probekey.js";
import { currentState, siteKeys, type SiteKeys, type SiteState, type SiteStore } from "./state.js";

type Env = Record<string, string | undefined>;

export const BYPASS_HEADER = "x-ceo-site-bypass";
export const GATE_HEADER = "x-ceo-site-gate";
/** The shortest SITE_BYPASS_TOKEN that counts: a shorter one is ignored, so a weak token can't open the site. */
export const MIN_BYPASS = 32;

export const LOGIN_PATH = "/api/site-login";
/** The Desk's sign-in function (api/desk-auth.ts): the passkey ceremony the login page uses (#238). */
export const PASSKEY_PATH = "/api/desk-auth";
const STATIC_PREFIXES = ["/assets/", "/models/", "/desk/", "/tide/"];
const STATIC_FILES = new Set(["/manifest.webmanifest", "/sw.js", "/favicon.ico", "/robots.txt"]);

/** Why a request was let through (for tests, and the x-ceo-site-gate header on the way out). */
export type Pass = "off" | "login" | "passkey" | "static" | "world-step" | "pings-secret" | "submind-token" | "probe-token" | "bypass" | "builder-read" | "room-log" | "room-feed" | "voice-tool" | "relay-hub" | "relay-pair" | "relay-status" | "annex-results" | "phone-key" | "phone-audio" | "greeting" | "session";

export type Decision = { allow: true; why: Pass; setCookie?: string } | { allow: false; response: Response };

export interface GateContext {
  state: SiteState & { unknown?: boolean };
  /** The site's signing keys, or null when neither SITE_SESSION_SECRET nor FOUNDRY_DESK_KEY is set. */
  keys: SiteKeys | null;
  env: Env;
  now: number;
}

/** Two secrets compared in constant time (both hashed first, so their lengths don't show). */
export function secretMatches(given: string | null | undefined, want: string | null | undefined): boolean {
  if (!given || !want) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

/** A static file from the public build: GET or HEAD only, and a plain path (nothing encoded). */
export function isStaticPath(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname.includes("%") || pathname.includes("..")) return false;
  return STATIC_FILES.has(pathname) || STATIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Whether a request carries the workflows' bypass token (SITE_BYPASS_TOKEN, at least 32 characters). */
export function hasBypass(request: Request, env: Env): boolean {
  const want = env.SITE_BYPASS_TOKEN?.trim();
  return Boolean(want && want.length >= MIN_BYPASS && secretMatches(request.headers.get(BYPASS_HEADER)?.trim(), want));
}

/**
 * The Desk's passkey ceremony (#238): /api/desk-auth on GET, HEAD or POST, with no `site` query (or `site=login`, the
 * login itself). Not ?site=password, which rewrites to the lock's control and stays behind the gate.
 */
export function isPasskeyPath(request: Request, url: URL): boolean {
  if (url.pathname !== PASSKEY_PATH) return false;
  if (!["GET", "HEAD", "POST"].includes(request.method)) return false;
  const site = url.searchParams.getAll("site");
  return site.length === 0 || (site.length === 1 && site[0] === "login");
}

/** The pings workflow's scan, with the right DESK_PINGS_SECRET (api/desk-pings.ts checks it again). */
function isPingsScan(request: Request, pathname: string, env: Env): boolean {
  if (request.method !== "POST" || pathname !== "/api/desk-pings") return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") && secretMatches(auth.slice(7).trim(), env.DESK_PINGS_SECRET?.trim());
}

/**
 * A hand-off's answer coming back (#312), with the room threads' write key (SUBMIND_FEED_TOKEN, at least 32
 * characters). Only this one path and method: the key opens nothing else on the site.
 */
function isSkippyAnswer(request: Request, pathname: string, env: Env): boolean {
  if (request.method !== "POST" || pathname !== "/api/skippy-answer") return false;
  const want = env.SUBMIND_FEED_TOKEN?.trim();
  const auth = request.headers.get("authorization") ?? "";
  return Boolean(want && want.length >= MIN_BYPASS && auth.startsWith("Bearer ") && secretMatches(auth.slice(7).trim(), want));
}

/**
 * The Skippy probe (#955, api/_skippy/probe.ts): the upkeep run's dry-run asks, with SKIPPY_PROBE_TOKEN (at least 32
 * characters). Only this one path and method, with no query; api/skippy.ts checks the token again.
 */
function isSkippyProbe(request: Request, url: URL, env: Env): boolean {
  if (request.method !== "POST" || url.pathname !== PROBE_PATH || url.search !== "") return false;
  const want = probeToken(env);
  const auth = request.headers.get("authorization") ?? "";
  return Boolean(want && auth.startsWith("Bearer ") && secretMatches(auth.slice(7).trim(), want));
}

/** A Talk call's tool (#479): GET (a lookup) or POST (a hand-off to the Kernel), this one path, with a tool token this Desk key signed that hasn't expired. */
function isVoiceTool(request: Request, pathname: string, env: Env, now: number): boolean {
  if ((request.method !== "GET" && request.method !== "POST") || pathname !== "/api/skippy-tools") return false;
  return toolTokenSigned(request.headers.get(TOOL_HEADER), env.FOUNDRY_DESK_KEY ?? "", now);
}

/**
 * The views the Mac hub may call on /api/relay-hub. The contact photos (#642: `photo`, `photos`, GET `photo-key`) were
 * missing here until #891, so on a locked site every photo call got the gate's 401 and no photo ever reached the Desk.
 */
export const HUB_POSTS: readonly string[] = ["", "?view=texts", "?view=results", "?view=sort", "?view=draft", "?view=unpair", "?view=learn", "?view=photo", "?view=photos"];
export const HUB_GETS: readonly string[] = ["?view=skip", "?view=requests", "?view=photo-key"];

/** Relay's Mac hub (#535): its own calls on /api/relay-hub, with a hub token this Desk key signed. */
function isRelayHub(request: Request, url: URL, env: Env): boolean {
  if (url.pathname !== "/api/relay-hub") return false;
  const ok = request.method === "POST" ? HUB_POSTS.includes(url.search) : request.method === "GET" && HUB_GETS.includes(url.search);
  if (!ok) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") && hubTokenPair(auth.slice(7).trim(), env.FOUNDRY_DESK_KEY ?? "") !== null;
}

/** Hey Skippy (#627): a phone key (its own header, or a bearer) of the right shape. The handler checks it against the stored hashes. */
function isPhoneKey(request: Request): boolean {
  return KEY_SHAPE.test(phoneKeyOf(request) ?? "");
}

/** An answer's audio link (#627): the one `a` query, signed by this Desk key and unexpired. */
function isPhoneAudio(url: URL, env: Env, now: number): boolean {
  const keys = [...url.searchParams.keys()];
  return keys.length === 1 && keys[0] === "a" && audioIdOf(url.searchParams.get("a"), env.FOUNDRY_DESK_KEY ?? "", now) !== null;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  [GATE_HEADER]: "locked",
} as const;

/** The refusal for this request: JSON for the API and anything but a page load, the login page for a page. */
export function locked(request: Request, message?: "unknown" | "off", passkey = true): Response {
  const url = new URL(request.url);
  const page = (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/");
  if (!page) {
    const status = message === "unknown" ? 503 : 401;
    return new Response(JSON.stringify({ error: message === "unknown" ? "site-unavailable" : "site-locked" }), {
      status,
      headers: { ...SECURITY_HEADERS, "Content-Type": "application/json" },
    });
  }
  return new Response(request.method === "HEAD" ? null : loginPage({ next: url.pathname + url.search, message, passkey }), {
    status: message === "unknown" ? 503 : 401,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": LOGIN_CSP,
    },
  });
}

/** The gate's decision for one request. */
export function decide(request: Request, ctx: GateContext): Decision {
  const { state, env } = ctx;
  if (!state.on) return { allow: true, why: "off" };
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === LOGIN_PATH) return { allow: true, why: "login" };
  if (isPasskeyPath(request, url)) return { allow: true, why: "passkey" };
  if (isStaticPath(request.method, pathname)) return { allow: true, why: "static" };
  if (request.method === "POST" && pathname === "/api/world-step") return { allow: true, why: "world-step" };
  if (isPingsScan(request, pathname, env)) return { allow: true, why: "pings-secret" };
  if (isSkippyAnswer(request, pathname, env)) return { allow: true, why: "submind-token" };
  if (isSkippyProbe(request, url, env)) return { allow: true, why: "probe-token" };
  if (hasBypass(request, env)) return { allow: true, why: "bypass" };
  if (builderReads(request, env)) return { allow: true, why: "builder-read" };
  if (isVoiceTool(request, pathname, env, ctx.now)) return { allow: true, why: "voice-tool" };
  if (isRelayHub(request, url, env)) return { allow: true, why: "relay-hub" };
  if (request.method === "POST" && pathname === "/api/relay-pair" && url.search === "") return { allow: true, why: "relay-pair" };
  if (request.method === "GET" && pathname === "/api/relay" && url.search === "?view=status") return { allow: true, why: "relay-status" };
  if ((request.method === "GET" || request.method === "HEAD") && pathname === "/api/annex-elections") return { allow: true, why: "annex-results" };
  if (request.method === "POST" && pathname === "/api/capture" && url.search === "" && isPhoneKey(request)) return { allow: true, why: "phone-key" };
  if (request.method === "GET" && pathname === "/api/capture" && isPhoneAudio(url, env, ctx.now)) return { allow: true, why: "phone-audio" };
  // The home devices (#632) take the same phone key: GET the readings, POST one action. The handler checks the key.
  if (url.search === "" && isPhoneKey(request) && ((request.method === "GET" && pathname === "/api/haven/devices") || (request.method === "POST" && pathname === "/api/haven/devices/action"))) return { allow: true, why: "phone-key" };
  if ((request.method === "GET" || request.method === "HEAD") && (pathname === "/api/hey-skippy" || pathname === "/hey-skippy/hello.mp3") && url.search === "") return { allow: true, why: "greeting" };
  const room = roomKeyPass(request, env);
  if (room) return { allow: true, why: room };
  // The passkey works only where the Desk key is set; without it, the login page says signing in isn't set up.
  const passkey = Boolean(env.FOUNDRY_DESK_KEY?.trim());
  if (state.unknown) return { allow: false, response: locked(request, "unknown", passkey) };
  if (!ctx.keys) return { allow: false, response: locked(request, "off", passkey) };
  const session = siteSessionOf(ctx.keys.session, readCookie(request, SITE_COOKIE), ctx.now);
  if (!sessionFits(session, state)) return { allow: false, response: locked(request, undefined, passkey) };
  const next = renewedSite(session, ctx.now);
  return { allow: true, why: "session", ...(next && { setCookie: siteCookie(ctx.keys.session, next, ctx.now) }) };
}

export interface GateDeps {
  env: Env;
  /** The site record's store, or null when no blob store is connected (then only the environment decides). */
  store: SiteStore | null;
  now: number;
}

/**
 * The gate for one request, with the state read (cached per instance, api/_site/state.ts). A refused request that
 * carries a cookie we signed, for another version, re-reads the record once (at most every 2 s): right after "Sign
 * out everywhere" or locking again, an instance's copy can be older than the browser's new cookie.
 */
export async function gateRequest(request: Request, deps: GateDeps): Promise<Decision> {
  const state = await currentState(deps.env, deps.store, deps.now);
  if (!state.on) return { allow: true, why: "off" };
  const keys = await (siteKeys(deps.env) ?? Promise.resolve(null));
  const first = decide(request, { state, keys, env: deps.env, now: deps.now });
  if (first.allow || !keys || !deps.store || state.unknown) return first;
  const session = siteSessionOf(keys.session, readCookie(request, SITE_COOKIE), deps.now);
  if (!session || session.v === state.sv) return first;
  const again = await currentState(deps.env, deps.store, deps.now, { fresh: true });
  return decide(request, { state: again, keys, env: deps.env, now: deps.now });
}

/**
 * A handler behind the gate, for hosts with no middleware in front (the Azure Functions, azure/src/index.ts): the
 * same decision, then the handler, with a renewed site cookie added to its answer.
 */
export function withGate(handler: (request: Request) => Response | Promise<Response>, deps: () => GateDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const decision = await gateRequest(request, deps());
    if (!decision.allow) return decision.response;
    const res = await handler(request);
    if (!decision.setCookie) return res;
    const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
    out.headers.append("Set-Cookie", decision.setCookie);
    return out;
  };
}
