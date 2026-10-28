import { create } from "zustand";
import type { RequestState } from "../../../../../api/_relay/texts.ts";
import { useDeskAuth } from "../signin.ts";
import { errorWords, useTexts, type TextCard, type TextRequestView } from "./texts.ts";

/**
 * Texts Skippy drafts and sends on a tap (#536, docs/RELAY-PRIVACY.md, "Texts Skippy writes"), browser side.
 *
 * Skippy's chat answer (or a Talk call's draft_text tool) names who and the gist. This asks the site for a compose
 * request; the Mac hub finds the contact on the Mac and Blasto writes the text onto a card, which comes back with the
 * Texts panel's own read (GET /api/relay). The card shows the contact's name, the last 4 digits of the number (or a
 * masked address) and the full text, with Send, Edit and Cancel.
 *
 * Nothing sends without Nikita's confirmation of that exact card:
 *   - a tap on Send, on the card as it is on screen (an edit refreshes it and the send binds to the new text), or
 *   - on a call, his own spoken "send", heard in his transcript after Skippy was handed that very version to read
 *     aloud (`heard`). The agent's send_text tool only asks; this file checks the transcript before it sends.
 * Either way the send is the texts line's ordinary send request (#535): this device's 72-hour passkey unlock, single
 * use, 10 minutes, signed, bound to the card and its text, and only the hub's `act` sends. There is no auto-send.
 */

export type ComposePhase = "asking" | "drafting" | "ready" | "choices" | "none" | "off" | "nochat" | "moved" | "sending" | "sent" | "unsent" | "cancelled" | "error";

export interface Compose {
  /** This tab's own id for it. */
  key: string;
  via: "chat" | "talk";
  who: string;
  gist: string;
  /** The site's card id, once asked. */
  card: string | null;
  phase: ComposePhase;
  /** What to say about it when something went wrong. */
  note: string;
  /** The text on the card now: Blasto's, or Nikita's edit of it. */
  text: string;
  /** The card's draft time: a send binds to it. */
  draftAt: number;
  /** Bumped by every new draft and every edit: a confirmation holds for one version only. */
  version: number;
  /** On a call: the version Skippy was handed to read aloud, and when. */
  readVersion: number;
  readAt: number;
  /** On a call: the version Nikita said "send" for, after it was read, and when he said it. */
  saidVersion: number;
  saidAt: number;
  /** The send request in flight or done. */
  rid: string | null;
  /** When the ask went in (for the drafting wait). */
  since: number;
}

/** How long a card may take to come back before the Desk says the Mac didn't answer. */
export const DRAFT_WAIT_MS = 3 * 60_000;
/** How often the card is looked for while it is being drafted or sent. */
export const FAST_POLL_MS = 3_000;

/** How long after Skippy was handed a version to read aloud Nikita's "send" for it counts, and how long that "send" holds. */
export const SAID_WINDOW_MS = 2 * 60_000;

const YES_SEND = /^(?:(?:yes|yeah|yep|ok|okay|sure)[, ]+)?(?:go ahead and )?send(?: it)?(?: now| please)?[.!]?$/;
const NOT_A_YES = /\?|\b(?:to|instead|myself|i'll|ill|i will)\b/;

/**
 * Whether one of Nikita's lines is a plain yes to sending: the whole line, nothing else in it. "Send", "send it",
 * "Yes, send it.", "ok send", "go ahead and send", "send it now". Never a question ("Did you send it?", "Send it?"),
 * never one that redirects it ("Send it to Sam instead") or keeps it ("I'll send it myself"), never with a no in it.
 */
export function saidSend(words: string): boolean {
  const w = words.normalize("NFKC").toLowerCase().replace(/[\u2019`]/g, "'").replace(/\s+/g, " ").trim();
  if (!w || NOT_A_YES.test(w)) return false;
  return YES_SEND.test(w);
}

/** A card's recipient as said aloud: "ending 0123" digit by digit, an address by its first letters. */
export function spokenMask(mask: string | null): string {
  if (!mask) return "";
  const n = /^ending (\d{4})$/.exec(mask);
  if (n) return `the number ending ${n[1]!.split("").join(" ")}`;
  const m = /^(.)•••@(.)•••\.([a-z]+)$/u.exec(mask);
  return m ? `the address starting with ${m[1]} at ${m[2]}, dot ${m[3]}` : "";
}

/** What the card is doing now, from the site's read of it and its send request. */
export function phaseOf(c: Compose, card: TextCard | undefined, req: TextRequestView | undefined, now: number): ComposePhase {
  if (c.phase === "cancelled" || c.phase === "asking" || c.phase === "error") return c.phase;
  // The Mac's word on the card wins over the request's: it went (or Messages shows it did), or Nikita texted them since
  // the card was made and nothing was sent.
  if (card?.state === "moved" || card?.state === "sent") return card.state;
  if (req && req.kind === "send") {
    const s: RequestState = req.state;
    if (s === "waiting" || s === "taken") return "sending";
    if (s === "sent") return "sent";
    if (s === "expired" || s === "failed" || s === "refused") return "unsent";
  }
  if (!card) return now - c.since > DRAFT_WAIT_MS ? "error" : "drafting";
  if (card.state === "ready") return "ready";
  return card.state;
}

/** What a finished send request says on the card (the Texts panel's own words, #535). */
export function sendWords(req: TextRequestView | undefined): { text: string; resend: boolean } | null {
  if (!req || req.kind !== "send") return null;
  if (req.state === "expired") return { text: "Not sent, Mac was offline.", resend: true };
  if (req.state === "failed") return { text: "Not confirmed: it may have sent. Check Messages before you resend.", resend: true };
  if (req.state === "refused") return { text: "Not sent: the Mac refused it (already sent, the text changed, or too late).", resend: false };
  return null;
}

interface ComposeStore {
  items: Record<string, Compose>;
  /** A new card: asks the site, and the Mac drafts it. Its key, at once. */
  start: (who: string, gist: string, via: Compose["via"]) => string;
  /** One of a "choices" card's contacts. */
  pick: (key: string, pick: string) => Promise<void>;
  /** Nikita's edit: the card shows the new text and asks again. */
  edit: (key: string, text: string) => void;
  /** Send the card as it is now. Only a tap (`tapped`) or Nikita's heard "send" for this version gets past here. */
  send: (key: string, how: { tapped: true } | { said: true }) => Promise<"sending" | "locked" | "unconfirmed" | "not-ready" | "error">;
  /** Resend one that didn't go (the Mac was offline, or it may not have gone): a new request, the unlock still needed. */
  resend: (key: string) => Promise<void>;
  cancel: (key: string) => Promise<void>;
  /** On a call: Skippy was handed this version to read aloud. */
  readOut: (key: string) => void;
  /** On a call: one of Nikita's own lines, as transcribed, and when it came. */
  heard: (words: string, at?: number) => void;
  /** The site's latest read, folded in. */
  sync: () => void;
}

let nextKey = 1;
let poller: number | null = null;

const post = (body: object) => fetch("/api/relay", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) });

async function asked(res: Response): Promise<{ ok: true; rid: string } | { ok: false; error: string }> {
  const got = (await res.json().catch(() => ({}))) as { rid?: unknown; error?: unknown };
  if (res.status === 401 && got.error === "signed-out") useDeskAuth.getState().lost();
  if (res.ok && typeof got.rid === "string") return { ok: true, rid: got.rid };
  return { ok: false, error: typeof got.error === "string" ? got.error : "failed" };
}

const live = (c: Compose) => c.phase === "drafting" || c.phase === "sending" || c.phase === "asking";

export const useCompose = create<ComposeStore>((set, get) => {
  const patch = (key: string, p: Partial<Compose>) => set((s) => (s.items[key] ? { items: { ...s.items, [key]: { ...s.items[key]!, ...p } } } : s));
  // Looks for the card every few seconds while one is being drafted or sent; stops when none is.
  const watch = () => {
    if (poller !== null || typeof window === "undefined") return;
    poller = window.setInterval(() => {
      if (!Object.values(get().items).some(live)) {
        window.clearInterval(poller!);
        poller = null;
        return;
      }
      void useTexts.getState().refresh().then(() => get().sync());
    }, FAST_POLL_MS);
  };
  return {
    items: {},
    start: (who, gist, via) => {
      const key = `c${nextKey++}`;
      set((s) => ({ items: { ...s.items, [key]: { key, via, who, gist, card: null, phase: "asking", note: "", text: "", draftAt: 0, version: 0, readVersion: -1, readAt: 0, saidVersion: -1, saidAt: 0, rid: null, since: Date.now() } } }));
      void useTexts
        .getState()
        .compose({ who, gist })
        .then((got) => {
          if ("error" in got) patch(key, { phase: "error", note: errorWords(got.error) });
          else {
            patch(key, { card: got.card, phase: "drafting", since: Date.now() });
            watch();
          }
        });
      return key;
    },
    pick: async (key, pick) => {
      const c = get().items[key];
      if (!c?.card) return;
      patch(key, { phase: "asking" });
      const got = await useTexts.getState().compose({ who: c.who, gist: c.gist, card: c.card, pick });
      if ("error" in got) patch(key, { phase: "error", note: errorWords(got.error) });
      else {
        patch(key, { phase: "drafting", since: Date.now() });
        watch();
      }
    },
    edit: (key, text) => {
      const c = get().items[key];
      const t = text.replace(/\r\n?/g, "\n").trim().slice(0, 2_000);
      if (!c || !t || t === c.text || (c.phase !== "ready" && c.phase !== "unsent")) return;
      // A new version: any confirmation, tapped or said, was for the old one. A send that didn't go is left behind.
      patch(key, { text: t, version: c.version + 1, ...(c.phase === "unsent" && { phase: "ready" as const, rid: null }) });
    },
    send: async (key, how) => {
      const c = get().items[key];
      if (!c?.card || c.phase !== "ready" || !c.text.trim()) return "not-ready";
      // On a call, the agent asking is not enough: Nikita said "send" after this very version was read to him.
      if ("said" in how && !confirmed(c, Date.now())) return "unconfirmed";
      const view = useTexts.getState().view;
      if (!view?.unlockedUntil || view.unlockedUntil <= Date.now()) return "locked";
      patch(key, { phase: "sending", note: "" });
      const got = await asked(await post({ action: "send", thread: c.card, draftAt: c.draftAt, text: c.text }).catch(() => new Response("{}", { status: 599 })));
      if (!got.ok) {
        patch(key, { phase: "ready", note: errorWords(got.error) });
        return got.error === "locked" ? "locked" : "error";
      }
      patch(key, { rid: got.rid });
      watch();
      void useTexts.getState().refresh().then(() => get().sync());
      return "sending";
    },
    resend: async (key) => {
      const c = get().items[key];
      if (!c?.rid) return;
      const got = await asked(await post({ action: "resend", rid: c.rid }).catch(() => new Response("{}", { status: 599 })));
      if (!got.ok) return patch(key, { note: errorWords(got.error) });
      patch(key, { rid: got.rid, phase: "sending", note: "" });
      watch();
    },
    cancel: async (key) => {
      const c = get().items[key];
      if (!c) return;
      patch(key, { phase: "cancelled" });
      if (c.card) await post({ action: "done", thread: c.card }).catch(() => undefined);
    },
    readOut: (key) => {
      const c = get().items[key];
      if (c) patch(key, { readVersion: c.version, readAt: Date.now(), saidVersion: -1, saidAt: 0 });
    },
    heard: (words, at = Date.now()) => {
      // Only the card the call is on, only for the version just handed to Skippy, and only soon after it was.
      const c = talkCard();
      if (!c || c.phase !== "ready" || c.readVersion !== c.version || at <= c.readAt || at - c.readAt > SAID_WINDOW_MS) return;
      if (saidSend(words)) patch(c.key, { saidVersion: c.version, saidAt: at });
    },
    sync: () => {
      const view = useTexts.getState().view;
      if (!view) return;
      const now = Date.now();
      for (const c of Object.values(get().items)) {
        if (!c.card || c.phase === "cancelled" || c.phase === "asking") continue;
        const card = view.cards.find((x) => x.id === c.card);
        const req = c.rid ? view.requests.find((r) => r.rid === c.rid) : undefined;
        const phase = phaseOf(c, card, req, now);
        const p: Partial<Compose> = {};
        if (phase !== c.phase) p.phase = phase;
        // A new draft from Blasto (the first, or after a pick) replaces the text and is a new version.
        if (card?.state === "ready" && card.draft && card.draft.at !== c.draftAt) Object.assign(p, { text: card.draft.text, draftAt: card.draft.at, version: c.version + 1 });
        if (phase === "error" && !c.note) p.note = "The Mac didn't answer. Is it awake?";
        if (Object.keys(p).length) patch(c.key, p);
      }
    },
  };
});

/**
 * Whether a spoken "send" stands for the card as it is: said for this version, after it was read out and within
 * SAID_WINDOW_MS of that, and not stale itself. An edit makes a new version, so it never carries over.
 */
export const confirmed = (c: Compose, now: number) =>
  c.readVersion === c.version && c.saidVersion === c.version && c.saidAt > c.readAt && c.saidAt - c.readAt <= SAID_WINDOW_MS && now - c.saidAt <= SAID_WINDOW_MS;

/** The latest card a call is working on. */
export const talkCard = (): Compose | null =>
  Object.values(useCompose.getState().items)
    .filter((c) => c.via === "talk" && c.phase !== "cancelled")
    .sort((a, b) => b.since - a.since)[0] ?? null;
