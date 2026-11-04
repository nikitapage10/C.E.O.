import { create } from "zustand";
import type { DeskEmailItem as EmailItem, EmailView, FilterRule, StyleProfile } from "../../../../../api/_email/types.ts";
import type { Intent } from "../../../../../api/_email/intent.ts";
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

export type { EmailItem, EmailStatus, EmailView, StyleProfile };
export type EmailRule = Pick<FilterRule, "id" | "kind" | "label" | "at" | "match" | "to">;
export type { Intent };

/** What the intent layer answered (#642): the intent, and for a rule the rule made and how many open items it moved. */
export interface IntentAnswer {
  intent: Intent;
  rule?: EmailRule;
  moved?: number;
}

const okIntent = (v: unknown): v is Intent => {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return false;
  switch (o.kind) {
    case "reply":
      return typeof o.words === "string";
    case "rule":
      return typeof o.match === "string" && (o.to === "can-wait" || o.to === "filtered");
    case "disposition":
      return o.disposition === "done" || o.disposition === "skip" || o.disposition === "later";
    case "question":
    case "unclear":
      return typeof o.answer === "string";
    default:
      return false;
  }
};

/** What a Thread action on the email line answered (#615): ok with its result, or the site's error code. */
export type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

const PATH = "/api/email";
const POLL_MS = 30_000;
/** A check this much older than the minute it runs on is late: only then does the page show check times (#375). */
export const LATE_MS = 5 * 60_000;

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
    ...(typeof o.said === "string" && o.said && { said: o.said.slice(0, 400) }),
    ...(typeof o.sentAt === "number" && o.sentAt > 0 && { sentAt: o.sentAt }),
    ...(o.skipped === true && { skipped: true }),
    ...(typeof o.logo === "string" && /^[0-9a-f]{32}$/.test(o.logo) && { logo: o.logo }),
    ...(typeof o.photo === "string" && /^[0-9a-f]{32}$/.test(o.photo) && { photo: o.photo }),
  };
}

const okRule = (r: unknown): r is EmailRule => {
  const o = r as Record<string, unknown> | null;
  return !!o && typeof o.id === "string" && /^[0-9a-f]{12}$/.test(o.id) && (o.kind === "block" || o.kind === "filter" || o.kind === "tier") && typeof o.label === "string" && typeof o.at === "number";
};

/** The style traits, checked; null when there are none. */
export function readStyleView(v: unknown): StyleProfile | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.traits)) return null;
  const traits = (o.traits as unknown[]).filter((t): t is string => typeof t === "string" && !!t).map((t) => t.slice(0, 48)).slice(0, 8);
  return traits.length ? { traits, from: typeof o.from === "number" ? o.from : 0, at: typeof o.at === "number" ? o.at : 0 } : null;
}

/** The private view, checked; null when it isn't one. */
export function readView(v: unknown): EmailView | null {
  const b = v as Record<string, unknown> | null;
  if (!b || b.ok !== true) return null;
  const status = readEmailStatus(b.status);
  const spend = b.spend as Record<string, unknown> | null;
  if (!status || !Array.isArray(b.items) || !spend || typeof spend.usd !== "number" || typeof spend.budget !== "number") return null;
  return { ok: true, status, canConnect: b.canConnect === true, canSend: b.canSend === true, items: b.items.map(readItem).filter((x): x is EmailItem => x !== null), applied: typeof b.applied === "number" && b.applied > 0 ? Math.min(9_999, Math.floor(b.applied)) : 0, urgentSkipped: typeof b.urgentSkipped === "number" && b.urgentSkipped > 0 ? Math.min(9_999, Math.floor(b.urgentSkipped)) : 0, spend: { usd: spend.usd, budget: spend.budget }, rules: Array.isArray(b.rules) ? (b.rules as unknown[]).filter(okRule).map((r) => ({ id: r.id, kind: r.kind, label: r.label.slice(0, 80), at: r.at, ...(r.to && { to: r.to }), ...(r.match && { match: r.match }) })) : [], sentWeek: typeof b.sentWeek === "number" && b.sentWeek > 0 ? Math.min(9_999, Math.floor(b.sentWeek)) : 0, ruled: typeof b.ruled === "number" && b.ruled > 0 ? Math.min(9_999, Math.floor(b.ruled)) : 0, style: readStyleView(b.style) };
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
  /** Takes a Done back (the Thread's Undo). */
  undone: (id: string) => Promise<void>;
  /** Gone like Done, until the sender writes again (#642). */
  skip: (id: string) => Promise<void>;
  /** What Nikita meant about the item in focus (#642): "e:<id>" or "t:<id>", and what they said. Never sends. */
  intent: (key: string, said: string) => Promise<Answer<IntentAnswer>>;
  /** Blasto's draft from Nikita's few words (#615). */
  reply: (id: string, said: string) => Promise<Answer<string>>;
  /** A sender rule from one mail: its address ("block") or its domain ("filter"). */
  rule: (id: string, kind: "block" | "filter") => Promise<Answer<EmailRule>>;
  unrule: (rule: string) => Promise<boolean>;
  learnStyle: () => Promise<Answer<StyleProfile>>;
  /** Sends the draft on screen as an in-thread reply. Only after Nikita's yes and the undo window; the server checks it is still that draft. */
  send: (id: string, draft: string) => Promise<Answer<number>>;
}

/** POST one action and read its answer; refreshes after. */
async function act<T>(body: object, pick: (got: Record<string, unknown>) => T | null): Promise<Answer<T>> {
  try {
    const res = await post(body);
    const got = isJson(res) ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : {};
    if (res.status === 401) useDeskAuth.getState().lost();
    const v = res.ok ? pick(got) : null;
    if (v !== null) return { ok: true, value: v };
    return { ok: false, error: typeof got.error === "string" ? got.error : res.status === 404 ? "off" : "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}

const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");

function setLink(status: EmailStatus | null, canSend = false) {
  const state = linkOf(status);
  useSystems.getState().setLink("gmail", { state, load: status ? Math.min(1, 0.25 + status.newToday / 40) : 0, lastSeen: status?.lastCheck ?? null, note: state === "ok" ? (canSend ? "SENDS ON YES" : "READ-ONLY") : undefined });
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
            setLink(view.status, view.canSend);
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
  undone: async (id) => {
    const view = get().view;
    if (view) set({ view: { ...view, items: view.items.map((i) => (i.id === id ? { ...i, done: false } : i)) } });
    await post({ action: "undone", id }).catch(() => undefined);
    await get().refresh();
  },
  skip: async (id) => {
    const view = get().view;
    if (view) set({ view: { ...view, items: view.items.map((i) => (i.id === id ? { ...i, done: true, skipped: true } : i)) } });
    await post({ action: "skip", id }).catch(() => undefined);
    await get().refresh();
  },
  intent: async (key, said) => {
    const got = await act({ action: "intent", key, said }, (g) => (okIntent(g.intent) ? { intent: g.intent, ...(okRule(g.rule) && { rule: g.rule }), ...(typeof g.moved === "number" && { moved: g.moved }) } : null));
    if (got.ok && got.value.rule) void get().refresh();
    return got;
  },
  reply: async (id, said) => {
    const got = await act({ action: "reply", id, said }, (g) => (typeof g.draft === "string" && g.draft ? g.draft.slice(0, 2_000) : null));
    if (got.ok) {
      const view = get().view;
      if (view) set({ view: { ...view, items: view.items.map((i) => (i.id === id ? { ...i, draft: got.value, said } : i)) } });
    }
    return got;
  },
  rule: async (id, kind) => {
    const got = await act({ action: kind, id }, (g) => (okRule(g.rule) ? g.rule : null));
    void get().refresh();
    return got;
  },
  unrule: async (rule) => {
    const got = await act({ action: "unblock", rule }, (g) => (g.ok === true ? true : null));
    void get().refresh();
    return got.ok;
  },
  learnStyle: async () => {
    const got = await act({ action: "learn-style" }, (g) => readStyleView(g.style));
    void get().refresh();
    return got;
  },
  send: async (id, draft) => {
    const got = await act({ action: "send", id, draft }, (g) => (g.ok === true && typeof g.sentAt === "number" ? g.sentAt : null));
    if (got.ok) {
      const view = get().view;
      if (view) set({ view: { ...view, items: view.items.map((i) => (i.id === id ? { ...i, done: true, sentAt: got.value } : i)) } });
    }
    void get().refresh();
    return got;
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
