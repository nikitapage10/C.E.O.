/**
 * Nikita's home devices (#632, docs/HOME-DEVICES.md): the common shape every vendor client fills in, so the routes,
 * the safety rails, the Council log and the Desk never need to know whose cloud a device lives on.
 *
 *   Roborock Qrevo (vacuum)          api/_haven/devices/roborock.ts   email code login, then the cloud MQTT
 *   Petlibro dry and wet feeders,    api/_haven/devices/petlibro.ts   REST with a login token
 *     and the water fountain
 *   Whisker Litter-Robot 5 Pro       api/_haven/devices/whisker.ts    Cognito (SRP) login, then the LR5 REST API
 *   Google Nest thermostat           api/_haven/google/nest.ts        Google OAuth (Connect Nest), then the Smart
 *                                                                     Device Management API (#637)
 *
 * A client hands back readings (what the Desk shows) and refs (what it needs to act: a serial, a duid, a local key).
 * Refs never leave the server: a reading carries an opaque id made from the serial with a keyed hash, never the serial.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export const VENDORS = ["roborock", "petlibro", "whisker", "nest"] as const;
export type Vendor = (typeof VENDORS)[number];
export const isVendor = (v: unknown): v is Vendor => typeof v === "string" && (VENDORS as readonly string[]).includes(v);

export type DeviceKind = "vacuum" | "dry-feeder" | "wet-feeder" | "fountain" | "litter" | "thermostat";

/** Every action there is. Each client lists the ones its devices take. */
export const ACTIONS = ["vacuum.start", "vacuum.pause", "vacuum.dock", "vacuum.rooms", "feeder.feed", "wet.open", "wet.rotate", "wet.close", "wet.status", "litter.clean", "thermostat.set", "thermostat.mode"] as const;
export type ActionId = (typeof ACTIONS)[number];
export const isAction = (v: unknown): v is ActionId => typeof v === "string" && (ACTIONS as readonly string[]).includes(v);

/** Which kind of device each action is for. */
export const ACTION_KIND: Record<ActionId, DeviceKind> = {
  "vacuum.start": "vacuum",
  "vacuum.pause": "vacuum",
  "vacuum.dock": "vacuum",
  "vacuum.rooms": "vacuum",
  "feeder.feed": "dry-feeder",
  "wet.open": "wet-feeder",
  "wet.rotate": "wet-feeder",
  "wet.close": "wet-feeder",
  "wet.status": "wet-feeder",
  "litter.clean": "litter",
  "thermostat.set": "thermostat",
  "thermostat.mode": "thermostat",
};

/** The thermostat's modes, as the Desk and the rails name them (Nest's HEAT, COOL, HEATCOOL, OFF). */
export const THERMO_MODES = ["heat", "cool", "heatcool", "off"] as const;
export type ThermoMode = (typeof THERMO_MODES)[number];
export const isThermoMode = (v: unknown): v is ThermoMode => typeof v === "string" && (THERMO_MODES as readonly string[]).includes(v);

/** One device as the signed-in Desk sees it. Plain values only; no serial, no account detail. */
export interface DeviceReading {
  /** Opaque, stable: a keyed hash of the vendor and serial (`deviceId`). */
  id: string;
  vendor: Vendor;
  kind: DeviceKind;
  /** The product, e.g. "Litter-Robot 5 Pro" (from the vendor's own model field). Private. */
  model: string;
  /** Where it stands in the home (PLACES). Private. */
  place: string;
  online: boolean;
  /** A short state word: docked, cleaning, paused, returning, ready, cycling, cat-inside, feeding, idle, offline… */
  state: string;
  /** Battery percent, when the device has one. */
  battery?: number | null;
  /** Short fixed phrases ("bin full", "water tank empty"), never free text from the vendor. */
  alerts: string[];
  /** The vacuum's named rooms (from its map and the app's names). */
  rooms?: string[];
  /** Feeders. */
  foodLow?: boolean;
  lastFed?: string | null;
  /** Manual portions (dry) or openings (wet) given from here today, and the day's cap. */
  manualToday?: number;
  manualCap?: number;
  /** Wet feeder: which bowl of the tray's three is in front (1 to 3), when Petlibro says. */
  plate?: number;
  /** Wet feeder: its schedule from the Petlibro app, each meal's Mountain time ("18:00") and bowl when the plan says,
   * and (#685) when its window closes and where it stands today. */
  meals?: WetMeal[];
  /** Wet feeder (#713): when the lid opened from here closes itself (ISO), while it is open and the auto-close stands. */
  closesAt?: string;
  /** Fountain: water level and filter life, in percent. */
  water?: number | null;
  filter?: number | null;
  /** Fountain (#685): days until the filter change and the clean are due, below 0 when overdue. */
  filterDays?: number;
  cleanDays?: number;
  /** Fountain (#685): water drunk today, in mL. */
  drankMl?: number;
  /** Today's visits (#685): drinks at the fountain, or the wet feeder's eating visits, with their total and average
   * length in seconds. Each only when Petlibro says. */
  visits?: number;
  visitSec?: number;
  avgSec?: number;
  /** Dry feeder (#685): portions dispensed today (a Granary portion is 1/12 cup), how many dispenses, the unit the
   * Petlibro app shows amounts in, and today's schedule. */
  fedPortions?: number;
  feeds?: number;
  feedUnit?: FeedUnit;
  plan?: DryMeal[];
  /** Litter-Robot: waste drawer and litter level in percent, and the last time a cat used it. */
  drawer?: number | null;
  litter?: number | null;
  lastUse?: string | null;
  catInside?: boolean;
  /** Thermostat (#637): the room's temperature (°F, whole), humidity (%), mode, the modes it offers, eco, what the
   * HVAC is doing now, and the set points (°F, whole; heat in heat mode, cool in cool mode, both in heatcool). */
  tempF?: number | null;
  humidity?: number | null;
  mode?: ThermoMode;
  modes?: ThermoMode[];
  eco?: boolean;
  hvac?: "heating" | "cooling" | "off";
  heatF?: number | null;
  coolF?: number | null;
  /** The vendor's cloud didn't answer this read (rate limited, or its own trouble), so this is its last good reading. */
  stale?: true;
}

/** A device found by a client: the reading and what the client keeps to act on it (never sent anywhere). */
export interface Found<R = unknown> {
  reading: DeviceReading;
  ref: R;
}

/** What a vendor call came to. `say` is Skippy's line when it worked; `feedId` the wet feeder's opening (#713). */
export type RunResult = { ok: true; say?: string; feedId?: number | string } | { ok: false; code: RunError };
export type RunError = "vendor" | "offline" | "not-connected" | "unknown-room" | "unsupported" | "eco";

export interface RunArgs {
  /** For vacuum.rooms: the room names asked for, as said or tapped. */
  rooms?: string[];
  /** For thermostat.set (#637): the set points in °F, already through the rails (60 to 80). */
  heatF?: number;
  coolF?: number;
  /** For thermostat.mode: the mode asked for, one the thermostat offers. */
  mode?: ThermoMode;
  /** For feeder.feed: how many portions, already through the feed cap (1 when not given). */
  portions?: number;
  /** For wet.rotate: how many bowls to turn the tray on (1 or 2: a Polar tray holds three). */
  steps?: number;
  /** For wet.close (#713): the opening kept from wet.open, used when the feeder no longer reports which one is open. */
  feedId?: number | string;
  /** For vacuum.start and vacuum.rooms: an optional suction and mop choice; without one the vacuum keeps its own. */
  suction?: Suction;
  water?: Water;
}

/** The vacuum's optional mode words (#637 scope): "quiet" or "max" suction; "vacuum only" (mop off) or "mop too". */
export const SUCTIONS = ["quiet", "max"] as const;
export type Suction = (typeof SUCTIONS)[number];
export const WATERS = ["off", "on"] as const;
export type Water = (typeof WATERS)[number];
export const isSuction = (v: unknown): v is Suction => typeof v === "string" && (SUCTIONS as readonly string[]).includes(v);
export const isWater = (v: unknown): v is Water => typeof v === "string" && (WATERS as readonly string[]).includes(v);

/** One scheduled wet meal: its time of day ("HH:MM", Mountain) and the bowl the plan gives it, when it says; (#685)
 * when its window closes and where it stands today. */
export interface WetMeal {
  time: string;
  plate?: number;
  end?: string;
  status?: MealStatus;
}

/**
 * Where a meal on today's plan stands (#685): served, open now (a wet meal's window), the next one to come, later
 * today, skipped, or set to be skipped. Read from Petlibro's own state where it gives one, else from the clock.
 */
export const MEAL_STATUSES = ["done", "now", "next", "later", "skipped", "skip"] as const;
export type MealStatus = (typeof MEAL_STATUSES)[number];

/** One meal on the dry feeder's plan for today (#685): its time, portions, whether it's switched on, and its status. */
export interface DryMeal {
  time: string;
  portions?: number;
  on: boolean;
  status?: MealStatus;
}

/** The unit the Petlibro app shows feed amounts in (realInfo.unitType: 1 cups, 2 oz, 3 g, 4 mL). */
export const FEED_UNITS = ["cup", "oz", "g", "ml"] as const;
export type FeedUnit = (typeof FEED_UNITS)[number];

/** One vendor's client behind the common interface. */
export interface DeviceClient<R = unknown> {
  vendor: Vendor;
  /** Whether its login is in place (keys set, or the connect flow done). */
  connected(): Promise<boolean>;
  /** Every device on the account, read fresh (each client keeps its own short cache). */
  status(): Promise<Found<R>[]>;
  /** The actions its devices take. */
  actions: readonly ActionId[];
  /** Runs one action on one of its devices. The rails (api/_haven/devices/rails.ts) have already said yes. */
  run(action: ActionId, found: Found<R>, args: RunArgs): Promise<RunResult>;
  /** Why its last read failed, when it can tell (#672): shown to a signed-in Desk only, never the vendor's own words. */
  problem?(): VendorProblem | null;
  /** The reading as a command that went through leaves it, when the client can tell without asking again: the Home
   * serves it for a short while instead of reading the vendor straight after (whose quota a read would spend). */
  settle?(action: ActionId, reading: DeviceReading, args: RunArgs): DeviceReading | null;
}

/**
 * Why a vendor reads "down" (#672), in fixed words only: no such account at the vendor, the sign-in refused (the
 * password changed, or the account signs in with Apple or Google and has no password), signed out by another
 * sign-in on the same account (Petlibro keeps one session, so the phone app signing in ends ours), the vendor's
 * cloud unreachable, or any other refusal. Passkey views only; the public face keeps the state alone.
 */
export const VENDOR_PROBLEMS = ["no-account", "refused", "signed-out", "unreachable", "vendor"] as const;
export type VendorProblem = (typeof VENDOR_PROBLEMS)[number];

/**
 * Where each device stands (Nikita, 2026-11-04): private metadata, shown only to a signed-in Desk and used for the
 * spoken lines. The Roborock's dock is in the Hall, the Petlibro feeders and fountain in the kitchen and dining area,
 * the Litter-Robot in the Corridor by the Studio.
 */
export const PLACES: Record<DeviceKind, string> = {
  vacuum: "Hall",
  "dry-feeder": "Kitchen",
  "wet-feeder": "Kitchen",
  fountain: "Kitchen",
  litter: "Corridor",
  thermostat: "Home",
};

/** What a device is called when Skippy speaks about it: never its own name from the app. */
export const SPOKEN: Record<DeviceKind, string> = {
  vacuum: "the vacuum",
  "dry-feeder": "the dry food feeder",
  "wet-feeder": "the wet food feeder",
  fountain: "the fountain",
  litter: "the Litter-Robot",
  thermostat: "the thermostat",
};

/** A whole number from 0 to 100, or null. */
export function pct(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

/** An ISO time from seconds or milliseconds since 1970, or an ISO string; null otherwise. */
export function isoOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

/** An object's field as an object, or {} (vendor answers are untyped JSON). */
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
