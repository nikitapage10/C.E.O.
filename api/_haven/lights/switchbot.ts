/**
 * SwitchBot's cloud API v1.1 (#931, https://github.com/OpenWonderLabs/SwitchBotAPI), for the Haven's lights. Azure
 * only: the token and secret are Key Vault references (`switchbot-token`, `switchbot-secret`), never anywhere else.
 *
 * Every call is signed: `sign` is the HMAC-SHA256 of token + t + nonce under the secret, in base64, with `t` the time
 * in milliseconds and `nonce` a fresh UUID. What this reads and does:
 *
 *   GET  /v1.1/devices                      the physical devices (`deviceList`) and the infrared remotes
 *                                           (`infraredRemoteList`) on the account
 *   GET  /v1.1/devices/{id}/status          a device's `power` ("on" or "off"), when it has one
 *   POST /v1.1/devices/{id}/commands        turnOn / turnOff (commandType "command"), for a device or an IR remote
 *   GET  /v1.1/scenes                       the manual scenes made in the app
 *   POST /v1.1/scenes/{id}/execute          runs one
 *
 * SwitchBot answers HTTP 200 with its own `statusCode` (100 is success); anything else is a VendorError with no
 * detail. The account allows 10,000 calls a day; the Lights service (./lights.ts) keeps a short cache over this.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac, randomUUID } from "node:crypto";
import { obj, str } from "../devices/types.js";
import { callJson, VendorError, type Fetch } from "../devices/http.js";

export const SWITCHBOT_BASE = "https://api.switch-bot.com/v1.1";

/** One thing on the SwitchBot account, as the API names it. `ir` is an infrared remote (no state to read). */
export interface SwitchBotThing {
  id: string;
  name: string;
  /** The API's own `deviceType` (a device) or `remoteType` (an IR remote), e.g. "Bot", "Plug Mini (US)", "Projector". */
  type: string;
  ir: boolean;
  /** For a device: whether its cloud service is on (a device with it off can't be read or run from here). */
  cloud: boolean;
}

export interface SwitchBotScene {
  id: string;
  name: string;
}

/** The headers one signed call takes. Exported for the test, which checks the signature against a known one. */
export function signedHeaders(token: string, secret: string, t: number = Date.now(), nonce: string = randomUUID()): Record<string, string> {
  const sign = createHmac("sha256", secret).update(`${token}${t}${nonce}`, "utf8").digest("base64");
  return { Authorization: token, sign, nonce, t: String(t), "Content-Type": "application/json; charset=utf8" };
}

/** Device types that are a hub or a sensor, never a light or a switch: left off the lights entirely. */
const NOT_SWITCHABLE = /\b(hub|meter|sensor|lock|keypad|camera|remote|button|curtain|blind)\b/i;

export class SwitchBot {
  constructor(
    private readonly fetchFn: Fetch,
    private readonly token: string,
    private readonly secret: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.token && this.secret);
  }

  private async call(path: string, body?: unknown): Promise<unknown> {
    const got = obj(
      await callJson(this.fetchFn, `${SWITCHBOT_BASE}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: signedHeaders(this.token, this.secret),
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
    if (got.statusCode !== 100) throw new VendorError(typeof got.statusCode === "number" ? got.statusCode : 0);
    return got.body;
  }

  /** Every device and IR remote on the account. */
  async things(): Promise<SwitchBotThing[]> {
    const body = obj(await this.call("/devices"));
    const out: SwitchBotThing[] = [];
    for (const d of Array.isArray(body.deviceList) ? body.deviceList : []) {
      const o = obj(d);
      const id = str(o.deviceId);
      if (id) out.push({ id, name: str(o.deviceName), type: str(o.deviceType), ir: false, cloud: o.enableCloudService !== false });
    }
    for (const d of Array.isArray(body.infraredRemoteList) ? body.infraredRemoteList : []) {
      const o = obj(d);
      const id = str(o.deviceId);
      if (id) out.push({ id, name: str(o.deviceName), type: str(o.remoteType), ir: true, cloud: true });
    }
    return out;
  }

  /** Whether a device can be switched from here: not a hub or a sensor, its cloud service on. */
  static switchable(t: SwitchBotThing): boolean {
    return !t.ir && t.cloud && !NOT_SWITCHABLE.test(t.type);
  }

  /** A device's power: true on, false off, null when it doesn't say. */
  async power(id: string): Promise<boolean | null> {
    const p = str(obj(await this.call(`/devices/${encodeURIComponent(id)}/status`)).power).toLowerCase();
    return p === "on" ? true : p === "off" ? false : null;
  }

  /** turnOn or turnOff, for a device or an IR remote. */
  async set(id: string, on: boolean): Promise<void> {
    await this.call(`/devices/${encodeURIComponent(id)}/commands`, { command: on ? "turnOn" : "turnOff", parameter: "default", commandType: "command" });
  }

  async scenes(): Promise<SwitchBotScene[]> {
    const body = await this.call("/scenes");
    return (Array.isArray(body) ? body : []).map(obj).map((s) => ({ id: str(s.sceneId), name: str(s.sceneName) })).filter((s) => s.id);
  }

  async runScene(id: string): Promise<void> {
    await this.call(`/scenes/${encodeURIComponent(id)}/execute`, {});
  }
}
