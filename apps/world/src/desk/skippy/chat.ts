import { create } from "zustand";

/**
 * Skippy's chat, browser side (#224; the function is api/skippy.ts). The conversation lives only in this tab's
 * memory: the last few turns go with each message so Skippy can follow along, and nothing is kept anywhere else.
 * What he suggests comes back as buttons from a closed set, checked again here (`readActions`), and nothing runs until
 * Nikita taps one: ideas and answers then go through the Desk's own buttons (IdeaCard.tsx), pages open in place.
 */

export type Page = "today" | "relay" | "foundry" | "systems" | "chronicle" | "security" | "compliance";
export type Room = "foundry" | "spire" | "exchange" | "green" | "relay" | "archive" | "breakroom" | "boiler" | "workshop";

export type SkippyAction =
  | { kind: "idea"; label: string; text: string }
  | { kind: "open"; label: string; page: Page }
  | { kind: "lattice"; label: string; room?: Room }
  | { kind: "answer"; label: string; issue: number; text: string };

/** How a tapped button went: sending, done, held back by the privacy check, signed out, or failed. */
export type ActionState = "busy" | "done" | "held" | "signed-out" | "failed";

export interface Turn {
  id: number;
  who: "nikita" | "skippy";
  text: string;
  actions?: SkippyAction[];
  /** Each action's state, by index, once tapped. */
  done?: Record<number, ActionState>;
  /** A line from the Desk itself (signed out, held back, too fast), not from Skippy. */
  note?: boolean;
}

/** What Nikita may send at once, and how many turns go with it: the function's own caps (api/_skippy/prompt.ts). */
export const MESSAGE_MAX = 600;
export const HISTORY_TURNS = 8;
/** Turns kept on screen. */
export const KEEP_TURNS = 40;

export const PAGES: Record<Page, string> = {
  today: "/",
  relay: "/relay",
  foundry: "/foundry",
  systems: "/systems",
  chronicle: "/chronicle",
  security: "/systems/security",
  compliance: "/systems/compliance",
};
const ROOMS: readonly Room[] = ["foundry", "spire", "exchange", "green", "relay", "archive", "breakroom", "boiler", "workshop"];

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The function's actions, checked again: only the closed set, with a label, at most three. */
export function readActions(raw: unknown): SkippyAction[] {
  const out: SkippyAction[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const label = clip(r.label, 40);
    if (!label) continue;
    if (r.kind === "idea" && clip(r.text, 600)) out.push({ kind: "idea", label, text: clip(r.text, 600) });
    else if (r.kind === "answer" && typeof r.issue === "number" && Number.isInteger(r.issue) && r.issue > 0 && clip(r.text, 600)) out.push({ kind: "answer", label, issue: r.issue, text: clip(r.text, 600) });
    else if (r.kind === "open" && typeof r.page === "string" && Object.hasOwn(PAGES, r.page)) out.push({ kind: "open", label, page: r.page as Page });
    else if (r.kind === "lattice") out.push({ kind: "lattice", label, ...(typeof r.room === "string" && (ROOMS as readonly string[]).includes(r.room) && { room: r.room as Room }) });
    if (out.length === 3) break;
  }
  return out;
}

/** Where an "open" or "lattice" button goes. */
export function actionPath(a: SkippyAction): string | null {
  if (a.kind === "open") return PAGES[a.page];
  if (a.kind === "lattice") return a.room ? `/lattice?room=${a.room}` : "/lattice";
  return null;
}

/** The turns that go with a message: Skippy's and Nikita's own words only, never the Desk's notes, the last few. */
export function historyFor(turns: Turn[]): { who: Turn["who"]; text: string }[] {
  return turns
    .filter((t) => !t.note)
    .slice(-HISTORY_TURNS)
    .map((t) => ({ who: t.who, text: t.text.slice(0, MESSAGE_MAX) }));
}

/** A reply as the browser's voice reads it: the attitude stays, the symbols go. */
export function speakable(text: string): string {
  return text
    .replace(/#(\d+)/g, "number $1")
    .replace(/[*_`~<>[\]{}|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type Asked =
  | { ok: true; reply: string; actions: SkippyAction[]; capped: boolean }
  | { ok: false; error: "signed-out" | "held" | "slow" | "off" | "failed"; message: string };

/** What the Desk says for each way a message can fail. */
export const ASK_ERROR: Record<Exclude<Asked, { ok: true }>["error"], string> = {
  "signed-out": "Sign in on the Desk to talk to Skippy.",
  held: "Held back, nothing was sent: that looks like it has something private in it. Say it another way.",
  slow: "Skippy needs a breather. Try again in a minute.",
  off: "Skippy's chat isn't set up on this site yet.",
  failed: "Skippy didn't answer. Try again.",
};

/** One message to the function. */
export async function askSkippy(message: string, history: { who: Turn["who"]; text: string }[], doFetch: typeof fetch = fetch): Promise<Asked> {
  try {
    const res = await doFetch("/api/skippy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.slice(0, MESSAGE_MAX), history }),
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => ({}))) as { reply?: unknown; actions?: unknown; capped?: unknown; held?: unknown; wait?: unknown };
    if (res.status === 401) return { ok: false, error: "signed-out", message: ASK_ERROR["signed-out"] };
    if (res.status === 422) {
      const kinds = Array.isArray(body.held) ? body.held.filter((k): k is string => typeof k === "string" && k.length < 60) : [];
      return { ok: false, error: "held", message: kinds.length ? `Held back, nothing was sent: that looks like it has ${kinds.join(" and ")} in it. Say it another way.` : ASK_ERROR.held };
    }
    if (res.status === 429) {
      const s = Number(body.wait);
      return { ok: false, error: "slow", message: Number.isFinite(s) && s > 0 ? `Skippy needs a breather. Try again in ${s < 90 ? `${Math.ceil(s)} s` : `${Math.ceil(s / 60)} min`}.` : ASK_ERROR.slow };
    }
    if (res.status === 503) return { ok: false, error: "off", message: ASK_ERROR.off };
    const reply = clip(body.reply, 700);
    if (!res.ok || !reply) return { ok: false, error: "failed", message: ASK_ERROR.failed };
    return { ok: true, reply, actions: readActions(body.actions), capped: body.capped === true };
  } catch {
    return { ok: false, error: "failed", message: ASK_ERROR.failed };
  }
}

/* ── The conversation, shared by the avatar, the compact box on Today and the dialogue ── */

const VOICE_KEY = "ceo.skippy.voice";

function readVoice(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) === "1";
  } catch {
    return false;
  }
}

interface SkippyStore {
  turns: Turn[];
  busy: boolean;
  open: boolean;
  /** Read replies aloud with the browser's own voice (remembered in this browser only). */
  voice: boolean;
  setOpen: (open: boolean) => void;
  setVoice: (on: boolean) => void;
  /** Sends a message; resolves with the reply turn, or null when it failed (a note says why). */
  send: (text: string, doFetch?: typeof fetch) => Promise<Turn | null>;
  /** Marks a tapped button's state on its turn. */
  mark: (turn: number, index: number, state: ActionState) => void;
  clear: () => void;
}

let nextId = 1;

export const useSkippy = create<SkippyStore>((set, get) => ({
  turns: [],
  busy: false,
  open: false,
  voice: readVoice(),
  setOpen: (open) => set({ open }),
  setVoice: (voice) => {
    try {
      localStorage.setItem(VOICE_KEY, voice ? "1" : "0");
    } catch {
      /* no storage: the toggle lasts this visit */
    }
    if (!voice) stopSpeaking();
    set({ voice });
  },
  send: async (text, doFetch) => {
    const message = text.trim().slice(0, MESSAGE_MAX);
    if (!message || get().busy) return null;
    const history = historyFor(get().turns);
    set((s) => ({ busy: true, turns: [...s.turns, { id: nextId++, who: "nikita" as const, text: message }].slice(-KEEP_TURNS) }));
    const got = await askSkippy(message, history, doFetch);
    const turn: Turn = got.ok ? { id: nextId++, who: "skippy", text: got.reply, actions: got.actions } : { id: nextId++, who: "skippy", text: got.message, note: true };
    set((s) => ({ busy: false, turns: [...s.turns, turn].slice(-KEEP_TURNS) }));
    if (got.ok && get().voice) speak(got.reply);
    return got.ok ? turn : null;
  },
  mark: (id, index, state) => set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, done: { ...t.done, [index]: state } } : t)) })),
  clear: () => {
    stopSpeaking();
    set({ turns: [] });
  },
}));

/* ── Spoken replies: the browser's own speech synthesis, nothing sent anywhere ── */

export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";

export function speak(text: string): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.rate = 1.05;
    u.pitch = 0.9;
    window.speechSynthesis.speak(u);
  } catch {
    /* no voice here: the reply is on screen anyway */
  }
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* nothing to stop */
  }
}
