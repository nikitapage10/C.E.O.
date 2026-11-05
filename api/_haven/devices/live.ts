/**
 * The home devices wired to the live settings (#632, docs/HOME-DEVICES.md). Azure only: every login lives in this
 * Function App's Key Vault, and nothing here runs on Vercel.
 *
 *   HOME_TOKEN_KEY                         seals the logins in the private store and keys the device ids (required)
 *   PETLIBRO_EMAIL, PETLIBRO_LOGIN_DIGEST  the Petlibro account and the digest its login takes (Key Vault only)
 *   WHISKER_EMAIL, WHISKER_SRP_DIGEST      the Whisker account and its SRP digest (Key Vault only); without them it waits
 *   HOME_FEED_CAP                          manual feeds a day per feeder (default 2)
 *   HAVEN_GOOGLE_CLIENT_ID/SECRET,         the Nest thermostat (#637, api/_haven/google/): the Google OAuth client and the
 *   HAVEN_NEST_PROJECT_ID                  Device Access project; the grant comes from Connect Nest, sealed in the store
 *
 * The Roborock login comes from Connect Roborock on the Desk and is sealed in the store.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../../_blob.js";
import { deskKeyFor } from "../../_desk/keys.js";
import { pickAuthStore } from "../../_desk/store.js";
import { BlobRoomLog } from "../../_skippy/log.js";
import { Home } from "./home.js";
import { PetlibroClient } from "./petlibro.js";
import { feedCap } from "./rails.js";
import { RoborockClient } from "./roborock.js";
import { devicesAction, devicesConnect, devicesGet, devicesMap, type DevicesDeps } from "./route.js";
import { HomeVault, homeKey } from "./vault.js";
import { WhiskerClient } from "./whisker.js";
import { NestClient } from "../google/nest.js";
import { havenClientFrom, nestProjectFrom } from "../google/oauth.js";
import { linksFromEnv } from "../google/live.js";

type Env = Record<string, string | undefined>;

/** One Home per warm instance and settings, so its 30-second status cache is shared between requests. */
let kept: { sig: string; home: Home } | null = null;

export function homeFromEnv(env: Env = process.env): Home | null {
  const blob = pickBlob(env);
  const sealKey = homeKey(env.HOME_TOKEN_KEY, "seal");
  const idKey = homeKey(env.HOME_TOKEN_KEY, "id");
  if (!blob || !sealKey || !idKey) return null;
  const sig = [env.HOME_TOKEN_KEY, env.PETLIBRO_EMAIL, env.PETLIBRO_LOGIN_DIGEST, env.WHISKER_EMAIL, env.WHISKER_SRP_DIGEST, env.HOME_FEED_CAP, env.HAVEN_GOOGLE_CLIENT_ID, env.HAVEN_GOOGLE_CLIENT_SECRET, env.HAVEN_NEST_PROJECT_ID].join("\u0000");
  if (kept?.sig === sig) return kept.home;
  const vault = new HomeVault(blob, sealKey);
  const now = () => Date.now();
  const f = (url: string, init?: RequestInit) => fetch(url, init);
  const home = new Home({
    blob,
    clients: [
      new RoborockClient({ fetch: f, vault, idKey, now }),
      new PetlibroClient({ fetch: f, vault, idKey, email: (env.PETLIBRO_EMAIL ?? "").trim(), loginDigest: (env.PETLIBRO_LOGIN_DIGEST ?? "").trim().toLowerCase(), now, log: (line) => console.log(line) }),
      new WhiskerClient({ fetch: f, vault, idKey, email: (env.WHISKER_EMAIL ?? "").trim(), srpDigest: (env.WHISKER_SRP_DIGEST ?? "").trim().toLowerCase(), now }),
      new NestClient({ fetch: f, vault, idKey, client: havenClientFrom(env), project: nestProjectFrom(env), now }),
    ],
    feedCap: feedCap(env.HOME_FEED_CAP),
    council: new BlobRoomLog(blob),
    log: (line) => console.log(line),
    now,
  });
  kept = { sig, home };
  return home;
}

export function devicesDeps(env: Env = process.env): DevicesDeps {
  const deskKey = env.FOUNDRY_DESK_KEY ?? "";
  const blob = pickBlob(env);
  const sealKey = homeKey(env.HOME_TOKEN_KEY, "seal");
  return {
    desk: { deskKey, store: pickAuthStore(env), now: Date.now() },
    blob,
    pepper: () => deskKeyFor(deskKey, "phone"),
    home: () => homeFromEnv(env),
    vault: blob && sealKey ? new HomeVault(blob, sealKey) : null,
    fetch: (url, init) => fetch(url, init),
    log: (line) => console.log(line),
    links: () => linksFromEnv(env),
    liveMap: (device) => new RoborockClient({ fetch: (url, init) => fetch(url, init), vault: blob && sealKey ? new HomeVault(blob, sealKey) : null, idKey: homeKey(env.HOME_TOKEN_KEY, "id"), now: Date.now }).liveMap(device),
  };
}

/** The wet tray's auto-close (#713), from the haven_tasks timer: closes an opening from here once its two hours are up. */
export async function runWetClose(env: Env = process.env): Promise<string> {
  const home = homeFromEnv(env);
  if (!home) return "idle";
  return home.closeDue().catch(() => "failed");
}

/* ── The handlers Azure registers ── */

export const devicesRoute = { GET: (request: Request) => devicesGet(request, devicesDeps()) };
export const actionRoute = { POST: (request: Request) => devicesAction(request, devicesDeps()) };
export const mapRoute = { GET: (request: Request) => devicesMap(request, devicesDeps()) };
export const connectRoute = { POST: (request: Request) => devicesConnect(request, devicesDeps()) };
