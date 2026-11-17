/**
 * DoorDash, browser side (#1195, phase 0: Connect; api/_haven/doordash/route.ts). Signed in, the Kitchen's DoorDash
 * card reads the sign-in's state and runs the CLI's two-step sign-in: DoorDash's page opens in a new tab, Nikita pastes
 * back the address it landed on, and the server seals the token. What the server sends is read again here as untrusted
 * data (a closed set of states, a checked time, only DoorDash's own sign-in URL).
 */

export type DdState = "not-set-up" | "signed-out" | "live" | "expired";
const STATES: DdState[] = ["not-set-up", "signed-out", "live", "expired"];

export interface DdView {
  state: DdState;
  /** ISO time the sign-in runs out, or null when unknown. */
  expiresAt: string | null;
}

export type DdLoad = { state: "ready"; view: DdView } | { state: "out" | "off" | "failed" };

export type DdAction = { action: "signin-start" } | { action: "signin-finish"; pasted: string } | { action: "signout" };

export interface DdReply {
  ok: boolean;
  status: number;
  error: string | null;
  view: DdView | null;
  /** DoorDash's sign-in page, after signin-start. */
  url: string | null;
}

const PATH = "/api/haven/doordash";

/** Only DoorDash's own sign-in page is ever opened. */
export const isDoorDashSignIn = (url: string) => /^https:\/\/identity\.doordash\.com\/authorize\?/.test(url);

const timeOf = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);

export function readView(got: unknown): DdView | null {
  if (!got || typeof got !== "object") return null;
  const o = got as Record<string, unknown>;
  const state = STATES.find((s) => s === o.state);
  return state ? { state, expiresAt: timeOf(o.expiresAt) } : null;
}

export async function loadDoorDash(f: typeof fetch = fetch): Promise<DdLoad> {
  try {
    const res = await f(PATH, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405 || !(res.headers.get("content-type") ?? "").includes("json")) return { state: "off" };
    const view = res.ok ? readView(await res.json().catch(() => null)) : null;
    return view ? { state: "ready", view } : { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

export async function doordashAction(body: DdAction, f: typeof fetch = fetch): Promise<DdReply> {
  try {
    const res = await f(PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    const got = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const url = typeof got.url === "string" && isDoorDashSignIn(got.url) ? got.url : null;
    const error = res.ok ? null : typeof got.error === "string" ? got.error.slice(0, 20) : "failed";
    return { ok: res.ok, status: res.status, error, view: readView(got), url };
  } catch {
    return { ok: false, status: 0, error: "failed", view: null, url: null };
  }
}

/** When the sign-in runs out, as the card says it. */
export function expiryWords(iso: string | null, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "expiry unknown";
  const when = new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return t <= now ? `expired ${when}` : `expires ${when}`;
}

/** What the card says when an action didn't work. */
export const DD_NOTE: Record<string, string> = {
  "not-set-up": "DoorDash isn't set up on the server yet (docs/HOME-DEVICES.md, \"DoorDash\").",
  vendor: "DoorDash didn't give a sign-in just now. Try again in a bit.",
  "bad-paste": "That doesn't look like the address the page landed on. Copy the whole address bar and paste it again.",
  "no-pending": "That sign-in ran out (it lasts 10 minutes). Start again.",
  refused: "DoorDash didn't take that. Start the sign-in again and paste the new address.",
  "signed-out": "Your session ended. Sign in again.",
  failed: "That didn't go through. Try again.",
};
