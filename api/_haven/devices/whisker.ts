/**
 * The Whisker Litter-Robot 5 Pro (#632, docs/HOME-DEVICES.md), ported from pylitterbot's documented LR5 path
 * (pylitterbot/robot/litterrobot5.py, pylitterbot/session.py). The LR5 and LR5 Pro speak plain REST, unlike the LR4's
 * GraphQL:
 *
 *   Sign-in   Whisker's Cognito user pool (us-east-1), SRP with the email and password from the Key Vault
 *             (api/_haven/devices/cognito.ts); the tokens are sealed and refreshed with the refresh token.
 *   GET  https://ub.prod.iothings.site/robots                         every robot: serial, name, type, state
 *   GET  https://ub.prod.iothings.site/robots/{serial}/activities     the last pet visit (`type=PET_VISIT`)
 *   POST https://ub.prod.iothings.site/robots/{serial}/commands       {"type":"CLEAN_CYCLE"}
 *
 * Each request carries the Cognito id token as a bearer. The pool and client ids are the Whisker app's own public
 * identifiers (pylitterbot ships them too), not secrets.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { srpSignIn, refreshTokens, type CognitoPool, type CognitoTokens } from "./cognito.js";
import { callJson, VendorError, withQuery, type Fetch } from "./http.js";
import { isoOf, obj, pct, PLACES, str, type DeviceClient, type DeviceReading, type Found, type RunResult } from "./types.js";
import { deviceId, type HomeVault } from "./vault.js";

export const WHISKER_POOL: CognitoPool = { poolId: "us-east-1_rjhNnZVAm", clientId: "4552ujeu3aic90nf8qn53levmn" };
export const LR5_ENDPOINT = "https://ub.prod.iothings.site";
const UA = "ceo-haven/1";

/** pylitterbot's LitterBoxStatus, folded into the few words the Desk shows. */
export type LitterState = "ready" | "cycling" | "cat-inside" | "drawer full" | "paused" | "bonnet off" | "starting" | "off" | "offline" | "unknown";

const BY_STATE: Record<string, LitterState> = {
  StRobotBonnet: "bonnet off",
  StRobotCatDetect: "cat-inside",
  StRobotCatDetectDelay: "cat-inside",
  StRobotClean: "cycling",
  StRobotEmpty: "cycling",
  StRobotFindDump: "cycling",
  StRobotIdle: "ready",
  StRobotPowerDown: "off",
  StRobotPowerOff: "off",
  StRobotPowerUp: "starting",
  ROBOT_BONNET: "bonnet off",
  ROBOT_CAT_DETECT: "cat-inside",
  ROBOT_CAT_DETECT_DELAY: "cat-inside",
  ROBOT_CLEAN: "cycling",
  ROBOT_EMPTY: "cycling",
  ROBOT_FIND_DUMP: "cycling",
  ROBOT_IDLE: "ready",
  ROBOT_POWER_DOWN: "off",
  ROBOT_POWER_OFF: "off",
  ROBOT_POWER_UP: "starting",
};
const BY_DISPLAY: Record<string, LitterState> = { DcCatDetect: "cat-inside", DcDfiFull: "drawer full", DcModeCycle: "cycling", DcModeIdle: "ready", DcxLampTest: "starting", DcxSuspend: "off", DC_CAT_DETECT: "cat-inside" };
const BY_INDICATOR: Record<string, LitterState> = { READY: "ready", DRAWER_FULL: "drawer full", CYCLING: "cycling", LITTER_LOW: "ready", CAT_DETECTED: "cat-inside", BONNET_REMOVED: "bonnet off", OFF: "off", OFFLINE: "offline" };
const BY_CYCLE: Record<string, LitterState> = { StCatDetect: "cat-inside", StPause: "paused", CYCLE_STATE_CAT_DETECT: "cat-inside", CYCLE_STATE_PAUSE: "paused" };

/** The robot's state, in pylitterbot's order: offline, an interrupted cycle, the state, the display code, the indicator. */
export function litterState(robot: unknown): LitterState {
  const s = obj(obj(robot).state);
  if (s.isOnline !== true) return "offline";
  const full = s.isDrawerFull === true;
  const ready = (v: LitterState) => (v === "ready" && full ? "drawer full" : v);
  const cycle = BY_CYCLE[str(s.cycleState) || str(s.robotCycleState)];
  if (cycle) return cycle;
  const st = BY_STATE[str(s.state)];
  if (st) return ready(st);
  const dc = BY_DISPLAY[str(s.displayCode)];
  if (dc) return ready(dc);
  const ind = BY_INDICATOR[str(obj(s.statusIndicator).type)];
  if (ind) return ready(ind);
  const raw = (str(s.status) || str(s.robotStatus)).trim().toUpperCase();
  if (BY_STATE[raw]) return ready(BY_STATE[raw]!);
  if (raw === "READY" || raw === "IDLE") return ready("ready");
  if (raw.includes("CLEAN") || raw.includes("DUMP")) return "cycling";
  if (raw.includes("CAT")) return "cat-inside";
  return "unknown";
}

export const MODEL_NAMES: Record<string, string> = { LR5: "Litter-Robot 5", LR5_PRO: "Litter-Robot 5 Pro" };

/** A robot's reading. `lastUse` comes from its activities, read separately. */
export function litterReading(id: string, robot: unknown, lastUse: string | null): DeviceReading {
  const r = obj(robot);
  const s = obj(r.state);
  const state = litterState(robot);
  const alerts: string[] = [];
  if (s.isDrawerFull === true || state === "drawer full") alerts.push("drawer full");
  if (s.isDrawerRemoved === true) alerts.push("drawer out");
  if (s.isBonnetRemoved === true) alerts.push("bonnet off");
  if (s.isLaserDirty === true) alerts.push("sensors need a wipe");
  if (str(obj(s.statusIndicator).type) === "LITTER_LOW" || str(s.globeLitterLevelIndicator).toUpperCase() === "LOW") alerts.push("litter low");
  return {
    id,
    vendor: "whisker",
    kind: "litter",
    model: MODEL_NAMES[str(r.type)] ?? (str(r.type).startsWith("LR4") ? "Litter-Robot 4" : "Litter-Robot"),
    place: PLACES.litter,
    online: state !== "offline",
    state,
    alerts,
    drawer: pct(s.dfiLevelPercent),
    litter: pct(s.litterLevelPercent),
    lastUse,
    catInside: state === "cat-inside",
  };
}

/** Whether a clean cycle may start now: online, idle, no cat, the drawer not full, the bonnet on. */
export const litterReady = (r: DeviceReading) => r.online && r.state === "ready" && !r.catInside;

export interface WhiskerDeps {
  fetch: Fetch;
  vault: HomeVault | null;
  idKey: Buffer | null;
  email: string;
  password: string;
  now: () => number;
}

export interface WhiskerRef {
  serial: string;
}

export class WhiskerClient implements DeviceClient<WhiskerRef> {
  readonly vendor = "whisker" as const;
  readonly actions = ["litter.clean"] as const;
  constructor(private readonly deps: WhiskerDeps) {}

  async connected(): Promise<boolean> {
    return Boolean(this.deps.email && this.deps.password && this.deps.vault && this.deps.idKey);
  }

  /** A good id token: the sealed one, refreshed when it is within a minute of expiring, or a fresh sign-in. */
  private async token(force = false): Promise<string | null> {
    const { vault, email, password, fetch: f } = this.deps;
    if (!vault || !email || !password) return null;
    const now = this.deps.now();
    let t = force ? null : await vault.read<CognitoTokens>("whisker").catch(() => null);
    if (t && t.expires - now < 60_000) {
      t = await refreshTokens(f, WHISKER_POOL, t.refreshToken).catch(() => null);
      if (t) await vault.write("whisker", t);
    }
    if (!t) {
      t = await srpSignIn(f, WHISKER_POOL, email, password, now);
      await vault.write("whisker", t);
    }
    return t.idToken;
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const go = async (force: boolean) => {
      const token = await this.token(force);
      if (!token) throw new VendorError(401);
      return callJson(this.deps.fetch, path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}`, "User-Agent": UA } });
    };
    try {
      return await go(false);
    } catch (e) {
      // A token Whisker no longer takes: sign in again once.
      if (e instanceof VendorError && e.status === 401) return go(true);
      throw e;
    }
  }

  async status(): Promise<Found<WhiskerRef>[]> {
    const { idKey } = this.deps;
    if (!idKey || !(await this.connected())) return [];
    const robots = await this.call(`${LR5_ENDPOINT}/robots`);
    const out: Found<WhiskerRef>[] = [];
    for (const robot of Array.isArray(robots) ? robots : []) {
      const serial = str(obj(robot).serial);
      if (!serial) continue;
      let lastUse: string | null = null;
      try {
        const acts = await this.call(withQuery(`${LR5_ENDPOINT}/robots/${encodeURIComponent(serial)}/activities`, { limit: 5, type: "PET_VISIT" }));
        lastUse = Array.isArray(acts) ? (acts.map((a) => isoOf(obj(a).timestamp)).find(Boolean) ?? null) : null;
      } catch {
        /* no last visit to show */
      }
      out.push({ reading: litterReading(deviceId(idKey, "whisker", serial), robot, lastUse), ref: { serial } });
    }
    return out;
  }

  async run(action: string, found: Found<WhiskerRef>): Promise<RunResult> {
    if (action !== "litter.clean") return { ok: false, code: "unsupported" };
    try {
      await this.call(`${LR5_ENDPOINT}/robots/${encodeURIComponent(found.ref.serial)}/commands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "CLEAN_CYCLE" }) });
      return { ok: true };
    } catch (e) {
      return { ok: false, code: e instanceof VendorError && e.status === 401 ? "not-connected" : "vendor" };
    }
  }
}
