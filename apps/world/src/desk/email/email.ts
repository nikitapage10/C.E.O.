import { create } from "zustand";
import type { EmailItem, EmailView } from "../../../../../api/_email/types.ts";
import { readEmailStatus, type EmailStatus } from "../../../../../api/_email/status.ts";
import { useSystems, type LinkState } from "../../systems.ts";
import { useDeskAuth } from "../signin.ts";

/**
 * The email agent (#263, docs/GMAIL.md), browser side. Two reads of /api/email, both on the Azure copy only:
 *
 *   ?view=status   the public counts (needs you, FYI, noise, the agent's state): for the Lattice's Relay room, Today
 *                  and Systems, signed in or not. Counts and states only.
 *   (no query)     the private list for the Desk's Relay page: subjects, senders, Dialtone's summary, Blasto's advice
 *                  and draft. Only in the passkey session; marked <Private> on the page for Hide mode.
 *
 * Every 30 seconds while the tab is showing: the agent checks Gmail every minute, so a new needs-you mail shows within
 * about a minute and a half. On the Vercel copy the route doesn't exist (404), and everything says the email agent
 * lives on the Azure copy.
 */

export type { EmailItem, EmailStatus, EmailView };

const PATH = "/api/email";
const POLL_MS = 30_000;

/** "idle" before the first answer; "off" where the route doesn't exist (the Vercel copy, a local preview). */
export type EmailLoad = "idle" | "off" | "live" | "failed";

const okId = (v: unknown) => typeof v === "string" && /^[0-9a-f]{6,32}$/.test(v);
const okKind = (v: unknown) => v === "needs-you" || v === "fyi" || v === "noise" || v === "unsorted";
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** One private item as the server sent it, or null when it isn't one. */
export function readItem(v: unknown): EmailItem | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !okId(o.id) || typeof o.at !== "number" || !okKind(o.kind)) return null;
  return {
    id: o.id as string,
    at: o.at,
    from: s(o.from, 120),
    subject: s(o.subject, 200),
    kind: o.kind as EmailItem["kind"],
    summary: s(o.summary, 240),
    action: s(o.action, 140),
    ...(typeof o.advice === "string" && o.advice && { advice: o.advice.slice(0, 800) }),
    ...(typeof o.draft === "string" && o.draft && { draft: o.draft.slice(0, 2000) }),
    done: o.done === true,
  };
}

/** The private view, checked; null when it isn't one. */
export function readView(v: unknown): EmailView | null {
  const b = v as Record<string, unknown> | null;
  if (!b || b.ok !== true) return null;
  const status = readEmailStatus(b.status);
  const spend = b.spend as Record<string, unknown> | null;
  if (!status || !Array.isArray(b.items) || !spend || typeof spend.usd !== "number" || typeof spend.budget !== "number") return null;
  return { ok: true, status, canConnect: b.canConnect === true, items: b.items.map(readItem).filter((x): x is EmailItem => x !== null), spend: { usd: spend.usd, budget: spend.budget } };
}

/** The Boiler Room's Gmail pipe and the Systems light, from the public counts. */
export function linkOf(status: EmailStatus | null): LinkState {
  if (!status || status.gmail === "not-connected" || status.agent === "waiting") return "off";
  if (status.gmail === "refused" || status.agent === "error") return "down";
  return status.agent === "paused" ? "slow" : "ok";
}

/** The agent's state in a few words, for the Lattice and Systems. Never a figure from a mail. */
export function emailLine(load: EmailLoad, status: EmailStatus | null): string {
  if (load === "off") return "Email: on the Azure copy";
  if (!status) return load === "failed" ? "Email: not answering" : "Email: reading…";
  if (status.agent === "waiting") return "Email: waiting for its keys";
  if (status.gmail === "not-connected") return "Email: waiting for Gmail";
  if (status.gmail === "refused") return "Email: Gmail needs reconnecting";
  if (status.agent === "paused") return "Email agent paused: monthly cap reached";
  if (status.agent === "error") return "Email: the last check failed";
  return status.needsYou === 1 ? "1 email needs you" : `${status.needsYou} emails need you`;
}

interface EmailStore {
  load: EmailLoad;
  /** The public counts. */
  status: EmailStatus | null;
  /** The private view, only while signed in. */
  view: EmailView | null;
  checkedAt: number | null;
  /** Set while Connect Gmail is on its way to Google, or a button is working. */
  busy: boolean;
  error: string | null;
  /** Why the signed-in read last failed ("502", "shape", …); null once it reads. Shown instead of a "Reading…" that never ends. */
  privateFail: string | null;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  done: (id: string) => Promise<void>;
}

const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");

function setLink(status: EmailStatus | null) {
  const state = linkOf(status);
  useSystems.getState().setLink("gmail", { state, load: status ? Math.min(1, 0.25 + status.newToday / 40) : 0, lastSeen: status?.lastCheck ?? null, note: state === "ok" ? "READ-ONLY" : undefined });
}

async function post(body: object): Promise<Response> {
  return fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) });
}

export const useEmail = create<EmailStore>((set, get) => ({
  load: "idle",
  status: null,
  view: null,
  checkedAt: null,
  busy: false,
  error: null,
  privateFail: null,
  refresh: async () => {
    const auth = useDeskAuth.getState().auth.status;
    let privateFail: string | null = null;
    try {
      if (auth === "in") {
        const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
        if (res.status === 401) useDeskAuth.getState().lost();
        else if (res.status === 404 || !isJson(res)) {
          set({ load: "off", view: null, status: null, checkedAt: Date.now() });
          setLink(null);
          return;
        } else if (res.ok) {
          const view = readView(await res.json());
          if (view) {
            set({ load: "live", view, status: view.status, checkedAt: Date.now(), privateFail: null });
            setLink(view.status);
            return;
          }
          privateFail = "shape";
        } else privateFail = String(res.status);
      }
      // Signed out (or the private read failed): the public counts, and nothing private lingers on the page.
      const res = await fetch(`${PATH}?view=status`, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (res.status === 404 || !isJson(res)) {
        set({ load: "off", view: null, status: null, checkedAt: Date.now() });
        setLink(null);
        return;
      }
      const status = res.ok ? readEmailStatus(((await res.json()) as { status?: unknown }).status) : null;
      set({ load: status ? "live" : "failed", status: status ?? get().status, view: null, checkedAt: Date.now(), privateFail });
      setLink(status ?? get().status);
    } catch {
      set({ load: "failed", checkedAt: Date.now(), ...(auth === "in" && { privateFail: privateFail ?? "network" }) });
    }
  },
  connect: async () => {
    set({ busy: true, error: null });
    try {
      const res = await post({ action: "connect" });
      const got = isJson(res) ? ((await res.json()) as { url?: unknown }) : {};
      const url = typeof got.url === "string" && got.url.startsWith("https://accounts.google.com/") ? got.url : null;
      if (res.status === 401) useDeskAuth.getState().lost();
      if (!url) {
        set({ busy: false, error: res.status === 503 ? "Gmail isn't set up on this copy yet." : "Couldn't start Connect Gmail." });
        return;
      }
      window.location.assign(url);
    } catch {
      set({ busy: false, error: "Couldn't start Connect Gmail." });
    }
  },
  disconnect: async () => {
    set({ busy: true, error: null });
    try {
      await post({ action: "disconnect" });
    } finally {
      set({ busy: false });
      await get().refresh();
    }
  },
  done: async (id) => {
    const view = get().view;
    if (view) set({ view: { ...view, items: view.items.map((i) => (i.id === id ? { ...i, done: true } : i)) } });
    await post({ action: "done", id }).catch(() => undefined);
    await get().refresh();
  },
}));

/** What Google sent back after Connect Gmail (?gmail=…), read once and taken off the address bar. */
export function takeGmailReturn(): "connected" | "cancelled" | "refused" | "failed" | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const got = q.get("gmail");
  if (got !== "connected" && got !== "cancelled" && got !== "refused" && got !== "failed") return null;
  q.delete("gmail");
  const rest = q.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  return got;
}

let started = false;

/** Start reading (once per page): every 30 seconds while the tab is showing, and on sign-in or out. */
export function startEmail(): void {
  if (started || typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (q.has("offline") || q.has("demo")) return;
  started = true;
  const refresh = () => void useEmail.getState().refresh();
  refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, POLL_MS);
  let was = useDeskAuth.getState().auth.status;
  useDeskAuth.subscribe((st) => {
    if (st.auth.status !== was) {
      was = st.auth.status;
      if (was !== "checking") refresh();
    }
  });
}
