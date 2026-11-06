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
import { clockAt, clockWords, closeAtFor, CLOSE_GIVE_UP_MS, FeedLedger, litterBlock, mealInWindow, PLATES, portionsOf, PORTIONS_MAX, rotateSteps, TrayLog, traySummary, trayWarning, THERMO_MAX_F, THERMO_MIN_F, thermostatPlan, WetCloseNote } from "./rails.js";
import { wetNextWords } from "./schedule.js";
import { VendorError } from "./http.js";
import { keepLines } from "./homeread.js";
import { joinRooms } from "./roborock.js";
import { ACTION_KIND, isSuction, isWater, SPOKEN, VENDORS, type ActionId, type DeviceClient, type DeviceKind, type DeviceReading, type Found, type RunArgs, type Vendor, type VendorProblem } from "./types.js";

export type VendorState = "waiting" | "live" | "down";

export interface HomeView {
  vendors: Record<Vendor, VendorState>;
  /** Why each "down" vendor is down, in fixed words (#672). Passkey views only: publicOf leaves it out. */
  problems: Partial<Record<Vendor, VendorProblem>>;
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
  /** The thermostat (#637): one set point, or heat and cool for heatcool, in °F; or the mode. Checked by the rails. */
  tempF?: unknown;
  heatF?: unknown;
  coolF?: unknown;
  mode?: unknown;
  /** feeder.feed: how many dry portions (1 when not given), each one counted against the feed cap. */
  portions?: unknown;
  /** wet.rotate: which bowl (1 to 3) to bring to the front; without one, the next bowl. */
  plate?: unknown;
  /** vacuum.start and vacuum.rooms: an optional suction ("quiet", "max") and mop ("off", "on") choice. */
  suction?: unknown;
  water?: unknown;
}

export type ActCode =
  | "cap"
  | "cat"
  | "cycling"
  | "drawer"
  | "not-ready"
  | "offline"
  | "unknown-room"
  | "no-rooms"
  | "not-connected"
  | "no-device"
  | "vendor"
  | "unsupported"
  // The thermostat's rails (#637, rails.ts).
  | "range"
  | "eco"
  | "mode-off"
  | "no-setpoint"
  | "gap"
  | "bad-mode"
  // The feeders' asks (#637 scope): too many portions in one go, a bowl that isn't 1 to 3.
  | "bad-portions"
  | "bad-plate"
  | "lid-open";

export interface ActResult {
  ok: boolean;
  say: string;
  code?: ActCode;
  /** True when the done line carries a warning (the wet tray's), so a phone should say it aloud (#652). */
  warned?: true;
}

const VENDOR_NAME: Record<Vendor, string> = { roborock: "Roborock", petlibro: "Petlibro", whisker: "Whisker", nest: "Google Nest" };

/** What the Council records as asked, for a tap on the Desk. */
export const LABEL: Record<ActionId, string> = {
  "vacuum.start": "Start the vacuum",
  "vacuum.pause": "Pause the vacuum",
  "vacuum.dock": "Send the vacuum back to its dock",
  "vacuum.rooms": "Clean rooms",
  "feeder.feed": "Feed one portion of dry food",
  "wet.open": "Open the wet food feeder",
  "wet.rotate": "Turn the wet food feeder to the next bowl",
  "wet.close": "Close the wet food feeder's lid",
  "wet.status": "What's in the wet food feeder",
  "litter.clean": "Run a litter clean cycle",
  "thermostat.set": "Set the thermostat",
  "thermostat.mode": "Change the thermostat's mode",
};

const MODE_WORD: Record<string, string> = { heat: "heat", cool: "cool", heatcool: "heat and cool", off: "off" };

/** The thermostat's change in words, for the Council and Skippy's line: "heat to 68°F", "between 66°F and 74°F". */
export function thermoWords(args: { heatF?: number; coolF?: number; mode?: string }): string {
  if (args.mode) return `mode ${MODE_WORD[args.mode] ?? args.mode}`;
  if (args.heatF !== undefined && args.coolF !== undefined) return `between ${args.heatF}°F and ${args.coolF}°F`;
  if (args.heatF !== undefined) return `heat to ${args.heatF}°F`;
  if (args.coolF !== undefined) return `cool to ${args.coolF}°F`;
  return "no change";
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the Council records as asked of the thermostat, from the request as it came (before the rails). */
export function thermoAsked(req: Pick<ActRequest, "action" | "tempF" | "heatF" | "coolF" | "mode">): string | undefined {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
  if (req.action === "thermostat.mode") return typeof req.mode === "string" && /^[a-z]{2,12}$/i.test(req.mode) ? `Set the thermostat to ${thermoWords({ mode: req.mode.toLowerCase() })}` : undefined;
  if (req.action !== "thermostat.set") return undefined;
  const one = n(req.tempF);
  if (one !== undefined) return `Set the thermostat to ${one}°F`;
  const heatF = n(req.heatF);
  const coolF = n(req.coolF);
  return heatF !== undefined || coolF !== undefined ? `Set the thermostat to ${thermoWords({ heatF, coolF })}` : undefined;
}

/** What the Council records as asked for a tap: the button's label, with the rooms, portions, bowl or mode in it. */
export function tapAsked(req: Pick<ActRequest, "action" | "rooms" | "portions" | "plate" | "suction" | "water">): string {
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
  const how = [isSuction(req.suction) ? `on ${req.suction}` : "", req.water === "off" ? "vacuum only" : req.water === "on" ? "with the mop" : ""].filter(Boolean).join(", ");
  const tail = how ? ` (${how})` : "";
  if (req.action === "vacuum.rooms" && req.rooms?.length) return `Clean the ${joinRooms(req.rooms)}${tail}`;
  if (req.action === "vacuum.start") return `${LABEL[req.action]}${tail}`;
  const portions = n(req.portions);
  if (req.action === "feeder.feed" && portions && portions > 1) return `Feed ${portions} portions of dry food`;
  const plate = n(req.plate);
  if (req.action === "wet.rotate" && plate) return `Turn the wet food feeder to bowl ${plate}`;
  return LABEL[req.action];
}

/** Skippy's line for an action that went through. */
export function sayDone(action: ActionId, extra: { count?: number; cap?: number; rooms?: string[]; heatF?: number; coolF?: number; mode?: string; portions?: number; plate?: number; closing?: string } = {}): string {
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
      return `${extra.portions && extra.portions > 1 ? `${extra.portions} portions are` : "One portion is"} coming out of the dry food feeder.${ofCap}`;
    case "wet.open":
      return `The wet food feeder's lid is open.${extra.closing ?? ""}${ofCap}`;
    case "wet.rotate":
      return `${extra.plate ? `Bowl ${extra.plate}` : "The next bowl"} is turning to the front of the wet food feeder.`;
    case "wet.close":
      return "The wet food feeder's lid is closing.";
    case "wet.status":
      return "Here's the wet food feeder.";
    case "litter.clean":
      return "The Litter-Robot is running a clean cycle.";
    case "thermostat.set":
      return `The thermostat is set to ${thermoWords(extra)}.`;
    case "thermostat.mode":
      return extra.mode === "off" ? "The thermostat is off." : `The thermostat is on ${MODE_WORD[extra.mode ?? ""] ?? extra.mode}.`;
  }
}

/** Skippy's line for an action that didn't go through. */
export function sayRefused(action: ActionId, code: ActCode, extra: { cap?: number; vendor?: Vendor; rooms?: string[]; left?: number; asked?: number } = {}): string {
  const who = SPOKEN[ACTION_KIND[action]];
  const vendor = extra.vendor ? VENDOR_NAME[extra.vendor] : "That device";
  switch (code) {
    case "cap":
      if (extra.asked !== undefined && extra.asked > 1 && extra.left !== undefined && extra.left > 0) {
        return `That's ${extra.asked} portions, and only ${extra.left} ${extra.left === 1 ? "is" : "are"} left of today's ${extra.cap ?? 0}. Ask for ${extra.left} or fewer.`;
      }
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
    case "range":
      return `I keep the thermostat between ${THERMO_MIN_F}°F and ${THERMO_MAX_F}°F.`;
    case "eco":
      return "The thermostat is in eco mode. Switch eco off in the Home app first.";
    case "mode-off":
      return "The thermostat is off. Pick heat or cool first.";
    case "no-setpoint":
      return "What temperature? Give me a number.";
    case "gap":
      return "Keep the cool point at least 3°F above the heat point.";
    case "bad-mode":
      return "The thermostat doesn't have that mode.";
    case "bad-portions":
      return `I give 1 to ${PORTIONS_MAX} portions at a time.`;
    case "lid-open":
      if (action === "wet.open") return "The wet food feeder's lid is already open, from its schedule or the Petlibro app, so I'll leave it to them.";
      return "The wet food feeder's lid is open. Say close the wet feeder first, then switch bowls.";
    case "bad-plate":
      return "The wet food feeder has bowls 1, 2 and 3, and I can't tell which one is in front right now.";
  }
}

/** The line when a scheduled meal opens inside the two hours (#713): the schedule wins and the auto-close stands down. */
const scheduleWins = (time: string) => ` The ${clockWords(time)} scheduled meal comes up within two hours, so I'll leave the closing to the schedule.`;

/** What the auto-close's tick came to (#713), for the timer's log: nothing due, not yet, shut, stood down, or retrying. */
export type CloseTick = "idle" | "waiting" | "closed" | "dropped" | "retry";

/** How long a status read is kept in this instance. */
export const STATUS_TTL_MS = 30_000;
/** How long after a command its vendor's reading is taken as the command left it (DeviceClient.settle), without
 * asking the vendor again: the read straight after a change is what spends a quota like Google SDM's. */
export const SETTLE_MS = 20_000;
/** How long a vendor's last good reading stands in, marked stale, while its cloud says slow down or doesn't answer. */
export const STALE_MAX_MS = 10 * 60_000;

/** A read that failed in passing (rate limited, the vendor's own 5xx, no answer), not a refused or missing login. */
export const passing = (e: unknown): boolean => e instanceof VendorError && (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500);

interface LastGood {
  /** When it was read (or settled). */
  at: number;
  found: Found[];
  /** Until when it is served without asking the vendor (after a command; 0 otherwise). */
  hold: number;
}

export class Home {
  private cache: { at: number; view: HomeView } | null = null;
  /** The read under way, shared by every caller at once (the Desk, the public status, Systems). */
  private pending: Promise<HomeView> | null = null;
  /** Bumped by every action, so a read begun before it never caches a view from before it. */
  private gen = 0;
  /** Each vendor's last good reading. */
  private readonly last = new Map<Vendor, LastGood>();
  constructor(private readonly deps: HomeDeps) {}

  /** Every vendor's devices; a vendor that isn't connected is "waiting", one that failed is "down". */
  async status(fresh = false): Promise<HomeView> {
    const now = this.deps.now();
    if (!fresh && this.cache && now - this.cache.at < STATUS_TTL_MS) return this.cache.view;
    if (this.pending) return this.pending;
    const going = this.readAll(now).finally(() => {
      if (this.pending === going) this.pending = null;
    });
    this.pending = going;
    return going;
  }

  /** One vendor's devices: held after a command, else read, else (a passing failure) its last good reading, stale. */
  private async read(c: DeviceClient, now: number): Promise<{ found: Found[]; stale: boolean }> {
    const last = this.last.get(c.vendor);
    if (last && now < last.hold) return { found: last.found, stale: false };
    try {
      const found = await c.status();
      const cur = this.last.get(c.vendor);
      if (!cur || cur.at <= now) this.last.set(c.vendor, { at: now, found, hold: 0 });
      return { found, stale: false };
    } catch (e) {
      if (last && passing(e) && !c.problem?.() && now - last.at < STALE_MAX_MS) return { found: last.found, stale: true };
      throw e;
    }
  }

  private async readAll(now: number): Promise<HomeView> {
    const gen = this.gen;
    const vendors = Object.fromEntries(VENDORS.map((v) => [v, "waiting"])) as Record<Vendor, VendorState>;
    const problems: Partial<Record<Vendor, VendorProblem>> = {};
    const devices: DeviceReading[] = [];
    const counts = this.deps.blob ? await new FeedLedger(this.deps.blob).today(now).catch(() => ({}) as Record<string, number>) : {};
    await Promise.all(
      this.deps.clients.map(async (c) => {
        if (!(await c.connected().catch(() => false))) return;
        try {
          const { found, stale } = await this.read(c, now);
          vendors[c.vendor] = "live";
          for (const f of found) devices.push({ ...f.reading, ...(stale && { stale: true as const }) });
          if (stale) this.deps.log(`home: ${c.vendor} status kept from the last good read`);
        } catch (e) {
          vendors[c.vendor] = "down";
          const why = c.problem?.() ?? (e instanceof VendorError && e.status === 0 ? "unreachable" : "vendor");
          problems[c.vendor] = why;
          this.deps.log(`home: ${c.vendor} status failed (${why})`);
        }
      }),
    );
    const order: DeviceKind[] = ["thermostat", "vacuum", "dry-feeder", "wet-feeder", "fountain", "litter"];
    devices.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const d of devices) {
      if (d.kind === "dry-feeder" || d.kind === "wet-feeder") {
        d.manualToday = counts[d.id] ?? 0;
        d.manualCap = this.deps.feedCap;
      }
    }
    // The wet tray's auto-close (#713): when an opening from here shuts, while it is still open.
    if (this.deps.blob && devices.some((d) => d.kind === "wet-feeder" && d.state === "lid open")) {
      const due = await new WetCloseNote(this.deps.blob).read().catch(() => null);
      const d = due && devices.find((x) => x.id === due.id && x.state === "lid open");
      if (d && due) d.closesAt = new Date(due.closeAt).toISOString();
    }
    // The wet tray's notes (rails.ts): bowls served from here today, and a heads-up when the next meal's bowl isn't
    // the one in front, so the card can draw the three bowls without asking.
    const wets = devices.filter((d) => d.kind === "wet-feeder" && d.online);
    if (this.deps.blob && wets.length) {
      const t = await new TrayLog(this.deps.blob).read(now).catch(() => null);
      for (const d of wets) {
        if (t?.served.length) d.served = [...t.served];
        const heads = trayWarning(d.plate ?? t?.front ?? null, t ?? { day: "", front: null, served: [] }, d.meals, now).trim();
        if (heads) d.heads = heads;
      }
    }
    const view = { vendors, problems, devices, feedCap: this.deps.feedCap };
    if (gen === this.gen) this.cache = { at: now, view };
    // Skippy's instant read (#926, homeread.ts): the last good lines kept, at most once a minute.
    if (this.deps.blob && Object.values(vendors).includes("live")) void keepLines(this.deps.blob, view, now);
    return view;
  }

  /** The public face: counts and states only. */
  static publicOf(view: HomeView): HomePublic {
    return { vendors: view.vendors, devices: view.devices.map((d) => ({ kind: d.kind, state: d.state, online: d.online })) };
  }

  /** Runs one action through the rails, says how it went, and keeps it in the Council. */
  async act(req: ActRequest): Promise<ActResult> {
    this.gen++;
    const result = await this.attempt(req);
    const asked = thermoAsked(req);
    this.gen++;
    this.cache = null;
    this.deps.log(`home: ${req.action} ${result.ok ? "done" : `refused (${result.code})`}`);
    if (this.deps.council) {
      const question = (req.said?.trim() || asked || tapAsked(req)).slice(0, 300);
      await this.deps.council
        .add({ at: new Date(this.deps.now()).toISOString(), question, answer: result.say, room: "kernel", model: "home", ...(req.via === "phone" && { via: "phone" as const }) }, this.deps.now())
        .catch(() => undefined);
    }
    return result;
  }

  /** Notes the opening's auto-close and says when, or that the schedule takes it (#713). */
  private async planClose(closer: WetCloseNote, r: DeviceReading, feedId: number | string | undefined): Promise<string> {
    const now = this.deps.now();
    const closeAt = closeAtFor(now);
    const meal = mealInWindow(r.meals, now, closeAt);
    try {
      if (meal) {
        await closer.clear(r.id);
        return scheduleWins(meal.time);
      }
      await closer.set({ id: r.id, ...(feedId !== undefined && { feedId }), from: now, closeAt });
      return ` It closes at ${clockAt(closeAt)}.`;
    } catch {
      return " I couldn't set it to close by itself, so close it when the cat's done.";
    }
  }

  /**
   * The auto-close's tick (#713), from the Function timer: when an opening from here is due, closes it, unless it is
   * already shut or a scheduled meal opened inside its window (the schedule wins). A close that can't get through is
   * tried on the next beats for an hour, then dropped. Every close is kept in the Council. Logs the outcome only.
   */
  async closeDue(): Promise<CloseTick> {
    const blob = this.deps.blob;
    if (!blob) return "idle";
    const note = new WetCloseNote(blob);
    const due = await note.read();
    const now = this.deps.now();
    if (!due) return "idle";
    if (due.closeAt > now) return "waiting";
    const drop = async (why: string): Promise<CloseTick> => {
      await note.clear(due.id, due.closeAt);
      this.deps.log(`home: wet auto-close stood down (${why})`);
      return "dropped";
    };
    const retry = async (why: string): Promise<CloseTick> => {
      if (now - due.closeAt > CLOSE_GIVE_UP_MS) return drop(`gave up: ${why}`);
      this.deps.log(`home: wet auto-close retrying (${why})`);
      return "retry";
    };
    const client = this.deps.clients.find((c) => c.actions.includes("wet.close"));
    if (!client || !(await client.connected().catch(() => false))) return retry("not connected");
    let found: Found[];
    try {
      found = await client.status();
    } catch {
      return retry("vendor");
    }
    const target = found.find((f) => f.reading.id === due.id);
    if (!target) return drop("no device");
    const r = target.reading;
    if (!r.online) return retry("offline");
    if (r.state !== "lid open") return drop("already closed");
    if (mealInWindow(r.meals, due.from, now)) return drop("schedule");
    const ran = await client.run("wet.close", target, due.feedId !== undefined ? { feedId: due.feedId } : {}).catch(() => ({ ok: false as const, code: "vendor" as const }));
    if (!ran.ok) return retry(ran.code);
    await note.clear(due.id, due.closeAt);
    this.gen++;
    this.cache = null;
    this.last.delete(client.vendor);
    this.deps.log("home: wet.close done (auto-close)");
    if (this.deps.council) {
      const at = this.deps.now();
      await this.deps.council
        .add({ at: new Date(at).toISOString(), question: "Close the wet food feeder after its two hours", answer: "The wet food feeder's lid is closing: its two hours are up.", room: "kernel", model: "home" }, at)
        .catch(() => undefined);
    }
    return "closed";
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
    // Straight after a command, the reading it left (SETTLE_MS) serves the rails, so a run of steps costs Google one
    // command each and no reads; otherwise a fresh read, kept as the vendor's last good one.
    let found: Found[];
    const held = this.last.get(vendor);
    const started = this.deps.now();
    if (held && started < held.hold) found = held.found;
    else {
      try {
        found = await client.status();
      } catch {
        return refuse("vendor", { vendor });
      }
      this.last.set(vendor, { at: started, found, hold: 0 });
    }
    const mine = found.filter((f) => f.reading.kind === kind);
    const target = req.device ? mine.find((f) => f.reading.id === req.device) : mine[0];
    if (!target) return refuse("no-device", { vendor });
    const r = target.reading;
    if (!r.online) return refuse("offline", { vendor });

    // The thermostat's rails (#637): 60 to 80 °F, the modes it offers, nothing in eco or while it's off.
    let thermo: RunArgs | null = null;
    if (kind === "thermostat") {
      const plan = thermostatPlan(r, action, { tempF: req.tempF, heatF: req.heatF, coolF: req.coolF, mode: req.mode });
      if (!plan.ok) return refuse(plan.code, { vendor });
      thermo = plan.args;
    }

    // The litter gate: only when the robot says it is ready.
    if (action === "litter.clean") {
      const block = litterBlock(r);
      if (block) return refuse(block === "offline" ? "offline" : block, { vendor });
    }

    // How many dry portions (each one counts against the cap), and how far the wet tray turns.
    let portions = 1;
    if (action === "feeder.feed") {
      const n = portionsOf(req.portions);
      if (n === null) return refuse("bad-portions", { vendor });
      portions = n;
    }
    // The wet tray (rails.ts): what's in it, in words; no turn while the lid is open.
    const tray = kind === "wet-feeder" && this.deps.blob ? new TrayLog(this.deps.blob) : null;
    if (action === "wet.status") {
      const t = tray ? await tray.read(this.deps.now()).catch(() => null) : null;
      // The next meal first (#952: "when is the next wet food cycle?"), then the tray.
      return { ok: true, say: `${wetNextWords(r)} ${traySummary(r, t ?? { day: "", front: null, served: [] }, this.deps.now(), false)}`.trim() };
    }
    if (action === "wet.rotate" && r.state === "lid open") return refuse("lid-open", { vendor });
    // The auto-close (#713): asked to open while an opening from here is still open, the two hours start again; no
    // vendor call and nothing counted. Open from the schedule or the app, it is theirs, and left alone.
    const closer = kind === "wet-feeder" && this.deps.blob ? new WetCloseNote(this.deps.blob) : null;
    if (action === "wet.open" && r.state === "lid open") {
      const mine = closer ? await closer.read().catch(() => null) : null;
      if (!closer || !mine || mine.id !== r.id) return refuse("lid-open", { vendor });
      const now = this.deps.now();
      const closeAt = closeAtFor(now);
      const meal = mealInWindow(r.meals, now, closeAt);
      if (meal) {
        await closer.clear(r.id).catch(() => undefined);
        return { ok: true, say: `The wet food feeder's lid is already open.${scheduleWins(meal.time)}` };
      }
      await closer.set({ ...mine, from: now, closeAt });
      return { ok: true, say: `The wet food feeder's lid is already open. I've started its two hours again: it closes at ${clockAt(closeAt)}.` };
    }
    let steps = 0;
    let plate: number | undefined;
    if (action === "wet.rotate") {
      const s = rotateSteps(r.plate, req.plate);
      if (s === null) return refuse("bad-plate", { vendor });
      plate = req.plate === undefined || req.plate === null ? undefined : Number(req.plate);
      // Already in front: nothing to turn, nothing counted.
      if (s === 0) return { ok: true, say: `Bowl ${plate} is already at the front of the wet food feeder.` };
      steps = s;
    }

    // The feed cap, per feeder, reserved before the vendor is called. A turn of the wet tray happens only with the lid
    // closed, so it serves nothing and isn't counted; the next opening is.
    const feeding = action === "feeder.feed" || action === "wet.open";
    const take = action === "feeder.feed" ? portions : 1;
    const ledger = feeding && this.deps.blob ? new FeedLedger(this.deps.blob) : null;
    let count: number | undefined;
    if (feeding) {
      if (!ledger) return refuse("vendor", { vendor });
      const got = await ledger.reserve(r.id, this.deps.feedCap, this.deps.now(), take);
      if (!got.ok) return refuse("cap", { cap: this.deps.feedCap, asked: take, left: Math.max(0, this.deps.feedCap - got.count) });
      count = got.count;
    }

    const vacMode = { ...(isSuction(req.suction) && { suction: req.suction }), ...(isWater(req.water) && { water: req.water }) };
    const args: RunArgs =
      thermo ??
      (action === "vacuum.rooms" ? { rooms: req.rooms, ...vacMode } : action === "vacuum.start" ? vacMode : action === "feeder.feed" ? { portions } : action === "wet.rotate" ? { steps } : {});
    const ran = await client.run(action, target, args).catch(() => ({ ok: false as const, code: "vendor" as const }));
    if (!ran.ok) {
      if (ledger) await ledger.release(r.id, this.deps.now(), take).catch(() => undefined);
      if (ran.code === "unknown-room") return refuse("unknown-room", { rooms: r.rooms });
      return refuse(ran.code, { vendor });
    }
    const settled = client.settle?.(action, r, args);
    if (settled) {
      const at = this.deps.now();
      this.last.set(vendor, { at, found: found.map((f) => (f === target ? { ...f, reading: settled } : f)), hold: at + SETTLE_MS });
    }
    // The auto-close (#713): an opening shuts itself two hours on, unless a scheduled meal opens inside that window;
    // a close from here cancels it.
    let closing: string | undefined;
    if (closer && action === "wet.open") closing = await this.planClose(closer, r, ran.feedId);
    if (closer && action === "wet.close") await closer.clear(r.id).catch(() => undefined);
    let heads = "";
    if (tray && (action === "wet.rotate" || action === "wet.open")) {
      // Remember the tray, then say if the next scheduled meal is now off: the plan opens whichever bowl is in front.
      const now = this.deps.now();
      const was = r.plate ?? null;
      const front = action === "wet.rotate" ? (was ? ((was - 1 + steps) % PLATES) + 1 : null) : was;
      const t = await tray.note(now, front, action === "wet.open" ? (was ?? undefined) : undefined).catch(() => null);
      if (t) heads = trayWarning(front, t, r.meals, now);
    }
    return { ok: true, say: (ran.say ?? sayDone(action, { count, cap: this.deps.feedCap, ...(thermo ?? {}), portions, ...(plate && { plate }), ...(closing && { closing }) })) + heads, ...(heads && { warned: true as const }) };
  }
}
