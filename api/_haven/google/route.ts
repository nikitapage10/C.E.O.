/**
 * The Haven's connections (#637, docs/HOME-DEVICES.md): Connect Nest, Connect Google Tasks, the Tasks list choice,
 * and every Haven connection's state. Azure only: azure/src/index.ts registers these behind the site gate.
 *
 *   GET  /api/haven/google?view=status   public: { ready, nest, tasks }, each "waiting", "live" or "down".
 *                                        States only, never a list's title, an item or a link.
 *   GET  /api/haven/google               passkey session: what is set up and connected, and the Tasks list's title and
 *                                        its last run's counts.
 *   POST /api/haven/google               passkey session only (a phone key or bearer is refused):
 *          { action: "connect", grant: "nest" | "tasks" }   → { url }: Google's page, and a short state cookie
 *          { action: "disconnect", grant }                   forgets that grant (and asks Google to revoke it)
 *          { action: "tasks-list", title }                   which Tasks list to read (default "Shopping")
 *          { action: "tasks-sync" }                          runs the quick-add now → { result, imported, skipped }
 *   GET  /api/haven/google-callback      where Google sends the browser back; then to the Desk with ?haven=<result>
 *
 * The state cookie works as Connect Gmail's does (api/_email/route.ts): 24 random bytes sent to Google as `state`, set
 * in a signed, HttpOnly, Secure, SameSite=Lax `__Host-` cookie good for ten minutes that names the grant and the
 * passkey that asked. The callback takes the code only when that cookie is ours, unexpired, its passkey still
 * enrolled, and its nonce equals `state` (constant time). Nothing here logs a code, a token, a list title or an item.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { BlobBackend } from "../../_blob.js";
import { deskKeyFor } from "../../_desk/keys.js";
import { readCookie, readToken, requireSession, signToken, withCookie, type DeskDeps } from "../../_desk/session.js";
import type { Fetch } from "../devices/http.js";
import type { VendorState } from "../devices/home.js";
import type { HomeVault } from "../devices/vault.js";
import { PHONE_KEY_HEADER } from "../links.js";
import { SDM_API } from "./nest.js";
import { accessToken, authUrl, exchangeCode, forgetTokens, isGrant, redirectFor, revoke, type Grant, type HavenClient, type StoredGrant } from "./oauth.js";
import { listTitle, readTasksState, setTasksList, syncTasks, type TasksResult } from "./tasks.js";

export const STATE_COOKIE = "__Host-ceo-haven-google";
export const STATE_S = 10 * 60;
const BODY_MAX = 4 * 1024;

export interface GoogleRouteDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  vault: HomeVault | null;
  client: HavenClient | null;
  project: string | null;
  fetch: Fetch;
  now: number;
  log: (line: string) => void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

function redirect(to: string, cookies: string[] = []): Response {
  const res = new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

const stateCookie = (value: string, maxAge: number) => `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;

/** The state cookie and the nonce for Google, for a connect of `grant` by `passkey`. */
export async function makeState(deskKey: string, grant: Grant, passkey: string, now: number): Promise<{ nonce: string; cookie: string }> {
  const nonce = randomBytes(24).toString("base64url");
  const token = signToken(await deskKeyFor(deskKey, "haven-google"), { t: "haven-google", g: grant, n: nonce, c: passkey, e: Math.floor(now / 1000) + STATE_S });
  return { nonce, cookie: stateCookie(token, STATE_S) };
}

/** The grant and passkey of a callback we sent to Google, or null. */
export async function checkState(deskKey: string, cookieValue: string | null, state: string | null, now: number): Promise<{ grant: Grant; passkey: string } | null> {
  if (!deskKey || !cookieValue || !state || state.length > 128) return null;
  const p = readToken(await deskKeyFor(deskKey, "haven-google"), cookieValue);
  if (!p || p.t !== "haven-google" || !isGrant(p.g) || typeof p.n !== "string" || typeof p.c !== "string" || typeof p.e !== "number") return null;
  if (p.e <= Math.floor(now / 1000)) return null;
  const a = Buffer.from(p.n);
  const b = Buffer.from(state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { grant: p.g, passkey: p.c };
}

const vaultName = (g: Grant): "google-nest" | "google-tasks" => (g === "nest" ? "google-nest" : "google-tasks");

async function grantOf(deps: GoogleRouteDeps, g: Grant): Promise<StoredGrant | null> {
  return deps.vault ? await deps.vault.read<StoredGrant>(vaultName(g)).catch(() => null) : null;
}

/** The Google connections' states: waiting until set up and connected, down when Google refused or a run failed. */
export async function havenLinks(deps: Pick<GoogleRouteDeps, "blob" | "vault" | "client" | "project">): Promise<{ nest: VendorState; tasks: VendorState }> {
  const read = (g: Grant) => (deps.vault ? deps.vault.read<StoredGrant>(vaultName(g)).catch(() => null) : Promise.resolve(null));
  const [nest, tasks, tasksState] = await Promise.all([read("nest"), read("tasks"), deps.blob ? readTasksState(deps.blob).catch(() => null) : null]);
  const grantState = (g: StoredGrant | null, ready: boolean): VendorState => (!ready || !g ? "waiting" : g.refused ? "down" : "live");
  const down: TasksResult[] = ["refused", "failed"];
  const t = grantState(tasks, Boolean(deps.client));
  return {
    nest: grantState(nest, Boolean(deps.client && deps.project)),
    tasks: t === "live" && tasksState?.lastResult && down.includes(tasksState.lastResult) ? "down" : t,
  };
}

/** GET /api/haven/google. */
export async function googleGet(request: Request, deps: GoogleRouteDeps): Promise<Response> {
  const view = new URL(request.url).searchParams.get("view");
  if (view === "status") return json({ ready: Boolean(deps.blob && deps.vault), ...(await havenLinks(deps)) });
  if (view !== null) return json({ error: "bad-request" }, 400);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const [nest, tasks, links] = await Promise.all([grantOf(deps, "nest"), grantOf(deps, "tasks"), havenLinks(deps)]);
  const tasksState = deps.blob ? await readTasksState(deps.blob).catch(() => null) : null;
  return reply({
    ready: Boolean(deps.blob && deps.vault),
    links,
    google: Boolean(deps.client),
    nest: { project: Boolean(deps.project), connected: Boolean(nest && !nest.refused), refused: Boolean(nest?.refused) },
    tasks: { connected: Boolean(tasks && !tasks.refused), refused: Boolean(tasks?.refused), ...(tasksState ?? {}) },
  });
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

/** POST /api/haven/google: passkey session only. */
export async function googlePost(request: Request, deps: GoogleRouteDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer ") || request.headers.has(PHONE_KEY_HEADER)) return json({ error: "unauthorized" }, 401);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const body = await bodyOf(request);
  if (!body) return reply({ error: "bad-request" }, 400);
  if (!deps.blob || !deps.vault) return reply({ error: "not-set-up" }, 503);

  if (body.action === "connect") {
    if (!isGrant(body.grant)) return reply({ error: "bad-request" }, 400);
    if (!deps.client) return reply({ error: "not-set-up" }, 503);
    if (body.grant === "nest" && !deps.project) return reply({ error: "no-project" }, 503);
    const { nonce, cookie } = await makeState(deps.desk.deskKey, body.grant, signed.passkey.id, deps.now);
    const url = authUrl(body.grant, redirectFor(deps.client, request), nonce, deps.project);
    if (!url) return reply({ error: "no-project" }, 503);
    const res = reply({ ok: true, url });
    res.headers.append("Set-Cookie", cookie);
    return res;
  }
  if (body.action === "disconnect") {
    if (!isGrant(body.grant)) return reply({ error: "bad-request" }, 400);
    const g = await grantOf(deps, body.grant);
    if (g) await revoke(deps.fetch, g.refresh);
    await deps.vault.forget(vaultName(body.grant));
    forgetTokens();
    deps.log(`haven: google ${body.grant} disconnected`);
    return reply({ ok: true, connected: false });
  }
  if (body.action === "tasks-list") {
    const title = listTitle(body.title);
    if (!title) return reply({ error: "bad-title" }, 400);
    const state = await setTasksList(deps.blob, title);
    return reply({ ok: true, list: state.list });
  }
  if (body.action === "tasks-sync") {
    const got = await syncTasks({ fetch: deps.fetch, client: deps.client, vault: deps.vault, blob: deps.blob, now: () => deps.now, log: deps.log });
    return reply({ ok: got.result === "synced", ...got }, got.result === "synced" ? 200 : got.result === "waiting" ? 503 : got.result === "no-list" ? 404 : 502);
  }
  return reply({ error: "bad-request" }, 400);
}

/** GET /api/haven/google-callback. */
export async function googleCallback(request: Request, deps: GoogleRouteDeps): Promise<Response> {
  const url = new URL(request.url);
  const back = (result: string) => redirect(`/?haven=${result}`, [stateCookie("", 0)]);
  const checked = await checkState(deps.desk.deskKey, readCookie(request, STATE_COOKIE), url.searchParams.get("state"), deps.now).catch(() => null);
  if (!checked || !deps.desk.store) return back("refused");
  const enrolled = (await deps.desk.store.passkeys().catch(() => [])).some((p) => p.id === checked.passkey);
  if (!enrolled) return back("refused");
  const { grant } = checked;
  if (url.searchParams.get("error")) return back(`${grant}-cancelled`);
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048 || !deps.client || !deps.vault) return back(`${grant}-failed`);
  try {
    const client = redirectFor(deps.client, request);
    const refresh = await exchangeCode(deps.fetch, grant, client, code);
    await deps.vault.write(vaultName(grant), { refresh, connectedAt: deps.now } satisfies StoredGrant);
    forgetTokens();
    // Google finishes a Device Access authorization only once the devices are listed (the Nest guide's own step).
    if (grant === "nest" && deps.project) {
      const token = await accessToken(deps.fetch, client, "nest", refresh, deps.now).catch(() => null);
      if (token) {
        const res = await deps.fetch(`${SDM_API}/enterprises/${deps.project}/devices`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
        await res?.body?.cancel().catch(() => undefined);
      }
    }
    deps.log(`haven: google ${grant} connected`);
    return back(`${grant}-connected`);
  } catch {
    deps.log(`haven: google ${grant} connect failed`);
    return back(`${grant}-failed`);
  }
}
