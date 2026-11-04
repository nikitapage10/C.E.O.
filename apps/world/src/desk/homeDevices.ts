import { create } from "zustand";
import { useDeskAuth } from "./signin.ts";

/**
 * Nikita's home devices on the Desk (#632, docs/HOME-DEVICES.md; api/_haven/devices/route.ts). Azure copy only:
 *
 *   GET  /api/haven/devices?view=status   the public face: each vendor's state, and each device's kind and state.
 *                                         Counts and states only; what the signed-out Desk and Systems show.
 *   GET  /api/haven/devices               signed in: every device's reading (model and place are private).
 *   POST /api/haven/devices/action        signed in: one action, through the server's safety rails.
 *   POST /api/haven/devices/connect       signed in: Connect Roborock (email, code, disconnect).
 *
 * Where the route doesn't exist (the Vercel copy, a local build) everything stays hidden.
 */

export type Vendor = "roborock" | "petlibro" | "whisker";
export type VendorState = "waiting" | "live" | "down";
export type DeviceKind = "vacuum" | "dry-feeder" | "wet-feeder" | "fountain" | "litter";
export type ActionId = "vacuum.start" | "vacuum.pause" | "vacuum.dock" | "vacuum.rooms" | "feeder.feed" | "wet.open" | "litter.clean";

export const VENDORS: readonly Vendor[] = ["roborock", "petlibro", "whisker"];
export const VENDOR_NAME: Record<Vendor, string> = { roborock: "Roborock", petlibro: "Petlibro", whisker: "Whisker" };
const KINDS: readonly DeviceKind[] = ["vacuum", "dry-feeder", "wet-feeder", "fountain", "litter"];

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
  water?: number | null;
  filter?: number | null;
  drawer?: number | null;
  litter?: number | null;
  lastUse?: string | null;
  catInside?: boolean;
}

export interface HomePrivate {
  vendors: Record<Vendor, VendorState>;
  devices: DeviceReading[];
  feedCap: number;
  roborockConnected: boolean;
}

export interface HomePublic {
  vendors: Record<Vendor, VendorState>;
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
  return { roborock: pick(b.roborock), petlibro: pick(b.petlibro), whisker: pick(b.whisker) };
}

/** The public face, checked; null when it isn't one. */
export function readPublic(v: unknown): HomePublic | null {
  const b = o(v);
  if (!b.vendors || !Array.isArray(b.devices)) return null;
  const devices = b.devices
    .map(o)
    .filter((d) => KINDS.includes(d.kind as DeviceKind))
    .map((d) => ({ kind: d.kind as DeviceKind, state: short(d.state, 24), online: d.online === true }));
  return { vendors: vendorsOf(b.vendors), devices };
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
    water: num(d.water),
    filter: num(d.filter),
    drawer: num(d.drawer),
    litter: num(d.litter),
    lastUse: typeof d.lastUse === "string" ? d.lastUse : null,
    catInside: d.catInside === true,
  };
}

export function readPrivate(v: unknown): HomePrivate | null {
  const b = o(v);
  if (!b.vendors || !Array.isArray(b.devices)) return null;
  return {
    vendors: vendorsOf(b.vendors),
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
  act: (action: ActionId, device?: string, rooms?: string[]) => Promise<boolean>;
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
            set({ load: "live", view, pub: { vendors: view.vendors, devices: view.devices.map((d) => ({ kind: d.kind, state: d.state, online: d.online })) } });
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
  act: async (action, device, rooms) => {
    set({ busy: action, said: null });
    try {
      const res = await post(`${PATH}/action`, { action, ...(device ? { device } : {}), ...(rooms?.length ? { rooms } : {}) });
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
