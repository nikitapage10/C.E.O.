/**
 * The Keys form, browser side (#330; api/_keys/route.ts). Write-only: the page sends a key once, with a fresh passkey
 * answer, and never gets one back. It only learns each allowlisted key's name, whether the vault has it, and when it
 * was written. The value lives in the input until it is sent, then the form forgets it, sent or not.
 */

import { ago } from "../foundryGraph.ts";
import { assertionJson, canPasskey, requestOptions } from "../signin.ts";

export interface KeyRow {
  name: string;
  label: string;
  from: string;
  /** Whether the vault has it; null when that couldn't be read. */
  set: boolean | null;
  /** When its current version was written (ms). */
  updated: number | null;
  /** When it was last set from the Desk (ms). */
  lastSet: number | null;
  /** A list over several lines: the form gives it a textarea that keeps newlines. */
  multiline?: boolean;
}

export interface KeysView {
  vault: "ok" | "none" | "error";
  keys: KeyRow[];
}

/** off: no keys route here (the Vercel copy, or a local build). out: the session is gone. */
export type KeysLoad = { state: "ready"; view: KeysView } | { state: "off" } | { state: "out" } | { state: "failed" };

export async function loadKeys(f: typeof fetch = fetch): Promise<KeysLoad> {
  try {
    const res = await f("/api/keys", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405) return { state: "off" };
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return { state: "failed" };
    return { state: "ready", view: (await res.json()) as KeysView };
  } catch {
    return { state: "failed" };
  }
}

/** One line on where a key stands: set or not, and when. Never anything of the value. */
export function keyLine(row: KeyRow, now: number): string {
  if (row.set === null) return "Can't tell yet";
  if (!row.set) return "Not set";
  const parts = ["Set"];
  if (row.updated) parts.push(`written ${ago(row.updated, now)}`);
  if (row.lastSet) parts.push(`from the Desk ${ago(row.lastSet, now)}`);
  return parts.join(", ");
}

export type SetResult = "ok" | "cancelled" | "step-up" | "not-allowed" | "bad-value" | "locked" | "out" | "no-vault" | "vault" | "unsupported" | "failed";

export const SET_NOTE: Record<Exclude<SetResult, "ok">, string> = {
  cancelled: "The passkey was closed, so nothing was sent.",
  "step-up": "The passkey didn't check out. Nothing was set.",
  "not-allowed": "That key can't be set from the Desk.",
  "bad-value": "That doesn't look like a key: one line (a list, several), up to 4,096 characters.",
  locked: "Too many in a row. Wait a few minutes and try again.",
  out: "Your session ended. Sign in again.",
  "no-vault": "The Key Vault isn't connected here yet.",
  vault: "The Key Vault said no. Nothing was set; the role paste in docs/AZURE.md may not have run yet.",
  unsupported: "This browser can't use passkeys.",
  failed: "That didn't go through. Try again.",
};

const post = (f: typeof fetch, body: unknown) => f("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });

/**
 * What the step-up is bound to (#330, api/_keys/route.ts, writeHash): sha256(name + "\n" + value), hex, over the value
 * as the server will store it (trimmed). The server hands out a passkey request for that hash only, and refuses the
 * answer for any other name or value.
 */
export async function writeHash(name: string, value: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(`${name}\n${value.trim()}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The step-up's options fetched ahead (once the value has been typed), so the tap goes straight to the passkey
 * prompt: some browsers only show it while the tap is fresh. Each is for one name and value (by hash), so a changed
 * value fetches again. The challenge lasts two minutes; these are used for ninety seconds.
 */
let ahead: { h: string; options: Promise<Response | null>; at: number } | null = null;
const AHEAD_MS = 90_000;

export async function prepareStepUp(name: string, value: string, f: typeof fetch = fetch): Promise<void> {
  if (!value.trim()) return;
  const h = await writeHash(name, value).catch(() => null);
  if (!h || (ahead && ahead.h === h && Date.now() - ahead.at < AHEAD_MS)) return;
  ahead = { h, options: post(f, { action: "options", h }).catch(() => null), at: Date.now() };
}

function takeOptions(h: string, f: typeof fetch): Promise<Response | null> {
  const fresh = ahead && ahead.h === h && Date.now() - ahead.at < AHEAD_MS ? ahead.options : null;
  ahead = null;
  return fresh ?? post(f, { action: "options", h }).catch(() => null);
}

const ERROR: Record<string, SetResult> = { "step-up": "step-up", "not-allowed": "not-allowed", "bad-value": "bad-value", "no-vault": "no-vault", vault: "vault", "signed-out": "out" };

/** Sets one key: the passkey prompt (the step-up), then the write. */
export async function setKey(name: string, value: string, f: typeof fetch = fetch, creds: CredentialsContainer | null = typeof navigator === "undefined" ? null : navigator.credentials): Promise<SetResult> {
  if (!canPasskey() || !creds) return "unsupported";
  const h = await writeHash(name, value).catch(() => null);
  if (!h) return "unsupported";
  const opts = await takeOptions(h, f);
  if (!opts) return "failed";
  if (opts.status === 401) return "out";
  if (opts.status === 429) return "locked";
  if (!opts.ok) return "failed";
  let cred: PublicKeyCredential | null;
  try {
    cred = (await creds.get({ publicKey: requestOptions((await opts.json()) as Parameters<typeof requestOptions>[0]) })) as PublicKeyCredential | null;
  } catch {
    return "cancelled";
  }
  if (!cred) return "cancelled";
  const res = await post(f, { action: "set", name, value, response: assertionJson(cred) }).catch(() => null);
  if (!res) return "failed";
  if (res.ok) return "ok";
  if (res.status === 429) return "locked";
  const error = String(((await res.json().catch(() => ({}))) as { error?: unknown }).error ?? "");
  return ERROR[error] ?? "failed";
}
