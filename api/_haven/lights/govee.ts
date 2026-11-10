/**
 * Govee's Developer API v2 (#931, https://developer.govee.com), for the Haven's lights. Azure only: the key is a Key
 * Vault reference (`govee-api-key`), sent as the `Govee-API-Key` header and never anywhere else.
 *
 *   GET  /router/api/v1/user/devices        the devices: sku, device (its id), deviceName, type, capabilities
 *   POST /router/api/v1/device/state        { requestId, payload: { sku, device } }: each capability's state, of which
 *                                           this reads `powerSwitch` (1 on, 0 off), `online`, `brightness` (1 to
 *                                           100), `colorRgb` (0xRRGGBB as one number) and `colorTemperatureK`
 *   POST /router/api/v1/device/scenes       { requestId, payload: { sku, device } }: the light's own scenes ("moods",
 *                                           #974), each a name and the value that runs it
 *   POST /router/api/v1/device/control      { requestId, payload: { sku, device, capability } }: powerSwitch 1 or 0,
 *                                           brightness, colorRgb, colorTemperatureK or lightScene (#974)
 *
 * Govee answers with its own `code` (200 is success); anything else is a VendorError with no detail. Only devices that
 * list the on/off capability are lights here. A group made in the Govee app (sku "BaseGroup", "SameModeGroup") comes in
 * the same list; it is marked `group`, so the Desk lists it with the scenes, never as a light to place (#974). The
 * account allows 10,000 calls a day; ./lights.ts caches over this.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomUUID } from "node:crypto";
import { obj, str } from "../devices/types.js";
import { callJson, VendorError, type Fetch } from "../devices/http.js";

export const GOVEE_BASE = "https://openapi.api.govee.com/router/api/v1";
const ON_OFF = "devices.capabilities.on_off";
const RANGE = "devices.capabilities.range";
const COLOR = "devices.capabilities.color_setting";
const SCENE = "devices.capabilities.dynamic_scene";

/** What a light can do beyond on and off, from its capabilities (#974). */
export interface GoveeCaps {
  color: boolean;
  brightness: boolean;
  /** The white range in kelvin, when it has one. */
  kelvin: [number, number] | null;
  /** It has the app's scenes (lightScene). */
  scenes: boolean;
}

export interface GoveeLight {
  /** Govee's device id (a MAC-like string) and its model: both needed to read or run it. */
  id: string;
  sku: string;
  name: string;
  /** Govee's own type, e.g. "devices.types.light". */
  type: string;
  caps: GoveeCaps;
  /** A group made in the app, not one light (#974). */
  group: boolean;
}

export interface GoveeState {
  on: boolean | null;
  online: boolean;
  brightness: number | null;
  /** 0xRRGGBB, or null when it isn't in colour (or doesn't say). */
  rgb: number | null;
  kelvin: number | null;
}

/** A Govee mood: its name as the app gives it, and the value Govee runs it by (kept server side). */
export interface GoveeScene {
  name: string;
  value: unknown;
}

/** A Govee group, by its model or type, or by the names the app gives its groups (#974: "Mood", "Same-Model"). */
export function goveeGroup(sku: string, type: string, name: string): boolean {
  return /group/i.test(sku) || /group/i.test(type) || /^(mood|same[\s-]?mod(el|e))\b/i.test(name.trim());
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export class Govee {
  constructor(
    private readonly fetchFn: Fetch,
    private readonly key: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.key);
  }

  private async call(path: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const got = obj(
      await callJson(this.fetchFn, `${GOVEE_BASE}${path}`, {
        method: payload ? "POST" : "GET",
        headers: { "Govee-API-Key": this.key, "Content-Type": "application/json" },
        ...(payload && { body: JSON.stringify({ requestId: randomUUID(), payload }) }),
      }),
    );
    if (got.code !== 200) throw new VendorError(typeof got.code === "number" ? got.code : 0);
    return got;
  }

  /** The devices that can be switched on and off (groups among them, marked). */
  async lights(): Promise<GoveeLight[]> {
    const data = (await this.call("/user/devices")).data;
    const out: GoveeLight[] = [];
    for (const d of Array.isArray(data) ? data : []) {
      const o = obj(d);
      const caps = Array.isArray(o.capabilities) ? o.capabilities.map(obj) : [];
      if (!caps.some((c) => c.type === ON_OFF)) continue;
      const id = str(o.device), sku = str(o.sku);
      if (!id || !sku) continue;
      const has = (type: string, instance: string) => caps.find((c) => c.type === type && c.instance === instance);
      const k = obj(obj(has(COLOR, "colorTemperatureK")?.parameters).range);
      const kmin = num(k.min), kmax = num(k.max);
      const name = str(o.deviceName), type = str(o.type);
      out.push({
        id,
        sku,
        name,
        type,
        caps: { color: !!has(COLOR, "colorRgb"), brightness: !!has(RANGE, "brightness"), kelvin: has(COLOR, "colorTemperatureK") ? [kmin ?? 2000, kmax ?? 9000] : null, scenes: !!has(SCENE, "lightScene") },
        group: goveeGroup(sku, type, name),
      });
    }
    return out;
  }

  /** On, off or unknown, whether Govee says it is online, and its brightness and colour when it says. */
  async state(l: GoveeLight): Promise<GoveeState> {
    const caps = obj((await this.call("/device/state", { sku: l.sku, device: l.id })).payload).capabilities;
    const s: GoveeState = { on: null, online: true, brightness: null, rgb: null, kelvin: null };
    for (const c of (Array.isArray(caps) ? caps : []).map(obj)) {
      const v = obj(c.state).value;
      if (c.instance === "powerSwitch") s.on = v === 1 ? true : v === 0 ? false : null;
      else if (c.instance === "online") s.online = v !== false;
      else if (c.instance === "brightness") s.brightness = num(v);
      else if (c.instance === "colorRgb") s.rgb = num(v) !== null && v !== 0 ? Math.max(0, Math.min(0xffffff, Math.round(v as number))) : null;
      else if (c.instance === "colorTemperatureK") s.kelvin = num(v) || null;
    }
    return s;
  }

  /** The light's own scenes (its moods), as the app names them. */
  async scenes(l: GoveeLight): Promise<GoveeScene[]> {
    const caps = obj((await this.call("/device/scenes", { sku: l.sku, device: l.id })).payload).capabilities;
    const out: GoveeScene[] = [];
    for (const c of (Array.isArray(caps) ? caps : []).map(obj)) {
      if (c.instance !== "lightScene") continue;
      const opts = obj(c.parameters).options;
      for (const x of (Array.isArray(opts) ? opts : []).map(obj)) {
        const name = str(x.name).replace(/[<>&"'`\\{}]/g, "").trim().slice(0, 40);
        if (name && x.value !== undefined && !out.some((s) => s.name === name)) out.push({ name, value: x.value });
      }
    }
    return out.slice(0, 40);
  }

  private control(l: GoveeLight, type: string, instance: string, value: unknown): Promise<unknown> {
    return this.call("/device/control", { sku: l.sku, device: l.id, capability: { type, instance, value } });
  }

  async set(l: GoveeLight, on: boolean): Promise<void> {
    await this.control(l, ON_OFF, "powerSwitch", on ? 1 : 0);
  }

  /** A colour, 0xRRGGBB. */
  async color(l: GoveeLight, rgb: number): Promise<void> {
    await this.control(l, COLOR, "colorRgb", rgb);
  }

  /** A white, in kelvin. */
  async kelvin(l: GoveeLight, k: number): Promise<void> {
    await this.control(l, COLOR, "colorTemperatureK", k);
  }

  /** Brightness, 1 to 100. */
  async brightness(l: GoveeLight, pct: number): Promise<void> {
    await this.control(l, RANGE, "brightness", pct);
  }

  /** One of the light's scenes, by the value its list gave. */
  async scene(l: GoveeLight, value: unknown): Promise<void> {
    await this.control(l, SCENE, "lightScene", value);
  }
}
