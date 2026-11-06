import { create } from "zustand";
import { REASON_WORDS, RESENDABLE, type Reason, type RequestState } from "../../../api/_relay/texts.ts";
import { UNDO_MS } from "./thread.ts";

/**
 * The texts outbox (#950, Nikita 2026-11-06 02:22Z: "the reply box stays open while sending; messages queue in order").
 * A text Nikita sends leaves the box at once, which stays open and editable for the next one. Each queued text waits out
 * its own few seconds of Undo, then goes to the site as its own send request (the unlock, single-use, 10 minutes, the
 * same send as before), strictly in the order he sent them: the next is posted only once the one before it was. The Mac
 * acts on a thread's requests in that order. Each shows under the box: sending, then sent, or not sent with Resend.
 *
 * It lives apart from any card (02:24Z: Done and Later never wait on sends): Done moves on at once, and the sends still
 * go in the background; a Done whose thread has a send that didn't go is held back and the thread comes back (useThread).
 * Memory only: words never touch the device's storage.
 */

export type OutState = "held" | "posting" | "waiting" | "sent" | "failed";

export interface OutMsg {
  /** This page's own id for it. */
  id: string;
  /** The thread (TextItem.id) and its Exchange key. */
  thread: string;
  key: string;
  who: string;
  text: string;
  /** The draft it was made from (its `at`), or 0. */
  draftAt: number;
  /**
   * Nikita's own words, not Blasto's draft: bound at post time to whatever draft the list then shows (a send before it
   * clears the draft on the Mac, so the next queued text mustn't carry the old draft's time). A draft's yes keeps its own.
   */
  own?: true;
  /** An inline reply (#950): their line's ref, and its words to show above the text. */
  reply?: { ref: string; text: string };
  /** When it was sent (tapped), and when its Undo window ends. */
  at: number;
  until: number;
  state: OutState;
  /** The site's request id, once posted, and when. */
  rid?: string;
  postedAt?: number;
  /** Why it didn't go, in the Desk's words. */
  why?: string;
  /** Whether Resend can make a new request from `rid` (else a fresh send is made). */
  resendable?: boolean;
  /** When it reached a final state (sent or failed). */
  doneAt?: number;
}

/** A posted text the site's list stops showing is given up on after this (REQUEST_MS plus the site's 5-minute grace). */
export const LOST_MS = 16 * 60_000;

/** A sent one stays under the box this long, then leaves (the Mac's next list shows it as his own line). */
export const SENT_SHOW_MS = 8_000;

let seq = 0;
const newId = () => `o${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Whether a message still has somewhere to go. */
export const open = (m: Pick<OutMsg, "state">) => m.state === "held" || m.state === "posting" || m.state === "waiting";

/** The next message to post, in order, at `now`: the first one not yet posted, once its Undo window ended and nothing is posting. */
export function nextToPost(list: readonly OutMsg[], now: number): OutMsg | null {
  if (list.some((m) => m.state === "posting")) return null;
  const first = list.find((m) => m.state === "held");
  return first && first.until <= now ? first : null;
}

/** A posted message's state from the site's request list: sent, failed (with why), or still waiting. */
export function settle(m: OutMsg, req: { state: RequestState; reason?: Reason } | undefined, now: number): OutMsg {
  if (m.state !== "waiting") return m;
  // Off the list long after its 10 minutes (and the site's grace) ended: it never reported, so it reads as not sent.
  if (!req) return m.postedAt !== undefined && now - m.postedAt > LOST_MS ? { ...m, state: "failed", why: "the Mac never answered. It may have sent: check Messages before you resend.", resendable: false, doneAt: now } : m;
  if (req.state === "sent" || req.state === "done") return { ...m, state: "sent", doneAt: now };
  if (req.state === "expired") return { ...m, state: "failed", why: "the Mac was offline.", resendable: true, doneAt: now };
  if (req.state === "failed" || req.state === "refused") {
    const ok = req.state === "failed" || (req.reason !== undefined && RESENDABLE.includes(req.reason));
    return { ...m, state: "failed", why: req.reason ? `${REASON_WORDS[req.reason]}.` : req.state === "failed" ? "it may have sent, check Messages." : "the Mac refused it.", resendable: ok, doneAt: now };
  }
  return m;
}

/** The list after `now`: sent ones past SENT_SHOW_MS leave. */
export const prune = (list: readonly OutMsg[], now: number): OutMsg[] => list.filter((m) => !(m.state === "sent" && now - (m.doneAt ?? now) > SENT_SHOW_MS));

interface OutboxStore {
  list: OutMsg[];
  add: (m: Omit<OutMsg, "id" | "at" | "until" | "state">, now?: number) => OutMsg;
  /** Takes back the newest message still in its Undo window (Z); null with none. */
  undo: () => OutMsg | null;
  /** Takes back one message still in its Undo window. */
  drop: (id: string) => void;
  patch: (id: string, p: Partial<OutMsg>) => void;
  /** A failed one again: back in line at the end, posted as soon as it is its turn (no second Undo window). */
  retry: (id: string) => void;
  set: (list: OutMsg[]) => void;
}

export const useOutbox = create<OutboxStore>((set, get) => ({
  list: [],
  add: (m, now = Date.now()) => {
    const msg: OutMsg = { ...m, id: newId(), at: now, until: now + UNDO_MS, state: "held" };
    set({ list: [...get().list, msg] });
    return msg;
  },
  undo: () => {
    const held = get().list.filter((m) => m.state === "held");
    const last = held.at(-1) ?? null;
    if (last) set({ list: get().list.filter((m) => m.id !== last.id) });
    return last;
  },
  drop: (id) => set({ list: get().list.filter((m) => !(m.id === id && m.state === "held")) }),
  patch: (id, p) => set({ list: get().list.map((m) => (m.id === id ? { ...m, ...p } : m)) }),
  retry: (id) => {
    const m = get().list.find((x) => x.id === id);
    if (!m || m.state !== "failed") return;
    const again: OutMsg = { ...m, state: "held", until: 0, why: undefined, doneAt: undefined };
    set({ list: [...get().list.filter((x) => x.id !== id), again] });
  },
  set: (list) => set({ list }),
}));

/** A thread's messages under its box, in order. */
export const outOf = (list: readonly OutMsg[], thread: string) => list.filter((m) => m.thread === thread);
