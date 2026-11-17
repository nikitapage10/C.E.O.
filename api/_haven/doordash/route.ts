/**
 * DoorDash, phase 0: Connect (#1195, docs/HOME-DEVICES.md, "DoorDash"). DoorDash's own CLI runs in the Function app
 * (./cli.ts); Nikita signs in from the Haven's Kitchen with the CLI's two-step remote sign-in, and the token it prints
 * (about 72 hours, no renewal without a browser) is sealed in the private store with HOME_TOKEN_KEY. No ordering yet.
 * Azure only: azure/src/index.ts registers these behind the site gate.
 *
 *   GET  /api/haven/doordash?view=status  public: { state } only (not-set-up, signed-out, live, expired); with a
 *                                         passkey session also { expiresAt }
 *   GET  /api/haven/doordash              passkey session: { state, expiresAt }
 *   POST /api/haven/doordash              passkey session only (a phone key or bearer is refused):
 *          { action: "signin-start" } → { url, until }   `export-token --start`: DoorDash's sign-in page (only ever
 *                                                        https://identity.doordash.com/authorize), good 10 minutes
 *          { action: "signin-finish", pasted }           `export-token --finish -` with the address the sign-in page
 *                                                        landed on (or its code) on stdin; seals the token
 *          { action: "signout" }                         forgets the token (and any pending sign-in)
 *
 * The pending sign-in lives on the instance's disk between start and finish (the CLI's
 * `~/.config/dd-cli/pending-login.json`: its PKCE verifier and state), and Flex Consumption may send the two calls to
 * different instances, so start seals that file in the private store for ten minutes and finish puts it back first.
 * Nothing here logs a token, a URL, a code or what the CLI printed: ./cli.ts logs the command and its exit code only.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../../_blob.js";
import { readCookie, requireSession, SESSION_COOKIE, withCookie, type DeskDeps } from "../../_desk/session.js";
import type { HomeVault } from "../devices/vault.js";
import { PHONE_KEY_HEADER } from "../links.js";
import { pastedCallback, pendingOk, PENDING_FILE, signInUrl, tokenOf, type DdRunner } from "./cli.js";

/** How long a sign-in started here can be finished (the CLI's own limit). */
export const PENDING_MS = 10 * 60_000;
const BODY_MAX = 8 * 1024;

export type DoorDashState = "not-set-up" | "signed-out" | "live" | "expired";

/** The token, sealed in the private store. */
export interface StoredDoorDash {
  token: string;
  /** ISO time it stops working, or null when the CLI didn't say. */
  expiresAt: string | null;
  signedInAt: string;
}

/** A sign-in in progress: the CLI's pending-login file, and when it was made. */
export interface PendingDoorDash {
  file: string;
  at: number;
}

export interface DoorDashDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  vault: HomeVault | null;
  cli: DdRunner;
  now: number;
  log: (line: string) => void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

const stored = async (vault: HomeVault): Promise<StoredDoorDash | null> => {
  const got = await vault.read<StoredDoorDash>("doordash").catch(() => null);
  return got && typeof got.token === "string" ? got : null;
};

/** The state from what is stored: expired once its expiry has passed (unknown counts as live). */
export function stateOf(ready: boolean, got: StoredDoorDash | null, now: number): DoorDashState {
  if (!ready) return "not-set-up";
  if (!got) return "signed-out";
  const at = got.expiresAt ? Date.parse(got.expiresAt) : NaN;
  return Number.isFinite(at) && at <= now ? "expired" : "live";
}

const isReady = (deps: Pick<DoorDashDeps, "blob" | "vault" | "cli">): deps is { blob: BlobBackend; vault: HomeVault; cli: DdRunner } => Boolean(deps.blob && deps.vault && deps.cli.ready);

/** The state and expiry (the expiry for a passkey session only). */
async function statusOf(deps: DoorDashDeps): Promise<{ state: DoorDashState; expiresAt: string | null }> {
  if (!isReady(deps)) return { state: "not-set-up", expiresAt: null };
  const got = await stored(deps.vault);
  return { state: stateOf(true, got, deps.now), expiresAt: got?.expiresAt ?? null };
}

/** The live token for later phases (#1195): null unless signed in and not past its expiry. */
export async function doordashToken(deps: Pick<DoorDashDeps, "blob" | "vault" | "cli" | "now">): Promise<string | null> {
  if (!isReady(deps)) return null;
  const got = await stored(deps.vault);
  return stateOf(true, got, deps.now) === "live" ? got!.token : null;
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return null;
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return null;
  try {
    const got: unknown = JSON.parse(raw);
    return got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** GET /api/haven/doordash. */
export async function doordashGet(request: Request, deps: DoorDashDeps): Promise<Response> {
  const view = new URL(request.url).searchParams.get("view");
  if (view === "status") {
    const { state, expiresAt } = await statusOf(deps);
    // Signed in, the same call also says when it runs out; the public get the state alone.
    if (readCookie(request, SESSION_COOKIE)) {
      const signed = await requireSession(request, deps.desk);
      if (signed.ok) return withCookie(json({ state, expiresAt }), signed);
    }
    return json({ state });
  }
  if (view !== null) return json({ error: "bad-request" }, 400);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  return withCookie(json(await statusOf(deps)), signed);
}

/** POST /api/haven/doordash: passkey session only. */
export async function doordashPost(request: Request, deps: DoorDashDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer ") || request.headers.has(PHONE_KEY_HEADER)) return json({ error: "unauthorized" }, 401);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const body = await bodyOf(request);
  if (!body) return reply({ error: "bad-request" }, 400);
  if (!isReady(deps)) return reply({ error: "not-set-up", state: "not-set-up" }, 503);
  const { vault, cli, now } = deps;

  if (body.action === "signin-start") {
    const r = await cli.run(["export-token", "--start"], { collect: [PENDING_FILE], timeoutMs: 20_000 });
    const url = r.code === 0 ? signInUrl(r.out) : null;
    const file = r.files[PENDING_FILE];
    if (!url || !pendingOk(file)) {
      deps.log(`doordash: sign-in start ${r.code === 0 ? "gave no usable sign-in" : "failed"}`);
      return reply({ error: "vendor" }, 502);
    }
    await vault.write("doordash-pending", { file, at: now } satisfies PendingDoorDash);
    return reply({ ok: true, url, until: new Date(now + PENDING_MS).toISOString() });
  }

  if (body.action === "signin-finish") {
    const pasted = pastedCallback(body.pasted);
    if (!pasted) return reply({ error: "bad-paste" }, 400);
    const pending = await vault.read<PendingDoorDash>("doordash-pending").catch(() => null);
    if (!pending || !pendingOk(pending.file) || typeof pending.at !== "number" || now - pending.at > PENDING_MS || pending.at > now + 60_000) {
      await vault.forget("doordash-pending");
      return reply({ error: "no-pending" }, 409);
    }
    const r = await cli.run(["export-token", "--finish", "-"], { stdin: `${pasted}\n`, files: { [PENDING_FILE]: pending.file }, timeoutMs: 30_000 });
    const got = r.code === 0 ? tokenOf(r.json) : null;
    if (!got) {
      deps.log(`doordash: sign-in finish ${r.code === 0 ? "gave no usable token" : "refused"}`);
      return reply({ error: r.code === 0 ? "vendor" : "refused" }, r.code === 0 ? 502 : 400);
    }
    await vault.write("doordash", { token: got.token, expiresAt: got.expiresAt, signedInAt: new Date(now).toISOString() } satisfies StoredDoorDash);
    await vault.forget("doordash-pending");
    deps.log("doordash: signed in");
    return reply({ ok: true, state: stateOf(true, { token: got.token, expiresAt: got.expiresAt, signedInAt: "" }, now), expiresAt: got.expiresAt });
  }

  if (body.action === "signout") {
    await Promise.all([vault.forget("doordash"), vault.forget("doordash-pending")]);
    deps.log("doordash: signed out");
    return reply({ ok: true, state: "signed-out", expiresAt: null });
  }

  return reply({ error: "bad-request" }, 400);
}
