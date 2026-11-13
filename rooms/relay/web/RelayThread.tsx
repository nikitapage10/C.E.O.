import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { gmailHref } from "./EmailSection.tsx";
import { takeGmailReturn, useEmail } from "../data/email.ts";
import { textsShown, useTexts, type TextItem } from "../data/texts.ts";
import { TextsSection } from "./TextsSection.tsx";
import { setRelayHandler } from "../data/bridge.ts";
import { GroupFlipper } from "./GroupFlipper.tsx";
import { groupsOf } from "../data/groups.ts";
import { RelayQueue, useMedia } from "./RelayQueue.tsx";
import { useSnapScroll } from "./useSnapScroll.ts";
import { lengthOf, outline, pointAlong, traceCount, traceStops, TRACE_MS } from "../data/trace.ts";
import { isTyping } from "@ceo/engine/web/wasdPan.ts";
import { Said } from "./Said.tsx";
import { EmojiPicker, Tapbacks } from "./Tapbacks.tsx";
import { outOf, useOutbox } from "../data/outbox.ts";
import { SetAside } from "./SetAside.tsx";
import { ghost, ghosted, quill, rise, SigilStage, sink } from "@ceo/engine/sigils/sigils.ts";
import { agoShort, askLine, codexOf, contactsHint, initialOf, lastRequest, noGistLine, olderInOrder, weekSent, type Exchange, type Order } from "../data/thread.ts";
import { errorText, useThread, type Notice } from "../data/useThread.ts";
import { useRoomMic } from "@ceo/desk/roomvoice/roomVoice.ts";
import { useHoldSpace } from "./holdSpace.ts";
import { useRoomShown } from "@ceo/engine/web/roomReady.ts";
import { RelayField } from "./RelayField.tsx";
import "./thread.css";

/**
 * The Relay's nanites, its sigils, in soft white (Nikita, 2026-11-05: "I don't like the gold accent on the relay. They
 * should be white."; #864 had made them gold): every glyph on the spine, the quill, the send and the bursts; the line's
 * own glow and the rest of the blue look stay as they are.
 */
const NANITE = { hi: "#eef2ff", you: "#ffffff", white: "#ffffff", sink: "#8a90a6" } as const;

/**
 * Relay's Thread (#615, simplified in #642) in the Codex look Nikita picked: a glowing spine down the page. Since #803
 * everything about the exchange in focus sits right of the line (their photo, logo or glowing initial, their name in
 * serif italic, their own texts, the gist small, Blasto's advice, one row of actions: Draft it or Reply, Write, Done,
 * Later, Skip and "…"), written in by a quill of sigils from the spine; every owed thread's circle sits on the line
 * itself, magnified where the pointer or the scroll is (./RelayQueue.tsx, #869), and a small toggle
 * on the line orders the queue newest, oldest or by priority. A text opens straight on Nikita's own words (#869): the
 * composer, with a mic to dictate into it and Blasto's draft only as a faint suggestion beside it; an email's draft
 * appears when asked for, with Send, Edit and Change. Write and Edit send your own words exactly as typed.
 * What you say shows at the spine's foot while you speak, then fades; the keys hide behind "?" (#950: no type box;
 * holding Space answers whatever is open).
 *
 * The to-do queue is one continuous codex: each exchange a full-height entry, soft-snapped. The entry in focus is the
 * only one voice and keys act on, and a send needs its draft (or your own words) on screen there. The Codex below is
 * one line of numbers, then Email and Texts in the queue's order; everything else sits behind Settings.
 *
 * This file only draws: the queue, the state machine and the gate live in ./useThread.ts and ./thread.ts, the glyph
 * engine in ./sigils.ts; listening is the Desk's room mic (#638), which hands what is said to rooms/relay/voice.ts and
 * from there to this Thread (./bridge.ts). Every word of mail or text is wrapped in <Private> for Hide mode, and
 * only the signed-in passkey session ever has any; signed out, the page shows counts and states.
 */

const PARTS = ".cx-init, .cx-msg, .cx-adv, .cx-draft";
/** How long a scroll of our own may take to arrive before scrolling picks the focus again (#895). */
const STEER_MS = 2_000;
const rnd = Math.random;
const first = (who: string) => who.trim().split(/\s+/)[0] || who;

/** The sender's face: the Mac's contact photo, else their domain's logo, else the initial (#642). */
function Face({ x, hidden }: { x: Exchange; hidden: boolean }) {
  const srcs = hidden ? [] : [x.photo ? `/api/relay?photo=${x.photo}` : "", x.logo ? `/api/email?logo=${x.logo}` : ""].filter(Boolean);
  const [bad, setBad] = useState(0);
  const src = srcs[bad];
  if (src) return <img className="cx-face" src={src} alt="" width={64} height={64} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad((b) => b + 1)} />;
  return (
    <span className="cx-init" aria-hidden="true">
      {hidden ? "·" : initialOf(x.who)}
    </span>
  );
}

/** The dock's notice: the undo countdown with its sigils, a send that went, or the Messenger's one line. */
function UndoLine({ n, now, sg }: { n: Notice | null; now: number; sg: SigilStage | null }) {
  const live = !!n && now - n.at < (n.kind === "rule" ? 12_000 : n.kind === "undo" ? 6_000 : 5_000);
  const left = n?.until ? Math.max(0, Math.ceil((n.until - now) / 1000)) : 0;
  const sigs = useMemo(() => (sg ? Array.from({ length: left }, () => sg.randGlyph()).join(" ") : "∴ ".repeat(left).trim()), [left, sg]);
  return (
    <div className="cx-undo" data-on={live || undefined} data-kind={n?.kind} role="status" aria-live="polite">
      {live && n && (
        <>
          {n.kind === "undo" ? (
            <>
              <span>
                <Private>{n.text}</Private> <span className="cx-n">{left}</span>
              </span>
              <span className="cx-sig" aria-hidden="true">
                {sigs}
              </span>
            </>
          ) : n.kind === "sent" ? (
            <span className="cx-ok">
              ∴ <Private>{n.text}</Private>
            </span>
          ) : (
            <span data-warn={n.kind === "warn" || undefined}>
              <Private>{n.text}</Private>
            </span>
          )}
          {n.act && (
            <button type="button" onClick={n.act.run}>
              {n.act.label}
              {n.act.label === "Undo" ? " · Z" : ""}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** The entry when nothing is waiting, or before sign-in: where the page's words come from. */
function Waiting({ signedIn, waiting }: { signedIn: boolean; waiting: number | null }) {
  const emailLoad = useEmail((s) => s.load);
  const emailStatus = useEmail((s) => s.status);
  const emailView = useEmail((s) => s.view);
  const textsStatus = useTexts((s) => s.status);
  const textsView = useTexts((s) => s.view);
  const auth = useDeskAuth((s) => s.auth.status);
  const signIn = useDeskAuth((s) => s.signIn);
  const gmailOn = !!emailStatus && emailStatus.gmail === "connected" && emailStatus.agent !== "waiting";
  const textsOn = !!textsStatus && textsStatus.hub !== "off" && textsStatus.hub !== "wiped";
  let h: ReactNode;
  let p: string;
  if (emailLoad === "off") {
    h = "Relay's mail lives on the Azure copy.";
    p = "Dialtone and Blasto work on the Azure copy, where their keys are. Open the Desk there.";
  } else if (!gmailOn && !textsOn) {
    h = "Waiting for a line.";
    p = "Connect Gmail or pair the MacBook under Settings in the codex below, and what needs you is written in here, one at a time.";
  } else if (!signedIn) {
    h = waiting ? `${waiting} waiting on you.` : "Nothing waiting on you.";
    p = "Who they are, what they said and Blasto's advice show only when you sign in.";
  } else if (!textsView && !emailView) {
    h = "Reading…";
    p = "";
  } else {
    h = "Nothing waiting on you.";
    p = "Dialtone sorts each new mail and text as it lands. Anything that needs you is written in here.";
  }
  return (
    <article className="cx-entry cx-empty">
      <div className="cx-folio">
        <div className="cx-verse">
          <div className="cx-mar">
            <span className="cx-init is-still" aria-hidden="true">
              ∴
            </span>
            <span className="cx-rub">Relay</span>
          </div>
          <div className="cx-body">
            <p className="cx-msg is-still">{h}</p>
            {p && <p className="cx-sub">{p}</p>}
            {!signedIn && auth === "out" && (gmailOn || textsOn) && (
              <div className="cx-ask">
                <button type="button" className="cx-opt is-yes" onClick={() => void signIn()}>
                  Sign in
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** "…": what is there but rarely needed. */
function More({ x, t }: { x: Exchange; t: ReturnType<typeof useThread> }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [copied, setCopied] = useState(false);
  const close = () => ref.current?.removeAttribute("open");
  const pick = (fn: () => void) => () => {
    fn();
    close();
  };
  return (
    <details className="cx-more" ref={ref}>
      <summary aria-label="More actions" title="More">
        …
      </summary>
      <div className="cx-menu" role="menu">
        {x.line === "email" && (
          <>
            <button type="button" role="menuitem" onClick={pick(() => t.say("filter"))}>
              Filter these out
            </button>
            <button type="button" role="menuitem" className="is-danger" onClick={pick(() => t.say("block"))}>
              Block this sender
            </button>
            <a role="menuitem" href={gmailHref(x.id)} target="_blank" rel="noopener noreferrer" onClick={close}>
              Open in Gmail
            </a>
          </>
        )}
        {x.draft && (
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(x.draft ?? "")
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => {
                    setCopied(false);
                    close();
                  }, 1_200);
                })
                .catch(() => undefined)
            }
          >
            {copied ? "Copied" : "Copy the draft"}
          </button>
        )}
      </div>
    </details>
  );
}

/**
 * The texts on their way from this box (#950): Nikita's own lines, right-aligned like his sent bubbles, in the order
 * they go, each with its state: sending (with Undo while its few seconds last), sent, or not sent with why and Resend.
 */
function Outbox({ thread, hidden }: { thread: string; hidden: boolean }) {
  const list = useOutbox((s) => s.list);
  const mine = useMemo(() => outOf(list, thread), [list, thread]);
  if (!mine.length) return null;
  return (
    <ol className="cx-out" aria-label="Your texts on their way" aria-live="polite">
      {mine.map((m) => (
        <li key={m.id} className="cx-outmsg" data-state={m.state}>
          {m.reply && (
            <span className="cx-outq">
              <Private>{m.reply.text}</Private>
            </span>
          )}
          <span className="cx-outtext">{hidden ? "·" : <Private>{m.text}</Private>}</span>
          <span className="cx-outstate">
            {m.state === "held" ? (
              <>
                sending…{" "}
                <button type="button" onClick={() => useOutbox.getState().drop(m.id)}>
                  Undo
                </button>
              </>
            ) : m.state === "sent" ? (
              "sent"
            ) : m.state === "failed" ? (
              <>
                not sent: {m.why ?? "it didn't go."}{" "}
                <button type="button" onClick={() => useOutbox.getState().retry(m.id)}>
                  Resend
                </button>
              </>
            ) : (
              "sending…"
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Opens a text's reply box and puts the cursor in it (#869, #904): a tap on its circle on the line, R or Enter. */
const WRITE_EVENT = "relay:write";
const openComposer = (key: string) => window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: key }));

/**
 * Nikita's own reply (#803), always open under the newest message on a text (#904): what he types here goes exactly
 * as typed when he taps Send or presses Enter (Shift+Enter is a new line), after the same few seconds of Undo; no
 * rewrite and no model. The box starts empty (#923, Nikita: "Don't populate the reply box with drafts"): "Write for
 * me" beside Send asks Blasto for a draft only then, and it lands in the box to edit; it is never sent unless it is
 * in the box and Send is pressed. Esc leaves the box so the page's keys work again. Holding Space (outside a text
 * field) talks into it (./holdSpace.ts).
 */
function Own({ x, t, focus, start = "", launch, reply = null, clearReply, children }: { x: Exchange; t: ReturnType<typeof useThread>; focus: boolean; start?: string; launch: (el: HTMLElement | null) => void; reply?: { ref: string; text: string } | null; clearReply?: () => void; children?: ReactNode }) {
  const [text, setText] = useState(start);
  // Z took a queued text back (#950): its words return to this box.
  const back = t.takenBack;
  const clearBack = t.clearTakenBack;
  useEffect(() => {
    if (!back || back.key !== x.key) return;
    clearBack();
    setText((now) => (now.trim() ? `${back.text}\n${now}` : back.text));
  }, [back, clearBack, x.key]);
  // An inline reply picked (#950): the cursor goes to the box.
  useEffect(() => {
    if (reply) ref.current?.focus({ preventScroll: true });
  }, [reply]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const { hearing, note } = useHoldSpace(focus && !t.hidden, setText, () => textRef.current);
  useEffect(() => {
    if (!focus) setText("");
  }, [focus]);
  // Edit (an email's draft, or a text's spoken one) starts the box from it, cursor at the end.
  useEffect(() => {
    if (!start) return;
    const el = ref.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(start.length, start.length);
  }, [start]);
  // A tap on the line, R or Enter puts the cursor in the box.
  useEffect(() => {
    if (!focus) return;
    const open = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== x.key) return;
      const el = ref.current;
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(el.value.length, el.value.length);
    };
    window.addEventListener(WRITE_EVENT, open);
    return () => window.removeEventListener(WRITE_EVENT, open);
  }, [focus, x.key]);
  const locked = x.line === "text" && !t.unlocked;
  const take = (words: string) => {
    setText(words);
    window.setTimeout(() => {
      const el = ref.current;
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(words.length, words.length);
    }, 0);
  };
  // "Write for me" (#923): Blasto's draft, once it is here, goes into the box to edit.
  const fill = t.fill;
  const clearFill = t.clearFill;
  useEffect(() => {
    if (!focus || !fill || fill.key !== x.key) return;
    clearFill();
    take(fill.text);
  }, [focus, fill, clearFill, x.key]);
  const canWrite = x.line === "text" && x.sendable && !x.group;
  const who = t.hidden ? "them" : x.who;
  const id = `cx-own-${x.key}`;
  return (
    <form
      className="cx-own"
      data-hearing={hearing || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (locked) return;
        // #950: the box clears at once and stays open and editable; the text queues and goes in order (Outbox below).
        if (t.sendOwn(text, x.line === "text" ? reply : null)) {
          launch(ref.current);
          setText("");
          clearReply?.();
          ref.current?.focus({ preventScroll: true });
        }
      }}
    >
      {x.line === "text" && <Outbox thread={x.id} hidden={t.hidden} />}
      <label className="cx-sr" htmlFor={id}>
        Your reply to {who}, sent exactly as you type it
      </label>
      {reply && (
        <p className="cx-quote">
          <span className="cx-lab">Replying to</span>{" "}
          <q>
            <Private>{reply.text}</Private>
          </q>
          <button type="button" className="cx-quotex" onClick={() => clearReply?.()} aria-label="Cancel the inline reply" title="Cancel the inline reply">
            ×
          </button>
        </p>
      )}
      <div className="cx-box">
        <textarea
          id={id}
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          rows={Math.min(6, Math.max(1, text.split("\n").length))}
          maxLength={2_000}
          placeholder={hearing ? "Listening…" : `Reply to ${t.hidden ? "them" : first(x.who)}`}
          data-private=""
        />
        {hearing && (
          <span className="cx-listen" role="status">
            <i aria-hidden="true" /> Listening · let go of Space to stop
          </span>
        )}
      </div>
      <div className="cx-ask cx-acts">
        {locked ? (
          <button type="button" className="cx-opt is-yes cx-send" onClick={() => void useTexts.getState().unlock()} title="One passkey check unlocks sending on this device for 72 hours">
            Unlock to send
          </button>
        ) : (
          <button type="submit" className="cx-opt is-yes cx-send" disabled={!text.trim() || t.hidden}>
            Send <kbd>Enter</kbd>
          </button>
        )}
        {canWrite && (
          <button type="button" className="cx-opt cx-write" disabled={t.hidden} onClick={() => t.say("draft")} title="Blasto writes a draft in your voice, into the box to edit; nothing sends until you tap Send">
            <i aria-hidden="true">✦</i> Write for me
          </button>
        )}
        <EmojiPicker box={ref} value={text} set={setText} />
        {children}
      </div>
      {note && <p className="cx-warn">{note}</p>}
    </form>
  );
}

/** One exchange, right of the line (#803, #904): the conversation, then the reply box always open under it on a text. */
function Entry({ x, focus, now, t, launch }: { x: Exchange; focus: boolean; now: number; t: ReturnType<typeof useThread>; launch: (el: HTMLElement | null) => void }) {
  const hidden = t.hidden;
  const sealed = t.pending === x.key;
  const phase = focus ? t.phase : null;
  const connect = useEmail((s) => s.connect);
  const canConnect = useEmail((s) => s.view?.canConnect === true);
  const textsView = useTexts((s) => s.view);
  const req = x.line === "text" ? lastRequest(textsView?.requests, x.id) : undefined;
  const reading = t.reading === x.key;
  /** This page's own texts on their way (#950): a failed one says so in the outbox, so the older line doesn't repeat it. */
  const outbox = useOutbox((s) => s.list);
  /** An email's own-words box, or a spoken draft taken into the box by Edit: closed, empty, or started from a draft. */
  const [own, setOwn] = useState<string | null>(null);
  /** Their line picked on the card (#950): tapbacks go on it, and Reply answers it inline. Their latest by default. */
  const [picked, setPicked] = useState<string | null>(null);
  const [reply, setReply] = useState<{ ref: string; text: string } | null>(null);
  useEffect(() => {
    if (!focus) {
      setOwn(null);
      setPicked(null);
      setReply(null);
    }
  }, [focus]);
  // A line that left the card (the list moved on) can't be picked or answered any more.
  useEffect(() => {
    if (picked && !x.messages?.some((m) => m.ref === picked)) setPicked(null);
    if (reply && !x.messages?.some((m) => m.ref === reply.ref)) setReply(null);
  }, [x.messages, picked, reply]);
  const pickable = focus && x.line === "text" && !x.group && x.sendable;
  const textLine = x.line === "text" && x.sendable;
  const open = phase === "incoming" || phase === "ask";
  /** A text's reply box is open whenever it is in focus (#904); an email's only on Write or Edit. */
  const writing = focus && open && !reading && (own !== null || (textLine && phase === "incoming"));
  /** The one row (#904): Send lives in the box; then Done, Later and "…". No Skip, no Cancel. */
  const rest = (
    <>
      <button type="button" className="cx-opt" onClick={() => t.say("done")}>
        Done <kbd>D</kbd>
      </button>
      <button type="button" className="cx-opt" onClick={() => t.say("later")} title={x.line === "text" ? "Back at the next nudge" : "To the back of the line"}>
        Later <kbd>A</kbd>
      </button>
      <More x={x} t={t} />
    </>
  );
  return (
    <article className="cx-entry" data-key={x.key} data-focus={focus || undefined} aria-label={`From ${hidden ? "someone" : x.who}`} aria-current={focus || undefined}>
      <div className="cx-folio">
        <div className="cx-verse cx-them">
          <div className="cx-body">
            <header className="cx-head">
              <Face x={x} hidden={hidden} />
              <span className="cx-id">
                <Private className="cx-rub">{x.who}</Private>
                <span className="cx-meta">
                  {x.line === "email" ? "email" : x.channel === "SMS" ? "sms" : "text"} · waiting {agoShort(now - x.at)}
                  {x.unread && <span className="cx-unread"> · unread</span>}
                  {x.settled && <span className="cx-settled"> · no reply needed</span>}
                </span>
              </span>
            </header>
            {x.messages?.length ? (
              <Said messages={x.messages} hidden={hidden} picked={pickable ? picked : null} onPick={pickable ? (r) => setPicked((p) => (p === r ? null : r)) : undefined} />
            ) : (
              <p className="cx-bub cx-bub-hero">
                <span className="cx-msg cx-hero">
                  <Private>{x.body || noGistLine(x)}</Private>
                </span>
              </p>
            )}
            {/* Tapbacks (#888): small, under their words, on the card in focus. */}
            {focus && x.line === "text" && x.messages?.length ? <Tapbacks thread={x.id} messages={x.messages} hidden={hidden} picked={picked} onPick={pickable ? setPicked : undefined} onReply={pickable ? (m) => setReply({ ref: m.ref!, text: m.text }) : undefined} /> : null}
            {x.line === "email" && x.advice && (
              <p className="cx-adv">
                <span className="cx-lab">Blasto</span> <Private>{x.advice}</Private>
              </p>
            )}
          </div>
        </div>

        {(focus || x.draft) && (
          <div className="cx-verse cx-you">
            <div className="cx-body">
              {x.said && (
                <p className="cx-youlab">
                  <span className="cx-meta">
                    heard{" "}
                    <q>
                      <Private>{x.said}</Private>
                    </q>
                  </span>
                </p>
              )}
              {writing ? (
                <Own x={x} t={t} focus={focus} start={own ?? ""} launch={launch} reply={reply} clearReply={() => setReply(null)}>
                  {rest}
                </Own>
              ) : focus && reading ? (
                <p className="cx-quiet">Reading that…</p>
              ) : focus && phase === "drafting" ? (
                <p className="cx-quiet">Blasto is writing it in your voice…</p>
              ) : x.draft ? (
                <>
                  <p className="cx-draft" data-sent={sealed || undefined}>
                    <Private>{x.draft}</Private>
                  </p>
                  {sealed && (
                    <p className="cx-tag">
                      Sealed · sending to {hidden ? "them" : <Private>{first(x.who)}</Private>}
                    </p>
                  )}
                </>
              ) : null}

              {focus && phase === "incoming" && !reading && !writing && (
                <div className="cx-ask cx-acts">
                  {x.line === "email" && (
                    <>
                      <button type="button" className="cx-opt is-yes" onClick={() => t.say("draft")}>
                        Draft it <kbd>R</kbd>
                      </button>
                      {x.sendable && (
                        <button type="button" className="cx-opt" onClick={() => setOwn("")} title="Type your reply; it goes exactly as typed">
                          Write
                        </button>
                      )}
                    </>
                  )}
                  {rest}
                </div>
              )}

              {focus && phase === "ask" && x.draft && !writing && (
                <div className="cx-ask">
                  {hidden ? (
                    <p>Turn off Hide to send.</p>
                  ) : x.sendable ? (
                    <>
                      <p>{askLine(x)}</p>
                      {x.line === "text" && !t.unlocked ? (
                        <button type="button" className="cx-opt is-yes" onClick={() => void useTexts.getState().unlock()} title="One passkey check unlocks sending on this device for 72 hours">
                          Unlock to send
                        </button>
                      ) : (
                        <button type="button" className="cx-opt is-yes" onClick={() => t.say("yes")}>
                          Send <kbd>Y</kbd>
                        </button>
                      )}
                      <button type="button" className="cx-opt" onClick={() => setOwn(x.draft ?? "")} title="Edit it by hand; it then goes exactly as typed">
                        Edit
                      </button>
                      <button
                        type="button"
                        className="cx-opt"
                        onClick={() => t.say("change")}
                      >
                        Change
                      </button>
                      {rest}
                    </>
                  ) : (
                    <>
                      <p>Send it from Gmail?</p>
                      <a className="cx-opt is-yes" href={gmailHref(x.id)} target="_blank" rel="noopener noreferrer">
                        Open in Gmail
                      </a>
                      <button
                        type="button"
                        className="cx-opt"
                        onClick={() => t.say("change")}
                      >
                        Change
                      </button>
                      <More x={x} t={t} />
                      {canConnect && (
                        <button type="button" className="cx-reconnect" onClick={() => void connect()}>
                          Reconnect Gmail to send from here
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {focus && req && (req.state === "expired" || req.state === "failed" || req.state === "refused") && req.kind === "send" && !outbox.some((m) => m.rid === req.rid) && <p className="cx-warn">The last send didn't go: {req.state === "expired" ? "the Mac was offline." : req.state === "failed" ? "it may have sent, check Messages." : "the Mac refused it."}</p>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The Groups shelf (#869, Nikita: "take group chats off the date-ordered line"): every group chat in one compact row on
 * the stage, each with how many texts came since Nikita last spoke there and a dot when Messages shows it unread. A tap
 * opens that group in the Codex's flipper, where he can read the summary and reply.
 */
function GroupShelf({ groups, hidden, open }: { groups: readonly TextItem[]; hidden: boolean; open: (id: string) => void }) {
  if (!groups.length) return null;
  return (
    <nav className="cx-shelf" aria-label="Groups">
      <span className="cx-lab">Groups</span>
      <ol>
        {groups.map((g) => {
          const n = g.messages?.length ?? 0;
          return (
            <li key={g.id}>
              <button type="button" onClick={() => open(g.id)} title={hidden ? "A group" : `${g.name}${n ? ` · ${n} new since you last wrote` : ""}${g.summary?.text ? `\n${g.summary.text}` : ""}`} aria-label={`${hidden ? "A group" : g.name}${n ? `, ${n} new` : ""}${g.unread ? ", unread" : ""}`}>
                {g.unread && <span className="cx-dot" aria-hidden="true" />}
                <Private as="b">{g.name || "Group"}</Private>
                {/* #923 (Nikita: bare numbers "don't explain themselves"): the count says what it counts. */}
                {n > 0 && <em aria-hidden="true">{n} new</em>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const ORDER_LABEL: Record<Order, string> = { oldest: "Longest waiting", newest: "Newest", priority: "Priority" };
const ORDER_MENU: readonly Order[] = ["oldest", "newest", "priority"];

/**
 * The order (#803; #904, Nikita: "fewer controls"): longest waiting first by default, Newest and Priority (Dialtone's
 * "reply sooner" first) in one small menu beside the count, remembered on this device.
 */
function OrderMenu({ order, set }: { order: Order; set: (o: Order) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: Event) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  return (
    <details className="cx-order" ref={ref}>
      <summary aria-label={`Order: ${ORDER_LABEL[order]}`}>
        {ORDER_LABEL[order]} <span aria-hidden="true">▾</span>
      </summary>
      <div className="cx-ordermenu" role="radiogroup" aria-label="Order of the queue">
        {ORDER_MENU.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={order === o}
            onClick={() => {
              set(o);
              ref.current?.removeAttribute("open");
            }}
          >
            {o === "oldest" ? "Oldest" : ORDER_LABEL[o]}
            {o === "oldest" && <em> longest waiting first</em>}
          </button>
        ))}
      </div>
    </details>
  );
}

export function RelayThread({ now }: { now: number }) {
  const stageRef = useRef<HTMLElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const earRef = useRef<HTMLSpanElement>(null);
  const sg = useRef<SigilStage | null>(null);
  const [engine, setEngine] = useState<SigilStage | null>(null);
  /** The spine's lit stretch (and its alpha, easing to `to`), the rush of its falling sigils, how loud the ear is. */
  const fx = useRef({ lit: null as Element | null, entry: null as Element | null, a: 0, to: 0, rush: 0, loud: 0, listening: false });
  const spineX = () => (sg.current && earRef.current ? sg.current.rel(earRef.current).cx : 0);
  /** The queue on the line (#803, #869): its box, and whether it lies flat (a phone). */
  const waveRef = useRef<HTMLElement>(null);
  const narrow = useMedia("(max-width: 760px)");
  const still = useMedia("(prefers-reduced-motion: reduce)");
  const entryOf = (key: string | null | undefined) => (key ? (pagesRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null) : null);

  // A filtered or blocked sender's words sink down the spine before the entry leaves.
  const leave = useCallback(async (key: string) => {
    const s = sg.current;
    const el = entryOf(key);
    if (!s || !el || s.reduced) return;
    const X = spineX();
    const H = s.h;
    fx.current.rush = 0.6;
    fx.current.to = 0;
    await Promise.all([...el.querySelectorAll<HTMLElement>(PARTS)].map((p) => s.dissolve(p, { color: NANITE.sink, rtl: true, dur: 1300, stagger: 600, to: () => [X + (rnd() - 0.5) * 6, H + 20], path: sink })));
  }, []);

  const t = useThread(now, { leave });
  const { ex, phase, hidden } = t;
  const tRef = useRef(t);
  tRef.current = t;
  // One listener (#638, #642): the Desk's room mic and hands-free hear Nikita; the Thread only lights its ear.
  const micPhase = useRoomMic((s) => (s.room === "relay" ? s.phase : "idle"));
  const [hints, setHints] = useState(false);
  const [back] = useState(() => takeGmailReturn());
  const run = useRef(0);
  fx.current.listening = micPhase === "listening";
  fx.current.loud = micPhase === "listening" ? 1 : 0;

  // Kept mounted out of sight (#934, apps/desk/src/keptRooms.ts), the Thread's keys and ear stay quiet.
  const onScreen = useRoomShown();

  // Relay refreshes by itself (#950, Nikita 02:26Z): every 15 seconds while it shows, at once on showing it again and on
  // the window's focus; slower while kept out of sight. The card in focus and the box being typed in stay as they are.
  useEffect(() => textsShown(onScreen), [onScreen]);

  // One listener (#638): the room voice hands what's said on /relay to this Thread (rooms/relay/voice.ts), while it is
  // on screen.
  useEffect(() => {
    if (!onScreen) return;
    return setRelayHandler(async (text) => {
      const r = tRef.current.line(text);
      if (!r.cmd) return null;
      if (r.cmd === "words" && !r.ok) return null;
      const say = (await r.said) || (r.ok ? "" : "That doesn't apply right now.");
      return say ? { say } : null;
    });
  }, [onScreen]);

  // The engine, and the spine's field: the lit stretch beside the entry in focus, a slow fall of sigils, the ear's wick.
  // A layout effect, so entries are blanked before their first paint.
  useLayoutEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const s = new SigilStage(host);
    sg.current = s;
    setEngine(s);
    (window as unknown as { __relaySigils?: SigilStage }).__relaySigils = s;
    const amb = Array.from({ length: 26 }, () => ({ y: rnd(), v: 0.02 + rnd() * 0.04, g: Math.floor(rnd() * 40), o: (rnd() - 0.5) * 6, s: 6 + rnd() * 3 }));
    let loud = 0;
    /**
     * The older lines' nanites (#950): fine white sigils lifting off the far, feathered edge of each out-of-focus
     * line above the newest, drifting outward and up, and gone. Crisp on this canvas (no CSS dot screens). The lines'
     * boxes are read a few times a second, not every frame; none while they are clear (hovered, focused or tapped).
     */
    const ctxMotes: { x: number; y: number; vx: number; vy: number; age: number; life: number; s: number; g: number; a: number }[] = [];
    let ctxBoxes: { x: number; y: number; w: number; h: number; me: boolean; d: number }[] = [];
    let ctxRead = 0;
    let ctxSpawn = 0;
    const readCtx = () => {
      const entry = fx.current.entry;
      const ctx = entry?.querySelector<HTMLElement>(".cx-ctx");
      if (!ctx || ctx.dataset.clear || ctx.matches(":hover, :focus-visible") || ghosted(ctx.closest(".cx-entry")?.querySelector(".cx-msg") ?? ctx)) return [];
      return [...ctx.querySelectorAll<HTMLElement>(":scope > .cx-bub")].map((b) => {
        const r = s.rel(b);
        return { x: r.x, y: r.y, w: r.w, h: r.h, me: b.hasAttribute("data-me"), d: Number(b.style.getPropertyValue("--d")) || 1 };
      });
    };
    const off = s.field((c, time, dt) => {
      ctxRead -= dt;
      if (ctxRead <= 0) {
        ctxRead = 0.25;
        ctxBoxes = readCtx().filter((b) => b.w > 0 && b.y + b.h > 0 && b.y < s.h);
      }
      // About four a second per line, the further back the fewer, 48 at most on screen.
      ctxSpawn += dt * ctxBoxes.length * 4;
      while (ctxSpawn >= 1 && ctxBoxes.length) {
        ctxSpawn -= 1;
        if (ctxMotes.length >= 48) continue;
        const b = ctxBoxes[Math.floor(rnd() * ctxBoxes.length)]!;
        const edge = b.me ? b.x + rnd() * b.w * 0.28 : b.x + b.w - rnd() * b.w * 0.28;
        const out = b.me ? -1 : 1;
        ctxMotes.push({ x: edge, y: b.y + 3 + rnd() * Math.max(1, b.h - 6), vx: out * (5 + rnd() * 12), vy: -(3 + rnd() * 9), age: 0, life: 1.8 + rnd() * 2.2, s: 5 + rnd() * 2.5, g: Math.floor(rnd() * 40), a: 0.3 + 0.3 / b.d });
      }
      for (let i = ctxMotes.length - 1; i >= 0; i--) {
        const m = ctxMotes[i]!;
        m.age += dt;
        if (m.age >= m.life) {
          ctxMotes.splice(i, 1);
          continue;
        }
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const k = m.age / m.life;
        s.glyph(c, NANITE.white, m.g, m.x, m.y, m.s * (1 - k * 0.3), m.a * Math.min(1, k * 5) * (1 - k));
      }
      const ear = earRef.current;
      if (!ear) return;
      const E = s.rel(ear);
      const X = E.cx;
      const f = fx.current;
      loud += (f.loud - loud) * Math.min(1, dt * 6);
      f.rush *= Math.pow(0.3, dt);
      f.a += (f.to - f.a) * Math.min(1, dt * 4);
      const g = c.createLinearGradient(0, 0, 0, E.y);
      g.addColorStop(0, "rgba(134,182,255,.05)");
      g.addColorStop(0.12, "rgba(134,182,255,.3)");
      g.addColorStop(0.88, "rgba(134,182,255,.3)");
      g.addColorStop(1, "rgba(134,182,255,.5)");
      c.globalAlpha = 1;
      c.fillStyle = g;
      c.fillRect(X - 0.5, 0, 1, Math.max(0, E.y - 6));
      if (f.lit && f.a > 0.01) {
        const r = s.rel(f.lit);
        const y0 = r.y;
        const y1 = r.y + r.h;
        const lg = c.createLinearGradient(0, y0 - 40, 0, y1 + 40);
        lg.addColorStop(0, "rgba(150,195,255,0)");
        lg.addColorStop(0.2, `rgba(170,205,255,${f.a})`);
        lg.addColorStop(0.8, `rgba(170,205,255,${f.a})`);
        lg.addColorStop(1, "rgba(150,195,255,0)");
        c.fillStyle = lg;
        c.fillRect(X - 1, y0 - 40, 2, y1 - y0 + 80);
        c.globalAlpha = 0.18 * f.a;
        c.fillRect(X - 5, y0 - 40, 10, y1 - y0 + 80);
        c.globalAlpha = 1;
      }
      for (const a of amb) {
        a.y += a.v * dt * (1 + f.rush * 6);
        if (a.y > 1) {
          a.y = 0;
          a.g = Math.floor(rnd() * 40);
        }
        if (rnd() < dt * 1.2) a.g = Math.floor(rnd() * 40);
        s.glyph(c, NANITE.hi, a.g, X + a.o, a.y * (E.y - 10), a.s, 0.4 * Math.sin(a.y * Math.PI));
      }
      // The ear: a short wick of sigils at the foot of the spine, brighter while it hears you.
      const live = f.listening ? 1 : 0.55;
      for (let k = 0; k < 4; k++) {
        const gi = Math.floor(time * (2 + loud * 10) + k * 7) % 40;
        const al = (0.25 + 0.75 * Math.max(0, Math.sin(time * (2 + loud * 6) - k * 0.9)) * (0.4 + loud * 0.6)) * live;
        s.glyph(c, k ? NANITE.hi : NANITE.white, gi, X, E.y + E.h - 6 - k * 12, 10 + loud * 2, al, k === 0);
      }
    });
    return () => {
      off();
      s.destroy();
      sg.current = null;
    };
  }, []);

  // Words are never held back (#1162): a message reads the instant it is there. Only a draft, which is written in, waits blank.
  useLayoutEffect(() => {
    const s = sg.current;
    const root = pagesRef.current;
    if (!root || !s) return;
    for (const el of root.querySelectorAll<HTMLElement>(".cx-entry[data-key]")) {
      if (el.dataset.seen) continue;
      el.dataset.seen = "1";
      if (!s.reduced && !hidden) for (const p of el.querySelectorAll<HTMLElement>(".cx-draft")) ghost(p, true);
    }
  });

  // Hide shows every entry plainly (veiled by <Private>): nothing forms from masked words.
  useEffect(() => {
    if (!hidden) return;
    for (const p of pagesRef.current?.querySelectorAll<HTMLElement>(PARTS) ?? []) ghost(p, false);
  }, [hidden]);

  /** The accent (#1162): sigils run from the spine round the card's border, clockwise, fading as they go. */
  const trace = useCallback((s: SigilStage, el: HTMLElement, X: number) => {
    const card = el.querySelector(".cx-them") ?? el;
    const b = s.rel(card);
    const pts = outline(X, b.y, Math.max(0, b.x + b.w - X), b.h);
    const len = lengthOf(pts);
    const stops = traceStops(len, traceCount(len));
    for (const d of stops) {
      const dur = 200 + (d / len) * 110;
      s.burst(X, pts[0]!.y, { n: 1, dur, stagger: TRACE_MS - dur * 1.4, size: 7, color: NANITE.hi, to: () => [pointAlong(pts, d).x, pointAlong(pts, d).y],
        path: (_p, e) => {
          const q = pointAlong(pts, d * e);
          return [q.x, q.y];
        },
      });
    }
  }, []);

  /** Your draft climbs from the ear and the quill writes it in. */
  const writeDraft = useCallback(async (el: HTMLElement, id: number) => {
    const s = sg.current;
    const d = el.querySelector<HTMLElement>(".cx-draft");
    if (!s || !d || run.current !== id || !earRef.current) return;
    ghost(d, !s.reduced);
    const X = spineX();
    const E = s.rel(earRef.current);
    fx.current.rush = 0.3;
    await s.form(d, { from: () => [X + (rnd() - 0.5) * 6, E.y + rnd() * E.h], path: quill(X), dur: 250, stagger: 250, jitter: 60, pre: 0.1, color: NANITE.hi });
  }, []);

  // Focus moves: the old entry's words dissolve into the spine, the new one's are written in from the top of it.
  const shown = useRef<string | null>(null);
  const draftShown = useRef<string | null>(null);
  useEffect(() => {
    const s = sg.current;
    const key = ex?.key ?? null;
    const prev = shown.current;
    if (!s || key === prev) return;
    shown.current = key;
    draftShown.current = ex?.draft ?? null;
    const id = ++run.current;
    const old = entryOf(prev);
    const el = entryOf(key);
    fx.current.lit = el?.querySelector(".cx-them") ?? null;
    fx.current.entry = el;
    fx.current.to = el ? 1 : 0;
    if (hidden) return;
    const X = spineX();
    if (old && !s.reduced) for (const p of old.querySelectorAll<HTMLElement>(PARTS)) void s.dissolve(p, { color: NANITE.hi, dur: 250, stagger: 100, to: (_i, _x, y) => [X + (rnd() - 0.5) * 8, y + (rnd() - 0.5) * 60] });
    if (!el) return;
    void (async () => {
      fx.current.rush = 1;
      // #1162 (Nikita: "the text itself should be the first thing I can see"): the words are on screen already and
      // nothing waits on a particle. Sigils leave the spine and trace the card's border as an accent, about half a
      // second; reduced motion has none.
      if (!s.reduced) trace(s, el, X);
      if (el.querySelector(".cx-draft")) await writeDraft(el, id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex?.key, engine]);

  // A new draft on the entry in focus (Draft it, or your words): it climbs from the ear.
  useLayoutEffect(() => {
    const d = ex?.draft ?? null;
    if (!ex || shown.current !== ex.key || d === draftShown.current || phase === "drafting") return;
    draftShown.current = d;
    if (!d || hidden) return;
    const el = entryOf(ex.key);
    const id = ++run.current;
    if (el) void writeDraft(el, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex?.draft, ex?.key, phase]);

  /**
   * The send (#869, Nikita: "a fun send animation"): the text lifts off as white sigils that stream to the line and up
   * it, and the person's circle on the line flashes a ring and a small burst as they pass. Quick (about a second), and
   * with reduced motion there is none: the undo line says it is sending.
   */
  const launched = useRef<string | null>(null);
  const launch = useCallback(
    (el: HTMLElement | null) => {
      const s = sg.current;
      launched.current = tRef.current.pending ?? tRef.current.ex?.key ?? null;
      if (!s || !el || hidden || s.reduced) return;
      const r = s.rel(el);
      const X = spineX();
      fx.current.rush = 1;
      s.burst(r.cx, r.cy, { n: 150, w: r.w, h: r.h, dur: 1100, stagger: 420, size: 8, color: NANITE.you, to: () => [X + (rnd() - 0.5) * 6, -30], path: rise });
      const li = waveRef.current?.querySelector<HTMLElement>(".rq-item[data-cur]");
      const face = li?.querySelector(".rq-face");
      if (!li || !face) return;
      window.setTimeout(() => {
        li.dataset.sent = "";
        const c = s.rel(face);
        s.burst(c.cx, c.cy, { n: 44, ang: 0, spread: Math.PI * 2, dist: 44, dur: 650, stagger: 80, size: 6, color: NANITE.white });
      }, 260);
      window.setTimeout(() => delete li.dataset.sent, 1_200);
    },
    [hidden],
  );

  // A send of the draft on screen (a yes, by tap, key or voice) takes off the same way.
  useEffect(() => {
    if (!ex || t.pending !== ex.key || launched.current === ex.key) return;
    launch(entryOf(ex.key)?.querySelector<HTMLElement>(".cx-draft") ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.pending]);
  useEffect(() => {
    if (!t.pending) launched.current = null;
  }, [t.pending]);

  // A rule that didn't take: the words come back.
  useEffect(() => {
    const s = sg.current;
    if (t.notice?.kind !== "warn" || !ex || !s) return;
    const el = entryOf(ex.key);
    for (const p of el?.querySelectorAll<HTMLElement>(PARTS) ?? []) if (ghosted(p) && !hidden) void s.form(p, { dur: 250, stagger: 150, color: NANITE.hi });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.notice]);

  // Scrolling picks the entry in focus: the one filling most of the page.
  const pick = t.pick;
  const keys = (t.queue ?? []).map((x) => x.key).join("|");
  /**
   * Where a scroll of our own is taking the codex (a tap on the line, J/K, a new order), and until when (#895). While
   * one is under way the entries it passes (the one it left fills most of the page for its first frames) don't take
   * the focus: only arriving does, or Nikita's own wheel, touch or key. Without it a new order chosen mid-scroll kept
   * the entry the scroll left, not the one he picked.
   */
  const steer = useRef<{ key: string; until: number } | null>(null);
  const steerTo = useCallback((key: string | null) => {
    steer.current = key ? { key, until: performance.now() + STEER_MS } : null;
  }, []);
  useEffect(() => {
    const root = pagesRef.current;
    if (!root) return;
    const mine = () => steerTo(null);
    const evs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const ev of evs) root.addEventListener(ev, mine, { passive: true });
    return () => {
      for (const ev of evs) root.removeEventListener(ev, mine);
    };
  }, [steerTo]);
  useEffect(() => {
    const root = pagesRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    // How much of the page each entry fills (an entry taller than the page counts by what shows).
    const fill = new Map<string, number>();
    const io = new IntersectionObserver(
      (list) => {
        for (const e of list) {
          const key = (e.target as HTMLElement).dataset.key;
          if (key) fill.set(key, e.isIntersecting ? e.intersectionRect.height / (e.rootBounds?.height || 1) : 0);
        }
        let best: string | null = null;
        let most = 0.5;
        for (const [k, f] of fill) if (f > most) [best, most] = [k, f];
        const going = steer.current;
        if (going && performance.now() < going.until) {
          // Our own scroll is still on its way: only its target takes the focus, and arriving ends it.
          if (best !== going.key) return;
          steer.current = null;
        }
        if (best) pick(best);
      },
      { root, threshold: [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1] },
    );
    for (const el of root.querySelectorAll(".cx-entry[data-key]")) io.observe(el);
    return () => io.disconnect();
  }, [keys, pick]);

  // A new order (#803) keeps the same exchange in focus: the codex jumps to where it now sits, before paint.
  useLayoutEffect(() => {
    const key = tRef.current.ex?.key;
    const el = entryOf(key);
    if (!el || !pagesRef.current) return;
    steerTo(key ?? null);
    pagesRef.current.scrollTo({ top: el.offsetTop, behavior: "instant" });
  }, [t.order, steerTo]);

  // Entries arriving or leaving (a line that loads after the other, a refresh, #950) keep the entry in focus on the
  // page. Scroll snapping otherwise holds on to whichever entry it last sat on: a mail that loaded first stayed on
  // screen once the texts above it came in, and took the focus from them. Only when the focus is off screen, and
  // never during a scroll of our own.
  useLayoutEffect(() => {
    const root = pagesRef.current;
    const key = tRef.current.ex?.key;
    const el = entryOf(key);
    if (!root || !el) return;
    const going = steer.current;
    if (going && performance.now() < going.until) return;
    if (Math.abs(root.scrollTop - el.offsetTop) < Math.max(el.offsetHeight, root.clientHeight) * 0.5) return;
    steerTo(key ?? null);
    root.scrollTo({ top: el.offsetTop, behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, steerTo]);

  // One gesture, one entry, sprung into place (#1161); the line's wheel goes to the same gate.
  const snapTo = useSnapScroll(pagesRef, waveRef, (t.queue?.length ?? 0) > 1);

  /** Puts an exchange in focus and scrolls the codex to it. */
  const goTo = useCallback(
    (key: string) => {
      pick(key);
      steerTo(key);
      const top = stageRef.current?.getBoundingClientRect().top ?? 0;
      if (Math.abs(top) > 4) stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const el = entryOf(key);
      const root = pagesRef.current;
      if (el && root) snapTo(el.offsetTop);
    },
    [pick, steerTo, snapTo],
  );
  /** A tap on the line (#869): puts it in focus and, for a text, opens straight on the composer. */
  const goWrite = useCallback(
    (key: string) => {
      goTo(key);
      if (!key.startsWith("t:")) return;
      // Once it is in focus (the next render), its composer opens.
      window.setTimeout(() => openComposer(key), 60);
    },
    [goTo],
  );

  // Keys (#904, Nikita: WASD): W and S the person before and after, A later, D done; R or Enter into the reply box,
  // Enter there sends and Esc leaves it. Y sends a draft on screen, Z undoes; J and K move too; ? the list. Holding
  // Space talks into the box (./holdSpace.ts). Never while typing in a field, and only while Relay is on screen (#934).
  useEffect(() => {
    if (!onScreen) return;
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (isTyping(el) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        setHints((h) => !h);
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        setHints(false);
        return;
      }
      const k = e.key.toLowerCase();
      if ((k === "w" || k === "s" || k === "j" || k === "k") && t.queue?.length) {
        const i = t.queue.findIndex((x) => x.key === ex?.key);
        const next = t.queue[Math.max(0, Math.min(t.queue.length - 1, i + (k === "s" || k === "j" ? 1 : -1)))];
        if (next) goTo(next.key);
        e.preventDefault();
        return;
      }
      if (k === "a") {
        if (!e.repeat && t.say("later")) e.preventDefault();
        return;
      }
      // R, or Enter anywhere but a button or link, puts the cursor in a text's reply box.
      const onControl = !!el?.closest?.("button, a, summary, [role=button]");
      if ((k === "r" || (e.key === "Enter" && !onControl)) && ex?.line === "text" && ex.sendable && phase === "incoming") {
        openComposer(ex.key);
        e.preventDefault();
        return;
      }
      if (!e.repeat && t.key(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onScreen, t, ex?.key, ex?.line, ex?.sendable, phase, goTo]);

  const waiting = t.metrics.waiting;
  const textsItems = useTexts((s) => s.view?.items);
  const shelf = useMemo(() => (t.signedIn ? groupsOf(textsItems, now, t.order) : []), [t.signedIn, textsItems, now, t.order]);
  const [openGroup, setOpenGroup] = useState<{ id: string; at: number } | null>(null);
  const showGroup = useCallback((id: string) => {
    setOpenGroup({ id, at: Date.now() });
    const sec = document.getElementById("cx-groups");
    sec?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="cx" data-phase={phase} data-still={engine?.reduced || undefined}>
      {/* The field (#950): wire and white nanites behind the whole page, very faint. */}
      <RelayField />
      <section className="cx-stage" ref={stageRef} aria-label="Relay at a glance">
        <header className="cx-top">
          <div className="cx-title">
            <h1 className="cx-mark">
              <b>Relay</b>
            </h1>
            <p className="cx-count">
              <b>{waiting === null ? "—" : waiting.toLocaleString()}</b> waiting
            </p>
            {/* The order (#904): longest waiting first; the others in a small menu. */}
            {t.queue && t.queue.length > 1 && <OrderMenu order={t.order} set={t.setOrder} />}
          </div>
          <a className="cx-codexlink" href="#cx-codex">
            Codex ↓
          </a>
        </header>

        {/* Group chats (#869): off the line, on their own shelf. */}
        <GroupShelf groups={shelf} hidden={hidden} open={showGroup} />

        {/* Who is waiting (#803, #869): every circle on the line, magnified where you point; a tap opens it. */}
        {t.queue && t.queue.length > 1 && <RelayQueue queue={t.queue} cur={ex?.key ?? null} now={now} hidden={hidden} goTo={goWrite} navRef={waveRef} pagesRef={pagesRef} narrow={narrow} still={still || !!engine?.reduced} />}

        <div className="cx-pages" ref={pagesRef} tabIndex={-1}>
          {t.queue && t.queue.length > 0 ? t.queue.map((x) => <Entry key={x.key} x={x} focus={x.key === ex?.key} now={now} t={t} launch={launch} />) : <Waiting signedIn={t.signedIn} waiting={waiting} />}
        </div>

        {/* The dock (#950, Nikita: no type box, no hint row): hold Space answers whatever text or email is open, into its
            reply box or to the Thread; the notice line, and the ear at the spine's foot. "?" still lists the keys. */}
        <div className="cx-dock">
          <div className="cx-dl">
            {/* The mic is the Desk's room mic (#638): one listener for every room. What's said here reaches the Thread. */}
            {/* #950 (Nikita: remove the "hold Space to talk, or type" row): words only while the room mic is live. The
                line keeps its place either way, so the cards above never shift as the mic comes and goes. */}
            <span className="cx-lab" data-live={micPhase !== "idle" || undefined} aria-hidden={micPhase === "idle" || undefined}>
              {micPhase === "listening" ? "Listening" : micPhase === "thinking" ? "Reading that…" : "\u00a0"}
            </span>
          </div>
          <div className="cx-dr">
            <UndoLine n={t.notice} now={now} sg={engine} />
            {hints && (
              <p className="cx-keys" id="cx-keys">
                <b>W S</b> move · <b>A</b> later · <b>D</b> done · <b>Enter</b> reply, send · <b>Esc</b> leave the box · <b>Tab</b> take the draft · hold <b>Space</b> to talk · <b>Z</b> undo · <b>?</b> these keys
              </p>
            )}
          </div>
          <span className="cx-ear" ref={earRef} data-on={micPhase === "listening" || undefined} aria-hidden="true" />
        </div>
      </section>

      <Codex now={now} t={t} back={back} goTo={goTo} openGroup={openGroup} />
    </div>
  );
}

const RETURN_TEXT: Record<string, string> = {
  connected: "Gmail is connected. Dialtone catches up on unread mail from the last two days, then watches new mail.",
  cancelled: "Connect Gmail was cancelled at Google. Nothing was connected.",
  refused: "That Connect Gmail link didn't match this session. Try again from here.",
  failed: "Google didn't hand over access. Try Connect Gmail again.",
};

/** How a rule reads in Settings. */
function ruleText(r: { kind: string; label: string; to?: string }): { lead: string; label: string; tail: string; undo: string } {
  if (r.kind === "block") return { lead: "Blocked ", label: r.label, tail: "", undo: "Unblock" };
  if (r.kind === "tier") return { lead: "", label: r.label, tail: r.to === "can-wait" ? " can wait" : " filtered out", undo: "Undo" };
  return { lead: "Filtered ", label: r.label, tail: "", undo: "Undo" };
}

/** One list of the Codex: who · gist · age, in the Thread's order (#803); a tap opens it there. */
function Rows({ rows, cur, goTo, empty }: { rows: ReturnType<typeof codexOf>["email"]; cur: string | null; goTo: (key: string) => void; empty: string }) {
  if (!rows.length) return <p className="cx-quiet">{empty}</p>;
  return (
    <ol className="cx-rows">
      {rows.map(({ ex: x, waited }) => (
        <li key={x.key} data-cur={x.key === cur || undefined}>
          <button type="button" onClick={() => goTo(x.key)}>
            <Private as="b">{x.who}</Private>
            <Private className="cx-what">{x.messages?.at(-1)?.text || x.body || x.subject}</Private>
            <em>
              {x.unread && (
                <span className="cx-unread" title="Unread in Messages">
                  unread ·{" "}
                </span>
              )}
              {agoShort(waited)}
            </em>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The Codex (#642): one line of numbers, Email and Texts, then everything else behind Settings. */
function Codex({ now, t, back, goTo, openGroup }: { now: number; t: ReturnType<typeof useThread>; back: string | null; goTo: (key: string) => void; openGroup: { id: string; at: number } | null }) {
  const ex = t.ex;
  const view = useEmail((s) => s.view);
  const status = useEmail((s) => s.status);
  const busy = useEmail((s) => s.busy);
  const error = useEmail((s) => s.error);
  const textsView = useTexts((s) => s.view);
  const textsStatus = useTexts((s) => s.status);
  const lock = useTexts((s) => s.lock);
  const unlock = useTexts((s) => s.unlock);
  const [learning, setLearning] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const rules = view?.rules ?? [];
  const older = textsView?.older ?? { count: 0, items: [] };
  const voice = textsView?.voice ?? null;
  const groups = useMemo(() => groupsOf(textsView?.items, now, t.order), [textsView?.items, now, t.order]);
  // A chore's latest request (#758): "busy" while the Mac has it, else how it ended.
  const chore = (kind: "rescan" | "learn") => {
    const r = (textsView?.requests ?? []).filter((x) => x.kind === kind).sort((a, b) => b.created - a.created)[0];
    return r && (r.state === "waiting" || r.state === "taken") ? "busy" : (r?.state ?? null);
  };
  const rescan = chore("rescan");
  const learnTexts = chore("learn");
  const style = view?.style ?? null;
  const gmailOn = !!status && status.gmail === "connected" && status.agent !== "waiting";
  const textsOn = !!textsStatus && textsStatus.hub !== "off" && textsStatus.hub !== "wiped";
  const c = codexOf(t.queue, now, { email: gmailOn ? status.needsYou : null, texts: textsOn ? textsStatus.owed : null }, t.order);
  const num = (v: number | null) => (v === null ? "—" : v.toLocaleString());
  const sent = weekSent(textsOn ? textsStatus : null, view?.sentWeek ?? 0);

  return (
    <section className="cx-all" id="cx-codex" aria-label="The codex">
      <div className="cx-verse">
        <div className="cx-mar">
          <h2>The codex</h2>
        </div>
        <div className="cx-body">
          <p className="cx-line" aria-label="This week">
            <span>
              <b>{num(c.waiting)}</b> waiting
            </span>
            <span>
              oldest <b>{c.oldest === null ? "—" : agoShort(c.oldest)}</b>
            </span>
            <span>
              <b>{num(t.metrics.unread)}</b> unread
            </span>
            <span>
              <b>{num(sent)}</b> sent this week
            </span>
            <span>
              <b>{num(t.metrics.filtered)}</b> filtered
            </span>
          </p>
          {back && <p className="cx-note">{RETURN_TEXT[back]}</p>}
          {error && <p className="cx-warn">{error}</p>}
          {/* The Mac reads no contacts (#861): every sender is "Unknown" until macOS lets BlueBubbles read them. */}
          {t.signedIn && contactsHint(textsStatus) && (
            <p className="cx-warn" data-hint="contacts">
              <b>Allow BlueBubbles to read Contacts.</b> {contactsHint(textsStatus)}
            </p>
          )}
          {!t.signedIn && <p className="cx-note">Counts only until you sign in.</p>}
        </div>
      </div>

      {t.queue && (
        <>
          <div className="cx-verse cx-sec" data-list="email">
            <div className="cx-mar">
              <span className="cx-lab">Email</span>
            </div>
            <div className="cx-body">
              <Rows rows={c.email} cur={ex?.key ?? null} goTo={goTo} empty={gmailOn ? "No mail needs you." : "Gmail isn't connected."} />
            </div>
          </div>
          <div className="cx-verse cx-sec" data-list="texts">
            <div className="cx-mar">
              <span className="cx-lab">Texts</span>
              {textsView?.paired && (
                <button type="button" className="cx-lnk" disabled={rescan === "busy"} onClick={() => void useTexts.getState().ask({ action: "rescan" })} title="Read every chat on the Mac again: who you owe from the last 30 days">
                  {rescan === "busy" ? "Rescanning…" : "Rescan"}
                </button>
              )}
            </div>
            <div className="cx-body">
              <Rows rows={c.texts} cur={ex?.key ?? null} goTo={goTo} empty={textsView?.paired ? "Nobody's waiting on a text." : "The MacBook isn't paired."} />
              {older.count > 0 && (
                <p className="cx-ex">
                  {older.count} older unanswered{" "}
                  {older.items.length > 0 && (
                    <button type="button" className="cx-lnk" aria-expanded={showOlder} onClick={() => setShowOlder(!showOlder)}>
                      {showOlder ? "hide them" : "show them"}
                    </button>
                  )}
                </p>
              )}
              {showOlder && older.items.length > 0 && (
                <ol className="cx-rows cx-older">
                  {olderInOrder(older.items, t.order).map((o) => (
                    <li key={o.id}>
                      <span className="cx-still">
                        <Private as="b">{o.name}</Private>
                        <span className="cx-what">no reply yet · {o.channel === "SMS" ? "sms" : "text"}</span>
                        <em>
                          {o.unread && <span className="cx-unread">unread · </span>}
                          {agoShort(now - o.since)}
                        </em>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <SetAside now={now} />
              {rescan === "failed" && <p className="cx-warn">The Mac couldn&apos;t read the chats. Is BlueBubbles running?</p>}
              {rescan === "expired" && <p className="cx-warn">Not rescanned: the Mac was offline.</p>}
            </div>
          </div>
          {groups.length > 0 && (
            <div className="cx-verse cx-sec" data-list="groups" id="cx-groups">
              <div className="cx-mar">
                <span className="cx-lab">Groups</span>
              </div>
              <div className="cx-body">
                {/* The flipper (#805): one group at a time, its texts, and a reply sent exactly as typed. */}
                <GroupFlipper groups={groups} hidden={t.hidden} unlocked={t.unlocked} open={openGroup} />
              </div>
            </div>
          )}
        </>
      )}

      <details className="cx-settings">
        <summary>
          <span className="cx-verse">
            <span className="cx-mar">
              <span className="cx-lab">Settings</span>
            </span>
            <span className="cx-body cx-sub">Rules, how you write, the lines</span>
          </span>
        </summary>
        <div className="cx-verse cx-sec">
          <div className="cx-mar" />
          <div className="cx-body cx-wide">
            <div className="cx-cols">
              <div>
                <h3>Filter rules</h3>
                {rules.length === 0 && <p className="cx-quiet">None yet. Say “invites can wait” or “filter these out” on a mail.</p>}
                {rules.map((r) => {
                  const rt = ruleText(r);
                  return (
                    <div className="cx-row" key={r.id}>
                      <span>
                        {rt.lead}
                        <Private>{rt.label}</Private>
                        {rt.tail}
                      </span>
                      <span>
                        <button type="button" className="cx-lnk" onClick={() => void useEmail.getState().unrule(r.id)}>
                          {rt.undo}
                        </button>
                      </span>
                    </div>
                  );
                })}
                {view && view.ruled > 0 && (
                  <div className="cx-row">
                    By your rules today<span>{view.ruled} cleared</span>
                  </div>
                )}
                <div className="cx-row">
                  Money, bills, payments, legal<span>never shown · {status ? `${status.skipped} today` : "kept out"}</span>
                </div>
                <div className="cx-row">
                  Promotions and noise<span>{status ? `${status.noise} cleared today` : "cleared without you"}</span>
                </div>
                {view && view.urgentSkipped > 0 && <p className="cx-warn">{view.urgentSkipped} urgent money or legal {view.urgentSkipped === 1 ? "alert" : "alerts"} skipped; check those accounts directly.</p>}
              </div>

              <div>
                <h3>How you write</h3>
                {style ? (
                  <ul className="cx-tones">
                    {style.traits.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="cx-quiet">{view ? "Not learned yet from your email." : "Waiting for Gmail."}</p>
                )}
                <p className="cx-ex">
                  {style ? `Learned from ${style.from} sent emails. ` : ""}Texts learn from your past replies to each person, on the Mac.{" "}
                  {view && status?.gmail === "connected" && (
                    <button
                      type="button"
                      className="cx-lnk"
                      disabled={learning === "busy"}
                      onClick={() => {
                        setLearning("busy");
                        void useEmail
                          .getState()
                          .learnStyle()
                          .then((g) => setLearning(g.ok ? null : errorText(g.error)));
                      }}
                    >
                      {learning === "busy" ? "Reading your sent mail…" : style ? "Learn again" : "Learn from my sent mail"}
                    </button>
                  )}
                </p>
                {learning && learning !== "busy" && <p className="cx-warn">{learning}</p>}
                <h3>How you text</h3>
                {voice ? (
                  <>
                    <ul className="cx-tones">
                      {voice.traits.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                    {(["family", "friends", "work"] as const).map((k) =>
                      voice.tones[k].length ? (
                        <p className="cx-ex" key={k}>
                          With {k}: {voice.tones[k].join("; ")}
                        </p>
                      ) : null,
                    )}
                    <p className="cx-ex">
                      Learned from {voice.from} of your texts to {voice.contacts} people; numbers from {voice.stats.texts.toLocaleString()} sent, on the Mac. Cost {"$"}
                      {voice.usd.toFixed(3)}.
                    </p>
                  </>
                ) : (
                  <p className="cx-quiet">{textsView?.paired ? "Not learned yet from your texts." : "Waiting on the MacBook."}</p>
                )}
                {textsView?.paired && (
                  <p className="cx-ex">
                    <button type="button" className="cx-lnk" disabled={learnTexts === "busy"} onClick={() => void useTexts.getState().ask({ action: "learn" })} title="The Mac reads your own sent texts from the last year; one Sonnet call learns your style, never a quote">
                      {learnTexts === "busy" ? "Reading your texts on the Mac…" : voice ? "Learn again" : "Learn from my texts"}
                    </button>
                  </p>
                )}
                {learnTexts === "failed" && <p className="cx-warn">Couldn&apos;t learn from your texts this time: too few, or the model didn&apos;t answer.</p>}
              </div>

              <div>
                <h3>The lines</h3>
                <GmailLine busy={busy} />
                <div className="cx-row">
                  Texts sending
                  <span>
                    {textsView?.paired ? (
                      t.unlocked ? (
                        <button type="button" className="cx-lnk" onClick={() => void lock()}>
                          Unlocked here · Lock
                        </button>
                      ) : (
                        <button type="button" className="cx-lnk" onClick={() => void unlock()}>
                          Locked · Unlock for 72 h
                        </button>
                      )
                    ) : (
                      "waiting on the MacBook"
                    )}
                  </span>
                </div>
                {textsView?.paired && (
                  <div className="cx-row">
                    The MacBook
                    <span>
                      paired ·{" "}
                      <button type="button" className="cx-lnk" onClick={() => void useTexts.getState().unpair()}>
                        Unpair
                      </button>
                    </span>
                  </div>
                )}
                <div className="cx-row">
                  Send without asking<span className="cx-off">never</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Paired, the texts are the Texts list above; the section only pairs (once is enough). */}
        {!textsView?.paired && <TextsSection now={now} />}
      </details>
    </section>
  );
}

function GmailLine({ busy }: { busy: boolean }) {
  const view = useEmail((s) => s.view);
  const status = useEmail((s) => s.status);
  const load = useEmail((s) => s.load);
  const connect = useEmail((s) => s.connect);
  const disconnect = useEmail((s) => s.disconnect);
  const on = status?.gmail === "connected";
  const state = load === "off" ? "on the Azure copy" : !status ? "reading…" : on ? (status.agent === "paused" ? "paused at the monthly cap" : status.agent === "error" ? "the last check failed" : view?.canSend ? "reads, sends on your yes" : "read-only") : status.gmail === "refused" ? "needs reconnecting" : "waiting to connect";
  return (
    <>
      <div className="cx-row">
        Gmail
        <span>
          {state}
          {view && on ? (
            <>
              {" · "}
              <button type="button" className="cx-lnk" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
            </>
          ) : view ? (
            <>
              {" · "}
              <button type="button" className="cx-lnk" disabled={!view.canConnect || busy} onClick={() => void connect()} title={view.canConnect ? "Opens Google's consent page" : "Waiting for the Gmail keys on Azure"}>
                {status?.gmail === "refused" ? "Reconnect" : "Connect"}
              </button>
            </>
          ) : null}
        </span>
      </div>
      {view && on && !view.canSend && (
        <div className="cx-row">
          Sending email
          <span>
            <button type="button" className="cx-lnk" disabled={!view.canConnect || busy} onClick={() => void connect()} title="Asks Google again, with Send email on your behalf">
              Reconnect Gmail to send from here
            </button>
          </span>
        </div>
      )}
    </>
  );
}
