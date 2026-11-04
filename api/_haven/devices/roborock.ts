/**
 * The Roborock Qrevo (#632, docs/HOME-DEVICES.md), ported from python-roborock's documented protocol (the web API
 * under roborock/web_api/, the message format in roborock/protocol.py, the V1 RPC in roborock/protocols/v1_protocol.py).
 * Only what C.E.O. needs:
 *
 *   Login (Connect Roborock on the Desk, once):
 *     POST {iot}/api/v1/getUrlByEmail            which region the account is on
 *     POST {iot}/api/v4/email/code/send          Roborock emails Nikita a code (v1 sendEmailCode as a fallback)
 *     POST {iot}/api/v3/key/sign                 signs a random string for the login headers
 *     POST {iot}/api/v4/auth/email/login/code    the code for the account's token and rriot credentials
 *   Home data (cached in the sealed login for six hours):
 *     GET  {iot}/api/v1/getHomeDetail            the home's id
 *     GET  {rriot.r.a}/v3/user/homes/{id}        devices (duid, local key), products, the app's room names (Hawk-signed)
 *   Commands, over the cloud MQTT broker (rriot.r.m), one short session each:
 *     get_status, get_room_mapping, app_start, app_pause, app_charge, app_segment_clean
 *
 * A V1 message is "1.0", seq, random, timestamp, protocol (101 request, 102 response) and the payload, AES-128-ECB
 * under md5(scrambled timestamp + the device's local key + a fixed salt), closed with a CRC32. The local key, the rriot
 * secrets and the token stay in the sealed blob; nothing here logs or returns them.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import { callJson, VendorError, withQuery, type Fetch } from "./http.js";
import { MqttError, requestOnce } from "./mqtt.js";
import { matchRooms, namedRooms, segmentPairs, type MapRoom } from "./rooms.js";
import { obj, PLACES, str, type DeviceClient, type DeviceReading, type Found, type RunResult } from "./types.js";
import { deviceId, type HomeVault } from "./vault.js";

export const BASE_URLS = ["https://usiot.roborock.com", "https://euiot.roborock.com", "https://cniot.roborock.com", "https://ruiot.roborock.com"];
const SALT = "TXdfu$jyZ#TZHsg4";
const AGREEMENT_FALLBACK = { majorVersion: 14, minorVersion: 0 };
/** How long the home data (device list, room names, room mapping) is kept before it is read again. */
export const HOME_TTL_MS = 6 * 60 * 60_000;
/** How long a Connect Roborock may wait for its code. */
export const PENDING_MS = 10 * 60_000;

const md5hex = (s: string | Buffer) => createHash("md5").update(s).digest("hex");
const md5 = (s: string | Buffer) => createHash("md5").update(s).digest();

/* ── The sealed login ── */

export interface Rriot {
  u: string;
  s: string;
  h: string;
  k: string;
  r: { a: string; m: string };
}

export interface RoborockHome {
  /** Date.now() it was read. */
  at: number;
  devices: { duid: string; name: string; localKey: string; productId: string; pv: string; online: boolean }[];
  products: { id: string; name: string; model: string }[];
  /** The app's room names by room id. */
  names: Record<string, string>;
  /** Each vacuum's map rooms, by duid, once read. */
  maps: Record<string, MapRoom[]>;
}

export interface RoborockLogin {
  email: string;
  baseUrl: string;
  clientId: string;
  token: string;
  rriot: Rriot;
  home?: RoborockHome;
}

export interface RoborockPending {
  email: string;
  baseUrl: string;
  country: string | null;
  countryCode: string | null;
  clientId: string;
  until: number;
}

/** The header_clientid the IoT API wants: base64(md5(email + a per-connection identifier)). */
export const clientIdOf = (email: string, seed: string) => md5(email + seed).toString("base64");

function rriotOf(v: unknown): Rriot | null {
  const o = obj(v);
  const r = obj(o.r);
  const out = { u: str(o.u), s: str(o.s), h: str(o.h), k: str(o.k), r: { a: str(r.a), m: str(r.m) } };
  return out.u && out.s && out.h && out.k && out.r.a.startsWith("https://") && /^(ssl|tcp):\/\//.test(out.r.m) ? out : null;
}

/* ── Login (Connect Roborock) ── */

export type ConnectError = "no-account" | "too-many" | "bad-code" | "agreement" | "vendor";

const ERR_OF: Record<number, ConnectError> = { 2008: "no-account", 3039: "no-account", 9002: "too-many", 2018: "bad-code", 3009: "agreement", 3006: "agreement" };
const fail = (code: unknown): ConnectError => ERR_OF[Number(code)] ?? "vendor";

type IotAnswer = { code?: unknown; data?: unknown };

/** Step one: find the account's region and have Roborock email a code. */
export async function sendCode(fetchFn: Fetch, email: string, now: number): Promise<{ ok: true; pending: RoborockPending } | { ok: false; error: ConnectError }> {
  const seed = randomBytes(16).toString("base64url");
  const clientId = clientIdOf(email, seed);
  for (let i = 0; i < BASE_URLS.length; i++) {
    const base = BASE_URLS[i]!;
    let found: IotAnswer;
    try {
      found = (await callJson(fetchFn, withQuery(`${base}/api/v1/getUrlByEmail`, { email, needtwostepauth: "false" }), { method: "POST" })) as IotAnswer;
    } catch {
      continue;
    }
    if (found.code !== 200) {
      if (Number(found.code) === 2003 || Number(found.code) === 1001) return { ok: false, error: "no-account" };
      continue;
    }
    const d = obj(found.data);
    const baseUrl = str(d.url);
    if (!baseUrl.startsWith("https://")) continue;
    const country = str(d.country) || null;
    const countryCode = str(d.countrycode) || null;
    const headers = { header_clientid: clientId, header_clientlang: "en" };
    let sent: IotAnswer;
    try {
      sent =
        country && countryCode
          ? ((await callJson(fetchFn, `${baseUrl}/api/v4/email/code/send`, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email, type: "login", platform: "" }).toString() })) as IotAnswer)
          : ((await callJson(fetchFn, withQuery(`${baseUrl}/api/v1/sendEmailCode`, { username: email, type: "auth" }), { method: "POST", headers })) as IotAnswer);
    } catch {
      return { ok: false, error: "vendor" };
    }
    // 3030: this account answers on another region's server; try the next.
    if (Number(sent.code) === 3030) continue;
    if (sent.code !== 200) return { ok: false, error: fail(sent.code) };
    return { ok: true, pending: { email, baseUrl, country, countryCode, clientId, until: now + PENDING_MS } };
  }
  return { ok: false, error: "no-account" };
}

/** Step two: the emailed code for the account's token and rriot credentials. */
export async function loginWithCode(fetchFn: Fetch, pending: RoborockPending, code: string): Promise<{ ok: true; login: RoborockLogin } | { ok: false; error: ConnectError }> {
  const { baseUrl, email, clientId } = pending;
  let answer: IotAnswer;
  try {
    if (pending.country && pending.countryCode) {
      const ks = randomBytes(12).toString("base64url").replace(/[^A-Za-z0-9]/g, "").padEnd(16, "x").slice(0, 16);
      const signed = obj(((await callJson(fetchFn, withQuery(`${baseUrl}/api/v3/key/sign`, { s: ks }), { method: "POST", headers: { header_clientid: clientId } })) as IotAnswer).data);
      const k = str(signed.k);
      if (!k) return { ok: false, error: "vendor" };
      let agreement = AGREEMENT_FALLBACK;
      try {
        const latest = (await callJson(fetchFn, withQuery(`${baseUrl}/api/v3/app/agreement/latest`, { country: pending.country }), { headers: { header_clientlang: "en" } })) as IotAnswer;
        const a = obj(latest.data);
        if (latest.code === 200 && Number.isInteger(a.majorVersion) && Number.isInteger(a.minorVersion)) agreement = { majorVersion: a.majorVersion as number, minorVersion: a.minorVersion as number };
      } catch {
        /* the fallback version */
      }
      answer = (await callJson(fetchFn, `${baseUrl}/api/v4/auth/email/login/code`, {
        method: "POST",
        headers: {
          header_clientid: clientId,
          "x-mercy-ks": ks,
          "x-mercy-k": k,
          "Content-Type": "application/x-www-form-urlencoded",
          header_clientlang: "en",
          header_appversion: "4.54.02",
          header_phonesystem: "iOS",
          header_phonemodel: "iPhone16,1",
        },
        body: new URLSearchParams({ country: pending.country, countryCode: pending.countryCode, email, code, majorVersion: String(agreement.majorVersion), minorVersion: String(agreement.minorVersion) }).toString(),
      })) as IotAnswer;
    } else {
      answer = (await callJson(fetchFn, withQuery(`${baseUrl}/api/v1/loginWithCode`, { username: email, verifycode: code, verifycodetype: "AUTH_EMAIL_CODE" }), { method: "POST", headers: { header_clientid: clientId } })) as IotAnswer;
    }
  } catch {
    return { ok: false, error: "vendor" };
  }
  if (answer.code !== 200) return { ok: false, error: fail(answer.code) };
  const d = obj(answer.data);
  const rriot = rriotOf(d.rriot);
  const token = str(d.token);
  if (!rriot || !token) return { ok: false, error: "vendor" };
  return { ok: true, login: { email, baseUrl, clientId, token, rriot } };
}

/* ── Hawk signing for the RRIoT API ── */

export function hawk(rriot: Rriot, path: string, ts: number, nonce: string): string {
  const pre = [rriot.u, rriot.s, nonce, String(ts), md5hex(path), "", ""].join(":");
  const mac = createHmac("sha256", rriot.h).update(pre).digest("base64");
  return `Hawk id="${rriot.u}",s="${rriot.s}",ts="${ts}",nonce="${nonce}",mac="${mac}"`;
}

/** The account's home: its devices, their products and the app's room names. */
export async function readHome(fetchFn: Fetch, login: RoborockLogin, now: number): Promise<RoborockHome> {
  const detail = (await callJson(fetchFn, `${login.baseUrl}/api/v1/getHomeDetail`, { headers: { header_clientid: login.clientId, Authorization: login.token } })) as IotAnswer;
  if (detail.code !== 200) throw new VendorError(Number(detail.code) === 2010 ? 401 : 502);
  const homeId = str(obj(detail.data).rrHomeId);
  if (!/^\d+$/.test(homeId)) throw new VendorError(502);
  const path = `/v3/user/homes/${homeId}`;
  const res = obj(await callJson(fetchFn, `${login.rriot.r.a}${path}`, { headers: { Authorization: hawk(login.rriot, path, Math.floor(now / 1000), randomBytes(6).toString("base64url")) } }));
  if (res.success !== true) throw new VendorError(502);
  const result = obj(res.result);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
  const names: Record<string, string> = {};
  for (const r of list(result.rooms)) if (str(r.id)) names[str(r.id)] = str(r.name).slice(0, 40);
  return {
    at: now,
    devices: [...list(result.devices), ...list(result.receivedDevices)]
      .map((d) => ({ duid: str(d.duid), name: str(d.name).slice(0, 40), localKey: str(d.localKey), productId: str(d.productId), pv: str(d.pv) || "1.0", online: d.online !== false }))
      .filter((d) => d.duid && d.localKey.length === 16),
    products: list(result.products).map((p) => ({ id: str(p.id), name: str(p.name).slice(0, 60), model: str(p.model) })),
    names,
    maps: login.home?.maps ?? {},
  };
}

/* ── The V1 message ── */

/** python-roborock's Utils.encode_timestamp: the hex timestamp's digits in a fixed order. */
export function scrambledTs(ts: number): string {
  const hex = ts.toString(16).padStart(8, "0");
  return [5, 6, 3, 7, 1, 2, 0, 4].map((i) => hex[i]).join("");
}

const msgKey = (ts: number, localKey: string) => md5(scrambledTs(ts) + localKey + SALT);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface V1Message {
  seq: number;
  random: number;
  timestamp: number;
  protocol: number;
  payload: Buffer;
}

export function encodeMessage(m: V1Message, localKey: string): Buffer {
  const cipher = createCipheriv("aes-128-ecb", msgKey(m.timestamp, localKey), null);
  const enc = Buffer.concat([cipher.update(m.payload), cipher.final()]);
  const head = Buffer.alloc(3 + 4 + 4 + 4 + 2 + 2);
  head.write("1.0", 0, "latin1");
  head.writeUInt32BE(m.seq >>> 0, 3);
  head.writeUInt32BE(m.random >>> 0, 7);
  head.writeUInt32BE(m.timestamp >>> 0, 11);
  head.writeUInt16BE(m.protocol, 15);
  head.writeUInt16BE(enc.length, 17);
  const body = Buffer.concat([head, enc]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([body, crc]);
}

/** A V1 message from the broker, or null when it isn't one (wrong version, bad checksum, wrong key). */
export function decodeMessage(buf: Buffer, localKey: string): V1Message | null {
  if (buf.length < 19 || buf.subarray(0, 3).toString("latin1") !== "1.0") return null;
  const len = buf.readUInt16BE(17);
  if (buf.length < 19 + len) return null;
  const body = buf.subarray(0, 19 + len);
  if (len > 0) {
    if (buf.length < 23 + len || buf.readUInt32BE(19 + len) !== crc32(body)) return null;
  }
  const timestamp = buf.readUInt32BE(11);
  let payload = Buffer.alloc(0);
  if (len > 0) {
    try {
      const d = createDecipheriv("aes-128-ecb", msgKey(timestamp, localKey), null);
      payload = Buffer.concat([d.update(buf.subarray(19, 19 + len)), d.final()]);
    } catch {
      return null;
    }
  }
  return { seq: buf.readUInt32BE(3), random: buf.readUInt32BE(7), timestamp, protocol: buf.readUInt16BE(15), payload };
}

/** The payload of an RPC request (protocol 101). */
export function requestPayload(id: number, method: string, params: unknown, ts: number): Buffer {
  const inner = JSON.stringify({ id, method, params: params ?? [] });
  return Buffer.from(JSON.stringify({ dps: { "101": inner }, t: ts }));
}

/** The result of the RPC response to request `id`; undefined when the message answers something else. Throws on an error answer. */
export function responseResult(m: V1Message, id: number): unknown {
  if (m.protocol !== 102) return undefined;
  const dps = obj(obj(JSON.parse(m.payload.toString("utf8"))).dps);
  const raw = dps["102"];
  if (typeof raw !== "string") return undefined;
  const r = obj(JSON.parse(raw));
  if (r.id !== id) return undefined;
  if (r.error !== undefined) throw new VendorError(409);
  if (r.result === "unknown_method") throw new VendorError(501);
  return r.result ?? [];
}

/** The MQTT username and password python-roborock derives from the rriot credentials. */
export function mqttParams(rriot: Rriot): { host: string; port: number; username: string; password: string } {
  const url = new URL(rriot.r.m.replace(/^ssl:/, "https:").replace(/^tcp:/, "http:"));
  return { host: url.hostname, port: Number(url.port) || 8883, username: md5hex(`${rriot.u}:${rriot.k}`).slice(2, 10), password: md5hex(`${rriot.s}:${rriot.k}`).slice(16) };
}

/* ── Status ── */

const STATE: Record<number, string> = {
  1: "starting",
  2: "idle",
  3: "idle",
  5: "cleaning",
  6: "returning",
  7: "cleaning",
  8: "docked",
  9: "error",
  10: "paused",
  11: "cleaning",
  12: "error",
  14: "updating",
  15: "returning",
  16: "cleaning",
  17: "cleaning",
  18: "cleaning",
  22: "emptying the bin",
  23: "washing the mop",
  25: "washing the mop",
  26: "returning",
  29: "mapping",
  100: "docked",
  101: "offline",
};
/** Dock and robot error codes that are about the tanks and the bin (python-roborock's code mappings). */
const ALERTS: Record<number, string> = {
  9: "bin missing",
  32: "dock bin or filter missing",
  33: "dock bin out of place",
  34: "dock bin or duct blocked",
  35: "dock can't empty the bin",
  38: "clean water tank empty",
  39: "dirty water tank full",
  41: "clean water tank empty",
  46: "bin missing",
  53: "dock cleaning tank full or blocked",
};

/** A vacuum's reading from its `get_status` result. */
export function vacuumReading(id: string, model: string, status: unknown, rooms: MapRoom[], online: boolean): DeviceReading {
  const s = obj(Array.isArray(status) ? status[0] : status);
  const code = Number(s.state);
  const err = Number(s.error_code ?? 0);
  const dock = Number(s.dock_error_status ?? 0);
  const alerts = new Set<string>();
  if (ALERTS[err]) alerts.add(ALERTS[err]!);
  if (ALERTS[dock]) alerts.add(ALERTS[dock]!);
  if (Number(s.water_shortage_status) === 1) alerts.add("clean water tank low");
  if (err && !ALERTS[err]) alerts.add("needs a look");
  const battery = Number(s.battery);
  return {
    id,
    vendor: "roborock",
    kind: "vacuum",
    model,
    place: PLACES.vacuum,
    online,
    state: online ? (STATE[code] ?? "idle") : "offline",
    battery: Number.isFinite(battery) ? Math.max(0, Math.min(100, battery)) : null,
    alerts: [...alerts],
    rooms: rooms.map((r) => r.name),
  };
}

/* ── The client ── */

export interface RoborockDeps {
  fetch: Fetch;
  vault: HomeVault | null;
  idKey: Buffer | null;
  now: () => number;
  /** Opens the broker socket; tests pass a fake broker. */
  open?: (host: string, port: number) => Duplex;
}

export interface RoborockRef {
  duid: string;
  localKey: string;
  rooms: MapRoom[];
}

let nextId = 10_000 + Math.floor(Math.random() * 20_000);

export class RoborockClient implements DeviceClient<RoborockRef> {
  readonly vendor = "roborock" as const;
  readonly actions = ["vacuum.start", "vacuum.pause", "vacuum.dock", "vacuum.rooms"] as const;
  constructor(private readonly deps: RoborockDeps) {}

  async connected(): Promise<boolean> {
    return Boolean(this.deps.vault && this.deps.idKey && (await this.deps.vault.read<RoborockLogin>("roborock").catch(() => null)));
  }

  /** One RPC to one device over a short MQTT session. */
  async rpc(login: RoborockLogin, duid: string, localKey: string, method: string, params: unknown = []): Promise<unknown> {
    const p = mqttParams(login.rriot);
    const id = (nextId = nextId >= 32_000 ? 10_000 : nextId + 1);
    const ts = Math.floor(this.deps.now() / 1000);
    const msg = encodeMessage({ seq: 100_000 + (id % 899_999), random: 10_000 + (id % 89_999), timestamp: ts, protocol: 101, payload: requestPayload(id, method, params, ts) }, localKey);
    try {
      return await requestOnce(
        { host: p.host, port: p.port, username: p.username, password: p.password, clientId: randomBytes(8).toString("hex"), open: this.deps.open, timeoutMs: 12_000 },
        `rr/m/i/${login.rriot.u}/${p.username}/${duid}`,
        `rr/m/o/${login.rriot.u}/${p.username}/${duid}`,
        msg,
        (buf) => {
          const m = decodeMessage(buf, localKey);
          return m ? responseResult(m, id) : undefined;
        },
      );
    } catch (e) {
      if (e instanceof VendorError) throw e;
      throw new VendorError(e instanceof MqttError && e.code === "unauthorized" ? 401 : 0);
    }
  }

  private async login(): Promise<RoborockLogin | null> {
    const { vault } = this.deps;
    if (!vault) return null;
    const login = await vault.read<RoborockLogin>("roborock");
    if (!login) return null;
    const now = this.deps.now();
    if (!login.home || now - login.home.at > HOME_TTL_MS) {
      login.home = await readHome(this.deps.fetch, login, now);
      await vault.write("roborock", login);
    }
    return login;
  }

  async status(): Promise<Found<RoborockRef>[]> {
    const { idKey, vault } = this.deps;
    const login = await this.login();
    if (!login?.home || !idKey || !vault) return [];
    const home = login.home;
    const out: Found<RoborockRef>[] = [];
    let changed = false;
    for (const d of home.devices) {
      const product = home.products.find((p) => p.id === d.productId);
      if (!product?.model.startsWith("roborock.vacuum.") || d.pv !== "1.0") continue;
      const id = deviceId(idKey, "roborock", d.duid);
      let status: unknown = null;
      let online = d.online;
      try {
        status = await this.rpc(login, d.duid, d.localKey, "get_status");
      } catch {
        online = false;
      }
      let rooms = home.maps[d.duid];
      if (online && !rooms) {
        try {
          rooms = namedRooms(segmentPairs(await this.rpc(login, d.duid, d.localKey, "get_room_mapping")), home.names);
          home.maps[d.duid] = rooms;
          changed = true;
        } catch {
          rooms = [];
        }
      }
      out.push({ reading: vacuumReading(id, product.name || "Roborock vacuum", status, rooms ?? [], online), ref: { duid: d.duid, localKey: d.localKey, rooms: rooms ?? [] } });
    }
    if (changed) await vault.write("roborock", login).catch(() => undefined);
    return out;
  }

  async run(action: string, found: Found<RoborockRef>, args: { rooms?: string[] }): Promise<RunResult> {
    const login = await this.login();
    if (!login) return { ok: false, code: "not-connected" };
    const { duid, localKey } = found.ref;
    const send = async (method: string, params: unknown = []) => {
      await this.rpc(login, duid, localKey, method, params);
    };
    try {
      if (action === "vacuum.start") await send("app_start");
      else if (action === "vacuum.pause") await send("app_pause");
      else if (action === "vacuum.dock") await send("app_charge");
      else if (action === "vacuum.rooms") {
        // The map may have changed since it was read: read it again when a name isn't found.
        let match = matchRooms(args.rooms ?? [], found.ref.rooms);
        if (match.unknown.length || !match.rooms.length) {
          const fresh = namedRooms(segmentPairs(await this.rpc(login, duid, localKey, "get_room_mapping")), login.home?.names ?? {});
          if (login.home) {
            login.home.maps[duid] = fresh;
            await this.deps.vault?.write("roborock", login).catch(() => undefined);
          }
          match = matchRooms(args.rooms ?? [], fresh);
        }
        if (match.unknown.length || !match.rooms.length) return { ok: false, code: "unknown-room" };
        await send("app_segment_clean", [{ segments: match.rooms.map((r) => r.segment), repeat: 1 }]);
        return { ok: true, say: `The vacuum is off to clean the ${joinRooms(match.rooms.map((r) => r.name))}.` };
      } else return { ok: false, code: "unsupported" };
    } catch {
      return { ok: false, code: found.reading.online ? "vendor" : "offline" };
    }
    return { ok: true };
  }
}

/** "kitchen", "kitchen and hall", "kitchen, hall and dining", in lower case for a spoken line. */
export function joinRooms(names: string[]): string {
  const n = names.map((s) => s.toLowerCase());
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}
