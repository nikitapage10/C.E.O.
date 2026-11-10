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
 * The device list is kept ten minutes, the states one minute and a Govee light's moods six hours (each vendor allows
 * 10,000 calls a day); a switch that went through updates the kept state at once instead of reading again. An IR remote has no state to read
 * (`on` is null), so the Desk shows on and off as two buttons for it. No line logged holds a name or an id.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac } from "node:crypto";
import type { VendorState } from "../devices/home.js";
import { VendorError } from "../devices/http.js";
import type { Govee, GoveeLight, GoveeScene } from "./govee.js";
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
}

/** One change to a Govee light's look (#974): exactly one of these. */
export type LookChange = { rgb: number } | { kelvin: number } | { brightness: number } | { mood: string };

export type LightsResult = { ok: true; say: string } | { ok: false; code: "unknown" | "vendor" | "not-set-up"; say: string };

type Ref = { vendor: "switchbot"; thing: SwitchBotThing } | { vendor: "govee"; light: GoveeLight } | { vendor: "scene"; scene: string };

const LIST_MS = 10 * 60_000;
const STATE_MS = 60_000;
const MOODS_MS = 6 * 3_600_000;

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

export interface LightsDeps {
  switchbot: SwitchBot | null;
  govee: Govee | null;
  idKey: Buffer;
  now: () => number;
  log: (line: string) => void;
}

export class Lights {
  private list: { at: number; refs: Map<string, Ref>; things: SwitchBotThing[]; govee: GoveeLight[]; scenes: Scene[]; down: Set<LightVendor> } | null = null;
  private state: { at: number; view: LightsView } | null = null;
  private moods = new Map<string, { at: number; list: GoveeScene[] }>();

  constructor(private readonly deps: LightsDeps) {}

  private configured(v: LightVendor): boolean {
    return v === "switchbot" ? Boolean(this.deps.switchbot?.configured) : Boolean(this.deps.govee?.configured);
  }

  private async lists() {
    const now = this.deps.now();
    if (this.list && now - this.list.at < LIST_MS && !this.list.down.size) return this.list;
    const refs = new Map<string, Ref>();
    const down = new Set<LightVendor>();
    let things: SwitchBotThing[] = [], govee: GoveeLight[] = [], scenes: Scene[] = [];
    const sb = this.configured("switchbot") ? this.deps.switchbot! : null;
    const gv = this.configured("govee") ? this.deps.govee! : null;
    await Promise.all([
      sb &&
        Promise.all([sb.things(), sb.scenes()]).then(
          ([t, s]) => {
            things = t;
            scenes = s.map((x) => {
              const id = lightId(this.deps.idKey, "scene", x.id);
              refs.set(id, { vendor: "scene", scene: x.id });
              return { id, name: x.name };
            });
          },
          (e: unknown) => {
            down.add("switchbot");
            this.deps.log(`lights: switchbot list failed (${e instanceof VendorError ? e.status : "error"})`);
          },
        ),
      gv &&
        gv.lights().then(
          (l) => void (govee = l),
          (e: unknown) => {
            down.add("govee");
            this.deps.log(`lights: govee list failed (${e instanceof VendorError ? e.status : "error"})`);
          },
        ),
    ]);
    for (const t of things) refs.set(lightId(this.deps.idKey, "switchbot", t.id), { vendor: "switchbot", thing: t });
    for (const l of govee) refs.set(lightId(this.deps.idKey, "govee", l.id), { vendor: "govee", light: l });
    this.list = { at: now, refs, things, govee, scenes, down };
    return this.list;
  }

  /** A Govee light's moods, kept six hours; none when Govee won't say. */
  private async moodsOf(gl: GoveeLight): Promise<GoveeScene[]> {
    if (!gl.caps.scenes) return [];
    const now = this.deps.now(), kept = this.moods.get(gl.id);
    if (kept && now - kept.at < MOODS_MS) return kept.list;
    const list = await this.deps.govee!.scenes(gl).catch((e: unknown) => {
      this.deps.log(`lights: govee scenes failed (${e instanceof VendorError ? e.status : "error"})`);
      return kept?.list ?? [];
    });
    this.moods.set(gl.id, { at: now, list });
    return list;
  }

  /** Every light, group, scene and remote, with the lights' states. */
  async view(): Promise<LightsView> {
    const now = this.deps.now();
    if (this.state && now - this.state.at < STATE_MS) return this.state.view;
    const l = await this.lists();
    const lights: Light[] = [], remotes: Remote[] = [], groups: Group[] = [];
    const reads: Promise<void>[] = [];
    for (const [id, ref] of l.refs) {
      if (ref.vendor === "switchbot" && ref.thing.ir) remotes.push({ id, name: ref.thing.name, type: ref.thing.type });
      else if (ref.vendor === "switchbot" && SwitchBot.switchable(ref.thing)) {
        const light: Light = { id, vendor: "switchbot", name: ref.thing.name, type: ref.thing.type, on: null, online: true };
        lights.push(light);
        reads.push(
          this.deps.switchbot!.power(ref.thing.id).then(
            (on) => void (light.on = on),
            () => void (light.online = false),
          ),
        );
      } else if (ref.vendor === "govee" && ref.light.group) {
        // A group has no one state to read: on and off as two buttons, like a remote.
        groups.push({ id, vendor: "govee", name: ref.light.name, on: null });
      } else if (ref.vendor === "govee") {
        const gl = ref.light;
        const light: Light = { id, vendor: "govee", name: gl.name, type: gl.type, on: null, online: true, rgb: null, brightness: null, look: { color: gl.caps.color, brightness: gl.caps.brightness, kelvin: gl.caps.kelvin, moods: [] } };
        lights.push(light);
        reads.push(
          this.deps.govee!.state(gl).then(
            (s) => {
              light.on = s.on;
              light.online = s.online;
              light.brightness = s.brightness;
              light.rgb = s.rgb !== null ? hexOf(s.rgb) : s.kelvin ? kelvinHex(s.kelvin) : null;
            },
            () => void (light.online = false),
          ),
          this.moodsOf(gl).then((m) => void (light.look!.moods = m.map((x) => x.name))),
        );
      }
    }
    await Promise.all(reads);
    const state = (v: LightVendor): VendorState => (!this.configured(v) ? "waiting" : l.down.has(v) ? "down" : "live");
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const view: LightsView = { vendors: { switchbot: state("switchbot"), govee: state("govee") }, lights: lights.sort(byName), scenes: [...l.scenes].sort(byName), groups: groups.sort(byName), remotes: remotes.sort(byName) };
    this.state = { at: now, view };
    return view;
  }

  /** One light or remote on or off. */
  async set(id: string, on: boolean): Promise<LightsResult> {
    const ref = (await this.lists()).refs.get(id);
    if (!ref || ref.vendor === "scene" || (ref.vendor === "switchbot" && !ref.thing.ir && !SwitchBot.switchable(ref.thing))) return { ok: false, code: "unknown", say: "I don't know that light." };
    const name = ref.vendor === "switchbot" ? ref.thing.name : ref.light.name;
    try {
      if (ref.vendor === "switchbot") await this.deps.switchbot!.set(ref.thing.id, on);
      else await this.deps.govee!.set(ref.light, on);
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
    let say: string;
    try {
      if ("rgb" in change) {
        if (!gl.caps.color) return { ok: false, code: "unknown", say: `${name} has no colour to set.` };
        await gv.color(gl, change.rgb);
        say = `${name} is ${hexOf(change.rgb)}.`;
      } else if ("kelvin" in change) {
        if (!gl.caps.kelvin) return { ok: false, code: "unknown", say: `${name} has no white to set.` };
        const k = Math.round(Math.max(gl.caps.kelvin[0], Math.min(gl.caps.kelvin[1], change.kelvin)));
        await gv.kelvin(gl, k);
        say = `${name} is white at ${k} K.`;
      } else if ("brightness" in change) {
        if (!gl.caps.brightness) return { ok: false, code: "unknown", say: `${name} can't be dimmed from here.` };
        await gv.brightness(gl, Math.round(Math.max(1, Math.min(100, change.brightness))));
        say = `${name} is at ${Math.round(Math.max(1, Math.min(100, change.brightness)))}%.`;
      } else {
        const want = change.mood.trim().toLowerCase();
        const mood = (await this.moodsOf(gl)).find((m) => m.name.toLowerCase() === want);
        if (!mood) return { ok: false, code: "unknown", say: `${name} has no mood called that.` };
        await gv.scene(gl, mood.value);
        say = `${name}: ${mood.name}.`;
      }
    } catch (e) {
      this.deps.log(`lights: govee look failed (${e instanceof VendorError ? e.status : "error"})`);
      return { ok: false, code: "vendor", say: "Govee didn't take that just now. Try again in a moment." };
    }
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
