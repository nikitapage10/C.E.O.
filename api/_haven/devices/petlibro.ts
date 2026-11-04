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
 *   POST /device/device/manualFeeding             portions from a dry feeder (grainNum: how many, already capped)
 *   POST /device/wetFeedingPlan/manualFeedNow     opens the wet feeder's lid on the bowl in front (plate)
 *   POST /device/wetFeedingPlan/platePositionChange   turns the wet tray one bowl counter-clockwise (#637 scope; the
 *                                                 `plate` it carries is ignored by the device). To reach a bowl it is
 *                                                 called (target - realInfo.platePosition) mod 3 times, 2 s apart, as
 *                                                 the integration's set_plate_position does.
 *   POST /device/wetFeedingPlan/stopFeedNow       closes the lid of a manual opening ({ deviceSn, feedId: manualFeedId })
 *
 * The wet plan (wetListV3's `plan`: each meal's `plate` and `executionStartTime`) is read into the reading as `meals`,
 * so the rails can tell when a manual turn or opening may throw off the next scheduled meal (rails.ts, the wet tray).
 *
 * Every request carries the app's own headers and, once signed in, `token`. Code 1009 means the token lapsed or
 * another sign-in took the account's one session (the phone app, or another instance): see `post`. Each sign-in
 * cancels every token before it, so only one Function App instance signs in at a time, behind a short lease in the
 * private store (`SIGNIN_LEASE_MS`), and the others wait for the token it stores (#683). A refused sign-in
 * (1101 no such account, or any other code) says why in fixed words (`problem`, #672) and holds off for 15 minutes.
 * The email and the login digest come from the Key Vault only: Petlibro's app sends the MD5 hex of the password, so
 * the setup paste (docs/HOME-DEVICES.md) makes that digest in Cloud Shell and the vault keeps it. The password itself
 * never reaches Azure, and this code hashes nothing.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomUUID } from "node:crypto";
import { callJson, VendorError, type Fetch } from "./http.js";
import { isoOf, obj, pct, PLACES, str, type DeviceClient, type DeviceKind, type DeviceReading, type Found, type RunArgs, type RunResult, type VendorProblem, type WetMeal } from "./types.js";
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
  /** Waits between two turns of the wet tray (tests pass one that doesn't wait). */
  pause?: (ms: number) => Promise<void>;
}

/** The gap between two turns of the wet tray, so the device finishes the first. */
export const ROTATE_GAP_MS = 2_000;

export interface PetlibroRef {
  serial: string;
  plate: number;
  /** The wet feeder's open manual feed, which stopFeedNow closes. */
  feedId?: number | string;
}

/** A plan time as "HH:MM" in Denver: "18:00", "6:00", or epoch seconds or milliseconds. Null when it isn't one. */
export function planTime(v: unknown): string | null {
  if (typeof v === "string") {
    const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${m[1]!.padStart(2, "0")}:${m[2]}`;
    if (!/^\d{9,13}$/.test(v.trim())) return null;
    v = Number(v);
  }
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const ms = v < 1e12 ? v * 1000 : v;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Denver", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

/** The wet plan's meals, by time, from wetListV3 (`plan`, each with `plate` and `executionStartTime`). Pure. */
export function wetMeals(wet: unknown): WetMeal[] {
  const plan = obj(wet).plan;
  const out: WetMeal[] = [];
  for (const p of Array.isArray(plan) ? plan.slice(0, 12) : []) {
    const o = obj(p);
    if (o.enable === false) continue;
    const time = planTime(o.executionStartTime);
    if (!time) continue;
    const plate = Number(o.plate);
    out.push({ time, ...(Number.isInteger(plate) && plate >= 1 && plate <= 3 && { plate }) });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

type Answer = { code?: unknown; data?: unknown };

/** The login digest's shape: 32 lowercase hex characters. */
export const LOGIN_DIGEST = /^[0-9a-f]{32}$/;

/** Petlibro's answer codes that matter here (probed against api.us.petlibro.com, and the community integration). */
export const PETLIBRO_CODE = { ok: 0, notLoggedIn: 1009, noMember: 1101, illegalPassword: 1102 } as const;

/** How long a refused sign-in holds off the next one (#672), so a wrong digest never hammers Petlibro's login. */
export const LOGIN_HOLD_MS = 15 * 60_000;

/** How long one instance's sign-in holds the others off (#683): they wait for its token instead of signing in too. */
export const SIGNIN_LEASE_MS = 20_000;
/** How an instance that finds the lease taken waits for the new token: a look every half second, 8 seconds at most. */
export const SIGNIN_WAIT_MS = 500;
export const SIGNIN_WAIT_STEPS = 16;

export class PetlibroClient implements DeviceClient<PetlibroRef> {
  readonly vendor = "petlibro" as const;
  readonly actions = ["feeder.feed", "wet.open", "wet.rotate", "wet.close", "wet.status"] as const;
  private why: VendorProblem | null = null;
  private holdUntil = 0;
  private signingIn: Promise<string> | null = null;
  private reading: Promise<Found<PetlibroRef>[]> | null = null;
  constructor(private readonly deps: PetlibroDeps) {}

  async connected(): Promise<boolean> {
    return Boolean(this.deps.email && LOGIN_DIGEST.test(this.deps.loginDigest) && this.deps.vault && this.deps.idKey);
  }

  /** Why the last call failed, in fixed words (types.ts, VendorProblem); null once a call goes through. */
  problem(): VendorProblem | null {
    return this.why;
  }

  private fail(why: VendorProblem, status: number): never {
    this.why = why;
    throw new VendorError(status);
  }

  /**
   * One sign-in at a time in this instance: two reads that both find the token lapsed share one new token. `lapsed`
   * is the token Petlibro just refused, so a token another instance stores meanwhile can be told from it.
   */
  private login(lapsed: string): Promise<string> {
    this.signingIn ??= this.leased(lapsed).finally(() => (this.signingIn = null));
    return this.signingIn;
  }

  /**
   * One sign-in at a time across instances (#683). Several instances (and the public status poll on each) find the
   * token lapsed at the same moment; if each signed in, every token but the last would be cancelled at once and read
   * as "signed-out", and the store could keep a cancelled one. So the instance that takes the lease signs in, and
   * the others wait for the token it stores, taking the lease themselves if it is let go without one.
   */
  private async leased(lapsed: string): Promise<string> {
    const { vault, now } = this.deps;
    // A refused sign-in is held off for a while: the same email and digest won't work a minute later.
    if (now() < this.holdUntil) this.fail(this.why ?? "refused", 401);
    if (!vault) return this.signIn();
    const pause = this.deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let step = 0; ; step++) {
      if (await vault.lease("petlibro", SIGNIN_LEASE_MS, now())) {
        try {
          // Another instance may have stored a token between our refusal and the lease.
          const newer = await this.stored();
          return newer && newer !== lapsed ? newer : await this.signIn();
        } finally {
          await vault.release("petlibro");
        }
      }
      if (step >= SIGNIN_WAIT_STEPS) this.fail("vendor", 503);
      await pause(SIGNIN_WAIT_MS);
      const newer = await this.stored();
      if (newer && newer !== lapsed) return newer;
    }
  }

  private async signIn(): Promise<string> {
    const { fetch: f, email, loginDigest, vault, now } = this.deps;
    let a: Answer;
    try {
      a = (await callJson(f, `${PETLIBRO_API}/member/auth/login`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ ...APP, country: "US", email, password: loginDigest, phoneBrand: "", phoneSystemVersion: "", timezone: HEADERS.timezone, thirdId: null, type: null }),
      })) as Answer;
    } catch (e) {
      this.fail(e instanceof VendorError && e.status === 0 ? "unreachable" : "vendor", e instanceof VendorError ? e.status : 502);
    }
    const token = str(obj(a.data).token);
    if (Number(a.code) !== PETLIBRO_CODE.ok || !token) {
      // 1101: Petlibro has no account under that email (one made with Apple or Google sign-in has no password to
      // match, and an Apple relay address isn't the email typed at setup). Anything else: the digest was refused.
      this.holdUntil = now() + LOGIN_HOLD_MS;
      this.fail(Number(a.code) === PETLIBRO_CODE.noMember ? "no-account" : "refused", 401);
    }
    this.holdUntil = 0;
    await vault?.write("petlibro", { token });
    return token;
  }

  private async stored(): Promise<string> {
    return str(obj(await this.deps.vault?.read("petlibro").catch(() => null)).token);
  }

  /**
   * One API call with the stored token. Petlibro keeps one session per account, so a token stops working (1009)
   * whenever anything else signs in: the phone app, or another Function App instance. Every 1009 looks in the store
   * for a newer token first (another instance may have just signed in) and otherwise signs in again, behind the
   * lease; a 1009 right after a fresh sign-in, with nothing newer stored, means something outside C.E.O. took the
   * session back (the phone app, or another integration on the same account), and reads as "signed-out".
   */
  async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.vault || !(await this.connected())) throw new VendorError(401);
    let token = await this.stored();
    let fresh = false;
    if (!token) {
      token = await this.login("");
      fresh = true;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      let a: Answer;
      try {
        a = (await callJson(this.deps.fetch, `${PETLIBRO_API}${path}`, { method: "POST", headers: { ...HEADERS, token }, body: JSON.stringify(body) })) as Answer;
      } catch (e) {
        this.fail(e instanceof VendorError && e.status === 0 ? "unreachable" : "vendor", e instanceof VendorError ? e.status : 502);
      }
      if (Number(a.code) === PETLIBRO_CODE.notLoggedIn) {
        const newer = await this.stored();
        if (newer && newer !== token) token = newer;
        else if (fresh) break;
        else {
          token = await this.login(token);
          fresh = true;
        }
        continue;
      }
      if (Number(a.code) !== PETLIBRO_CODE.ok) this.fail("vendor", 502);
      this.why = null;
      return a.data ?? {};
    }
    this.fail("signed-out", 401);
  }

  /** Every device's reading. Reads that overlap in this instance share one pass over Petlibro. */
  status(): Promise<Found<PetlibroRef>[]> {
    this.reading ??= this.readAll().finally(() => (this.reading = null));
    return this.reading;
  }

  private async readAll(): Promise<Found<PetlibroRef>[]> {
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
      const at = Number(obj(real).platePosition);
      const plate = at >= 1 && at <= 3 ? at : 1;
      const reading = petlibroReading(deviceId(idKey, "petlibro", serial), kind, item, real, extra);
      let feedId: number | string | undefined;
      if (kind === "wet-feeder") {
        if (at >= 1 && at <= 3) reading.plate = at;
        const meals = wetMeals(extra.wet);
        if (meals.length) reading.meals = meals;
        const id = obj(extra.wet).manualFeedId;
        if ((typeof id === "number" && Number.isFinite(id)) || (typeof id === "string" && /^[\w-]{1,40}$/.test(id))) feedId = id;
      }
      out.push({ reading, ref: { serial, plate, ...(feedId !== undefined && { feedId }) } });
    }
    return out;
  }

  async run(action: string, found: Found<PetlibroRef>, args: RunArgs = {}): Promise<RunResult> {
    try {
      if (action === "feeder.feed" && found.reading.kind === "dry-feeder") {
        // The rails have already counted these against the cap (home.ts); 1 to 6, 1 when not given.
        const grainNum = Number.isInteger(args.portions) && args.portions! >= 1 && args.portions! <= 6 ? args.portions! : 1;
        await this.post("/device/device/manualFeeding", { deviceSn: found.ref.serial, grainNum, requestId: randomUUID().replace(/-/g, "") });
        return { ok: true };
      }
      if (action === "wet.close" && found.reading.kind === "wet-feeder") {
        if (found.ref.feedId === undefined) return { ok: true, say: "The wet food feeder's lid is already closed." };
        await this.post("/device/wetFeedingPlan/stopFeedNow", { deviceSn: found.ref.serial, feedId: found.ref.feedId });
        return { ok: true };
      }
      if (action === "wet.rotate" && found.reading.kind === "wet-feeder") {
        const steps = args.steps === 2 ? 2 : 1;
        const pause = this.deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
        for (let i = 0; i < steps; i++) {
          if (i) await pause(ROTATE_GAP_MS);
          await this.post("/device/wetFeedingPlan/platePositionChange", { deviceSn: found.ref.serial, plate: 1 });
        }
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
