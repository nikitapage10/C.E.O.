/**
 * The home devices together (#632): every vendor's devices in one list, and one way to act on them, with the safety
 * rails, Skippy's spoken confirmation and a turn in the Council (the "kernel" room's log, api/_skippy/log.ts) for every
 * action asked for, done or refused. Used by the Desk's Home card, the phone (/api/haven/devices with a phone key) and
 * Hey Skippy's capture ("feed the cat", "clean the kitchen").
 *
 * What it logs: which action and how it went ("home: feeder.feed done"), never a device's name, serial or anything a
 * vendor said.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../../_blob.js";
import type { RoomLog } from "../../_skippy/log.js";
import { FeedLedger, litterBlock } from "./rails.js";
import { joinRooms } from "./roborock.js";
import { ACTION_KIND, SPOKEN, VENDORS, type ActionId, type DeviceClient, type DeviceKind, type DeviceReading, type Found, type RunArgs, type Vendor } from "./types.js";

export type VendorState = "waiting" | "live" | "down";

export interface HomeView {
  vendors: Record<Vendor, VendorState>;
  devices: DeviceReading[];
  feedCap: number;
}

/** What the public may see: how many devices of each kind and each one's state, nothing else. */
export interface HomePublic {
  vendors: Record<Vendor, VendorState>;
  devices: { kind: DeviceKind; state: string; online: boolean }[];
}

export interface HomeDeps {
  blob: BlobBackend | null;
  clients: DeviceClient[];
  feedCap: number;
  council: RoomLog | null;
  log: (line: string) => void;
  now: () => number;
}

export type ActVia = "desk" | "phone";

export interface ActRequest {
  action: ActionId;
  /** A device's opaque id, when there is more than one of its kind. */
  device?: string;
  rooms?: string[];
  via: ActVia;
  /** The words as said (from the phone), for the Council; otherwise the button's label is used. */
  said?: string;
}

export type ActCode = "cap" | "cat" | "cycling" | "drawer" | "not-ready" | "offline" | "unknown-room" | "no-rooms" | "not-connected" | "no-device" | "vendor" | "unsupported";

export interface ActResult {
  ok: boolean;
  say: string;
  code?: ActCode;
}

const VENDOR_NAME: Record<Vendor, string> = { roborock: "Roborock", petlibro: "Petlibro", whisker: "Whisker" };

/** What the Council records as asked, for a tap on the Desk. */
export const LABEL: Record<ActionId, string> = {
  "vacuum.start": "Start the vacuum",
  "vacuum.pause": "Pause the vacuum",
  "vacuum.dock": "Send the vacuum back to its dock",
  "vacuum.rooms": "Clean rooms",
  "feeder.feed": "Feed one portion of dry food",
  "wet.open": "Open the wet food feeder",
  "litter.clean": "Run a litter clean cycle",
};

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Skippy's line for an action that went through. */
export function sayDone(action: ActionId, extra: { count?: number; cap?: number; rooms?: string[] } = {}): string {
  const ofCap = extra.count !== undefined && extra.cap !== undefined ? ` That's ${extra.count} of ${extra.cap} today.` : "";
  switch (action) {
    case "vacuum.start":
      return "The vacuum is off from the Hall to clean the whole place.";
    case "vacuum.pause":
      return "Paused the vacuum.";
    case "vacuum.dock":
      return "The vacuum is heading back to its dock in the Hall.";
    case "vacuum.rooms":
      return `The vacuum is off to clean the ${joinRooms(extra.rooms ?? [])}.`;
    case "feeder.feed":
      return `One portion is coming out of the dry food feeder.${ofCap}`;
    case "wet.open":
      return `The wet food feeder's lid is open.${ofCap}`;
    case "litter.clean":
      return "The Litter-Robot is running a clean cycle.";
  }
}

/** Skippy's line for an action that didn't go through. */
export function sayRefused(action: ActionId, code: ActCode, extra: { cap?: number; vendor?: Vendor; rooms?: string[] } = {}): string {
  const who = SPOKEN[ACTION_KIND[action]];
  const vendor = extra.vendor ? VENDOR_NAME[extra.vendor] : "That device";
  switch (code) {
    case "cap":
      return `That's already ${extra.cap ?? 0} manual ${extra.cap === 1 ? "feed" : "feeds"} from ${who} today. No more until tomorrow, monkey.`;
    case "cat":
      return "Not now: there's a cat in the Litter-Robot.";
    case "cycling":
      return "The Litter-Robot is already mid-cycle.";
    case "drawer":
      return "The Litter-Robot's drawer is full. Empty it first.";
    case "not-ready":
      return "The Litter-Robot isn't ready for a cycle right now.";
    case "offline":
      return `${cap1(who)} is offline.`;
    case "unknown-room":
      return `I couldn't match that to a room on the vacuum's map${extra.rooms?.length ? `. It knows the ${joinRooms(extra.rooms)}` : ""}.`;
    case "no-rooms":
      return "Which rooms? Say something like: clean the kitchen.";
    case "not-connected":
      return `${vendor} isn't connected yet. It's set up from the Desk.`;
    case "no-device":
      return `I can't find ${who} on the account.`;
    case "unsupported":
      return `${cap1(who)} can't do that.`;
    case "vendor":
      return `${vendor}'s cloud didn't take it. Try again in a bit.`;
  }
}

/** How long a status read is kept in this instance. */
export const STATUS_TTL_MS = 30_000;

export class Home {
  private cache: { at: number; view: HomeView } | null = null;
  constructor(private readonly deps: HomeDeps) {}

  /** Every vendor's devices; a vendor that isn't connected is "waiting", one that failed is "down". */
  async status(fresh = false): Promise<HomeView> {
    const now = this.deps.now();
    if (!fresh && this.cache && now - this.cache.at < STATUS_TTL_MS) return this.cache.view;
    const vendors = Object.fromEntries(VENDORS.map((v) => [v, "waiting"])) as Record<Vendor, VendorState>;
    const devices: DeviceReading[] = [];
    const counts = this.deps.blob ? await new FeedLedger(this.deps.blob).today(now).catch(() => ({}) as Record<string, number>) : {};
    await Promise.all(
      this.deps.clients.map(async (c) => {
        if (!(await c.connected().catch(() => false))) return;
        try {
          const found = await c.status();
          vendors[c.vendor] = "live";
          for (const f of found) devices.push(f.reading);
        } catch {
          vendors[c.vendor] = "down";
          this.deps.log(`home: ${c.vendor} status failed`);
        }
      }),
    );
    const order: DeviceKind[] = ["vacuum", "dry-feeder", "wet-feeder", "fountain", "litter"];
    devices.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const d of devices) {
      if (d.kind === "dry-feeder" || d.kind === "wet-feeder") {
        d.manualToday = counts[d.id] ?? 0;
        d.manualCap = this.deps.feedCap;
      }
    }
    const view = { vendors, devices, feedCap: this.deps.feedCap };
    this.cache = { at: now, view };
    return view;
  }

  /** The public face: counts and states only. */
  static publicOf(view: HomeView): HomePublic {
    return { vendors: view.vendors, devices: view.devices.map((d) => ({ kind: d.kind, state: d.state, online: d.online })) };
  }

  /** Runs one action through the rails, says how it went, and keeps it in the Council. */
  async act(req: ActRequest): Promise<ActResult> {
    const result = await this.attempt(req);
    this.cache = null;
    this.deps.log(`home: ${req.action} ${result.ok ? "done" : `refused (${result.code})`}`);
    if (this.deps.council) {
      const question = (req.said?.trim() || (req.action === "vacuum.rooms" && req.rooms?.length ? `Clean the ${joinRooms(req.rooms)}` : LABEL[req.action])).slice(0, 300);
      await this.deps.council
        .add({ at: new Date(this.deps.now()).toISOString(), question, answer: result.say, room: "kernel", model: "home", ...(req.via === "phone" && { via: "phone" as const }) }, this.deps.now())
        .catch(() => undefined);
    }
    return result;
  }

  private async attempt(req: ActRequest): Promise<ActResult> {
    const { action } = req;
    const kind = ACTION_KIND[action];
    const refuse = (code: ActCode, extra: Parameters<typeof sayRefused>[2] = {}): ActResult => ({ ok: false, code, say: sayRefused(action, code, extra) });
    if (action === "vacuum.rooms" && !(req.rooms ?? []).some((r) => r.trim())) return refuse("no-rooms");
    const client = this.deps.clients.find((c) => c.actions.includes(action));
    if (!client) return refuse("unsupported");
    const vendor = client.vendor;
    if (!(await client.connected().catch(() => false))) return refuse("not-connected", { vendor });
    let found: Found[];
    try {
      found = await client.status();
    } catch {
      return refuse("vendor", { vendor });
    }
    const mine = found.filter((f) => f.reading.kind === kind);
    const target = req.device ? mine.find((f) => f.reading.id === req.device) : mine[0];
    if (!target) return refuse("no-device", { vendor });
    const r = target.reading;
    if (!r.online) return refuse("offline", { vendor });

    // The litter gate: only when the robot says it is ready.
    if (action === "litter.clean") {
      const block = litterBlock(r);
      if (block) return refuse(block === "offline" ? "offline" : block, { vendor });
    }

    // The feed cap, per feeder, reserved before the vendor is called.
    const feeding = action === "feeder.feed" || action === "wet.open";
    const ledger = feeding && this.deps.blob ? new FeedLedger(this.deps.blob) : null;
    let count: number | undefined;
    if (feeding) {
      if (!ledger) return refuse("vendor", { vendor });
      const got = await ledger.reserve(r.id, this.deps.feedCap, this.deps.now());
      if (!got.ok) return refuse("cap", { cap: this.deps.feedCap });
      count = got.count;
    }

    const args: RunArgs = action === "vacuum.rooms" ? { rooms: req.rooms } : {};
    const ran = await client.run(action, target, args).catch(() => ({ ok: false as const, code: "vendor" as const }));
    if (!ran.ok) {
      if (ledger) await ledger.release(r.id, this.deps.now()).catch(() => undefined);
      if (ran.code === "unknown-room") return refuse("unknown-room", { rooms: r.rooms });
      return refuse(ran.code, { vendor });
    }
    return { ok: true, say: ran.say ?? sayDone(action, { count, cap: this.deps.feedCap }) };
  }
}
