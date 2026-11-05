/**
 * The home devices' private API (#632, docs/HOME-DEVICES.md). Azure only: azure/src/index.ts registers these behind
 * the site gate, like every function.
 *
 *   GET  /api/haven/devices               a passkey session or a phone key: every device's reading, each vendor's
 *                                         state and the feed cap.
 *   GET  /api/haven/devices?view=status   the public face: each vendor's state, and each device's kind and state,
 *                                         and `links`: the Haven's other connections' states (Google Tasks, #637;
 *                                         King Soopers, #664). Never a name, a model, a place, a room or a serial.
 *   POST /api/haven/devices/action        { action, device?, rooms?, tempF?, heatF?, coolF?, mode?, portions?, plate?, suction?, water? }, a passkey
 *                                         session or a phone key (the thermostat's fields: #637): runs one
 *                                         action through the rails (api/_haven/devices/rails.ts) and answers
 *                                         { ok, say, code? }. 409 when a rail refused it, 502 when the vendor did.
 *   GET  /api/haven/devices/map?device=<id>  passkey session only (never a phone key): the vacuum's live run on the
 *                                         Hall's map (#814), { state: "idle" } when it isn't out, else { map }. It is the
 *                                         home's floor plan: read on request, never stored or logged; 404 when no map.
 *   POST /api/haven/devices/connect       passkey session only, Connect Roborock:
 *                                           { vendor: "roborock", step: "send", email }   Roborock emails a code
 *                                           { vendor: "roborock", step: "code", code }    the code; the login is sealed
 *                                           { vendor: "roborock", step: "disconnect" }    forgets the login
 *
 * A phone key (Hey Skippy, #627; `x-ceo-phone-key`, or a Bearer on the Function App's own address) is checked against the stored hashes and paced with the phone's captures (30 an
 * hour, api/_haven/phones.ts). A missing or wrong session or key gets 401 and nothing else. Every answer is
 * `private, no-store`, and no line logged holds a device's name, a serial, an email, a code or a token.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../../_blob.js";
import { requireSession, withCookie, type DeskDeps } from "../../_desk/session.js";
import { phoneKeyOf, PHONE_KEY_HEADER } from "../links.js";
import { PhoneKeys, KEY_SHAPE } from "../phones.js";
import { Home, type ActVia, type VendorState } from "./home.js";
import type { Fetch } from "./http.js";
import { loginWithCode, sendCode, type ConnectError, type RoborockLogin, type RoborockPending } from "./roborock.js";
import { isAction } from "./types.js";
import type { HomeVault } from "./vault.js";

/** The most a request body may be (bytes). */
const BODY_MAX = 4 * 1024;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,24}$/;
const CODE = /^\d{4,8}$/;
const DEVICE_ID = /^[0-9a-f]{12}$/;

export interface DevicesDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  /** The pepper phone keys are hashed with. */
  pepper: () => Promise<Buffer>;
  /** The devices, or null when HOME_TOKEN_KEY or the store isn't set. */
  home: () => Home | null;
  /** The sealed logins, for Connect Roborock. */
  vault: HomeVault | null;
  fetch: Fetch;
  log: (line: string) => void;
  /** The Haven's other connections' states (#637, api/_haven/google/route.ts): Systems reads them here. */
  links?: () => Promise<{ tasks: VendorState; kroger: VendorState }>;
  /** The vacuum's live map (#814, roborockMap.ts); null when it can't be read. */
  liveMap?: (device: string) => Promise<{ state: "idle" } | { map: unknown } | null>;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...headers } });
}

const unauthorized = () => json({ error: "unauthorized" }, 401);

type Who = { ok: true; via: ActVia; send: (r: Response) => Response } | { ok: false; response: Response };

/** A passkey session, or (when `phones` allows it) a phone key. */
async function who(request: Request, deps: DevicesDeps, phones: boolean): Promise<Who> {
  const key = phoneKeyOf(request);
  if (key !== null) {
    if (!phones || !KEY_SHAPE.test(key) || !deps.blob || !deps.desk.deskKey) return { ok: false, response: unauthorized() };
    let check: Awaited<ReturnType<PhoneKeys["use"]>>;
    try {
      check = await new PhoneKeys(deps.blob, await deps.pepper()).use(key, deps.desk.now);
    } catch {
      return { ok: false, response: json({ error: "unavailable" }, 503) };
    }
    if (!check.ok && check.why === "slow") return { ok: false, response: json({ say: "Easy, monkey. That's your lot for this hour." }, 429, { "Retry-After": String(check.wait ?? 60) }) };
    if (!check.ok) return { ok: false, response: unauthorized() };
    return { ok: true, via: "phone", send: (r) => r };
  }
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return { ok: false, response: signed.response };
  return { ok: true, via: "desk", send: (r) => withCookie(r, signed) };
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | "too-big" | "bad"> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return "too-big";
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return "too-big";
  try {
    const got: unknown = JSON.parse(raw);
    return got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : "bad";
  } catch {
    return "bad";
  }
}

/** GET /api/haven/devices. */
export async function devicesGet(request: Request, deps: DevicesDeps): Promise<Response> {
  const view = new URL(request.url).searchParams.get("view");
  const home = deps.home();
  const links = async () => {
    const l = deps.links ? await deps.links().catch(() => null) : null;
    return { tasks: l?.tasks ?? "waiting", kroger: l?.kroger ?? "waiting" };
  };
  if (view === "status") {
    if (!home) return json({ ready: false, vendors: { roborock: "waiting", petlibro: "waiting", whisker: "waiting", nest: "waiting" }, devices: [], links: await links() });
    return json({ ready: true, ...Home.publicOf(await home.status()), links: await links() });
  }
  if (view !== null) return json({ error: "bad-request" }, 400);
  const w = await who(request, deps, true);
  if (!w.ok) return w.response;
  if (!home) return w.send(json({ error: "not-set-up" }, 503));
  const status = await home.status();
  const roborock = deps.vault ? Boolean(await deps.vault.read<RoborockLogin>("roborock").catch(() => null)) : false;
  return w.send(json({ ...status, roborockConnected: roborock, links: await links() }));
}

/** GET /api/haven/devices/map: the vacuum's live run (#814), passkey session only. */
export async function devicesMap(request: Request, deps: DevicesDeps): Promise<Response> {
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer ") || request.headers.has(PHONE_KEY_HEADER)) return unauthorized();
  const w = await who(request, deps, false);
  if (!w.ok) return w.response;
  const device = new URL(request.url).searchParams.get("device") ?? "";
  if (!DEVICE_ID.test(device)) return w.send(json({ error: "bad-request" }, 400));
  if (!deps.liveMap) return w.send(json({ error: "not-set-up" }, 503));
  const got = await deps.liveMap(device).catch(() => null);
  if (!got) return w.send(json({ error: "no-map" }, 404));
  return w.send(json(got));
}

/** POST /api/haven/devices/action. */
export async function devicesAction(request: Request, deps: DevicesDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const w = await who(request, deps, true);
  if (!w.ok) return w.response;
  const body = await bodyOf(request);
  if (body === "too-big") return w.send(json({ error: "too-big" }, 413));
  if (body === "bad" || !isAction(body.action)) return w.send(json({ error: "bad-request" }, 400));
  const device = typeof body.device === "string" && DEVICE_ID.test(body.device) ? body.device : undefined;
  const rooms = Array.isArray(body.rooms) ? body.rooms.filter((r): r is string => typeof r === "string" && r.trim().length > 0 && r.length <= 40).slice(0, 8) : undefined;
  const home = deps.home();
  if (!home) return w.send(json({ error: "not-set-up", say: "The home devices aren't set up on this copy yet." }, 503));
  // The thermostat's numbers and mode go to its rails as given; they check type and range (rails.ts).
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const mode = typeof body.mode === "string" && body.mode.length <= 12 ? body.mode : undefined;
  // The portions, the wet bowl and the vacuum's mode words (#637 scope), checked by home.ts and its rails.
  const word = (v: unknown) => (typeof v === "string" && v.length <= 12 ? v : undefined);
  const result = await home.act({ action: body.action, device, rooms, via: w.via, tempF: num(body.tempF), heatF: num(body.heatF), coolF: num(body.coolF), mode, portions: num(body.portions), plate: num(body.plate), suction: word(body.suction), water: word(body.water) });
  const status = result.ok ? 200 : result.code === "vendor" ? 502 : result.code === "not-connected" ? 503 : 409;
  return w.send(json(result, status));
}

const CONNECT_SAY: Record<ConnectError | "expired", string> = {
  "no-account": "Roborock doesn't know that email.",
  "too-many": "Roborock says too many codes were asked for. Wait a while and try again.",
  "bad-code": "That code didn't work. Check the email and try again.",
  agreement: "Open the Roborock app once and accept its user agreement, then try again.",
  vendor: "Roborock's cloud didn't answer. Try again in a bit.",
  expired: "That code request ran out. Start again.",
};

/** POST /api/haven/devices/connect: Connect Roborock, passkey session only. */
export async function devicesConnect(request: Request, deps: DevicesDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer ") || request.headers.has(PHONE_KEY_HEADER)) return unauthorized();
  const w = await who(request, deps, false);
  if (!w.ok) return w.response;
  const body = await bodyOf(request);
  if (body === "too-big") return w.send(json({ error: "too-big" }, 413));
  if (body === "bad" || body.vendor !== "roborock") return w.send(json({ error: "bad-request" }, 400));
  const vault = deps.vault;
  if (!vault) return w.send(json({ error: "not-set-up" }, 503));
  const now = deps.desk.now;
  if (body.step === "send") {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!EMAIL.test(email)) return w.send(json({ error: "bad-email" }, 400));
    const sent = await sendCode(deps.fetch, email, now);
    if (!sent.ok) {
      deps.log(`home: roborock code not sent (${sent.error})`);
      return w.send(json({ error: sent.error, say: CONNECT_SAY[sent.error] }, sent.error === "vendor" ? 502 : 409));
    }
    await vault.write("roborock-pending", sent.pending);
    deps.log("home: roborock code sent");
    return w.send(json({ ok: true, step: "code" }));
  }
  if (body.step === "code") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!CODE.test(code)) return w.send(json({ error: "bad-code", say: CONNECT_SAY["bad-code"] }, 400));
    const pending = await vault.read<RoborockPending>("roborock-pending").catch(() => null);
    if (!pending || pending.until < now) {
      await vault.forget("roborock-pending");
      return w.send(json({ error: "expired", say: CONNECT_SAY.expired }, 409));
    }
    const got = await loginWithCode(deps.fetch, pending, code);
    if (!got.ok) {
      deps.log(`home: roborock login refused (${got.error})`);
      return w.send(json({ error: got.error, say: CONNECT_SAY[got.error] }, got.error === "vendor" ? 502 : 409));
    }
    await vault.write("roborock", got.login);
    await vault.forget("roborock-pending");
    deps.log("home: roborock connected");
    return w.send(json({ ok: true, connected: true }));
  }
  if (body.step === "disconnect") {
    await vault.forget("roborock");
    await vault.forget("roborock-pending");
    deps.log("home: roborock disconnected");
    return w.send(json({ ok: true, connected: false }));
  }
  return w.send(json({ error: "bad-request" }, 400));
}
