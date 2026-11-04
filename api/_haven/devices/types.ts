/**
 * Nikita's home devices (#632, docs/HOME-DEVICES.md): the common shape every vendor client fills in, so the routes,
 * the safety rails, the Council log and the Desk never need to know whose cloud a device lives on.
 *
 *   Roborock Qrevo (vacuum)          api/_haven/devices/roborock.ts   email code login, then the cloud MQTT
 *   Petlibro dry and wet feeders,    api/_haven/devices/petlibro.ts   REST with a login token
 *     and the water fountain
 *   Whisker Litter-Robot 5 Pro       api/_haven/devices/whisker.ts    Cognito (SRP) login, then the LR5 REST API
 *
 * A client hands back readings (what the Desk shows) and refs (what it needs to act: a serial, a duid, a local key).
 * Refs never leave the server: a reading carries an opaque id made from the serial with a keyed hash, never the serial.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export const VENDORS = ["roborock", "petlibro", "whisker"] as const;
export type Vendor = (typeof VENDORS)[number];
export const isVendor = (v: unknown): v is Vendor => typeof v === "string" && (VENDORS as readonly string[]).includes(v);

export type DeviceKind = "vacuum" | "dry-feeder" | "wet-feeder" | "fountain" | "litter";

/** Every action there is. Each client lists the ones its devices take. */
export const ACTIONS = ["vacuum.start", "vacuum.pause", "vacuum.dock", "vacuum.rooms", "feeder.feed", "wet.open", "litter.clean"] as const;
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
  "litter.clean": "litter",
};

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
  /** Fountain: water level and filter life, in percent. */
  water?: number | null;
  filter?: number | null;
  /** Litter-Robot: waste drawer and litter level in percent, and the last time a cat used it. */
  drawer?: number | null;
  litter?: number | null;
  lastUse?: string | null;
  catInside?: boolean;
}

/** A device found by a client: the reading and what the client keeps to act on it (never sent anywhere). */
export interface Found<R = unknown> {
  reading: DeviceReading;
  ref: R;
}

/** What a vendor call came to. `say` is Skippy's line when it worked. */
export type RunResult = { ok: true; say?: string } | { ok: false; code: RunError };
export type RunError = "vendor" | "offline" | "not-connected" | "unknown-room" | "unsupported";

export interface RunArgs {
  /** For vacuum.rooms: the room names asked for, as said or tapped. */
  rooms?: string[];
}

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
}

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
};

/** What a device is called when Skippy speaks about it: never its own name from the app. */
export const SPOKEN: Record<DeviceKind, string> = {
  vacuum: "the vacuum",
  "dry-feeder": "the dry food feeder",
  "wet-feeder": "the wet food feeder",
  fountain: "the fountain",
  litter: "the Litter-Robot",
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
