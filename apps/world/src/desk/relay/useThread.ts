import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeskAuth } from "../signin.ts";
import { startEmail, useEmail } from "../email/email.ts";
import { startTexts, useTexts } from "../texts/texts.ts";
import { allowed, commandOf, keyCommand, metricsOf, offered, queueOf, undoable, UNDO_MS, type Command, type Exchange, type Phase } from "./thread.ts";

/**
 * Relay's Thread (#615), the controller: the live queue from both lines, the one exchange on screen, where it is
 * (incoming → drafting → ask → undo → sent → the next), and every command through the gate in ./thread.ts. The view
 * (RelayThread.tsx) only draws what this hands it, so the look can change without touching any of this.
 *
 * Sends are texts only (the texts line's send request: this device's passkey unlock, single-use, bound to the draft
 * on screen) and wait out UNDO_MS first: nothing is posted until the undo window has passed. Email is read-only, so
 * an email's draft is copied for Gmail instead.
 */

export interface Notice {
  kind: "undo" | "sent" | "rule" | "info" | "warn";
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
  gmail: "Gmail didn't answer. Try again in a minute.",
  off: "Relay's mail lives on the Azure copy.",
};
export const errorText = (code: string) => ERR[code] ?? "That didn't go through. Try again.";

export function useThread(now: number) {
  useEffect(() => startEmail(), []);
  useEffect(() => startTexts(), []);
  const auth = useDeskAuth((s) => s.auth.status);
  const emailStatus = useEmail((s) => s.status);
  const emailView = useEmail((s) => s.view);
  const textsStatus = useTexts((s) => s.status);
  const textsView = useTexts((s) => s.view);
  const signedIn = auth === "in";

  const [skipped, setSkipped] = useState<string[]>([]);
  /** Exchanges this page already acted on (sent, done, filtered): hidden until the next read drops them. */
  const [gone, setGone] = useState<string[]>([]);
  /** Drafts Nikita said no to (by key and the draft's text): the exchange goes back to incoming. */
  const [declined, setDeclined] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState<{ key: string; since: number; was: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sentHere, setSentHere] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  /** Nikita's words for a text's draft (the Mac writes it, so the read doesn't carry them): shown beside the draft. */
  const [saidHere, setSaidHere] = useState<Record<string, string>>({});

  const all = useMemo(() => (signedIn && (emailView || textsView) ? queueOf(emailView?.items, textsView?.paired ? textsView.items : [], skipped) : null), [signedIn, emailView, textsView, skipped]);
  const queue = useMemo(
    () =>
      (all
        ? all
            .filter((x) => !gone.includes(x.key)).map((x) => (declined[x.key] !== undefined && declined[x.key] === x.draft ? { ...x, draft: null } : x))
            .map((x) => (!x.said && saidHere[x.key] && x.draft ? { ...x, said: saidHere[x.key]! } : x))
        : null),
    [all, gone, declined, saidHere],
  );
  const ex = useMemo(() => (queue ? (queue.find((x) => x.key === current) ?? queue[0] ?? null) : null), [queue, current]);
  useEffect(() => setCurrent(ex?.key ?? null), [ex?.key]);

  const unlocked = !!textsView?.unlockedUntil && textsView.unlockedUntil > now;
  const phase: Phase = !ex ? "empty" : pending === ex.key ? "undo" : drafting?.key === ex.key ? "drafting" : ex.draft ? "ask" : "incoming";

  // A draft arriving ends the drafting wait (a text's comes back from the Mac on a later read).
  useEffect(() => {
    if (!drafting) return;
    const x = all?.find((q) => q.key === drafting.key);
    if (x?.draft && x.draft !== drafting.was) setDrafting(null);
    else if (now - drafting.since > DRAFT_WAIT_MS) {
      setDrafting(null);
      setNotice({ kind: "warn", text: "Blasto didn't answer from the Mac. Is it awake?", at: now });
    }
  }, [all, drafting, now]);
  // While a text is being drafted, read every few seconds.
  useEffect(() => {
    if (!drafting?.key.startsWith("t:")) return;
    const t = window.setInterval(() => void useTexts.getState().refresh(), 3_000);
    return () => window.clearInterval(t);
  }, [drafting]);

  const undo = useRef(undoable());
  useEffect(() => () => undo.current.flush(), []);

  const say = useCallback(
    (cmd: Command, words = ""): boolean => {
      if (!ex || !allowed(cmd, phase, ex)) return false;
      const at = Date.now();
      const next = () => {
        const i = queue?.findIndex((x) => x.key === ex.key) ?? -1;
        setCurrent(queue?.[i + 1]?.key ?? null);
      };
      switch (cmd) {
        case "yes": {
          if (!unlocked) {
            setNotice({ kind: "warn", text: "Sending is locked on this device.", act: { label: "Unlock", run: () => void useTexts.getState().unlock() }, at });
            return true;
          }
          const draft = ex.draft!;
          const key = ex.key;
          setPending(key);
          const who = ex.who;
          setNotice({ kind: "undo", text: `Sending to ${who}`, until: at + UNDO_MS, act: { label: "Undo", run: () => sayRef.current("undo") }, at });
          undo.current.start(key, () => {
            setPending(null);
            setGone((g) => [...g, key]);
            setSentHere((n) => n + 1);
            void useTexts
              .getState()
              .ask({ action: "send", thread: ex.id, draftAt: ex.draftAt, text: draft })
              .then((ok) => {
                if (ok) setNotice({ kind: "sent", text: `Sent to ${who}`, at: Date.now() });
                else {
                  setGone((g) => g.filter((k) => k !== key));
                  setSentHere((n) => n - 1);
                  setNotice({ kind: "warn", text: useTexts.getState().error ?? "That didn't go through.", at: Date.now() });
                }
              });
          });
          return true;
        }
        case "undo": {
          const k = undo.current.undo();
          setPending(null);
          if (k) setNotice({ kind: "info", text: "Not sent.", at });
          return true;
        }
        case "no":
        case "change":
          setDeclined((d) => ({ ...d, [ex.key]: ex.draft ?? "" }));
          setNotice({ kind: "info", text: cmd === "no" ? "Not sending that. Say what to write instead, or skip." : "Say what to change.", at });
          return true;
        case "skip":
          setSkipped((s) => [...s.filter((k) => k !== ex.key), ex.key]);
          next();
          return true;
        case "later":
          if (ex.line === "text") void useTexts.getState().ask({ action: "later", thread: ex.id });
          setSkipped((s) => [...s.filter((k) => k !== ex.key), ex.key]);
          next();
          return true;
        case "filter":
        case "block": {
          const key = ex.key;
          setGone((g) => [...g, key]);
          void useEmail
            .getState()
            .rule(ex.id, cmd)
            .then((got) => {
              if (!got.ok) {
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
      }
    },
    [ex, phase, queue, unlocked],
  );
  const sayRef = useRef(say);
  sayRef.current = say;

  /** One heard or typed line: a command when it is one and works now, else words for a reply. */
  const line = useCallback(
    (raw: string): { cmd: Command | null; ok: boolean } => {
      const cmd = commandOf(raw);
      if (!cmd) return { cmd, ok: false };
      const ok = sayRef.current(cmd, raw);
      // A command that doesn't work now says so quietly; it never falls through to anything else.
      if (!ok && cmd !== "words") setNotice({ kind: "info", text: cmd === "yes" ? "Nothing to send yet." : `"${raw.trim()}" doesn't apply right now.`, at: Date.now() });
      return { cmd, ok };
    },
    [],
  );

  /** A key press: Y, N, S, Z, L. */
  const key = useCallback((k: string) => {
    const cmd = keyCommand(k);
    return cmd ? sayRef.current(cmd) : false;
  }, []);

  const done = useCallback(
    (x: Exchange) => {
      setGone((g) => [...g, x.key]);
      if (x.line === "email") void useEmail.getState().done(x.id);
      else void useTexts.getState().ask({ action: "done", thread: x.id });
      setNotice({
        kind: "info",
        text: `Marked done.`,
        act: x.line === "email" ? { label: "Undo", run: () => (setGone((g) => g.filter((k) => k !== x.key)), void useEmail.getState().undone(x.id)) } : undefined,
        at: Date.now(),
      });
    },
    [],
  );

  const metrics = metricsOf(emailStatus, textsStatus, queue, sentHere);
  return { signedIn, queue, ex, phase, offered: offered(phase, ex), notice, setNotice, metrics, unlocked, line, key, say, done, pick: setCurrent, drafting };
}
