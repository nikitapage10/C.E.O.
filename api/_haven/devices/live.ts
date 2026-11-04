/**
 * The home devices wired to the live settings (#632, docs/HOME-DEVICES.md). Azure only: every login lives in this
 * Function App's Key Vault, and nothing here runs on Vercel.
 *
 *   HOME_TOKEN_KEY                         seals the logins in the private store and keys the device ids (required)
 *   PETLIBRO_EMAIL, PETLIBRO_LOGIN_DIGEST  the Petlibro account and the digest its login takes (Key Vault only)
 *   WHISKER_EMAIL, WHISKER_SRP_DIGEST      the Whisker account and its SRP digest (Key Vault only); without them it waits
 *   HOME_FEED_CAP                          manual feeds a day per feeder (default 2)
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
import { devicesAction, devicesConnect, devicesGet, type DevicesDeps } from "./route.js";
import { HomeVault, homeKey } from "./vault.js";
import { WhiskerClient } from "./whisker.js";

type Env = Record<string, string | undefined>;

/** One Home per warm instance and settings, so its 30-second status cache is shared between requests. */
let kept: { sig: string; home: Home } | null = null;

export function homeFromEnv(env: Env = process.env): Home | null {
  const blob = pickBlob(env);
  const sealKey = homeKey(env.HOME_TOKEN_KEY, "seal");
  const idKey = homeKey(env.HOME_TOKEN_KEY, "id");
  if (!blob || !sealKey || !idKey) return null;
  const sig = [env.HOME_TOKEN_KEY, env.PETLIBRO_EMAIL, env.PETLIBRO_LOGIN_DIGEST, env.WHISKER_EMAIL, env.WHISKER_SRP_DIGEST, env.HOME_FEED_CAP].join("\u0000");
  if (kept?.sig === sig) return kept.home;
  const vault = new HomeVault(blob, sealKey);
  const now = () => Date.now();
  const f = (url: string, init?: RequestInit) => fetch(url, init);
  const home = new Home({
    blob,
    clients: [
      new RoborockClient({ fetch: f, vault, idKey, now }),
      new PetlibroClient({ fetch: f, vault, idKey, email: (env.PETLIBRO_EMAIL ?? "").trim(), loginDigest: (env.PETLIBRO_LOGIN_DIGEST ?? "").trim().toLowerCase(), now }),
      new WhiskerClient({ fetch: f, vault, idKey, email: (env.WHISKER_EMAIL ?? "").trim(), srpDigest: (env.WHISKER_SRP_DIGEST ?? "").trim().toLowerCase(), now }),
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
  };
}

/* ── The handlers Azure registers ── */

export const devicesRoute = { GET: (request: Request) => devicesGet(request, devicesDeps()) };
export const actionRoute = { POST: (request: Request) => devicesAction(request, devicesDeps()) };
export const connectRoute = { POST: (request: Request) => devicesConnect(request, devicesDeps()) };
