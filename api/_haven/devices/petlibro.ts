/**
 * The Petlibro feeders and fountain (#632, docs/HOME-DEVICES.md), ported from the community Home Assistant
 * integration jjjonesjr33/petlibro (custom_components/petlibro/api.py and its devices/). Nikita has three: a dry food
 * feeder, a wet food feeder (the Polar kind, a rotating tray of three bowls with a lid) and a water fountain. Their
 * exact models come from the account's own device list (`productName`).
 *
 *   POST /member/auth/login                       email and the login digest for a token (sealed, reused until it lapses)
 *   POST /device/device/list                      every device: deviceSn, productName, surplusGrain, online…
 *   POST /device/device/realInfo                  live state: online, food left, the fountain's water and filter
 *   POST /device/data/grainStatus                 today's feeds (dry feeders)
 *   POST /device/workRecord/list                  the last successful dispense (dry feeders)
 *   POST /device/wetFeedingPlan/wetListV3         the wet feeder's plan and whether a manual feed is open
 *   POST /device/device/manualFeeding             one portion from a dry feeder (grainNum 1)
 *   POST /device/wetFeedingPlan/manualFeedNow     opens the wet feeder's lid on the bowl in front (plate)
 *
 * Every request carries the app's own headers and, once signed in, `token`. Code 1009 means the token lapsed: sign in
 * again once. The email and the login digest come from the Key Vault only: Petlibro's app sends the MD5 hex of the
 * password, so the setup paste (docs/HOME-DEVICES.md) makes that digest in Cloud Shell and the vault keeps it. The
 * password itself never reaches Azure, and this code hashes nothing.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomUUID } from "node:crypto";
import { callJson, VendorError, type Fetch } from "./http.js";
import { isoOf, obj, pct, PLACES, str, type DeviceClient, type DeviceKind, type DeviceReading, type Found, type RunResult } from "./types.js";
import { deviceId, type HomeVault } from "./vault.js";

export const PETLIBRO_API = "https://api.us.petlibro.com";
const APP = { appId: 1, appSn: "c35772530d1041699c87fe62348507a8" };
const HEADERS = { source: "ANDROID", language: "EN", timezone: "America/Denver", version: "1.3.45", "Content-Type": "application/json" };

/** Which of Nikita's three a device is, from its product name ("Granary Smart Feeder", "Polar Wet Food Feeder", "Dockstream Smart Fountain"). */
export function petlibroKind(productName: string): DeviceKind | null {
  const p = productName.toLowerCase();
  if (p.includes("fountain")) return "fountain";
  if (p.includes("wet")) return "wet-feeder";
  if (p.includes("feeder")) return "dry-feeder";
  return null;
}

const FILTER_DAYS_DEFAULT = 30;

/** A Petlibro device's reading from its list entry and the extra reads for its kind. */
export function petlibroReading(id: string, kind: DeviceKind, item: unknown, real: unknown, extra: { grain?: unknown; work?: unknown; wet?: unknown }): DeviceReading {
  const d = obj(item);
  const r = obj(real);
  const online = (r.online ?? d.online) === true;
  const base: DeviceReading = { id, vendor: "petlibro", kind, model: str(d.productName).slice(0, 60) || "Petlibro", place: PLACES[kind], online, state: online ? "idle" : "offline", alerts: [] };
  if (kind === "fountain") {
    const water = pct(r.weightPercent);
    const left = Number(r.remainingReplacementDays);
    const cycle = Number(r.filterReplacementFrequency) || FILTER_DAYS_DEFAULT;
    const filter = Number.isFinite(left) ? pct((left / cycle) * 100) : null;
    if (water !== null && water <= 20) base.alerts.push("water low");
    if (filter !== null && filter <= 10) base.alerts.push("filter due");
    const cleaning = Number(r.remainingCleaningDays);
    if (Number.isFinite(cleaning) && cleaning <= 0) base.alerts.push("needs a clean");
    return { ...base, water, filter, state: online ? "running" : "offline" };
  }
  // surplusGrain false (or the bin sensor) means food is low.
  const surplus = r.surplusGrain ?? d.surplusGrain;
  const foodLow = surplus === false;
  if (foodLow) base.alerts.push("food low");
  if (r.barnDoorError === true) base.alerts.push("lid blocked");
  if (r.grainOutletState === false) base.alerts.push("dispenser blocked");
  if (kind === "dry-feeder") {
    let lastFed: string | null = null;
    for (const day of Array.isArray(extra.work) ? extra.work : []) {
      for (const rec of Array.isArray(obj(day).workRecords) ? (obj(day).workRecords as unknown[]) : []) {
        if (str(obj(rec).type) === "GRAIN_OUTPUT_SUCCESS") {
          lastFed = isoOf(obj(rec).recordTime);
          break;
        }
      }
      if (lastFed) break;
    }
    return { ...base, foodLow, lastFed };
  }
  // The wet feeder: a manual feed is open while the plan carries its id.
  const wet = obj(extra.wet);
  const open = wet.manualFeedId !== undefined && wet.manualFeedId !== null;
  return { ...base, foodLow, lastFed: null, state: online ? (open ? "lid open" : "closed") : "offline" };
}

export interface PetlibroDeps {
  fetch: Fetch;
  vault: HomeVault | null;
  idKey: Buffer | null;
  email: string;
  /** The MD5 hex Petlibro's login takes (PETLIBRO_LOGIN_DIGEST), made at setup. */
  loginDigest: string;
  now: () => number;
}

export interface PetlibroRef {
  serial: string;
  plate: number;
}

type Answer = { code?: unknown; data?: unknown };

/** The login digest's shape: 32 lowercase hex characters. */
export const LOGIN_DIGEST = /^[0-9a-f]{32}$/;

export class PetlibroClient implements DeviceClient<PetlibroRef> {
  readonly vendor = "petlibro" as const;
  readonly actions = ["feeder.feed", "wet.open"] as const;
  constructor(private readonly deps: PetlibroDeps) {}

  async connected(): Promise<boolean> {
    return Boolean(this.deps.email && LOGIN_DIGEST.test(this.deps.loginDigest) && this.deps.vault && this.deps.idKey);
  }

  private async login(): Promise<string> {
    const { fetch: f, email, loginDigest, vault } = this.deps;
    const a = (await callJson(f, `${PETLIBRO_API}/member/auth/login`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ ...APP, country: "US", email, password: loginDigest, phoneBrand: "", phoneSystemVersion: "", timezone: HEADERS.timezone, thirdId: null, type: null }),
    })) as Answer;
    const token = str(obj(a.data).token);
    if (a.code !== 0 || !token) throw new VendorError(401);
    await vault?.write("petlibro", { token });
    return token;
  }

  /** One API call with the stored token; a lapsed token (1009) signs in again once. */
  async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const { vault } = this.deps;
    if (!vault || !(await this.connected())) throw new VendorError(401);
    let token = str(obj(await vault.read("petlibro").catch(() => null)).token) || (await this.login());
    for (let attempt = 0; attempt < 2; attempt++) {
      const a = (await callJson(this.deps.fetch, `${PETLIBRO_API}${path}`, { method: "POST", headers: { ...HEADERS, token }, body: JSON.stringify(body) })) as Answer;
      if (Number(a.code) === 1009 && attempt === 0) {
        token = await this.login();
        continue;
      }
      if (a.code !== 0) throw new VendorError(502);
      return a.data ?? {};
    }
    throw new VendorError(401);
  }

  async status(): Promise<Found<PetlibroRef>[]> {
    const { idKey } = this.deps;
    if (!idKey || !(await this.connected())) return [];
    const list = await this.post("/device/device/list", {});
    const out: Found<PetlibroRef>[] = [];
    const now = this.deps.now();
    for (const item of Array.isArray(list) ? list : []) {
      const d = obj(item);
      const serial = str(d.deviceSn);
      const kind = petlibroKind(str(d.productName));
      if (!serial || !kind) continue;
      const bySn = { id: serial, deviceSn: serial };
      const read = (path: string, body: Record<string, unknown> = bySn) => this.post(path, body).catch(() => null);
      const real = await read("/device/device/realInfo");
      const extra: { grain?: unknown; work?: unknown; wet?: unknown } = {};
      if (kind === "dry-feeder") {
        extra.work = await read("/device/workRecord/list", { deviceSn: serial, startTime: now - 7 * 86_400_000, endTime: now, size: 10, type: ["GRAIN_OUTPUT_SUCCESS"] });
      } else if (kind === "wet-feeder") {
        extra.wet = await read("/device/wetFeedingPlan/wetListV3");
      }
      const plate = Number(obj(real).platePosition) || 1;
      out.push({ reading: petlibroReading(deviceId(idKey, "petlibro", serial), kind, item, real, extra), ref: { serial, plate } });
    }
    return out;
  }

  async run(action: string, found: Found<PetlibroRef>): Promise<RunResult> {
    try {
      if (action === "feeder.feed" && found.reading.kind === "dry-feeder") {
        await this.post("/device/device/manualFeeding", { deviceSn: found.ref.serial, grainNum: 1, requestId: randomUUID().replace(/-/g, "") });
        return { ok: true };
      }
      if (action === "wet.open" && found.reading.kind === "wet-feeder") {
        await this.post("/device/wetFeedingPlan/manualFeedNow", { deviceSn: found.ref.serial, plate: found.ref.plate });
        return { ok: true };
      }
      return { ok: false, code: "unsupported" };
    } catch (e) {
      return { ok: false, code: e instanceof VendorError && e.status === 401 ? "not-connected" : found.reading.online ? "vendor" : "offline" };
    }
  }
}
