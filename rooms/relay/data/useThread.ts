import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHide } from "@ceo/engine/web/hide.ts";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { startEmail, useEmail } from "./email.ts";
import { startTexts, useTexts } from "./texts.ts";
import { allowed, commandOf, doneHere, isOrder, keyCommand, lastRequest, metricsOf, offered, queueOf, undoable, UNDO_MS, type Command, type Exchange, type Order, type Phase } from "./thread.ts";

/**
 * The order (#803), remembered on this device only. Longest waiting first by default since #904 (Nikita: "default
 * order = longest waiting first"); a new key, so the new default reaches a device that had picked one before.
 */
const ORDER_KEY = "relay.order.v2";
function readOrder(): Order {
  try {
    const v = window.localStorage.getItem(ORDER_KEY);
    return isOrder(v) ? v : "oldest";
  } catch {
    return "oldest";
  }
}

/**
 * A Done or skip waiting out its Undo window, noted on this device (#914): a reload or a closed tab inside the window
 * would otherwise lose it, and the thread came back. The next open of Relay sends it. Only the Relay ids, never text.
 */
const HELD_KEY = "relay.held";
interface HeldNote {
  key: string;
  line: "email" | "text";
  id: string;
  cmd: "done" | "skip";
}
function writeHeld(n: HeldNote | null): void {
  try {
    if (n) window.localStorage.setItem(HELD_KEY, JSON.stringify(n));
    else window.localStorage.removeItem(HELD_KEY);
  } catch {
    /* private window: the Undo window lasts this visit */
  }
}
function readHeld(): HeldNote | null {
  try {
    const o = JSON.parse(window.localStorage.getItem(HELD_KEY) ?? "null") as Partial<HeldNote> | null;
    if (!o || typeof o.key !== "string" || typeof o.id !== "string" || (o.line !== "email" && o.line !== "text") || (o.cmd !== "done" && o.cmd !== "skip")) return null;
    return { key: o.key, line: o.line, id: o.id, cmd: o.cmd };
  } catch {
    return null;
  }
}
/** The Done or skip itself: email marks it done (or skipped), a text's Done goes to the Mac. */
function fireHeld(n: HeldNote): void {
  writeHeld(null);
  if (n.line === "email") void (n.cmd === "skip" ? useEmail.getState().skip(n.id) : useEmail.getState().done(n.id));
  else void useTexts.getState().ask({ action: "done", thread: n.id });
}

const firstOf = (who: string) => who.trim().split(/\s+/)[0] || who;

/** The Messenger's one line for what just happened (#642): plain, short, said aloud through the room's voice. */
export function sayFor(cmd: Command | "skip" | "done" | "later", x: Pick<Exchange, "who" | "line">): string {
  const who = firstOf(x.who);
  switch (cmd) {
    case "done":
      return `Closed. Nothing owed to ${who}.`;
    case "skip":
      return `Skipped. ${who} comes back only if they write again.`;
    case "later":
      return x.line === "text" ? `Later. ${who} comes back at the next nudge.` : `Later. ${who} waits at the back.`;
    case "draft":
      return x.line === "text" ? `Here's the reply for ${who}.` : `Writing it in your voice.`;
    case "yes":
      return `Sending to ${who}. Z takes it back.`;
    case "no":
      return "Not sending that. Say what to write instead.";
    case "change":
      return "Say what to change.";
    default:
      return "";
  }
}

/** A rule's line: what it covers from now on, and how many open ones moved. */
export function ruleLine(label: string, to: "can-wait" | "filtered", moved: number): string {
  const what = to === "can-wait" ? "can wait" : "are filtered out";
  return `From now on, ${label} ${what}.${moved ? ` ${moved} moved off your list.` : ""}`;
}

/**
 * Relay's Thread (#615), the controller: the live queue from both lines, the one exchange on screen, where it is
 * (incoming → drafting → ask → undo → sent → the next), and every command through the gate in ./thread.ts. The view
 * (RelayThread.tsx) only draws what this hands it, so the look can change without touching any of this.
 *
 * The exchange in focus is the one the codex scrolled to (the view tells it with `pick`); voice and keys act only on
 * it. A send needs its draft on screen (not masked by Hide), Nikita's yes (said, keyed or tapped), and then waits out
 * UNDO_MS: nothing is posted until the undo window has passed. A text goes through the texts line's send request
 * (this device's passkey unlock, single-use, bound to the draft); an email through /api/email's send, only when Gmail
 * granted send (bound to the draft, single-use, under the agent's cap). Without that grant an email's draft is copied
 * for Gmail instead.
 *
 * Since #642: anything said or typed that isn't a gate command goes to the intent layer (api/_email/intent.ts: one Haiku
 * call under the email cap) and comes back as a reply, a rule, a disposition, an answer or one question back. Done and
 * skip wait out a few seconds of Undo (Z) before they reach the server. An email gets its draft only on "Draft it";
 * a text's ready draft shows on "Reply". Every confirmation is one short line in the Messenger's voice (`say`).
 */

export interface Notice {
  kind: "undo" | "sent" | "rule" | "info" | "warn" | "say";
  text: string;
  /** A button on the notice: Undo, Unlock, … */
  act?: { label: string; run: () => void };
  /** For the undo countdown. */
  until?: number;
  at: number;
}

/** How long words for a text may take to come back as a draft (the Mac's Blasto) before the Thread says so. */
const DRAFT_WAIT_MS = 3 * 60_000;

const ERR: Record<string, string> = {
  private: "That has a number, address or key in it. Say it another way.",
  "not-set-up": "Blasto isn't set up on this copy yet.",
  cap: "The email agent's monthly cap is spent; Blasto drafts again next month.",
  "no-item": "That mail isn't waiting any more.",
  claude: "Blasto couldn't write that one. Try different words.",
  "no-key": "That mail came in before Relay kept sender rules. The next one from them can be filtered.",
  "too-few": "Not enough sent mail in the last 90 days to learn from yet.",
  refused: "Gmail needs reconnecting first.",
  "no-send": "Gmail hasn't granted sending yet. Reconnect Gmail to send from here.",
  "not-connected": "Gmail isn't connected.",
  changed: "That draft changed. Look again, then say yes.",
  "already-sent": "That one already went.",
  "no-address": "That mail has no address to reply to.",
  busy: "Relay was busy. Try again.",
  gmail: "Gmail didn't answer. Try again in a minute.",
  off: "Relay's mail lives on the Azure copy.",
};
export const errorText = (code: string) => ERR[code] ?? "That didn't go through. Try again.";

export interface ThreadHooks {
  /** Runs before a filtered or blocked exchange leaves the codex (its words sink down the spine). */
  leave?: (key: string) => Promise<void>;
}

export function useThread(now: number, hooks: ThreadHooks = {}) {
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  useEffect(() => startEmail(), []);
  useEffect(() => startTexts(), []);
  const auth = useDeskAuth((s) => s.auth.status);
  const emailStatus = useEmail((s) => s.status);
  const emailView = useEmail((s) => s.view);
  const textsStatus = useTexts((s) => s.status);
  const textsView = useTexts((s) => s.view);
  const signedIn = auth === "in";

  const [skipped, setSkipped] = useState<string[]>([]);
  const [order, setOrderState] = useState<Order>(readOrder);
  const setOrder = useCallback((o: Order) => {
    setOrderState(o);
    try {
      window.localStorage.setItem(ORDER_KEY, o);
    } catch {
      /* private window: the order lasts this visit */
    }
  }, []);
  /** Texts whose ready draft Nikita opened with Reply (#642): until then the draft stays folded. */
  const [revealed, setRevealed] = useState<string[]>([]);
  /** The intent layer is reading a line about this exchange. */
  const [reading, setReading] = useState<string | null>(null);
  /** Exchanges this page already acted on (sent, done, filtered): hidden until the next read drops them. */
  const [gone, setGone] = useState<string[]>([]);
  /** Drafts Nikita said no to (by key and the draft's text): the exchange goes back to incoming. */
  const [declined, setDeclined] = useState<Record<string, string>>({});
  /** A draft on its way; `fill` (#923, "Write for me"): it goes into the reply box when it lands. */
  const [drafting, setDrafting] = useState<{ key: string; since: number; was: string; fill?: true } | null>(null);
  /** Blasto's draft for the reply box (#923): put in on "Write for me", never before; Nikita edits it and taps Send. */
  const [fill, setFill] = useState<{ key: string; text: string; at: number } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sentHere, setSentHere] = useState(0);
  /** Who this page sent to today, newest first (the codex's margin index). */
  const [sentList, setSentList] = useState<{ key: string; who: string; at: number }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  /** Nikita's words for a text's draft (the Mac writes it, so the read doesn't carry them): shown beside the draft. */
  const [saidHere, setSaidHere] = useState<Record<string, string>>({});

  const hidden = useHide((s) => s.on);
  const canSend = emailView?.canSend === true;
  const all = useMemo(() => (signedIn && (emailView || textsView) ? queueOf(emailView?.items, textsView?.paired ? textsView.items : [], skipped, canSend, order) : null), [signedIn, emailView, textsView, skipped, canSend, order]);
  /** Done here and not yet settled on the Mac (#914): off the line across reloads. */
  const doneOnSite = useMemo(() => doneHere(textsView?.items, textsView?.requests), [textsView]);
  const queue = useMemo(
    () =>
      (all
        ? all
            .filter((x) => !gone.includes(x.key) && !(x.line === "text" && doneOnSite.has(x.id)))
            .map((x) => (declined[x.key] !== undefined && declined[x.key] === x.draft ? { ...x, draft: null } : x))
            .map((x) => (!x.said && saidHere[x.key] && x.draft ? { ...x, said: saidHere[x.key]! } : x))
            // A text's ready draft folds until Reply (#642), unless it was written from Nikita's own words.
            .map((x) => (x.line === "text" && x.draft && !revealed.includes(x.key) && !saidHere[x.key] ? { ...x, draft: null, ready: true, hint: x.draft } : x))
        : null),
    [all, gone, declined, saidHere, revealed, doneOnSite],
  );
  const ex = useMemo(() => (queue ? (queue.find((x) => x.key === current) ?? queue.find((x) => !x.settled) ?? queue[0] ?? null) : null), [queue, current]);
  useEffect(() => setCurrent(ex?.key ?? null), [ex?.key]);

  const unlocked = !!textsView?.unlockedUntil && textsView.unlockedUntil > now;
  const phase: Phase = !ex ? "empty" : pending === ex.key ? "undo" : drafting?.key === ex.key ? "drafting" : ex.draft ? "ask" : "incoming";

  // A draft arriving ends the drafting wait (a text's comes back from the Mac on a later read).
  useEffect(() => {
    if (!drafting) return;
    const x = all?.find((q) => q.key === drafting.key);
    if (x?.draft && x.draft !== drafting.was) {
      if (drafting.fill) setFill({ key: x.key, text: x.draft, at: Date.now() });
      setDrafting(null);
      return;
    }
    // "Write for me" the Mac turned down (#923): a hub from before it reads the ask as unknown until reinstalled.
    const r = drafting.fill && x ? lastRequest(textsView?.requests, x.id) : undefined;
    if (r?.kind === "draft" && r.created >= drafting.since - 60_000 && (r.state === "refused" || r.state === "failed" || r.state === "expired")) {
      setDrafting(null);
      setNotice({ kind: "warn", text: r.reason === "unreadable" ? "The Mac can't write drafts on request yet: rerun the Relay installer on it." : "Blasto couldn't write one from the Mac.", at: now });
    } else if (now - drafting.since > DRAFT_WAIT_MS) {
      setDrafting(null);
      setNotice({ kind: "warn", text: "Blasto didn't answer from the Mac. Is it awake?", at: now });
    }
  }, [all, drafting, now, textsView]);
  // While a text is being drafted, read every few seconds.
  useEffect(() => {
    if (!drafting?.key.startsWith("t:")) return;
    const t = window.setInterval(() => void useTexts.getState().refresh(), 3_000);
    return () => window.clearInterval(t);
  }, [drafting]);

  const undo = useRef(undoable());
  /** Done and skip wait out their own Undo window (#642), apart from a send's. */
  const held = useRef(undoable());
  useEffect(() => {
    // A Done (or skip) still in its Undo window when the page reloaded or closed goes now (#914): it was meant, and
    // only Undo takes it back. It was noted on this device when pressed; the next open of Relay sends it.
    const left = readHeld();
    if (left) {
      setGone((g) => (g.includes(left.key) ? g : [...g, left.key]));
      fireHeld(left);
    }
    const sends = undo.current;
    const holds = held.current;
    return () => {
      sends.flush();
      holds.flush();
    };
  }, []);

  /**
   * The send itself, after a yes or a tap on Send: it waits out UNDO_MS, then goes to the line. `own` (#803): words
   * Nikita typed himself, sent exactly as typed (an email with no draft behind it; a text bound like any send).
   */
  const sendNow = useCallback((x: Exchange, text: string, own: boolean) => {
    const at = Date.now();
    const key = x.key;
    const who = x.who;
    setPending(key);
    setNotice({ kind: "undo", text: `Sending to ${who}`, until: at + UNDO_MS, act: { label: "Undo", run: () => sayRef.current("undo") }, at });
    undo.current.start(key, () => {
      setPending(null);
      // A text's thread stays in the queue after a send (#870, multi-send): only Done takes it off. An email still goes.
      if (x.line !== "text") setGone((g) => [...g, key]);
      setSentHere((n) => n + 1);
      const went = (ok: boolean, why?: string) => {
        if (ok) {
          setNotice({ kind: "sent", text: `Sent to ${who}`, at: Date.now() });
          setSentList((l) => [{ key, who, at: Date.now() }, ...l].slice(0, 12));
        } else {
          setGone((g) => g.filter((k) => k !== key));
          setSentHere((n) => n - 1);
          setNotice({ kind: "warn", text: why ?? "That didn't go through.", at: Date.now() });
        }
      };
      if (x.line === "text")
        void useTexts
          .getState()
          .ask({ action: "send", thread: x.id, draftAt: x.draftAt, text })
          .then((ok) => went(ok, useTexts.getState().error ?? undefined));
      else
        void useEmail
          .getState()
          .send(x.id, text, own)
          .then((got) => went(got.ok, got.ok ? undefined : errorText(got.error)));
    });
  }, []);

  const say = useCallback(
    (cmd: Command, words = ""): boolean => {
      // Undo reaches the waiting send wherever the codex has scrolled since; else the waiting done or skip.
      if (cmd === "undo") {
        const k = undo.current.undo();
        if (k) {
          setPending(null);
          setNotice({ kind: "info", text: "Not sent.", at: Date.now() });
          return true;
        }
        const h = held.current.undo();
        if (!h) return false;
        writeHeld(null);
        setGone((g) => g.filter((x) => x !== h));
        setNotice({ kind: "info", text: "Back on your list.", at: Date.now() });
        return true;
      }
      if (!ex || !allowed(cmd, phase, ex)) return false;
      // A yes needs the draft readable on screen: never while Hide masks it.
      if (cmd === "yes" && hidden) return false;
      const at = Date.now();
      const next = () => {
        const i = queue?.findIndex((x) => x.key === ex.key) ?? -1;
        setCurrent(queue?.[i + 1]?.key ?? null);
      };
      switch (cmd) {
        case "yes": {
          if (ex.line === "text" && !unlocked) {
            setNotice({ kind: "warn", text: "Sending is locked on this device.", act: { label: "Unlock", run: () => void useTexts.getState().unlock() }, at });
            return true;
          }
          sendNow(ex, ex.draft!, false);
          return true;
        }
        case "no":
        case "change":
          setDeclined((d) => ({ ...d, [ex.key]: ex.draft ?? "" }));
          setNotice({ kind: "info", text: cmd === "no" ? "Not sending that. Hold Space and say what to write instead, or skip." : "Hold Space and say what to change.", at });
          return true;
        case "done":
        case "skip": {
          // Gone now, for good after the Undo window: email marks it done (or skipped), a text settles on the Mac.
          // Either comes back only when the sender writes again.
          const x = ex;
          next();
          setGone((g) => [...g, x.key]);
          const note: HeldNote = { key: x.key, line: x.line, id: x.id, cmd };
          held.current.start(x.key, () => fireHeld(note));
          writeHeld(note);
          setNotice({ kind: "undo", text: sayFor(cmd, x), until: at + UNDO_MS, act: { label: "Undo", run: () => sayRef.current("undo") }, at });
          return true;
        }
        case "later":
          if (ex.line === "text") void useTexts.getState().ask({ action: "later", thread: ex.id });
          setSkipped((s) => [...s.filter((k) => k !== ex.key), ex.key]);
          setNotice({ kind: "say", text: sayFor("later", ex), at });
          next();
          return true;
        case "draft": {
          // Draft on request (#642): an email goes to Blasto (Sonnet) from his advice. A text (#923, "Write for me"):
          // a draft the Mac already has goes into the reply box; else Blasto is asked for one, and it goes in when it
          // lands. Never sent from here: Nikita edits it and taps Send, the same send as his own words.
          if (ex.line === "text") {
            const ready = ex.hint ?? ex.draft;
            if (ready) {
              setFill({ key: ex.key, text: ready, at });
              return true;
            }
            setDrafting({ key: ex.key, since: at, was: "", fill: true });
            void useTexts
              .getState()
              .ask({ action: "draft", thread: ex.id })
              .then((ok) => {
                if (ok) return;
                setDrafting(null);
                setNotice({ kind: "warn", text: useTexts.getState().error ?? "That didn't go through.", at: Date.now() });
              });
            return true;
          }
          setDrafting({ key: ex.key, since: at, was: ex.draft ?? "" });
          void useEmail
            .getState()
            .reply(ex.id, "")
            .then((got) => {
              setDrafting(null);
              if (!got.ok) setNotice({ kind: "warn", text: errorText(got.error), at: Date.now() });
            });
          return true;
        }
        case "filter":
        case "block": {
          const key = ex.key;
          let failed = false;
          void (hooksRef.current.leave?.(key) ?? Promise.resolve()).then(() => !failed && setGone((g) => (g.includes(key) ? g : [...g, key])));
          void useEmail
            .getState()
            .rule(ex.id, cmd)
            .then((got) => {
              if (!got.ok) {
                failed = true;
                setGone((g) => g.filter((k) => k !== key));
                return setNotice({ kind: "warn", text: errorText(got.error), at: Date.now() });
              }
              const rule = got.value;
              setNotice({
                kind: "rule",
                text: cmd === "block" ? `Blocked ${rule.label}.` : `Got it, fewer like ${rule.label}.`,
                act: {
                  label: "Undo",
                  run: () => {
                    setGone((g) => g.filter((k) => k !== key));
                    void useEmail.getState().unrule(rule.id);
                    setNotice({ kind: "info", text: "Rule taken back.", at: Date.now() });
                  },
                },
                at: Date.now(),
              });
            });
          return true;
        }
        case "words": {
          const said = words.trim();
          if (!said) return false;
          if (ex.line === "text") setRevealed((r) => (r.includes(ex.key) ? r : [...r, ex.key]));
          setDeclined((d) => {
            const { [ex.key]: _drop, ...rest } = d;
            return rest;
          });
          setDrafting({ key: ex.key, since: at, was: ex.draft ?? "" });
          if (ex.line === "text") {
            setSaidHere((m) => ({ ...m, [ex.key]: said }));
            void useTexts
              .getState()
              .ask({ action: "restyle", thread: ex.id, text: said })
              .then((ok) => {
                if (!ok) {
                  setDrafting(null);
                  setNotice({ kind: "warn", text: useTexts.getState().error ?? "That didn't go through.", at: Date.now() });
                }
              });
          } else {
            void useEmail
              .getState()
              .reply(ex.id, said)
              .then((got) => {
                setDrafting(null);
                if (!got.ok) setNotice({ kind: "warn", text: errorText(got.error), at: Date.now() });
              });
          }
          return true;
        }
        default:
          return false;
      }
    },
    [ex, phase, queue, unlocked, hidden, sendNow],
  );
  const sayRef = useRef(say);

  /**
   * Nikita's own typed reply (#803), sent exactly as typed when he taps Send: no rewrite, no voice pass, no model.
   * Only on the exchange in focus, while it waits on him, never masked by Hide; a text still needs this device's
   * unlock. Rewriting into his voice is only for Blasto's drafts and for what he says aloud (offered as a draft).
   */
  const sendOwn = useCallback(
    (text: string): boolean => {
      const words = text.replace(/\r\n?/g, "\n").trim();
      if (!ex || !words || words.length > 2_000 || hidden || !ex.sendable || (phase !== "incoming" && phase !== "ask")) return false;
      if (ex.line === "text" && !unlocked) {
        setNotice({ kind: "warn", text: "Sending is locked on this device.", act: { label: "Unlock", run: () => void useTexts.getState().unlock() }, at: Date.now() });
        return false;
      }
      sendNow(ex, words, true);
      return true;
    },
    [ex, hidden, phase, unlocked, sendNow],
  );
  sayRef.current = say;

  const exRef = useRef(ex);
  exRef.current = ex;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  /**
   * What a line means beyond the gate (#642): the intent layer's one Haiku call. Its answer is carried out here
   * through the same gate as a tap, and comes back as one short line to show (and, through the room's voice, to say).
   */
  const understand = useCallback(async (x: Exchange, raw: string): Promise<string> => {
    setReading(x.key);
    const got = await useEmail.getState().intent(x.key, raw);
    setReading(null);
    const at = Date.now();
    if (!got.ok) {
      // No model here (no key, the cap, a refusal): the words are a reply, as before the intent layer.
      if (got.error === "private") {
        setNotice({ kind: "warn", text: errorText("private"), at });
        return errorText("private");
      }
      sayRef.current("words", raw);
      return "Writing it in your voice.";
    }
    const { intent } = got.value;
    switch (intent.kind) {
      case "reply":
        sayRef.current(intent.words ? "words" : "draft", intent.words || raw);
        return "Writing it in your voice.";
      case "disposition":
        sayRef.current(intent.disposition);
        return sayFor(intent.disposition, x);
      case "rule": {
        const r = got.value.rule;
        const text = ruleLine(r?.label ?? "mail like this", intent.to, got.value.moved ?? 0);
        if (r) setGone((g) => (got.value.moved ? [...g, x.key] : g));
        setNotice({
          kind: "rule",
          text,
          act: r
            ? {
                label: "Undo",
                run: () => {
                  setGone((g) => g.filter((k) => k !== x.key));
                  void useEmail.getState().unrule(r.id);
                  setNotice({ kind: "info", text: "Rule taken back.", at: Date.now() });
                },
              }
            : undefined,
          at,
        });
        return text;
      }
      case "question":
      case "unclear":
        setNotice({ kind: "say", text: intent.answer, at });
        return intent.answer;
    }
  }, []);

  /** One heard or typed line: a command when it is one and works now, else the intent layer reads it. */
  const line = useCallback(
    (raw: string): { cmd: Command | null; ok: boolean; said?: Promise<string> } => {
      const cmd = commandOf(raw, phaseRef.current);
      if (!cmd) return { cmd, ok: false };
      const x = exRef.current;
      if (cmd === "words") {
        if (!x || !raw.trim() || !allowed("words", phaseRef.current, x)) return { cmd, ok: false };
        return { cmd, ok: true, said: understand(x, raw.trim()) };
      }
      const ok = sayRef.current(cmd, raw);
      // A command that doesn't work now says so quietly; it never falls through to anything else.
      if (!ok) setNotice({ kind: "info", text: cmd === "yes" ? "Nothing to send yet." : `"${raw.trim()}" doesn't apply right now.`, at: Date.now() });
      return { cmd, ok, said: Promise.resolve(ok && x ? sayFor(cmd, x) : "") };
    },
    [understand],
  );

  /** A key press: Y, N, S, Z, L. */
  const key = useCallback((k: string) => {
    const cmd = keyCommand(k);
    return cmd ? sayRef.current(cmd) : false;
  }, []);

  // Groups that wait (#950: unread in Messages, or asking Nikita) sit on their own shelf, off the line, but count.
  const groupsWaiting = signedIn && textsView?.paired ? textsView.items.filter((i) => i.group && i.state !== "settled").length : 0;
  const metrics = metricsOf(emailStatus, textsStatus, queue, sentHere, groupsWaiting);
  const clearFill = useCallback(() => setFill(null), []);
  return { signedIn, queue, ex, phase, offered: offered(phase, ex), notice, setNotice, metrics, unlocked, canSend, hidden, line, key, say, sendOwn, order, setOrder, pick: setCurrent, drafting, pending, sentList, reading, fill, clearFill };
}
