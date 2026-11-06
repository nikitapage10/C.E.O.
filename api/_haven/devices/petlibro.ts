/**
 * The Petlibro feeders and fountain (#632, docs/HOME-DEVICES.md), ported from the community Home Assistant
 * integration jjjonesjr33/petlibro (custom_components/petlibro/api.py and its devices/). Nikita has three: a dry food
 * feeder, a wet food feeder (the Polar kind, a rotating tray of three bowls with a lid) and a water fountain. Their
 * exact models come from the account's own device list (`productName`).
 *
 *   POST /member/auth/login                       email and the login digest for a token (sealed, reused until it lapses)
 *   POST /device/device/list                      every device: deviceSn, productName, surplusGrain, online…
 *   POST /device/device/realInfo                  live state: online, food left, the fountain's water and filter
 *   POST /device/data/grainStatus                 today's feeds: portions and dispenses (dry), eating visits and
 *                                                 time (the wet feeder, when it reports them) (#685)
 *   POST /device/workRecord/list                  the last successful dispense (dry feeders)
 *   POST /device/feedingPlan/list                 the dry feeder's schedule: each meal's time, portions, on or off (#685)
 *   POST /device/feedingPlan/todayNew             today's dry meals and where each stands (served, skipped…) (#685)
 *   POST /data/deviceDrinkWater/todayDrinkData    the fountain's day: mL drunk, visits, their total and average length (#685)
 *   POST /device/wetFeedingPlan/wetListV3         the wet feeder's plan and whether a manual feed is open
 *   POST /device/device/manualFeeding             portions from a dry feeder (grainNum: how many, already capped)
 *   POST /device/wetFeedingPlan/manualFeedNow     opens the wet feeder's lid on the bowl in front (plate)
 *   POST /device/wetFeedingPlan/platePositionChange   turns the wet tray one bowl counter-clockwise (#637 scope; the
 *                                                 `plate` it carries is ignored by the device). To reach a bowl it is
 *                                                 called (target - realInfo.platePosition) mod 3 times, 2 s apart, as
 *                                                 the integration's set_plate_position does.
 *   POST /device/wetFeedingPlan/stopFeedNow       closes the lid of a manual opening ({ deviceSn, feedId: manualFeedId });
 *                                                 the Home's auto-close calls it two hours after an opening (#713)
 *
 * The wet plan (wetListV3's `templateName` and `plan`: each meal's `plate`, `label`, `executionStartTime` and
 * `executionEndTime`) is read into the reading as `meals`, so the rails can tell when a manual turn or opening may
 * throw off the next scheduled meal (rails.ts, the wet tray). The plan is read by deviceSn, so an account the feeder
 * is shared to should get it too; `wetPlanShape` (counts and key names, signed in only, and logged once per cold
 * start) tells a plan that comes back empty from one the parser drops. Without a plan, the device list's own
 * `nextFeedingTime` and `enableFeedingPlan` still say when the next meal is, or that the schedule is off.
 *
 * The day's numbers and plans (#685) are read only: field names come from the community integration, so each is
 * taken only when it has the expected shape and left out otherwise (the Desk hides what isn't there). They are private
 * readings; the public face stays each device's kind and state (home.ts, publicOf).
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
import { FEED_UNITS, isoOf, obj, pct, PLACES, str, type DeviceClient, type DeviceKind, type DeviceReading, type DryMeal, type Found, type MealStatus, type RunArgs, type RunResult, type VendorProblem, type WetMeal, type WetPlanShape } from "./types.js";
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
/** What a device's reading is made of besides its list entry and realInfo (each null when its read failed). */
export interface PetlibroExtra {
  grain?: unknown;
  work?: unknown;
  wet?: unknown;
  /** Petlibro's answer code when it refused the wet plan read (#952), for the plan-read diagnostic. */
  wetCode?: number;
  /** The fountain's todayDrinkData. */
  drink?: unknown;
  /** The dry feeder's feedingPlan/list and feedingPlan/todayNew. */
  plans?: unknown;
  today?: unknown;
}

/** A whole count from 0 to `max` (numbers or numeric strings), or undefined. */
export function count(v: unknown, max = 100_000): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : undefined;
}

/** Days left (below 0 when overdue), a whole number within ten years either way, or undefined. */
export function daysLeft(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= 3650 ? Math.round(n) : undefined;
}

/** The fountain's day from todayDrinkData: mL drunk, visits, their total and average length (seconds). */
export function fountainDay(drink: unknown): Pick<DeviceReading, "drankMl" | "visits" | "visitSec" | "avgSec"> {
  const d = obj(drink);
  const drankMl = count(d.todayTotalMl, 50_000);
  const visits = count(d.todayTotalTimes, 2_000);
  const visitSec = count(d.petEatingTime, 86_400);
  const avgSec = count(d.avgDrinkDuration, 86_400);
  return { ...(drankMl !== undefined && { drankMl }), ...(visits !== undefined && { visits }), ...(visitSec !== undefined && { visitSec }), ...(avgSec !== undefined && { avgSec }) };
}

/** A feeder's day from grainStatus: portions dispensed and how many times (dry), eating visits and their time. */
export function feederDay(grain: unknown, kind: DeviceKind): Pick<DeviceReading, "fedPortions" | "feeds" | "visits" | "visitSec"> {
  const g = obj(grain);
  const visits = count(g.todayEatingTimes, 2_000);
  const visitSec = count(g.petEatingTime, 86_400);
  const eat = { ...(visits !== undefined && { visits }), ...(visitSec !== undefined && { visitSec }) };
  if (kind !== "dry-feeder") return eat;
  const fedPortions = count(g.todayFeedingQuantity, 1_000);
  const feeds = count(g.todayFeedingTimes, 200);
  return { ...(fedPortions !== undefined && { fedPortions }), ...(feeds !== undefined && { feeds }) };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Now in Mountain time: minutes into the day, and the weekday as Petlibro's repeatDay counts it (1 Monday … 7 Sunday). */
export function denverNow(now: number): { minutes: number; weekday: number } {
  const hhmm = planTime(now) ?? "00:00";
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" }).format(new Date(now));
  return { minutes: minutesOf(hhmm), weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1 };
}

/** Marks the first meal still to come today as the next one. */
function markNext<T extends { status?: MealStatus }>(meals: T[]): T[] {
  const n = meals.find((m) => m.status === "later");
  if (n) n.status = "next";
  return meals;
}

/** Petlibro's state for a meal of today's dry plan (the integration's map): 1 waiting, 2 to be skipped, 3 served, 4 skipped. */
const DRY_STATE: Record<number, MealStatus> = { 2: "skip", 3: "done", 4: "skipped" };

/** The days a dry plan repeats on ("[1,2,3]" or [1,2,3]; empty means once). */
function repeatDays(v: unknown): number[] {
  let a: unknown = v;
  if (typeof v === "string") {
    try {
      a = JSON.parse(v);
    } catch {
      a = [];
    }
  }
  return Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7) : [];
}

/**
 * The dry feeder's plan for today (#685), from feedingPlan/todayNew (`plans`: each meal's `planId`, `time`,
 * `grainNum` and `state`) and feedingPlan/list (every meal: `id`, `executionTime`, `grainNum`, `enable`, `repeatDay`).
 * Today's own list leads; meals of the schedule set for today that it leaves out (switched off) are added. Without
 * todayNew, the schedule's meals for today's weekday. Pure.
 */
export function dryPlan(list: unknown, today: unknown, now: number): DryMeal[] {
  const plans = (Array.isArray(list) ? list : []).map(obj).slice(0, 24);
  const t = Array.isArray(today) ? today : obj(today).plans;
  const todays = (Array.isArray(t) ? t : []).map(obj).slice(0, 24);
  const byId = new Map(plans.filter((p) => p.id !== undefined).map((p) => [str(p.id), p]));
  const { minutes, weekday } = denverNow(now);
  const out: DryMeal[] = [];
  const seen = new Set<string>();
  const add = (time: string | null, grain: unknown, on: boolean, state: unknown) => {
    if (!time) return;
    const portions = count(grain, 48);
    const known = DRY_STATE[Number(state)];
    const status: MealStatus | undefined = known ?? (on && minutesOf(time) > minutes ? "later" : undefined);
    out.push({ time, ...(portions !== undefined && { portions }), on, ...(status && { status }) });
  };
  for (const tp of todays) {
    const plan = byId.get(str(tp.planId)) ?? {};
    if (tp.planId !== undefined) seen.add(str(tp.planId));
    add(planTime(tp.time ?? tp.executionTime ?? plan.executionTime), tp.grainNum ?? plan.grainNum, plan.enable !== false, tp.state);
  }
  for (const p of plans) {
    if (seen.has(str(p.id))) continue;
    const days = repeatDays(p.repeatDay);
    if (days.length && !days.includes(weekday)) continue;
    if (!days.length && todays.length) continue;
    add(planTime(p.executionTime), p.grainNum, p.enable === true, null);
  }
  return markNext(out.sort((a, b) => a.time.localeCompare(b.time)).slice(0, 12));
}

export function petlibroReading(id: string, kind: DeviceKind, item: unknown, real: unknown, extra: PetlibroExtra, now = Date.now()): DeviceReading {
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
    const filterDays = daysLeft(r.remainingReplacementDays);
    const cleanDays = daysLeft(r.remainingCleaningDays);
    return {
      ...base,
      water,
      filter,
      ...(filterDays !== undefined && { filterDays }),
      ...(cleanDays !== undefined && { cleanDays }),
      ...fountainDay(extra.drink),
      state: online ? "running" : "offline",
    };
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
    const unit = FEED_UNITS[Number(r.unitType) - 1];
    const plan = extra.plans || extra.today ? dryPlan(extra.plans, extra.today, now) : [];
    return { ...base, foodLow, lastFed, ...feederDay(extra.grain, kind), ...(unit && { feedUnit: unit }), ...(plan.length > 0 && { plan }) };
  }
  // The wet feeder: a manual feed is open while the plan carries its id.
  const wet = obj(extra.wet);
  const open = wet.manualFeedId !== undefined && wet.manualFeedId !== null;
  const at = Number(r.platePosition);
  const meals = wetMeals(extra.wet, now);
  // The device list's own next meal and plan switch (the integration's nextFeedingTime, nextFeedingEndTime and
  // enableFeedingPlan): what the card can still say when the plan itself doesn't come back to this account.
  // realInfo carries them too on some firmware (#952), so either answers.
  const nextTime = planTime(d.nextFeedingTime ?? r.nextFeedingTime);
  const nextEnd = planTime(d.nextFeedingEndTime ?? r.nextFeedingEndTime);
  const planOn = onOff(d.enableFeedingPlan ?? r.enableFeedingPlan);
  return {
    ...base,
    foodLow,
    lastFed: null,
    ...feederDay(extra.grain, kind),
    ...(Number.isInteger(at) && at >= 1 && at <= 3 && { plate: at }),
    ...(meals.length > 0 && { meals }),
    ...(nextTime && { nextFeed: { time: nextTime, ...(nextEnd && nextEnd !== nextTime && { end: nextEnd }) } }),
    ...(planOn !== undefined && { planOn }),
    ...("wet" in extra && { wetPlanShape: wetPlanShape(extra.wet, extra.wet === null, extra.wetCode) }),
    state: online ? (open ? "lid open" : "closed") : "offline",
  };
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
  /** The Function's log (the wet plan's shape once per cold start: counts and key names, never a value). */
  log?: (line: string) => void;
}

/** The gap between two turns of the wet tray, so the device finishes the first. */
export const ROTATE_GAP_MS = 2_000;

/** A wet feeder opening's id as Petlibro gives it: a finite number or a short word; undefined otherwise. */
export function feedIdOf(v: unknown): number | string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^[\w-]{1,40}$/.test(v)) return v;
  return undefined;
}

export interface PetlibroRef {
  serial: string;
  plate: number;
  /** The wet feeder's open manual feed, which stopFeedNow closes. */
  feedId?: number | string;
}

/** Minutes in a day: a whole number below this is a time of day as minutes since midnight, not an epoch. */
const DAY_MIN = 24 * 60;

/**
 * A plan time as "HH:MM" in Denver, from any of the shapes Petlibro's plans have used: "18:00", "6:00", "18:00:00",
 * "6:00 PM", a date with its time ("2026-11-05 18:00:00", taken as written), an ISO time with its zone, minutes since
 * midnight (0 to 1439, a number or digits), or epoch seconds or milliseconds. Null when it isn't one.
 */
export function planTime(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    const m = /^(?:\d{4}-\d{2}-\d{2}[ T])?(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(?:([ap])\.?m\.?)?$/i.exec(t);
    if (m) {
      let h = Number(m[1]);
      const min = Number(m[2]);
      if (m[3]) {
        if (h < 1 || h > 12) return null;
        h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
      }
      return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
    }
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/i.test(t)) v = Date.parse(t);
    else if (/^\d{1,4}$/.test(t) || /^\d{9,13}$/.test(t)) v = Number(t);
    else return null;
  }
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  if (Number.isInteger(v) && v < DAY_MIN) return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  // Below 1e8 (1973) is neither minutes nor an epoch the feeder would send.
  if (v < 1e8) return null;
  const ms = v < 1e12 ? v * 1000 : v;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Denver", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

/** A switch as Petlibro may send it: true or false, 1 or 0, or those as words. Undefined when it isn't one. */
export function onOff(v: unknown): boolean | undefined {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  return undefined;
}

/** The names a list of wet meals has come under (the integration's `plan`, and the shapes Petlibro's other plans use). */
const PLAN_KEYS = ["plan", "plans", "planList", "wetFeedingPlanList", "wetPlanList", "feedingPlanList", "feedingPlans", "list", "data"] as const;

/** A list that may come as JSON text (Petlibro sends some arrays as strings, like repeatDay). */
function listOf(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const got: unknown = JSON.parse(v);
      return Array.isArray(got) ? got : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a template is the one in use, when the answer says which. */
const inUse = (t: Record<string, unknown>) => [t.enable, t.isUse, t.inUse, t.use, t.used, t.selected, t.isDefault, t.current].some((v) => onOff(v) === true);

/**
 * The wet plan's entries as wetListV3 sends them (#952: read every shape a plan has been seen in, so a plan that comes
 * back is never dropped by the parser): `plan` (the integration's), or another list name, a list sent as JSON text, the
 * answer itself as a bare list, or a list of templates each with its own plan (the one in use, else the first with
 * meals).
 */
function wetEntries(wet: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 3) return [];
  const bare = listOf(wet);
  const lists = bare ? [bare] : PLAN_KEYS.map((k) => listOf(obj(wet)[k])).filter((l): l is unknown[] => !!l && l.length > 0);
  const list = (lists[0] ?? []).slice(0, 24).map(obj);
  // Templates: entries that hold plans of their own.
  const nested = list.filter((t) => PLAN_KEYS.some((k) => listOf(t[k])?.length));
  if (nested.length) {
    const pick = nested.find(inUse) ?? nested.find((t) => wetEntries(t, depth + 1).length) ?? nested[0]!;
    return wetEntries(pick, depth + 1);
  }
  // A wrapper object around the plan ({ data: { plan } }).
  if (!list.length && depth === 0) {
    const inner = obj(obj(wet).data ?? obj(wet).result);
    if (Object.keys(inner).length) return wetEntries(inner, depth + 1);
  }
  return list;
}

/** An entry's start and end: the integration's executionStartTime and executionEndTime, or the shorter names. */
const startOf = (o: Record<string, unknown>) => o.executionStartTime ?? o.startTime ?? o.executionTime ?? o.feedTime ?? o.planTime ?? o.time;
const endOf = (o: Record<string, unknown>) => o.executionEndTime ?? o.endTime ?? o.feedEndTime;
/** A plate number as sent (a number or a digit); NaN when there is none. */
const plateNum = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d$/.test(v.trim()) ? Number(v) : NaN);

/** A meal's name from the app, without control characters, squeezed and cut to 40 characters. */
export function cleanLabel(v: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) : "";
}

/** A key name worth showing in the diagnostic: letters, digits and underscores, up to 40 characters. */
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const keyNames = (objs: Record<string, unknown>[]) => [...new Set(objs.flatMap((o) => Object.keys(o)).filter((k) => KEY_NAME.test(k)))].sort().slice(0, 40);

/**
 * What the wet plan read came back as (private diagnostic): whether it went through, whether it has a template, how
 * many entries, how many are switched off or have no time the parser reads, and the key names on the entries and on
 * the answer. Names and counts only, never a value. Pure.
 */
export function wetPlanShape(wet: unknown, failed = false, code?: number): WetPlanShape {
  const w = obj(wet);
  const entries = wetEntries(wet);
  const t = w.templateName;
  return {
    read: failed ? "failed" : "ok",
    template: typeof t === "string" ? t.trim() !== "" : t !== undefined && t !== null,
    entries: entries.length,
    disabled: entries.filter((o) => onOff(o.enable) === false).length,
    badTime: entries.filter((o) => planTime(startOf(o)) === null).length,
    keys: keyNames(entries),
    top: keyNames([w]),
    ...(failed && code !== undefined && { code }),
  };
}

/** The shape in one log line: counts and key names only. */
export function shapeLine(s: WetPlanShape): string {
  return `petlibro: wet plan read=${s.read}${s.code !== undefined ? ` code=${s.code}` : ""} template=${s.template} entries=${s.entries} disabled=${s.disabled} badTime=${s.badTime} keys=[${s.keys.join(",")}] top=[${s.top.join(",")}]`;
}

/**
 * The wet plan's meals, by time, from wetListV3 (`plan`, each with `plate`, `executionStartTime` and
 * `executionEndTime`). Given now (#685), each meal also says where it stands by the clock: served once its window has
 * closed, open now inside it, and the first still to come is next. Pure.
 */
export function wetMeals(wet: unknown, now?: number): WetMeal[] {
  const entries = wetEntries(wet).slice(0, 12);
  // The integration's plates are 1 to 3 (as platePosition and manualFeedNow); a plan that numbers them 0 to 2 is shifted.
  const plates = entries.map((o) => plateNum(o.plate)).filter((n) => !Number.isNaN(n));
  const shift = plates.includes(0) && plates.every((n) => n >= 0 && n <= 2) ? 1 : 0;
  const out: WetMeal[] = [];
  for (const o of entries) {
    // The integration reads no switch on a wet meal; when one is there, false or 0 means off.
    if (onOff(o.enable) === false) continue;
    const time = planTime(startOf(o));
    if (!time) continue;
    const plate = plateNum(o.plate) + shift;
    const end = planTime(endOf(o));
    const label = cleanLabel(o.label);
    out.push({ time, ...(Number.isInteger(plate) && plate >= 1 && plate <= 3 && { plate }), ...(end && end !== time && { end }), ...(label && { label }) });
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  if (now === undefined) return out;
  const at = denverNow(now).minutes;
  for (const m of out) {
    const start = minutesOf(m.time);
    let stop = m.end ? minutesOf(m.end) : start;
    if (stop < start) stop += 24 * 60;
    m.status = at < start ? "later" : at < stop ? "now" : "done";
  }
  return markNext(out);
}

type Answer = { code?: unknown; data?: unknown };

/** The wet feeder's plan, read by deviceSn (the integration's `device_wet_feeding_plan`). */
const WET_PLAN = "/device/wetFeedingPlan/wetListV3";

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
  /** The answer code of each path Petlibro last refused (#952: why the wet plan doesn't come back), never a value. */
  private refused = new Map<string, number>();
  private holdUntil = 0;
  private signingIn: Promise<string> | null = null;
  private reading: Promise<Found<PetlibroRef>[]> | null = null;
  private shapeLogged = false;
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
      if (Number(a.code) !== PETLIBRO_CODE.ok) {
        if (Number.isInteger(Number(a.code))) this.refused.set(path, Number(a.code));
        this.fail("vendor", 502);
      }
      this.refused.delete(path);
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
      // Each kind's reads go out together; a failed one only leaves its fields out.
      const [real, extra] = await Promise.all([read("/device/device/realInfo"), this.extraOf(kind, serial, now, read)]);
      const at = Number(obj(real).platePosition);
      const plate = at >= 1 && at <= 3 ? at : 1;
      const reading = petlibroReading(deviceId(idKey, "petlibro", serial), kind, item, real, extra, now);
      let feedId: number | string | undefined;
      if (kind === "wet-feeder") {
        feedId = feedIdOf(obj(extra.wet).manualFeedId);
        // Once per cold start: what the plan read came back as, counts and key names only.
        if (!this.shapeLogged && reading.wetPlanShape) {
          this.shapeLogged = true;
          this.deps.log?.(shapeLine(reading.wetPlanShape));
        }
      }
      out.push({ reading, ref: { serial, plate, ...(feedId !== undefined && { feedId }) } });
    }
    // The list went through: a side read that failed (a field this model doesn't report) only left its fields out,
    // and isn't why Petlibro would read down next time.
    this.why = null;
    return out;
  }

  /** The reads a device's kind takes besides realInfo (#685: the day's numbers and plans), all at once. */
  private async extraOf(kind: DeviceKind, serial: string, now: number, read: (path: string, body?: Record<string, unknown>) => Promise<unknown>): Promise<PetlibroExtra> {
    if (kind === "fountain") return { drink: await read("/data/deviceDrinkWater/todayDrinkData") };
    if (kind === "wet-feeder") {
      const [wet, grain] = await Promise.all([read(WET_PLAN), read("/device/data/grainStatus")]);
      const code = wet === null ? this.refused.get(WET_PLAN) : undefined;
      return { wet, grain, ...(code !== undefined && { wetCode: code }) };
    }
    const [work, grain, plans, today] = await Promise.all([
      read("/device/workRecord/list", { deviceSn: serial, startTime: now - 7 * 86_400_000, endTime: now, size: 10, type: ["GRAIN_OUTPUT_SUCCESS"] }),
      read("/device/data/grainStatus"),
      read("/device/feedingPlan/list"),
      read("/device/feedingPlan/todayNew"),
    ]);
    return { work, grain, plans, today };
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
        // The opening the feeder reports now; else the one kept from wet.open (#713).
        const feedId = found.ref.feedId ?? feedIdOf(args.feedId);
        if (feedId === undefined) return { ok: true, say: "The wet food feeder's lid is already closed." };
        await this.post("/device/wetFeedingPlan/stopFeedNow", { deviceSn: found.ref.serial, feedId });
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
        const answer = await this.post("/device/wetFeedingPlan/manualFeedNow", { deviceSn: found.ref.serial, plate: found.ref.plate });
        // The opening's id, which stopFeedNow closes (#713): the plan's manualFeedId once it shows, else whatever id the
        // open call answered with. Kept by the Home for the auto-close; neither is ever logged.
        const plan = await this.post("/device/wetFeedingPlan/wetListV3", { id: found.ref.serial, deviceSn: found.ref.serial }).catch(() => null);
        const feedId = feedIdOf(obj(plan).manualFeedId) ?? feedIdOf(answer) ?? feedIdOf(obj(answer).manualFeedId) ?? feedIdOf(obj(answer).feedId);
        return { ok: true, ...(feedId !== undefined && { feedId }) };
      }
      return { ok: false, code: "unsupported" };
    } catch (e) {
      return { ok: false, code: e instanceof VendorError && e.status === 401 ? "not-connected" : found.reading.online ? "vendor" : "offline" };
    }
  }
}
