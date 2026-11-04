/**
 * Send to King Soopers wired to the live settings (#664, docs/HOME-DEVICES.md, "King Soopers"). Azure only:
 *
 *   KROGER_CLIENT_ID, KROGER_CLIENT_SECRET   the Kroger app (Key Vault `kroger-client-id`, `kroger-client-secret`)
 *   HOME_TOKEN_KEY                           seals the cart grant in the private store
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../../_blob.js";
import { pickAuthStore } from "../../_desk/store.js";
import { HomeVault, homeKey } from "../devices/vault.js";
import { krogerClientFrom } from "./api.js";
import { krogerCallback, krogerGet, krogerLink, krogerPost, type KrogerDeps } from "./route.js";

type Env = Record<string, string | undefined>;

export function krogerDeps(env: Env = process.env): KrogerDeps {
  const blob = pickBlob(env);
  const sealKey = homeKey(env.HOME_TOKEN_KEY, "seal");
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    blob,
    vault: blob && sealKey ? new HomeVault(blob, sealKey) : null,
    client: krogerClientFrom(env),
    fetch: (url, init) => fetch(url, init),
    now: Date.now(),
    log: (line) => console.log(line),
  };
}

/** The King Soopers link's state, for the devices route's answers (and so Systems). */
export const krogerLinkFromEnv = (env: Env = process.env) => krogerLink(krogerDeps(env));

/* ── The handlers Azure registers ── */

export const krogerRoute = {
  GET: (request: Request) => krogerGet(request, krogerDeps()),
  POST: (request: Request) => krogerPost(request, krogerDeps()),
};
export const krogerCallbackRoute = { GET: (request: Request) => krogerCallback(request, krogerDeps()) };
