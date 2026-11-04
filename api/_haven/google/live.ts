/**
 * The Haven's connections wired to the live settings (#637, docs/HOME-DEVICES.md). Azure only:
 *
 *   HAVEN_GOOGLE_CLIENT_ID, HAVEN_GOOGLE_CLIENT_SECRET   the Google OAuth client (Key Vault)
 *   HAVEN_NEST_PROJECT_ID                                 the Device Access project's id (Key Vault)
 *   HOME_TOKEN_KEY                                        seals the two Google grants in the private store
 *   INSTACART_API_KEY, INSTACART_ENV                      Send to Instacart (api/_haven/instacart.ts)
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../../_blob.js";
import { pickAuthStore } from "../../_desk/store.js";
import { HomeVault, homeKey } from "../devices/vault.js";
import { instacartFrom } from "../instacart.js";
import { googleCallback, googleGet, googlePost, havenLinks, type GoogleRouteDeps } from "./route.js";
import { havenClientFrom, nestProjectFrom } from "./oauth.js";
import { syncTasks, type TasksResult } from "./tasks.js";

type Env = Record<string, string | undefined>;

export function googleDeps(env: Env = process.env): GoogleRouteDeps {
  const blob = pickBlob(env);
  const sealKey = homeKey(env.HOME_TOKEN_KEY, "seal");
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    blob,
    vault: blob && sealKey ? new HomeVault(blob, sealKey) : null,
    client: havenClientFrom(env),
    project: nestProjectFrom(env),
    instacart: instacartFrom(env),
    fetch: (url, init) => fetch(url, init),
    now: Date.now(),
    log: (line) => console.log(line),
  };
}

/** Every Haven connection's state, for the devices route's answers (and so Systems). */
export const linksFromEnv = (env: Env = process.env) => havenLinks(googleDeps(env));

/** One run of the Google Tasks quick-add, for the Function App's timer. */
export async function runTasksTick(env: Env = process.env): Promise<TasksResult> {
  const d = googleDeps(env);
  const got = await syncTasks({ fetch: d.fetch, client: d.client, vault: d.vault, blob: d.blob, now: Date.now, log: d.log });
  return got.result;
}

/* ── The handlers Azure registers ── */

export const googleRoute = {
  GET: (request: Request) => googleGet(request, googleDeps()),
  POST: (request: Request) => googlePost(request, googleDeps()),
};
export const googleCallbackRoute = { GET: (request: Request) => googleCallback(request, googleDeps()) };
