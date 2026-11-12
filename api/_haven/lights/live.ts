/**
 * The Haven's lights wired to the live settings (#931). Azure only; each key is a Key Vault reference
 * (infra/resources.bicep), settable on the Desk's Keys form (api/_keys/allowlist.ts):
 *
 *   SWITCHBOT_TOKEN, SWITCHBOT_SECRET   `switchbot-token`, `switchbot-secret`: the SwitchBot app's Developer Options
 *   GOVEE_API_KEY                       `govee-api-key`: the key Govee emails from the Govee Home app
 *   HOME_TOKEN_KEY                      keys the lights' opaque ids, as it does the other home devices' (required)
 *
 * #1077: the last good Govee list, Govee's pause and the day's Govee call count are kept in the private store
 * (GOVEE_KEEP_PATH), so a cold instance still lists the lamps while Govee is down. Nothing here polls on a timer.
 *
 * Either vendor alone is enough; without both, or without HOME_TOKEN_KEY, the lights wait (503).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../../_blob.js";
import { pickAuthStore } from "../../_desk/store.js";
import { homeKey } from "../devices/vault.js";
import { Govee } from "./govee.js";
import { Lights, type LightsKeep } from "./lights.js";
import { lightsGet, lightsPost, type LightsRouteDeps } from "./route.js";
import { SwitchBot } from "./switchbot.js";

type Env = Record<string, string | undefined>;

export const GOVEE_KEEP_PATH = "haven/lights-govee.json";

/** The kept Govee file in the Haven's private store (#1077). */
export function blobKeep(blob: BlobBackend): LightsKeep {
  return {
    read: async () => {
      const found = await blob.get(GOVEE_KEEP_PATH);
      return found ? await new Response(found.stream).json().catch(() => null) : null;
    },
    write: async (value) => {
      await blob.put(GOVEE_KEEP_PATH, JSON.stringify(value), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
    },
  };
}

/** One service per warm instance and settings, so its short caches are shared between requests. */
let kept: { sig: string; lights: Lights } | null = null;

export function lightsFromEnv(env: Env = process.env): Lights | null {
  const idKey = homeKey(env.HOME_TOKEN_KEY, "id");
  const sbToken = (env.SWITCHBOT_TOKEN ?? "").trim(), sbSecret = (env.SWITCHBOT_SECRET ?? "").trim(), govKey = (env.GOVEE_API_KEY ?? "").trim();
  if (!idKey || (!(sbToken && sbSecret) && !govKey)) return null;
  const sig = [env.HOME_TOKEN_KEY, sbToken, sbSecret, govKey].join("\u0000");
  if (kept?.sig === sig) return kept.lights;
  const f = (url: string, init?: RequestInit) => fetch(url, init);
  const blob = govKey ? pickBlob(env) : null;
  const lights = new Lights({
    switchbot: sbToken && sbSecret ? new SwitchBot(f, sbToken, sbSecret) : null,
    govee: govKey ? new Govee(f, govKey) : null,
    idKey,
    now: () => Date.now(),
    log: (line) => console.log(line),
    keep: blob ? blobKeep(blob) : null,
  });
  kept = { sig, lights };
  return lights;
}

export function lightsDeps(env: Env = process.env): LightsRouteDeps {
  return { desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() }, lights: () => lightsFromEnv(env) };
}

export const lightsRoute = {
  GET: (request: Request) => lightsGet(request, lightsDeps()),
  POST: (request: Request) => lightsPost(request, lightsDeps()),
};
