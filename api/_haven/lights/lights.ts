/**
 * The Haven's lights (#931): SwitchBot (./switchbot.ts) and Govee (./govee.ts) behind one small service, so the
 * Haven's map, its Lights panel and Skippy's tools see one list and one way to switch.
 *
 *   view()             every light with its on/off state (and a Govee light's colour, brightness and moods, #974),
 *                      the SwitchBot manual scenes, the Govee groups (#974: listed with the scenes, never as a light),
 *                      and the infrared remotes (the projector), each with an opaque id: a keyed hash of the vendor and
 *                      its own id, never the vendor's id itself. Names are as the apps name them, so the view is
 *                      passkey-only.
 *   set(id, on)        one light, group or remote on or off
 *   look(id, change)   a Govee light's colour, white, brightness or mood (#974)
 *   scene(id)          runs one SwitchBot manual scene
 *   byName(words)      a light, group, remote or scene by its name, for Skippy ("the kitchen light", "Turn off lights")
 *
 * The device list is kept ten minutes (Govee's half an hour), SwitchBot's states 18 seconds (#1020, STATE_MS) and a Govee
 * light's moods a day (each vendor allows 10,000 calls a day). #1077: Govee's states are read only for the lamps the
 * Haven shows, every 18 s while the Lights panel is on screen and every 115 s otherwise, all callers sharing them; on
 * Govee's limit (429) nothing goes to Govee until its reset, and while Govee is down its lamps stay listed from the last
 * good list (kept in the store, ./live.ts), unreachable. A switch that went through updates the kept state at once
 * instead of reading again. An IR remote has no state to read
 * (`on` is null), so the Desk shows on and off as two buttons for it. No line logged holds a name or an id.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac } from "node:crypto";
import type { VendorState } from "../devices/home.js";
import { VendorError } from "../devices/http.js";
import type { Govee, GoveeLight, GoveeScene, GoveeState } from "./govee.js";
import { isShown } from "./hidden.js";
import { SwitchBot, type SwitchBotThing } from "./switchbot.js";

export const LIGHT_VENDORS = ["switchbot", "govee"] as const;
export type LightVendor = (typeof LIGHT_VENDORS)[number];

export interface Light {
  id: string;
  vendor: LightVendor;
  /** As the vendor's app names it. Private. */
  name: string;
  /** The vendor's own device type ("Bot", "Plug Mini (US)", "devices.types.light"). */
  type: string;
  on: boolean | null;
  online: boolean;
  /** Its colour as "#rrggbb" when the vendor says (a Govee light in colour, or its white as a colour), else null. */
  rgb?: string | null;
  /** 1 to 100, when the vendor says. */
  brightness?: number | null;
  /** What a Govee light can do beyond on and off (#974); absent for a plain switch. */
  look?: LightLook;
  /** Its vendor isn't answering (#1077): listed from the last list that came back, its state unknown. */
  stale?: boolean;
}

/** A Govee light's controls (#974): colour, white range, brightness and its moods (the app's scenes), by name. */
export interface LightLook {
  color: boolean;
  brightness: boolean;
  kelvin: [number, number] | null;
  moods: string[];
}

export interface Scene {
  id: string;
  name: string;
}

/** A group made in a vendor's app (#974: Govee's "Same-Model" and the like): on and off for all of it, never placed. */
export interface Group {
  id: string;
  vendor: LightVendor;
  name: string;
  on: boolean | null;
}

/** An infrared remote (SwitchBot): power on and off only, no state. */
export interface Remote {
  id: string;
  name: string;
  type: string;
}

export interface LightsView {
  vendors: Record<LightVendor, VendorState>;
  lights: Light[];
  scenes: Scene[];
  /** Absent from an older copy's answer: read as none. */
  groups?: Group[];
  remotes: Remote[];
  /** When a paused vendor is asked again (#1077: Govee's daily limit reached), epoch ms. */
  until?: Partial<Record<LightVendor, number>>;
}

/** One change to a Govee light's look (#974): exactly one of these. */
export type LookChange = { rgb: number } | { kelvin: number } | { brightness: number } | { mood: string };

export type LightsResult = { ok: true; say: string } | { ok: false; code: "unknown" | "vendor" | "not-set-up"; say: string };

type Ref = { vendor: "switchbot"; thing: SwitchBotThing } | { vendor: "govee"; light: GoveeLight } | { vendor: "scene"; scene: string };

const LIST_MS = 10 * 60_000;
/**
 * SwitchBot's states are kept 18 s (#1020, #1077: the Haven reads them every 20 s while its Lights panel is on screen, else every 2 minutes, so a switch flipped at the
 * wall, in the SwitchBot app, by a scene or by Skippy shows within half a minute). A fresh read (after a tap or a scene)
 * skips the kept states once they're 4 s old. Past STATE_BUDGET SwitchBot status calls in a day (SwitchBot allows
 * 10,000) they're kept three minutes instead, fresh reads included.
 */
const STATE_MS = 18_000;
const FRESH_MS = 4_000;
const SLOW_MS = 180_000;
export const STATE_BUDGET = 7_000;
const HOUR = 3_600_000;
const MOODS_MS = 24 * HOUR;
/** A vendor's list that failed is asked again after a minute, not on every read (#1077). */
const DOWN_MS = 60_000;
/**
 * Govee (#1077): its list kept half an hour; its lamps' states 18 s while the Lights panel is on screen, else 115 s
 * (so a check-in or Skippy within two minutes reads the kept ones); at most GOVEE_BUDGET calls a day of Govee's
 * 10,000, spread over the hours left (PACE) when the day runs short.
 */
const GOVEE_LIST_MS = 30 * 60_000;
export const GOVEE_LIVE_MS = 18_000;
export const GOVEE_IDLE_MS = 115_000;
export const GOVEE_BUDGET = 8_000;
const PACE = 0.4;

/** 0xRRGGBB as "#rrggbb". */
export const hexOf = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;

/** A white in kelvin as a colour, near enough to draw it (Tanner Helland's fit, for 1,000 K to 40,000 K). */
export function kelvinHex(k: number): string {
  const t = Math.max(1000, Math.min(40000, k)) / 100;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = t <= 66 ? 255 : c(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? c(99.4708025861 * Math.log(t) - 161.1195681661) : c(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : c(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return hexOf((r << 16) | (g << 8) | b);
}

/** The opaque id for a vendor's own id: 12 hex characters, stable for a given HOME_TOKEN_KEY. */
export function lightId(idKey: Buffer, kind: string, vendorId: string): string {
  return createHmac("sha256", idKey).update(`lights\n${kind}\n${vendorId}`).digest("hex").slice(0, 12);
}

export const LIGHT_ID = /^[0-9a-f]{12}$/;

const norm = (s: string) => s.toLowerCase().replace(/\b(the|light|lights|lamp)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Where the last good Govee list, the pause and the day's Govee call count live between instances (#1077): one
 * small private file in the Haven's store (./live.ts), so a cold instance still lists the lamps while Govee is
 * down and still knows it is paused.
 */
export interface LightsKeep {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

export interface LightsDeps {
  switchbot: SwitchBot | null;
  govee: Govee | null;
  idKey: Buffer;
  now: () => number;
  log: (line: string) => void;
  keep?: LightsKeep | null;
}

export interface ViewOpts {
  /** After a tap or a scene: SwitchBot's states kept 4 s at most (#1020). Govee's are not read again for it. */
  fresh?: boolean;
  /** The Lights panel is on screen in a visible tab (#1077): Govee's lamps are read every 18 s, else every 115 s. */
  live?: boolean;
}

/** The next midnight UTC after `now`: when Govee's day starts again. */
export const nextMidnight = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

/** What the kept file holds, checked: a stored file is read as untrusted data. */
export function keptOf(raw: unknown): { lights: GoveeLight[]; until: number; calls: { day: string; n: number } } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const s = (v: unknown): v is string => typeof v === "string" && v.length <= 200;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const lights: GoveeLight[] = [];
  for (const x of Array.isArray(o.lights) ? o.lights.slice(0, 100) : []) {
    const l = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const c = (l.caps && typeof l.caps === "object" ? l.caps : {}) as Record<string, unknown>;
    if (!s(l.id) || !s(l.sku) || !s(l.name) || !s(l.type) || !l.id || !l.sku) continue;
    const k = Array.isArray(c.kelvin) && c.kelvin.length === 2 && c.kelvin.every((v) => typeof v === "number") ? (c.kelvin as [number, number]) : null;
    lights.push({ id: l.id, sku: l.sku, name: l.name, type: l.type, group: l.group === true, caps: { color: c.color === true, brightness: c.brightness === true, kelvin: k, scenes: c.scenes === true } });
  }
  const calls = (o.calls && typeof o.calls === "object" ? o.calls : {}) as Record<string, unknown>;
  return { lights, until: n(o.until), calls: { day: typeof calls.day === "string" ? calls.day : "", n: n(calls.n) } };
}

type SbList = { at: number; things: SwitchBotThing[]; scenes: { id: string; name: string }[]; down: boolean };
type GvList = { at: number; lights: GoveeLight[]; down: boolean };

export class Lights {
  private list: { sb: SbList | null; gv: GvList | null; refs: Map<string, Ref>; scenes: Scene[]; down: Set<LightVendor> } | null = null;
  private sbList: SbList | null = null;
  private gvList: GvList | null = null;
  /** The last Govee list that came back whole (#1077): what the lamps are listed from while Govee is down. */
  private gvKept: GoveeLight[] | null = null;
  private state: { at: number; view: LightsView } | null = null;
  /** SwitchBot status calls today (UTC), for the daily budget. */
  private calls = { day: "", n: 0 };
  /** Every Govee call today (UTC): list, states, moods and switches alike (#1077). */
  private gvCalls = { day: "", n: 0 };
  /** Govee's last states, by Govee's id; when the shown lamps were last read; until when Govee is not asked at all. */
  private gvState = new Map<string, GoveeState>();
  private gvAt = -Infinity;
  private gvUntil = 0;
  private moods = new Map<string, { at: number; list: GoveeScene[] }>();
  private restored: Promise<void> | null = null;

  constructor(private readonly deps: LightsDeps) {}

  private configured(v: LightVendor): boolean {
    return v === "switchbot" ? Boolean(this.deps.switchbot?.configured) : Boolean(this.deps.govee?.configured);
  }

  private today(now: number) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.calls.day !== day) this.calls = { day, n: 0 };
    if (this.gvCalls.day !== day) this.gvCalls = { day, n: 0 };
  }

  /** Govee is paused (#1077): it said its limit was reached, and nothing goes to it until its reset. */
  private paused(now = this.deps.now()) {
    return now < this.gvUntil;
  }

  /** The kept file, read once per instance. */
  private restore(): Promise<void> {
    return (this.restored ??= (async () => {
      if (!this.deps.keep || !this.configured("govee")) return;
      const k = keptOf(await this.deps.keep.read().catch(() => null));
      if (!k) return;
      if (!this.gvKept && k.lights.length) this.gvKept = k.lights;
      this.gvUntil = Math.max(this.gvUntil, k.until);
      this.today(this.deps.now());
      if (k.calls.day === this.gvCalls.day) this.gvCalls.n = Math.max(this.gvCalls.n, k.calls.n);
    })());
  }

  private persist() {
    if (!this.deps.keep) return;
    const value = { v: 1, lights: this.gvKept ?? [], until: this.gvUntil, calls: this.gvCalls };
    this.deps.keep.write(value).catch(() => this.deps.log("lights: govee keep not saved"));
  }

  /** One Govee call: counted, and a 429 (HTTP or Govee's own code) pauses Govee until its reset. */
  private async gcall<T>(call: () => Promise<T>): Promise<T> {
    const now = this.deps.now();
    this.today(now);
    this.gvCalls.n++;
    if (this.gvCalls.n % 100 === 0) this.persist();
    try {
      return await call();
    } catch (e) {
      if (e instanceof VendorError && e.status === 429) this.pause(e, now);
      throw e;
    }
  }

  /**
   * Govee said its limit was reached (#1077): no Govee call until its reset. Its header's time when it gives one,
   * else midnight UTC (its day); an hour when the limit is still reached just after a pause ended.
   */
  private pause(e: VendorError, now: number) {
    const said = e.resetAt && e.resetAt > now && e.resetAt <= now + 26 * HOUR ? e.resetAt : null;
    const until = said ?? (this.gvUntil && now - this.gvUntil < HOUR ? now + HOUR : nextMidnight(now));
    if (until <= this.gvUntil) return;
    this.gvUntil = until;
    this.deps.log(`lights: govee limit reached, paused until ${new Date(until).toISOString().slice(11, 16)} UTC`);
    this.persist();
  }

  /**
   * How long Govee's states are kept (#1077): 18 s while the Lights panel is on screen, else 115 s; slower when the
   * day's calls run short (spread over the hours left), and not read again at all once the budget is spent.
   */
  private goveeKeep(now: number, lamps: number, live: boolean): number {
    const left = GOVEE_BUDGET - this.gvCalls.n;
    if (left <= lamps) return Infinity;
    return Math.max(live ? GOVEE_LIVE_MS : GOVEE_IDLE_MS, (PACE * lamps * (nextMidnight(now) - now)) / left);
  }

  private async lists() {
    const now = this.deps.now();
    await this.restore();
    const sb = this.configured("switchbot") ? this.deps.switchbot! : null;
    const gv = this.configured("govee") ? this.deps.govee! : null;
    const jobs: Promise<void>[] = [];
    if (sb && (!this.sbList || now - this.sbList.at >= (this.sbList.down ? DOWN_MS : LIST_MS)))
      jobs.push(
        Promise.all([sb.things(), sb.scenes()]).then(
          ([things, scenes]) => void (this.sbList = { at: now, things, scenes, down: false }),
          (e: unknown) => {
            this.sbList = { at: now, things: this.sbList?.things ?? [], scenes: this.sbList?.scenes ?? [], down: true };
            this.deps.log(`lights: switchbot list failed (${e instanceof VendorError ? e.status : "error"})`);
          },
        ),
      );
    if (gv && (!this.gvList || now - this.gvList.at >= (this.gvList.down ? DOWN_MS : GOVEE_LIST_MS))) {
      // Down or paused, the lamps stay listed from the last list that came back (#1077).
      if (this.paused(now)) this.gvList = { at: now, lights: this.gvKept ?? [], down: true };
      else
        jobs.push(
          this.gcall(() => gv.lights()).then(
            (lights) => {
              this.gvList = { at: now, lights, down: false };
              this.gvKept = lights;
              this.persist();
            },
            (e: unknown) => {
              this.gvList = { at: now, lights: this.gvKept ?? [], down: true };
              this.deps.log(`lights: govee list failed (${e instanceof VendorError ? e.status : "error"})`);
            },
          ),
        );
    }
    await Promise.all(jobs);
    const down = new Set<LightVendor>();
    if (sb && this.sbList?.down) down.add("switchbot");
    if (gv && (this.gvList?.down || this.paused(now))) down.add("govee");
    if (this.list && this.list.sb === this.sbList && this.list.gv === this.gvList) {
      this.list.down = down;
      return this.list;
    }
    const refs = new Map<string, Ref>();
    const scenes: Scene[] = [];
    if (sb && this.sbList) {
      for (const x of this.sbList.scenes) {
        const id = lightId(this.deps.idKey, "scene", x.id);
        refs.set(id, { vendor: "scene", scene: x.id });
        scenes.push({ id, name: x.name });
      }
      for (const t of this.sbList.things) refs.set(lightId(this.deps.idKey, "switchbot", t.id), { vendor: "switchbot", thing: t });
    }
    if (gv && this.gvList) for (const l of this.gvList.lights) refs.set(lightId(this.deps.idKey, "govee", l.id), { vendor: "govee", light: l });
    this.list = { sb: this.sbList, gv: this.gvList, refs, scenes, down };
    return this.list;
  }

  /** A Govee light's moods, kept a day; none when Govee won't say. */
  private async moodsOf(gl: GoveeLight): Promise<GoveeScene[]> {
    if (!gl.caps.scenes) return [];
    const now = this.deps.now(), kept = this.moods.get(gl.id);
    if ((kept && now - kept.at < MOODS_MS) || this.paused(now)) return kept?.list ?? [];
    const list = await this.gcall(() => this.deps.govee!.scenes(gl)).catch((e: unknown) => {
      this.deps.log(`lights: govee scenes failed (${e instanceof VendorError ? e.status : "error"})`);
      return kept?.list ?? [];
    });
    this.moods.set(gl.id, { at: now, list });
    return list;
  }

  /**
   * Every light, group, scene and remote, with the lights' states. Govee's states are read only for the lamps the
   * Haven shows (#1077: never a hidden light or a group), and only when the kept ones are older than `goveeKeep`;
   * every caller (the Desk's tabs, Skippy, the house check-in) shares them. Nothing here runs on a timer.
   */
  async view(opts: ViewOpts = {}): Promise<LightsView> {
    const now = this.deps.now();
    this.today(now);
    const keep = this.calls.n >= STATE_BUDGET ? SLOW_MS : opts.fresh ? FRESH_MS : STATE_MS;
    if (this.state && now - this.state.at < keep) return this.state.view;
    const l = await this.lists();
    const lights: Light[] = [], remotes: Remote[] = [], groups: Group[] = [];
    const reads: Promise<unknown>[] = [];
    const lamps: GoveeLight[] = [];
    for (const [id, ref] of l.refs) {
      if (ref.vendor === "switchbot" && ref.thing.ir) remotes.push({ id, name: ref.thing.name, type: ref.thing.type });
      else if (ref.vendor === "switchbot" && SwitchBot.switchable(ref.thing)) {
        const light: Light = { id, vendor: "switchbot", name: ref.thing.name, type: ref.thing.type, on: null, online: true };
        lights.push(light);
        if (l.down.has("switchbot")) {
          light.online = false;
          light.stale = true;
          continue;
        }
        this.calls.n++;
        reads.push(
          this.deps.switchbot!.power(ref.thing.id).then(
            (on) => void (light.on = on),
            () => void (light.online = false),
          ),
        );
      } else if (ref.vendor === "govee" && ref.light.group) {
        // A group has no one state to read: on and off as two buttons, like a remote.
        groups.push({ id, vendor: "govee", name: ref.light.name, on: null });
      } else if (ref.vendor === "govee" && isShown(ref.light.name)) lamps.push(ref.light);
    }
    const gv = this.deps.govee;
    if (gv && lamps.length && !l.down.has("govee") && now - this.gvAt >= this.goveeKeep(now, lamps.length, !!opts.live)) {
      this.gvAt = now;
      for (const gl of lamps)
        reads.push(
          this.gcall(() => gv.state(gl)).then(
            (s) => void this.gvState.set(gl.id, s),
            (e: unknown) => {
              if (!(e instanceof VendorError && e.status === 429)) this.gvState.set(gl.id, { on: null, online: false, brightness: null, rgb: null, kelvin: null });
            },
          ),
        );
    }
    if (!l.down.has("govee")) for (const gl of lamps) reads.push(this.moodsOf(gl));
    await Promise.all(reads);
    // Down or paused (#1077): every Govee lamp still listed, unreachable, so it keeps its spot on the house.
    const gvDown = this.configured("govee") && (l.down.has("govee") || this.paused(now));
    for (const [id, ref] of l.refs) {
      if (ref.vendor !== "govee" || ref.light.group) continue;
      const gl = ref.light, s = gvDown ? undefined : this.gvState.get(gl.id);
      lights.push({
        id,
        vendor: "govee",
        name: gl.name,
        type: gl.type,
        on: s?.on ?? null,
        online: gvDown ? false : (s?.online ?? true),
        rgb: s ? (s.rgb !== null ? hexOf(s.rgb) : s.kelvin ? kelvinHex(s.kelvin) : null) : null,
        brightness: s?.brightness ?? null,
        look: { color: gl.caps.color, brightness: gl.caps.brightness, kelvin: gl.caps.kelvin, moods: (this.moods.get(gl.id)?.list ?? []).map((x) => x.name) },
        ...(gvDown && { stale: true }),
      });
    }
    const state = (v: LightVendor): VendorState => (!this.configured(v) ? "waiting" : (v === "govee" ? gvDown : l.down.has(v)) ? "down" : "live");
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const view: LightsView = { vendors: { switchbot: state("switchbot"), govee: state("govee") }, lights: lights.sort(byName), scenes: [...l.scenes].sort(byName), groups: groups.sort(byName), remotes: remotes.sort(byName), ...(this.configured("govee") && this.paused(now) && { until: { govee: this.gvUntil } }) };
    this.state = { at: now, view };
    return view;
  }

  /** Govee's line while it is paused (#1077). */
  private pausedSay() {
    return `Govee's daily limit is used up; its lamps answer again after ${new Date(this.gvUntil).toISOString().slice(11, 16)} UTC.`;
  }

  /** What a Govee control did, kept as its state (#1077): no read straight back. */
  private kept(gl: GoveeLight, change: Partial<GoveeState>) {
    const was = this.gvState.get(gl.id) ?? { on: null, online: true, brightness: null, rgb: null, kelvin: null };
    this.gvState.set(gl.id, { ...was, online: true, ...change });
  }

  /** One light or remote on or off. */
  async set(id: string, on: boolean): Promise<LightsResult> {
    const ref = (await this.lists()).refs.get(id);
    if (!ref || ref.vendor === "scene" || (ref.vendor === "switchbot" && !ref.thing.ir && !SwitchBot.switchable(ref.thing))) return { ok: false, code: "unknown", say: "I don't know that light." };
    const name = ref.vendor === "switchbot" ? ref.thing.name : ref.light.name;
    if (ref.vendor === "govee" && this.paused()) return { ok: false, code: "vendor", say: this.pausedSay() };
    try {
      if (ref.vendor === "switchbot") await this.deps.switchbot!.set(ref.thing.id, on);
      else {
        const gl = ref.light;
        await this.gcall(() => this.deps.govee!.set(gl, on));
        if (!gl.group) this.kept(gl, { on });
      }
    } catch (e) {
      this.deps.log(`lights: ${ref.vendor} switch failed (${e instanceof VendorError ? e.status : "error"})`);
      return { ok: false, code: "vendor", say: `${ref.vendor === "govee" ? "Govee" : "SwitchBot"} didn't take that just now. Try again in a moment.` };
    }
    // Keep what we know: the light's new state, without reading the vendor straight back.
    const kept = this.state?.view.lights.find((x) => x.id === id) ?? this.state?.view.groups?.find((x) => x.id === id);
    if (kept) kept.on = on;
    this.deps.log(`lights: ${ref.vendor} switched ${on ? "on" : "off"}`);
    return { ok: true, say: `${name || "That light"} is ${on ? "on" : "off"}.` };
  }

  /** A Govee light's colour, white, brightness or mood (#974). Each one turns the light on, as the app does. */
  async look(id: string, change: LookChange): Promise<LightsResult> {
    const ref = (await this.lists()).refs.get(id);
    if (!ref || ref.vendor !== "govee" || ref.light.group) return { ok: false, code: "unknown", say: "I don't know that light." };
    const gl = ref.light, gv = this.deps.govee!;
    const name = gl.name || "That light";
    if (this.paused()) return { ok: false, code: "vendor", say: this.pausedSay() };
    let say: string;
    try {
      if ("rgb" in change) {
        if (!gl.caps.color) return { ok: false, code: "unknown", say: `${name} has no colour to set.` };
        await this.gcall(() => gv.color(gl, change.rgb));
        say = `${name} is ${hexOf(change.rgb)}.`;
      } else if ("kelvin" in change) {
        if (!gl.caps.kelvin) return { ok: false, code: "unknown", say: `${name} has no white to set.` };
        const k = Math.round(Math.max(gl.caps.kelvin[0], Math.min(gl.caps.kelvin[1], change.kelvin)));
        await this.gcall(() => gv.kelvin(gl, k));
        say = `${name} is white at ${k} K.`;
      } else if ("brightness" in change) {
        if (!gl.caps.brightness) return { ok: false, code: "unknown", say: `${name} can't be dimmed from here.` };
        await this.gcall(() => gv.brightness(gl, Math.round(Math.max(1, Math.min(100, change.brightness)))));
        say = `${name} is at ${Math.round(Math.max(1, Math.min(100, change.brightness)))}%.`;
      } else {
        const want = change.mood.trim().toLowerCase();
        const mood = (await this.moodsOf(gl)).find((m) => m.name.toLowerCase() === want);
        if (!mood) return { ok: false, code: "unknown", say: `${name} has no mood called that.` };
        await this.gcall(() => gv.scene(gl, mood.value));
        say = `${name}: ${mood.name}.`;
      }
    } catch (e) {
      this.deps.log(`lights: govee look failed (${e instanceof VendorError ? e.status : "error"})`);
      return { ok: false, code: "vendor", say: "Govee didn't take that just now. Try again in a moment." };
    }
    if ("rgb" in change) this.kept(gl, { on: true, rgb: change.rgb, kelvin: null });
    else if ("kelvin" in change) this.kept(gl, { on: true, rgb: null, kelvin: change.kelvin });
    else if ("brightness" in change) this.kept(gl, { on: true, brightness: Math.round(Math.max(1, Math.min(100, change.brightness))) });
    else this.kept(gl, { on: true });
    const kept = this.state?.view.lights.find((x) => x.id === id);
    if (kept) {
      kept.on = true;
      if ("rgb" in change) kept.rgb = hexOf(change.rgb);
      else if ("kelvin" in change) kept.rgb = kelvinHex(change.kelvin);
      else if ("brightness" in change) kept.brightness = Math.round(Math.max(1, Math.min(100, change.brightness)));
    }
    this.deps.log("lights: govee look set");
    return { ok: true, say };
  }

  /** Runs one SwitchBot manual scene. */
  async scene(id: string): Promise<LightsResult> {
    const ref = (await this.lists()).refs.get(id);
    if (!ref || ref.vendor !== "scene") return { ok: false, code: "unknown", say: "I don't know that scene." };
    try {
      await this.deps.switchbot!.runScene(ref.scene);
    } catch (e) {
      this.deps.log(`lights: scene failed (${e instanceof VendorError ? e.status : "error"})`);
      return { ok: false, code: "vendor", say: "SwitchBot didn't run that scene just now. Try again in a moment." };
    }
    // A scene can switch anything: read the states fresh next time.
    this.state = null;
    this.deps.log("lights: scene run");
    const name = this.list?.scenes.find((s) => s.id === id)?.name;
    return { ok: true, say: name ? `Done: ${name}.` : "Done." };
  }

  /** A light, remote or scene by its name as said: exact first, then the one whose name holds the words (or is held by them). */
  async byName(words: string): Promise<{ kind: "light" | "group" | "remote" | "scene"; id: string; name: string } | null> {
    const v = await this.view();
    const want = norm(words);
    if (!want) return null;
    // A group switches like a light (on and off for all of it), but is never placed.
    const all = [...v.lights.map((x) => ({ kind: "light" as const, id: x.id, name: x.name })), ...(v.groups ?? []).map((x) => ({ kind: "group" as const, id: x.id, name: x.name })), ...v.remotes.map((x) => ({ kind: "remote" as const, id: x.id, name: x.name })), ...v.scenes.map((x) => ({ kind: "scene" as const, id: x.id, name: x.name }))];
    const exact = all.filter((x) => norm(x.name) === want);
    if (exact.length === 1) return exact[0]!;
    const near = all.filter((x) => norm(x.name) && (norm(x.name).includes(want) || want.includes(norm(x.name))));
    return near.length === 1 ? near[0]! : null;
  }
}
