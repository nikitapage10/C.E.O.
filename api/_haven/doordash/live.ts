/**
 * DoorDash wired to the live settings (#1195, docs/HOME-DEVICES.md, "DoorDash"). Azure only. No new secret:
 *
 *   HOME_TOKEN_KEY   seals the CLI's token and a pending sign-in in the private store
 *   DD_CLI_DIR       optional: where the CLI's folder is, instead of bin/dd-cli beside the built module
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../../_blob.js";
import { pickAuthStore } from "../../_desk/store.js";
import { HomeVault, homeKey } from "../devices/vault.js";
import { bundledDir, makeRunner, type DdRunner } from "./cli.js";
import { doordashGet, doordashPost, type DoorDashDeps } from "./route.js";

type Env = Record<string, string | undefined>;

const log = (line: string) => console.log(line);
// One runner per instance, so the CLI is copied to /tmp once.
let runner: DdRunner | null = null;
const cliOf = (env: Env) => (runner ??= makeRunner({ dir: bundledDir(env), log }));

export function doordashDeps(env: Env = process.env): DoorDashDeps {
  const blob = pickBlob(env);
  const sealKey = homeKey(env.HOME_TOKEN_KEY, "seal");
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    blob,
    vault: blob && sealKey ? new HomeVault(blob, sealKey) : null,
    cli: cliOf(env),
    now: Date.now(),
    log,
  };
}

/* ── The handlers Azure registers ── */

export const doordashRoute = {
  GET: (request: Request) => doordashGet(request, doordashDeps()),
  POST: (request: Request) => doordashPost(request, doordashDeps()),
};
