/**
 * The Google Nest thermostat (#637, docs/HOME-DEVICES.md) through Google's Smart Device Management API, behind
 * the home devices' common interface (api/_haven/devices/types.ts), so it shares their routes, rails, Council log and
 * Desk card.
 *
 *   GET  https://smartdevicemanagement.googleapis.com/v1/enterprises/{project}/devices    every shared device's traits
 *   POST …/devices/{id}:executeCommand                                                    one command:
 *          sdm.devices.commands.ThermostatMode.SetMode                  { mode: HEAT | COOL | HEATCOOL | OFF }
 *          sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat   { heatCelsius }
 *          sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool   { coolCelsius }
 *          sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange  { heatCelsius, coolCelsius }
 *
 * The rails (api/_haven/devices/rails.ts) have already said yes before run() is called: 60 to 80 °F, the modes the
 * thermostat offers, nothing in eco or while off. SDM speaks Celsius; the Desk speaks whole °F. The device's resource
 * name stays on the server (the reading carries an opaque id), and its own name from the Home app is never read.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { callJson, VendorError, type Fetch } from "../devices/http.js";
import { obj, PLACES, str, type DeviceClient, type DeviceReading, type Found, type RunArgs, type RunResult, type ThermoMode, type ActionId } from "../devices/types.js";
import { deviceId, type HomeVault } from "../devices/vault.js";
import { accessToken, GrantRefusedError, type HavenClient, type StoredGrant } from "./oauth.js";

export const SDM_API = "https://smartdevicemanagement.googleapis.com/v1";
const T = "sdm.devices.traits.";
const C = "sdm.devices.commands.";

export interface NestRef {
  /** enterprises/{project}/devices/{id}: never leaves the server. */
  name: string;
}

export interface NestDeps {
  fetch: Fetch;
  vault: HomeVault | null;
  idKey: Buffer | null;
  client: HavenClient | null;
  project: string | null;
  now: () => number;
}

export const cToF = (c: number) => Math.round((c * 9) / 5 + 32);
/** °F to °C for SDM, to two places. */
export const fToC = (f: number) => Math.round(((f - 32) * 5 * 100) / 9) / 100;

const MODE_OF: Record<string, ThermoMode> = { HEAT: "heat", COOL: "cool", HEATCOOL: "heatcool", OFF: "off" };
const SDM_MODE: Record<ThermoMode, string> = { heat: "HEAT", cool: "COOL", heatcool: "HEATCOOL", off: "OFF" };

const numOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A room name from the Home app, as a plain short place; the default when there is none. */
function placeOf(parents: unknown): string {
  const first = Array.isArray(parents) ? obj(parents[0]) : {};
  const name = str(first.displayName)
    .replace(/[\p{Cc}<>]/gu, "")
    .trim()
    .slice(0, 30);
  return name || PLACES.thermostat;
}

/** One SDM device as a reading, or null when it isn't a thermostat. Pure, so it is tested on its own. */
export function readThermostat(raw: unknown, idKey: Buffer): Found<NestRef> | null {
  const d = obj(raw);
  const name = str(d.name);
  if (str(d.type) !== "sdm.devices.types.THERMOSTAT" || !/^enterprises\/[^/]+\/devices\/[A-Za-z0-9_-]+$/.test(name)) return null;
  const t = obj(d.traits);
  const online = str(obj(t[`${T}Connectivity`]).status) !== "OFFLINE";
  const modeT = obj(t[`${T}ThermostatMode`]);
  const mode = MODE_OF[str(modeT.mode)];
  const modes = (Array.isArray(modeT.availableModes) ? modeT.availableModes : []).map((m) => MODE_OF[str(m)]).filter((m): m is ThermoMode => Boolean(m));
  const eco = str(obj(t[`${T}ThermostatEco`]).mode) === "MANUAL_ECO";
  const hvacRaw = str(obj(t[`${T}ThermostatHvac`]).status);
  const hvac = hvacRaw === "HEATING" ? "heating" : hvacRaw === "COOLING" ? "cooling" : "off";
  const amb = numOr(obj(t[`${T}Temperature`]).ambientTemperatureCelsius);
  const hum = numOr(obj(t[`${T}Humidity`]).ambientHumidityPercent);
  const sp = obj(t[`${T}ThermostatTemperatureSetpoint`]);
  const heat = numOr(sp.heatCelsius);
  const cool = numOr(sp.coolCelsius);
  const state = !online ? "offline" : eco ? "eco" : mode === "off" ? "off" : hvac === "off" ? "idle" : hvac;
  const reading: DeviceReading = {
    id: deviceId(idKey, "nest", name),
    vendor: "nest",
    kind: "thermostat",
    model: "Nest thermostat",
    place: placeOf(d.parentRelations),
    online,
    state,
    alerts: [],
    tempF: amb === null ? null : cToF(amb),
    humidity: hum === null ? null : Math.max(0, Math.min(100, Math.round(hum))),
    ...(mode && { mode }),
    modes,
    eco,
    hvac,
    heatF: heat === null ? null : cToF(heat),
    coolF: cool === null ? null : cToF(cool),
  };
  return { reading, ref: { name } };
}

/** The one SDM command (and its params) for an action that passed the rails, or null. */
export function commandFor(action: ActionId, args: RunArgs, mode: ThermoMode | undefined): { command: string; params: Record<string, unknown> } | null {
  if (action === "thermostat.mode" && args.mode) return { command: `${C}ThermostatMode.SetMode`, params: { mode: SDM_MODE[args.mode] } };
  if (action !== "thermostat.set") return null;
  if (mode === "heatcool" && args.heatF !== undefined && args.coolF !== undefined) return { command: `${C}ThermostatTemperatureSetpoint.SetRange`, params: { heatCelsius: fToC(args.heatF), coolCelsius: fToC(args.coolF) } };
  if (mode === "heat" && args.heatF !== undefined) return { command: `${C}ThermostatTemperatureSetpoint.SetHeat`, params: { heatCelsius: fToC(args.heatF) } };
  if (mode === "cool" && args.coolF !== undefined) return { command: `${C}ThermostatTemperatureSetpoint.SetCool`, params: { coolCelsius: fToC(args.coolF) } };
  return null;
}

export class NestClient implements DeviceClient<NestRef> {
  readonly vendor = "nest" as const;
  readonly actions = ["thermostat.set", "thermostat.mode"] as const;
  constructor(private readonly deps: NestDeps) {}

  private async grant(): Promise<StoredGrant | null> {
    return this.deps.vault ? await this.deps.vault.read<StoredGrant>("google-nest").catch(() => null) : null;
  }

  async connected(): Promise<boolean> {
    if (!this.deps.client || !this.deps.project || !this.deps.idKey) return false;
    const g = await this.grant();
    return Boolean(g && !g.refused);
  }

  private async token(): Promise<string> {
    const { client, vault } = this.deps;
    const g = await this.grant();
    if (!client || !g || g.refused) throw new VendorError(401);
    try {
      return await accessToken(this.deps.fetch, client, "nest", g.refresh, this.deps.now());
    } catch (e) {
      if (e instanceof GrantRefusedError && vault) await vault.write("google-nest", { ...g, refused: true }).catch(() => undefined);
      throw new VendorError(e instanceof GrantRefusedError ? 401 : 0);
    }
  }

  async status(): Promise<Found<NestRef>[]> {
    const { project, idKey } = this.deps;
    if (!project || !idKey) return [];
    const token = await this.token();
    const got = obj(await callJson(this.deps.fetch, `${SDM_API}/enterprises/${project}/devices`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error" }));
    const list = Array.isArray(got.devices) ? got.devices : [];
    return list.map((d) => readThermostat(d, idKey)).filter((f): f is Found<NestRef> => f !== null);
  }

  async run(action: ActionId, found: Found<NestRef>, args: RunArgs): Promise<RunResult> {
    const cmd = commandFor(action, args, found.reading.mode);
    if (!cmd) return { ok: false, code: "unsupported" };
    let token: string;
    try {
      token = await this.token();
    } catch {
      return { ok: false, code: "not-connected" };
    }
    const res = await this.deps
      .fetch(`${SDM_API}/${found.ref.name}:executeCommand`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(cmd),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      })
      .catch(() => null);
    if (!res) return { ok: false, code: "vendor" };
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: true };
    }
    // Google answers FAILED_PRECONDITION when eco took over between the read and the command.
    const text = await res.text().catch(() => "");
    if (res.status === 400 && /FAILED_PRECONDITION/.test(text) && /eco/i.test(text)) return { ok: false, code: "eco" };
    return { ok: false, code: "vendor" };
  }
}
