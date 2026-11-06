/**
 * The Haven's lights (#931): SwitchBot (./switchbot.ts) and Govee (./govee.ts) behind one small service, so the
 * Haven's map, its Lights panel and Skippy's tools see one list and one way to switch.
 *
 *   view()             every light with its on/off state, the SwitchBot manual scenes, and the infrared remotes (the
 *                      projector), each with an opaque id: a keyed hash of the vendor and its own id, never the
 *                      vendor's id itself. Names are as the apps name them, so the view is passkey-only.
 *   set(id, on)        one light or one remote on or off
 *   scene(id)          runs one SwitchBot manual scene
 *   byName(words)      a light, remote or scene by its name, for Skippy ("the kitchen light", "Turn off lights")
 *
 * The device list is kept ten minutes and the states one minute (each vendor allows 10,000 calls a day); a switch
 * that went through updates the kept state at once instead of reading again. An IR remote has no state to read
 * (`on` is null), so the Desk shows on and off as two buttons for it. No line logged holds a name or an id.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac } from "node:crypto";
import type { VendorState } from "../devices/home.js";
import { VendorError } from "../devices/http.js";
import type { Govee, GoveeLight } from "./govee.js";
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
}

export interface Scene {
  id: string;
  name: string;
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
  remotes: Remote[];
}

export type LightsResult = { ok: true; say: string } | { ok: false; code: "unknown" | "vendor" | "not-set-up"; say: string };

type Ref = { vendor: "switchbot"; thing: SwitchBotThing } | { vendor: "govee"; light: GoveeLight } | { vendor: "scene"; scene: string };

const LIST_MS = 10 * 60_000;
const STATE_MS = 60_000;

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

  /** Every light, scene and remote, with the lights' states. */
  async view(): Promise<LightsView> {
    const now = this.deps.now();
    if (this.state && now - this.state.at < STATE_MS) return this.state.view;
    const l = await this.lists();
    const lights: Light[] = [], remotes: Remote[] = [];
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
      } else if (ref.vendor === "govee") {
        const light: Light = { id, vendor: "govee", name: ref.light.name, type: ref.light.type, on: null, online: true };
        lights.push(light);
        reads.push(
          this.deps.govee!.state(ref.light).then(
            (s) => void ((light.on = s.on), (light.online = s.online)),
            () => void (light.online = false),
          ),
        );
      }
    }
    await Promise.all(reads);
    const state = (v: LightVendor): VendorState => (!this.configured(v) ? "waiting" : l.down.has(v) ? "down" : "live");
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const view: LightsView = { vendors: { switchbot: state("switchbot"), govee: state("govee") }, lights: lights.sort(byName), scenes: [...l.scenes].sort(byName), remotes: remotes.sort(byName) };
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
    const kept = this.state?.view.lights.find((x) => x.id === id);
    if (kept) kept.on = on;
    this.deps.log(`lights: ${ref.vendor} switched ${on ? "on" : "off"}`);
    return { ok: true, say: `${name || "That light"} is ${on ? "on" : "off"}.` };
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
  async byName(words: string): Promise<{ kind: "light" | "remote" | "scene"; id: string; name: string } | null> {
    const v = await this.view();
    const want = norm(words);
    if (!want) return null;
    const all = [...v.lights.map((x) => ({ kind: "light" as const, id: x.id, name: x.name })), ...v.remotes.map((x) => ({ kind: "remote" as const, id: x.id, name: x.name })), ...v.scenes.map((x) => ({ kind: "scene" as const, id: x.id, name: x.name }))];
    const exact = all.filter((x) => norm(x.name) === want);
    if (exact.length === 1) return exact[0]!;
    const near = all.filter((x) => norm(x.name) && (norm(x.name).includes(want) || want.includes(norm(x.name))));
    return near.length === 1 ? near[0]! : null;
  }
}
