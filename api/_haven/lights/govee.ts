/**
 * Govee's Developer API v2 (#931, https://developer.govee.com), for the Haven's lights. Azure only: the key is a Key
 * Vault reference (`govee-api-key`), sent as the `Govee-API-Key` header and never anywhere else.
 *
 *   GET  /router/api/v1/user/devices        the devices: sku, device (its id), deviceName, type, capabilities
 *   POST /router/api/v1/device/state        { requestId, payload: { sku, device } }: each capability's state, of which
 *                                           this reads `powerSwitch` (1 on, 0 off) and `online`
 *   POST /router/api/v1/device/control      { requestId, payload: { sku, device, capability } }: powerSwitch 1 or 0
 *
 * Govee answers with its own `code` (200 is success); anything else is a VendorError with no detail. Only devices that
 * list the on/off capability are lights here. The account allows 10,000 calls a day; ./lights.ts caches over this.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomUUID } from "node:crypto";
import { obj, str } from "../devices/types.js";
import { callJson, VendorError, type Fetch } from "../devices/http.js";

export const GOVEE_BASE = "https://openapi.api.govee.com/router/api/v1";
const ON_OFF = "devices.capabilities.on_off";

export interface GoveeLight {
  /** Govee's device id (a MAC-like string) and its model: both needed to read or run it. */
  id: string;
  sku: string;
  name: string;
  /** Govee's own type, e.g. "devices.types.light". */
  type: string;
}

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

  /** The devices that can be switched on and off. */
  async lights(): Promise<GoveeLight[]> {
    const data = (await this.call("/user/devices")).data;
    const out: GoveeLight[] = [];
    for (const d of Array.isArray(data) ? data : []) {
      const o = obj(d);
      const caps = Array.isArray(o.capabilities) ? o.capabilities.map(obj) : [];
      if (!caps.some((c) => c.type === ON_OFF)) continue;
      const id = str(o.device), sku = str(o.sku);
      if (id && sku) out.push({ id, sku, name: str(o.deviceName), type: str(o.type) });
    }
    return out;
  }

  /** On, off or unknown, and whether Govee says it is online. */
  async state(l: GoveeLight): Promise<{ on: boolean | null; online: boolean }> {
    const caps = obj((await this.call("/device/state", { sku: l.sku, device: l.id })).payload).capabilities;
    let on: boolean | null = null, online = true;
    for (const c of (Array.isArray(caps) ? caps : []).map(obj)) {
      const v = obj(c.state).value;
      if (c.instance === "powerSwitch") on = v === 1 ? true : v === 0 ? false : null;
      if (c.instance === "online") online = v !== false;
    }
    return { on, online };
  }

  async set(l: GoveeLight, on: boolean): Promise<void> {
    await this.call("/device/control", { sku: l.sku, device: l.id, capability: { type: ON_OFF, instance: "powerSwitch", value: on ? 1 : 0 } });
  }
}
