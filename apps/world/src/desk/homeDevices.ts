import { create } from "zustand";
import { useDeskAuth } from "./signin.ts";
import { navigateTo } from "../route.ts";

/**
 * Nikita's home devices on the Desk (#632, docs/HOME-DEVICES.md; api/_haven/devices/route.ts). Azure copy only:
 *
 *   GET  /api/haven/devices?view=status   the public face: each vendor's state, and each device's kind and state.
 *                                         Counts and states only; what the signed-out Desk and Systems show.
 *   GET  /api/haven/devices               signed in: every device's reading (model and place are private).
 *   POST /api/haven/devices/action        signed in: one action, through the server's safety rails.
 *   POST /api/haven/devices/connect       signed in: Connect Roborock (email, code, disconnect).
 *   GET  /api/haven/google                signed in: Connect Nest and Connect Google Tasks, the Tasks list (#637).
 *   POST /api/haven/google                signed in: connect, disconnect, the Tasks list's title, a sync now.
 *
 * Where the route doesn't exist (the Vercel copy, a local build) everything stays hidden.
 */

export type Vendor = "roborock" | "petlibro" | "whisker" | "nest";
export type VendorState = "waiting" | "live" | "down";
export type DeviceKind = "vacuum" | "dry-feeder" | "wet-feeder" | "fountain" | "litter" | "thermostat";
export type ActionId = "vacuum.start" | "vacuum.pause" | "vacuum.dock" | "vacuum.rooms" | "feeder.feed" | "wet.open" | "wet.rotate" | "wet.close" | "wet.status" | "litter.clean" | "thermostat.set" | "thermostat.mode";
export type ThermoMode = "heat" | "cool" | "heatcool" | "off";
/** An action's own fields: the thermostat's (#637), dry portions, the wet bowl, the vacuum's mode words. */
export interface ActExtra {
  tempF?: number;
  heatF?: number;
  coolF?: number;
  mode?: ThermoMode;
  portions?: number;
  plate?: number;
  suction?: "quiet" | "max";
  water?: "off" | "on";
}
/** The Haven's other connections (#637): their states come with the devices' answers. */
export type Link = "tasks" | "kroger";

export const VENDORS: readonly Vendor[] = ["roborock", "petlibro", "whisker", "nest"];
export const LINKS: readonly Link[] = ["tasks", "kroger"];
export const VENDOR_NAME: Record<Vendor, string> = { roborock: "Roborock", petlibro: "Petlibro", whisker: "Whisker", nest: "Google Nest" };
const KINDS: readonly DeviceKind[] = ["thermostat", "vacuum", "dry-feeder", "wet-feeder", "fountain", "litter"];
const MODES: readonly ThermoMode[] = ["heat", "cool", "heatcool", "off"];
/** The thermostat's rails, as the server keeps them (api/_haven/devices/rails.ts). */
export const THERMO_MIN_F = 60;
export const THERMO_MAX_F = 80;

export interface DeviceReading {
  id: string;
  vendor: Vendor;
  kind: DeviceKind;
  model: string;
  place: string;
  online: boolean;
  state: string;
  battery?: number | null;
  alerts: string[];
  rooms?: string[];
  foodLow?: boolean;
  lastFed?: string | null;
  manualToday?: number;
  manualCap?: number;
  /** The wet feeder's bowl in front (1 to 3). */
  plate?: number;
  /** The wet feeder (#713): when an opening from here closes itself (ISO), while it is open. */
  closesAt?: string;
  water?: number | null;
  filter?: number | null;
  /** The Petlibro day (#685): the fountain's days to the filter change and the clean (below 0 overdue), mL drunk,
   * visits and their total and average seconds (the fountain's drinks, the wet feeder's eating visits), the dry
   * feeder's portions and dispenses today and the app's unit, and today's plans. Each only when Petlibro said. */
  filterDays?: number;
  cleanDays?: number;
  drankMl?: number;
  visits?: number;
  visitSec?: number;
  avgSec?: number;
  fedPortions?: number;
  feeds?: number;
  feedUnit?: FeedUnit;
  /** The wet feeder's bowls for today, and the dry feeder's schedule for today. */
  meals?: PetMeal[];
  plan?: PetMeal[];
  drawer?: number | null;
  litter?: number | null;
  lastUse?: string | null;
  catInside?: boolean;
  tempF?: number | null;
  humidity?: number | null;
  mode?: ThermoMode;
  modes?: ThermoMode[];
  eco?: boolean;
  hvac?: string;
  heatF?: number | null;
  coolF?: number | null;
}

/** Where a meal on today's plan stands (#685; api/_haven/devices/types.ts, MealStatus). */
export type MealStatus = "done" | "now" | "next" | "later" | "skipped" | "skip";
const MEAL_STATUSES: readonly MealStatus[] = ["done", "now", "next", "later", "skipped", "skip"];
export type FeedUnit = "cup" | "oz" | "g" | "ml";
const FEED_UNITS: readonly FeedUnit[] = ["cup", "oz", "g", "ml"];
/** One meal of today's plan: its time ("HH:MM", Mountain), the wet window's end and bowl, the dry portions and switch. */
export interface PetMeal {
  time: string;
  end?: string;
  plate?: number;
  portions?: number;
  on?: boolean;
  status?: MealStatus;
}

const HHMM = /^\d{2}:\d{2}$/;
/** When the wet tray closes (#713), on Nikita's clock in Denver: "6:15pm". */
export function closeClock(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${v("hour")}:${v("minute")}${v("dayPeriod").toLowerCase()}`;
}

/** Today's plan, checked: at most 12 meals, each with a time; anything else dropped. */
export function mealsOf(v: unknown): PetMeal[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PetMeal[] = [];
  for (const m of v.slice(0, 12).map(o)) {
    if (typeof m.time !== "string" || !HHMM.test(m.time)) continue;
    const plate = whole(m.plate, 3);
    const portions = whole(m.portions, 48);
    out.push({
      time: m.time,
      ...(typeof m.end === "string" && HHMM.test(m.end) && { end: m.end }),
      ...(plate && { plate }),
      ...(portions !== undefined && { portions }),
      ...(typeof m.on === "boolean" && { on: m.on }),
      ...(MEAL_STATUSES.includes(m.status as MealStatus) && { status: m.status as MealStatus }),
    });
  }
  return out;
}

/** A whole number from 0 to max, or undefined. */
function whole(v: unknown, max: number): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
}
/** Days either way within ten years, or undefined. */
function days(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 3650 ? v : undefined;
}

/** Why a vendor reads "down" (#672; api/_haven/devices/types.ts, VendorProblem), signed in only. */
export type VendorProblem = "no-account" | "refused" | "signed-out" | "unreachable" | "vendor";
const PROBLEMS: readonly VendorProblem[] = ["no-account", "refused", "signed-out", "unreachable", "vendor"];

/** Each problem in words, by vendor where the fix differs (Petlibro keeps one session per account). */
export function problemSay(vendor: Vendor, why: VendorProblem | undefined): string {
  const name = VENDOR_NAME[vendor];
  switch (why) {
    case "no-account":
      return `${name} has no account under the email in the Key Vault. An account made with Apple or Google sign-in has no password to match: give it a password in the app, or use a second account, then run the setup paste again.`;
    case "refused":
      return `${name} refused the sign-in: the password changed since the setup paste, or the account signs in with Apple or Google. Run the setup paste again (docs/HOME-DEVICES.md).`;
    case "signed-out":
      return vendor === "petlibro"
        ? "Signed out by another sign-in, most likely the phone app: Petlibro keeps one session per account, so signing in on the phone ends ours. Share the feeders to a second Petlibro account and put that one in the Key Vault."
        : `Signed out by another sign-in on the same ${name} account. It signs in again on the next read.`;
    case "unreachable":
      return `${name}'s cloud didn't answer. It tries again on the next read.`;
    default:
      return `${name} refused a read. It tries again on the next read.`;
  }
}

function problemsOf(v: unknown): Partial<Record<Vendor, VendorProblem>> {
  const b = o(v);
  const out: Partial<Record<Vendor, VendorProblem>> = {};
  for (const k of VENDORS) if (PROBLEMS.includes(b[k] as VendorProblem)) out[k] = b[k] as VendorProblem;
  return out;
}

export interface HomePrivate {
  vendors: Record<Vendor, VendorState>;
  /** Why each "down" vendor is down (#672). */
  problems: Partial<Record<Vendor, VendorProblem>>;
  links: Record<Link, VendorState>;
  devices: DeviceReading[];
  feedCap: number;
  roborockConnected: boolean;
}

export interface HomePublic {
  vendors: Record<Vendor, VendorState>;
  links: Record<Link, VendorState>;
  devices: { kind: DeviceKind; state: string; online: boolean }[];
}

const PATH = "/api/haven/devices";
const POLL_MS = 60_000;
const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");
const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const short = (v: unknown, max = 40) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function vendorsOf(v: unknown): Record<Vendor, VendorState> {
  const b = o(v);
  const pick = (s: unknown): VendorState => (s === "live" || s === "down" ? s : "waiting");
  return { roborock: pick(b.roborock), petlibro: pick(b.petlibro), whisker: pick(b.whisker), nest: pick(b.nest) };
}

function linksOf(v: unknown): Record<Link, VendorState> {
  const b = o(v);
  const pick = (s: unknown): VendorState => (s === "live" || s === "down" ? s : "waiting");
  return { tasks: pick(b.tasks), kroger: pick(b.kroger) };
}

/** The public face, checked; null when it isn't one. */
export function readPublic(v: unknown): HomePublic | null {
  const b = o(v);
  if (!b.vendors || !Array.isArray(b.devices)) return null;
  const devices = b.devices
    .map(o)
    .filter((d) => KINDS.includes(d.kind as DeviceKind))
    .map((d) => ({ kind: d.kind as DeviceKind, state: short(d.state, 24), online: d.online === true }));
  return { vendors: vendorsOf(b.vendors), links: linksOf(b.links), devices };
}

/** One private reading, checked; null when it isn't one. */
export function readDevice(v: unknown): DeviceReading | null {
  const d = o(v);
  if (typeof d.id !== "string" || !/^[0-9a-f]{12}$/.test(d.id) || !VENDORS.includes(d.vendor as Vendor) || !KINDS.includes(d.kind as DeviceKind)) return null;
  return {
    id: d.id,
    vendor: d.vendor as Vendor,
    kind: d.kind as DeviceKind,
    model: short(d.model, 60),
    place: short(d.place, 30),
    online: d.online === true,
    state: short(d.state, 24),
    battery: num(d.battery),
    alerts: Array.isArray(d.alerts) ? d.alerts.filter((a): a is string => typeof a === "string").map((a) => a.slice(0, 40)).slice(0, 8) : [],
    rooms: Array.isArray(d.rooms) ? d.rooms.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 40)).slice(0, 30) : undefined,
    foodLow: d.foodLow === true,
    lastFed: typeof d.lastFed === "string" ? d.lastFed : null,
    manualToday: num(d.manualToday) ?? undefined,
    manualCap: num(d.manualCap) ?? undefined,
    plate: num(d.plate) ?? undefined,
    ...(d.kind === "wet-feeder" && typeof d.closesAt === "string" && Number.isFinite(Date.parse(d.closesAt)) && { closesAt: d.closesAt }),
    water: num(d.water),
    filter: num(d.filter),
    drawer: num(d.drawer),
    litter: num(d.litter),
    lastUse: typeof d.lastUse === "string" ? d.lastUse : null,
    catInside: d.catInside === true,
    ...(d.vendor === "petlibro" && petDayOf(d)),
    ...(d.kind === "thermostat" && {
      tempF: num(d.tempF),
      humidity: num(d.humidity),
      ...(MODES.includes(d.mode as ThermoMode) && { mode: d.mode as ThermoMode }),
      modes: Array.isArray(d.modes) ? d.modes.filter((m): m is ThermoMode => MODES.includes(m as ThermoMode)) : [],
      eco: d.eco === true,
      hvac: short(d.hvac, 12),
      heatF: num(d.heatF),
      coolF: num(d.coolF),
    }),
  };
}

/** The Petlibro day's fields (#685), each kept only when it has its shape. */
function petDayOf(d: Record<string, unknown>): Partial<DeviceReading> {
  const out: Partial<DeviceReading> = {};
  const set = <K extends keyof DeviceReading>(k: K, v: DeviceReading[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("filterDays", days(d.filterDays));
  set("cleanDays", days(d.cleanDays));
  set("drankMl", whole(d.drankMl, 50_000));
  set("visits", whole(d.visits, 2_000));
  set("visitSec", whole(d.visitSec, 86_400));
  set("avgSec", whole(d.avgSec, 86_400));
  set("fedPortions", whole(d.fedPortions, 1_000));
  set("feeds", whole(d.feeds, 200));
  if (FEED_UNITS.includes(d.feedUnit as FeedUnit)) out.feedUnit = d.feedUnit as FeedUnit;
  set("meals", mealsOf(d.meals));
  set("plan", mealsOf(d.plan));
  return out;
}

export function readPrivate(v: unknown): HomePrivate | null {
  const b = o(v);
  if (!b.vendors || !Array.isArray(b.devices)) return null;
  return {
    vendors: vendorsOf(b.vendors),
    problems: problemsOf(b.problems),
    links: linksOf(b.links),
    devices: b.devices.map(readDevice).filter((d): d is DeviceReading => d !== null),
    feedCap: num(b.feedCap) ?? 2,
    roborockConnected: b.roborockConnected === true,
  };
}

/** The Systems light for one vendor: live is ok, down is down, waiting is off (not connected yet). */
export const linkOf = (s: VendorState | undefined): "ok" | "down" | "off" => (s === "live" ? "ok" : s === "down" ? "down" : "off");

/** The few words the Desk shows for how many devices are home, counts only. */
export function homeLine(pub: HomePublic | null): string {
  if (!pub) return "reading…";
  const n = pub.devices.length;
  if (!n) return VENDORS.every((v) => pub.vendors[v] === "waiting") ? "not connected yet" : "no devices";
  const off = pub.devices.filter((d) => !d.online).length;
  return `${n} device${n === 1 ? "" : "s"}${off ? `, ${off} offline` : ""}`;
}

/** "idle" before the first answer; "off" where the route doesn't exist. */
export type HomeLoad = "idle" | "off" | "live" | "failed";

interface HomeStore {
  load: HomeLoad;
  pub: HomePublic | null;
  view: HomePrivate | null;
  busy: string | null;
  /** Skippy's line after the last action, or the reason it was refused. */
  said: string | null;
  refresh: () => Promise<void>;
  act: (action: ActionId, device?: string, rooms?: string[], extra?: ActExtra) => Promise<boolean>;
  connect: (body: { step: "send"; email: string } | { step: "code"; code: string } | { step: "disconnect" }) => Promise<{ ok: boolean; say?: string }>;
}

async function post(path: string, body: object): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) });
}

export const useHome = create<HomeStore>((set, get) => ({
  load: "idle",
  pub: null,
  view: null,
  busy: null,
  said: null,
  refresh: async () => {
    const auth = useDeskAuth.getState().auth.status;
    try {
      if (auth === "in") {
        const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
        if (res.status === 401) useDeskAuth.getState().lost();
        else if (res.status === 404 || res.status === 405 || !isJson(res)) {
          set({ load: "off", view: null, pub: null });
          return;
        } else if (res.ok) {
          const view = readPrivate(await res.json());
          if (view) {
            set({ load: "live", view, pub: { vendors: view.vendors, links: view.links, devices: view.devices.map((d) => ({ kind: d.kind, state: d.state, online: d.online })) } });
            return;
          }
        }
      }
      // Signed out (or the private read failed): the public counts, and nothing private lingers on the page.
      const res = await fetch(`${PATH}?view=status`, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (res.status === 404 || res.status === 405 || !isJson(res)) {
        set({ load: "off", view: null, pub: null });
        return;
      }
      const pub = res.ok ? readPublic(await res.json()) : null;
      set({ load: pub ? "live" : "failed", pub: pub ?? get().pub, view: null });
    } catch {
      set({ load: "failed" });
    }
  },
  act: async (action, device, rooms, extra) => {
    set({ busy: action, said: null });
    try {
      const res = await post(`${PATH}/action`, { action, ...(device ? { device } : {}), ...(rooms?.length ? { rooms } : {}), ...(extra ?? {}) });
      if (res.status === 401) useDeskAuth.getState().lost();
      const got = isJson(res) ? o(await res.json().catch(() => ({}))) : {};
      set({ busy: null, said: short(got.say, 300) || (res.ok ? "Done." : "That didn't go through. Try again.") });
      void get().refresh();
      return res.ok;
    } catch {
      set({ busy: null, said: "That didn't go through. Try again." });
      return false;
    }
  },
  connect: async (body) => {
    try {
      const res = await post(`${PATH}/connect`, { vendor: "roborock", ...body });
      if (res.status === 401) useDeskAuth.getState().lost();
      const got = isJson(res) ? o(await res.json().catch(() => ({}))) : {};
      if (res.ok) void get().refresh();
      return { ok: res.ok, say: short(got.say, 300) || (res.ok ? undefined : got.error === "bad-email" ? "That email doesn't look right." : "That didn't go through. Try again.") };
    } catch {
      return { ok: false, say: "That didn't go through. Try again." };
    }
  },
}));

let started = false;

/** Start reading (once per page): every minute while the tab is showing, and on sign-in or out. */
export function startHome(): void {
  if (started || typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (q.has("offline") || q.has("demo")) return;
  started = true;
  const refresh = () => void useHome.getState().refresh();
  refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, POLL_MS);
  let was = useDeskAuth.getState().auth.status;
  useDeskAuth.subscribe((st) => {
    if (st.auth.status !== was) {
      was = st.auth.status;
      if (was !== "checking") refresh();
    }
  });
}

/* ── The Haven's Google connections (#637, api/_haven/google/route.ts) ── */

export interface HavenGoogle {
  google: boolean;
  nest: { project: boolean; connected: boolean; refused: boolean };
  tasks: { connected: boolean; refused: boolean; list: string; lastRun: string | null; lastResult: string | null; lastImported: number };
}

export function readGoogle(v: unknown): HavenGoogle | null {
  const b = o(v);
  if (typeof b.google !== "boolean") return null;
  const n = o(b.nest);
  const t = o(b.tasks);
  return {
    google: b.google,
    nest: { project: n.project === true, connected: n.connected === true, refused: n.refused === true },
    tasks: { connected: t.connected === true, refused: t.refused === true, list: short(t.list, 60) || "Shopping", lastRun: typeof t.lastRun === "string" ? t.lastRun : null, lastResult: short(t.lastResult, 12) || null, lastImported: num(t.lastImported) ?? 0 },
  };
}

/** The signed-in Desk's view of the Google connections; null when the route isn't there or signed out. */
export async function loadGoogle(): Promise<HavenGoogle | null> {
  try {
    const res = await fetch("/api/haven/google", { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) useDeskAuth.getState().lost();
    return res.ok && isJson(res) ? readGoogle(await res.json()) : null;
  } catch {
    return null;
  }
}

/** One Google action; `url` comes back for a connect, to send the browser to Google. */
export async function googleAction(body: { action: "connect" | "disconnect"; grant: "nest" | "tasks" } | { action: "tasks-list"; title: string } | { action: "tasks-sync" }): Promise<{ ok: boolean; url?: string; error?: string; imported?: number }> {
  try {
    const res = await post("/api/haven/google", body);
    if (res.status === 401) useDeskAuth.getState().lost();
    const got = isJson(res) ? o(await res.json().catch(() => ({}))) : {};
    const url = typeof got.url === "string" && /^https:\/\/(accounts\.google\.com|nestservices\.google\.com)\//.test(got.url) ? got.url : undefined;
    return { ok: res.ok, url, error: short(got.error ?? got.result, 20) || undefined, imported: num(got.imported) ?? undefined };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * Google sends a Nest or Tasks connect back to Today (`/?haven=…`); the house setup lives on the Boiler Room's Controls,
 * so the result goes on there. Today calls it once on mount (the home devices' chip did until the Iris, #666).
 */
export function forwardHavenResult() {
  try {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("haven");
    if (!r || !/^(nest|tasks)-(connected|cancelled|failed)$|^refused$/.test(r)) return;
    navigateTo(`/boiler/controls?haven=${r}`);
  } catch {
    /* no address to read */
  }
}
