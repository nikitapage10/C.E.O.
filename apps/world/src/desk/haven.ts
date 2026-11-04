/**
 * Hey Skippy's Desk side (#627; api/_haven/route.ts): the Kitchen list on Today and the Phones panel in Security.
 * Signed in, the Desk reads the list's items and the phones; signed out it gets the counts only. A phone's key comes
 * back once, when the phone is added, and the page keeps it only until the panel is closed.
 */

export interface KitchenItem {
  id: string;
  name: string;
  addedAt: string;
  source: "phone" | "tasks";
  done: boolean;
}

export interface HavenCounts {
  kitchen: { open: number; done: number };
  todos: number;
  /** The Gym's plan (#660): sessions a week and done this week, never an exercise. Absent on an older server. */
  gym?: { perWeek: number; doneThisWeek: number } | null;
  ready: boolean;
}

export interface PhoneRow {
  id: string;
  label: string;
  created: string;
  lastUsed: string | null;
  revoked: string | null;
}

export interface PhonesView {
  phones: PhoneRow[];
  greetings: { made: string | null; clips: number };
  voice: boolean;
}

/** off: no haven route here (the Vercel copy, or a local build). out: the session is gone. */
export type Load<T> = { state: "ready"; view: T } | { state: "off" } | { state: "out" } | { state: "failed" };

async function load<T>(path: string, f: typeof fetch): Promise<Load<T>> {
  try {
    const res = await f(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405) return { state: "off" };
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return { state: "failed" };
    return { state: "ready", view: (await res.json()) as T };
  } catch {
    return { state: "failed" };
  }
}

export const loadCounts = (f: typeof fetch = fetch) => load<HavenCounts>("/api/haven?view=status", f);
export const loadKitchen = (f: typeof fetch = fetch) => load<{ items: KitchenItem[] }>("/api/haven?view=list", f);
export const loadPhones = (f: typeof fetch = fetch) => load<PhonesView>("/api/haven?view=phones", f);

async function post<T>(body: unknown, f: typeof fetch): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await f("/api/haven", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as T & { error?: unknown };
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: String(data.error ?? "failed") };
  } catch {
    return { ok: false, status: 0, error: "failed" };
  }
}

export const tickItem = (id: string, done: boolean, f: typeof fetch = fetch) => post<{ ok: true }>({ action: "tick", id, done }, f);
export const removeItem = (id: string, f: typeof fetch = fetch) => post<{ ok: true }>({ action: "remove", id }, f);
export const undoRemoveItem = (id: string, f: typeof fetch = fetch) => post<{ ok: true }>({ action: "undo-remove", id }, f);
export const addPhone = (label: string, f: typeof fetch = fetch) => post<{ phone: PhoneRow; key: string }>({ action: "add-phone", label }, f);
export const revokePhone = (id: string, f: typeof fetch = fetch) => post<{ ok: true }>({ action: "revoke-phone", id }, f);
export const makeGreetings = (f: typeof fetch = fetch) => post<{ clips: number }>({ action: "make-greetings" }, f);
/** What the Desk says when adding a phone didn't work. */
export const ADD_NOTE: Record<string, string> = {
  "too-many": "Five phones already hold a key. Revoke one first.",
  "signed-out": "Your session ended. Sign in again.",
  "not-set-up": "Hey Skippy isn't set up on this copy of the Desk.",
  failed: "That didn't go through. Try again.",
};

/** What the Desk says when the greeting clips couldn't be made. */
export const GREET_NOTE: Record<string, string> = {
  "no-voice": "ElevenLabs isn't connected, so there's no voice to record them in.",
  "over-budget": "ElevenLabs' cap for the month is spent. Try again next month.",
  eleven: "ElevenLabs didn't answer. Try again in a bit.",
  failed: "That didn't go through. Try again.",
};
