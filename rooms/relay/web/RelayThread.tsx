import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { gmailHref } from "./EmailSection.tsx";
import { takeGmailReturn, useEmail } from "../data/email.ts";
import { useTexts, type TextItem } from "../data/texts.ts";
import { TextsSection } from "./TextsSection.tsx";
import { setRelayHandler } from "../data/bridge.ts";
import { GroupFlipper } from "./GroupFlipper.tsx";
import { groupsOf } from "../data/groups.ts";
import { RelayQueue, useMedia } from "./RelayQueue.tsx";
import { Said } from "./Said.tsx";
import { SetAside } from "./SetAside.tsx";
import { ghost, ghosted, quill, rise, SigilStage, sink } from "@ceo/engine/sigils/sigils.ts";
import { agoShort, askLine, codexOf, contactsHint, initialOf, lastRequest, noGistLine, olderInOrder, ORDERS, weekSent, type Exchange, type Order } from "../data/thread.ts";
import { errorText, useThread, type Notice } from "../data/useThread.ts";
import { listen, useRoomMic, type Listener } from "@ceo/desk/roomvoice/roomVoice.ts";
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
 * What you say shows at the spine's foot while you speak, then fades; the keys hide behind "?".
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
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
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

/** Opens a text's composer (#869): its circle on the line, R, or Reply. */
const WRITE_EVENT = "relay:write";
const openComposer = (key: string) => window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: key }));

const focusWords = () => document.getElementById("cx-words")?.focus();

/**
 * Nikita's own reply (#803): what he types here goes exactly as typed when he taps Send, after the same few seconds of
 * Undo; no rewrite and no model. Blasto's voice is for his drafts and for what is said aloud (the dock's line).
 */
function Own({ x, t, start, close, autoFocus, launch, children }: { x: Exchange; t: ReturnType<typeof useThread>; start: string; close: (() => void) | null; autoFocus: boolean; launch: (el: HTMLElement | null) => void; children?: ReactNode }) {
  const [text, setText] = useState(start);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ear = useRef<Listener | null>(null);
  const [hearing, setHearing] = useState(false);
  const [micNote, setMicNote] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el || !autoFocus) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);
  useEffect(() => () => ear.current?.cancel(), []);
  const locked = x.line === "text" && !t.unlocked;
  const hint = x.hint && !t.hidden && text.trim() !== x.hint.trim() ? x.hint : null;
  const take = (words: string) => {
    setText(words);
    window.setTimeout(() => {
      const el = ref.current;
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(words.length, words.length);
    }, 0);
  };
  /** Dictation (#869): the browser's own speech recognition writes into the box; nothing goes until Send. */
  const mic = async () => {
    if (ear.current) {
      const l = ear.current;
      ear.current = null;
      setHearing(false);
      const got = await l.finish();
      if ("error" in got) setMicNote(got.error);
      else if ("clip" in got) setMicNote("Dictation needs a browser with speech recognition (Chrome, Edge or Safari).");
      return;
    }
    const base = text.trim() ? `${text.trimEnd()} ` : "";
    setMicNote("");
    ear.current = listen((w) => setText(`${base}${w}`));
    setHearing(true);
  };
  return (
    <form
      className="cx-own"
      data-hint={hint ? "" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        ear.current?.cancel();
        ear.current = null;
        setHearing(false);
        if (t.sendOwn(text)) {
          launch(ref.current);
          setText("");
          close?.();
        }
      }}
    >
      <label className="cx-sr" htmlFor={`cx-own-${x.key}`}>
        Your reply to {t.hidden ? "them" : x.who}, sent exactly as you type it
      </label>
      <div className="cx-ownrow">
        <textarea
          id={`cx-own-${x.key}`}
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Tab on an empty box takes the suggestion, as the iPhone's does on a tap.
            if (e.key === "Tab" && !e.shiftKey && hint && !text.trim()) {
              e.preventDefault();
              take(hint);
            }
          }}
          rows={Math.min(6, Math.max(2, text.split("\n").length))}
          maxLength={2_000}
          placeholder={hearing ? "Listening…" : "Write it, or tap the mic and say it. It goes exactly as written."}
          data-private=""
        />
        {/* Blasto's draft, faint, off to the side: a suggestion to pick, never sent unless picked and sent (#869). */}
        {hint && (
          <div className="cx-hints" aria-label="Suggestion">
            <button type="button" className="cx-hint" onClick={() => take(hint)} title="Use this suggestion (Tab)">
              <Private>{hint}</Private>
            </button>
          </div>
        )}
      </div>
      <div className="cx-ask cx-acts">
        {locked ? (
          <button type="button" className="cx-opt is-yes" onClick={() => void useTexts.getState().unlock()} title="One passkey check unlocks sending on this device for 72 hours">
            Unlock to send
          </button>
        ) : (
          <button type="submit" className="cx-opt is-yes" disabled={!text.trim() || t.hidden}>
            Send
          </button>
        )}
        {typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) && (
          <button type="button" className="cx-opt cx-mic" data-on={hearing || undefined} aria-pressed={hearing} onClick={() => void mic()} title={hearing ? "Stop dictating" : "Dictate into the box"}>
            {hearing ? "Stop" : "Mic"}
          </button>
        )}
        {close && (
          <button type="button" className="cx-opt" onClick={close}>
            Cancel
          </button>
        )}
        {children}
      </div>
      {micNote && <p className="cx-warn">{micNote}</p>}
    </form>
  );
}

/** One exchange, right of the line (#803): who, their words, Blasto's advice, one row of actions; a draft only once asked for. */
function Entry({ x, focus, now, t, launch }: { x: Exchange; focus: boolean; now: number; t: ReturnType<typeof useThread>; launch: (el: HTMLElement | null) => void }) {
  const hidden = t.hidden;
  const sealed = t.pending === x.key;
  const phase = focus ? t.phase : null;
  const connect = useEmail((s) => s.connect);
  const canConnect = useEmail((s) => s.view?.canConnect === true);
  const textsView = useTexts((s) => s.view);
  const req = x.line === "text" ? lastRequest(textsView?.requests, x.id) : undefined;
  const reading = t.reading === x.key;
  /** The own-words box (#803): closed, empty, or started from the draft on screen. */
  const [own, setOwn] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) setOwn(null);
  }, [focus]);
  // Reply on a text (#869): a tap on its circle, R, or the Reply button opens the composer, Nikita's own words first.
  useEffect(() => {
    if (!focus || x.line !== "text" || !x.sendable) return;
    const open = (e: Event) => {
      if ((e as CustomEvent<string>).detail === x.key) setOwn((o) => o ?? "");
    };
    window.addEventListener(WRITE_EVENT, open);
    return () => window.removeEventListener(WRITE_EVENT, open);
  }, [focus, x.key, x.line, x.sendable]);
  const textReply = x.line === "text" && x.sendable && phase === "incoming";
  const writing = focus && own !== null && (phase === "incoming" || phase === "ask");
  /** One small, quiet row (#869): Skip, Done, Later, and "…". */
  const rest = (
    <>
      <button type="button" className="cx-opt" onClick={() => t.say("skip")}>
        Skip <kbd>S</kbd>
      </button>
      <button type="button" className="cx-opt" onClick={() => t.say("done")}>
        Done <kbd>D</kbd>
      </button>
      <button type="button" className="cx-opt" onClick={() => t.say("later")}>
        Later <kbd>L</kbd>
      </button>
      <More x={x} t={t} />
    </>
  );
  return (
    <article className="cx-entry" data-key={x.key} data-focus={focus || undefined} aria-label={`From ${hidden ? "someone" : x.who}`} aria-current={focus || undefined}>
      <div className="cx-folio">
        {/* Right of the line (#803): who, then their words; what comes next rides the wave on the left. */}
        <div className="cx-verse cx-them">
          <div className="cx-body">
            <header className="cx-head">
              <Face x={x} hidden={hidden} />
              <span className="cx-id">
                <Private className="cx-rub">{x.who}</Private>
                <span className="cx-meta">
                  {x.line === "email" ? "email" : x.channel === "SMS" ? "sms" : "text"} · {agoShort(now - x.at)}
                  {x.unread && <span className="cx-unread"> · unread</span>}
                  {x.settled && <span className="cx-settled"> · no reply needed</span>}
                </span>
              </span>
            </header>
            {x.messages?.length ? (
              <>
                {/* Their own words (#758), the hero (#869): oldest first, the newest last and largest; no gist. */}
                <Said messages={x.messages} hidden={hidden} />
              </>
            ) : (
              <p className="cx-msg">
                <Private>{x.body || noGistLine(x)}</Private>
              </p>
            )}
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
                <Own x={x} t={t} start={own ?? ""} close={() => setOwn(null)} autoFocus launch={launch}>
                  {textReply ? rest : null}
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
                  {textReply ? (
                    <button type="button" className="cx-opt is-yes" onClick={() => setOwn("")} title="Write or say your reply; it goes exactly as written">
                      Reply <kbd>R</kbd>
                    </button>
                  ) : x.line === "email" ? (
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
                  ) : null}
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
                        onClick={() => {
                          t.say("change");
                          focusWords();
                        }}
                      >
                        Change
                      </button>
                      <button type="button" className="cx-opt" onClick={() => t.say("skip")}>
                        Skip <kbd>S</kbd>
                      </button>
                      <More x={x} t={t} />
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
                        onClick={() => {
                          t.say("change");
                          focusWords();
                        }}
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
              {focus && req && (req.state === "expired" || req.state === "failed" || req.state === "refused") && req.kind === "send" && <p className="cx-warn">The last send didn't go: {req.state === "expired" ? "the Mac was offline." : req.state === "failed" ? "it may have sent, check Messages." : "the Mac refused it."}</p>}
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
              <button type="button" onClick={() => open(g.id)} title={hidden ? "A group" : (g.summary?.text ?? g.name)} aria-label={`${hidden ? "A group" : g.name}${n ? `, ${n} new` : ""}${g.unread ? ", unread" : ""}`}>
                {g.unread && <span className="cx-dot" aria-hidden="true" />}
                <Private as="b">{g.name || "Group"}</Private>
                {n > 0 && <em aria-hidden="true">{n}</em>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const ORDER_LABEL: Record<Order, string> ={ newest: "Newest", oldest: "Oldest", priority: "Priority" };

/** Newest (the default), Oldest or Priority (Dialtone's "reply sooner" first): one segmented toggle on the line (#803). */
function OrderToggle({ order, set }: { order: Order; set: (o: Order) => void }) {
  return (
    <div className="cx-order" role="radiogroup" aria-label="Order of the queue">
      {ORDERS.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={order === o} onClick={() => set(o)}>
          {ORDER_LABEL[o]}
        </button>
      ))}
    </div>
  );
}

export function RelayThread({ now }: { now: number }) {
  const stageRef = useRef<HTMLElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const earRef = useRef<HTMLSpanElement>(null);
  const sg = useRef<SigilStage | null>(null);
  const [engine, setEngine] = useState<SigilStage | null>(null);
  /** The spine's lit stretch (and its alpha, easing to `to`), the rush of its falling sigils, how loud the ear is. */
  const fx = useRef({ lit: null as Element | null, a: 0, to: 0, rush: 0, loud: 0, listening: false });
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
  const [typed, setTyped] = useState("");
  const [hints, setHints] = useState(false);
  const [back] = useState(() => takeGmailReturn());
  const run = useRef(0);
  fx.current.listening = micPhase === "listening";
  fx.current.loud = micPhase === "listening" ? 1 : 0;

  // One listener (#638): the room voice hands what's said on /relay to this Thread (rooms/relay/voice.ts).
  useEffect(
    () =>
      setRelayHandler(async (text) => {
        const r = tRef.current.line(text);
        if (!r.cmd) return null;
        if (r.cmd === "words" && !r.ok) return null;
        const say = (await r.said) || (r.ok ? "" : "That doesn't apply right now.");
        return say ? { say } : null;
      }),
    [],
  );

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
    const off = s.field((c, time, dt) => {
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

  // Entries not yet written in stay blank (their words are still there for screen readers) until they come into focus.
  useLayoutEffect(() => {
    const s = sg.current;
    const root = pagesRef.current;
    if (!root || !s) return;
    for (const el of root.querySelectorAll<HTMLElement>(".cx-entry[data-key]")) {
      if (el.dataset.seen) continue;
      el.dataset.seen = "1";
      if (!s.reduced && !hidden) for (const p of el.querySelectorAll<HTMLElement>(PARTS)) ghost(p, true);
    }
  });

  // Hide shows every entry plainly (veiled by <Private>): nothing forms from masked words.
  useEffect(() => {
    if (!hidden) return;
    for (const p of pagesRef.current?.querySelectorAll<HTMLElement>(PARTS) ?? []) ghost(p, false);
  }, [hidden]);

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
    fx.current.to = el ? 1 : 0;
    if (hidden) return;
    const X = spineX();
    if (old && !s.reduced) for (const p of old.querySelectorAll<HTMLElement>(PARTS)) void s.dissolve(p, { color: NANITE.hi, dur: 250, stagger: 100, to: (_i, _x, y) => [X + (rnd() - 0.5) * 8, y + (rnd() - 0.5) * 60] });
    if (!el) return;
    void (async () => {
      fx.current.rush = 1;
      const init = el.querySelector<HTMLElement>(".cx-init");
      const msgs = [...el.querySelectorAll<HTMLElement>(".cx-msg")];
      const adv = el.querySelector<HTMLElement>(".cx-adv");
      for (const p of el.querySelectorAll<HTMLElement>(PARTS)) ghost(p, !s.reduced);
      // The illuminated initial gathers first, poured down the spine. Quick (Nikita, 2026-11-05: the texts loaded too
      // slowly): 250 ms an item at most, about 600 ms for the whole entry; reduced motion shows it at once.
      if (init) void s.form(init, { gap: 3, size: 8, ltr: false, swirl: 120, dur: 250, stagger: 100, glow: 0.3, color: NANITE.hi, from: () => [X + (rnd() - 0.5) * 6, -10 - rnd() * 140] });
      if (!s.reduced) await sleep(120);
      if (run.current !== id) return;
      const vb = s.rel(el.querySelector(".cx-them") ?? el);
      const top = (): [number, number] => [X + (rnd() - 0.5) * 4, Math.max(0, vb.y - 20 - rnd() * 160)];
      // Every text at once (#758: one line each), not one after another.
      await Promise.all(msgs.map((m) => s.form(m, { from: top, path: quill(X), dur: 250, stagger: 200, jitter: 60, max: 620, pre: 0, color: NANITE.hi })));
      if (run.current !== id) return;
      if (adv) void s.form(adv, { from: top, path: quill(X), dur: 220, stagger: 150, jitter: 40, max: 300, color: NANITE.hi });
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
        if (best) pick(best);
      },
      { root, threshold: [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1] },
    );
    for (const el of root.querySelectorAll(".cx-entry[data-key]")) io.observe(el);
    return () => io.disconnect();
  }, [keys, pick]);

  // A new order (#803) keeps the same exchange in focus: the codex jumps to where it now sits, before paint.
  useLayoutEffect(() => {
    const el = entryOf(tRef.current.ex?.key);
    if (el && pagesRef.current) pagesRef.current.scrollTop = el.offsetTop;
  }, [t.order]);

  /** Puts an exchange in focus and scrolls the codex to it. */
  const goTo = useCallback(
    (key: string) => {
      pick(key);
      const top = stageRef.current?.getBoundingClientRect().top ?? 0;
      if (Math.abs(top) > 4) stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const el = entryOf(key);
      const root = pagesRef.current;
      if (el && root) root.scrollTo({ top: el.offsetTop, behavior: "smooth" });
    },
    [pick],
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

  // Keys: Y send, N no, R draft it, D done, L later, S skip, Z undo; J and K move; ? the list. Space is the room mic's.
  // Never while typing.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
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
      if ((k === "j" || k === "k") && t.queue?.length) {
        const i = t.queue.findIndex((x) => x.key === ex?.key);
        const next = t.queue[Math.max(0, Math.min(t.queue.length - 1, i + (k === "j" ? 1 : -1)))];
        if (next) goTo(next.key);
        e.preventDefault();
        return;
      }
      // R on a text opens its composer (#869): Nikita's own words first; Blasto's draft waits there as a suggestion.
      if (k === "r" && ex?.line === "text" && ex.sendable && phase === "incoming") {
        openComposer(ex.key);
        e.preventDefault();
        return;
      }
      if (!e.repeat && t.key(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [t, ex?.key, ex?.line, ex?.sendable, phase, goTo]);

  const submit = (raw: string) => {
    const r = t.line(raw);
    if (r.ok) setTyped("");
  };

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
      <section className="cx-stage" ref={stageRef} aria-label="Relay at a glance">
        <header className="cx-top">
          <h1 className="cx-mark">
            <b>Relay</b>
            <span>C.E.O.</span>
          </h1>
          <p className="cx-count">
            <span>{waiting === null ? "—" : waiting.toLocaleString()} waiting</span>
            <a href="#cx-codex">Codex ↓</a>
          </p>
        </header>

        {/* The order (#803): one small toggle sitting on the line, remembered on this device. */}
        {t.queue && t.queue.length > 1 && <OrderToggle order={t.order} set={t.setOrder} />}

        {/* Group chats (#869): off the line, on their own shelf. */}
        <GroupShelf groups={shelf} hidden={hidden} open={showGroup} />

        {/* Who is waiting (#803, #869): every circle on the line, magnified where you point; a tap opens it. */}
        {t.queue && t.queue.length > 1 && <RelayQueue queue={t.queue} cur={ex?.key ?? null} now={now} hidden={hidden} goTo={goWrite} navRef={waveRef} pagesRef={pagesRef} narrow={narrow} still={still || !!engine?.reduced} />}

        <div className="cx-pages" ref={pagesRef} tabIndex={-1}>
          {t.queue && t.queue.length > 0 ? t.queue.map((x) => <Entry key={x.key} x={x} focus={x.key === ex?.key} now={now} t={t} launch={launch} />) : <Waiting signedIn={t.signedIn} waiting={waiting} />}
        </div>

        <div className="cx-dock">
          <div className="cx-dl">
            {/* The mic is the Desk's room mic (#638): one listener for every room. What's said here reaches the Thread. */}
            <span className="cx-lab">{micPhase === "listening" ? "Listening" : micPhase === "thinking" ? "Reading that…" : "Talk with the mic, or type"}</span>
          </div>
          <div className="cx-dr">
            <UndoLine n={t.notice} now={now} sg={engine} />
            <div className="cx-dockrow">
              {ex && (phase === "incoming" || phase === "ask") && (
                <form
                  className="cx-type"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (typed.trim()) submit(typed);
                  }}
                >
                  <label className="cx-sr" htmlFor="cx-words">
                    Say what to tell them, or what to do with it
                  </label>
                  <input id="cx-words" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={phase === "ask" ? "or say what to change" : ex.line === "email" ? "tell Blasto what to say, or: invites can wait" : "tell Blasto what to say, in your voice"} autoComplete="off" maxLength={300} data-private="" />
                  <button type="submit" disabled={!typed.trim()}>
                    Go
                  </button>
                </form>
              )}
              <button type="button" className="cx-help" aria-expanded={hints} aria-controls="cx-keys" onClick={() => setHints((h) => !h)} title="Keys">
                ?
              </button>
            </div>
            {hints && (
              <p className="cx-keys" id="cx-keys">
                <b>Y</b> send · <b>N</b> no · <b>R</b> reply · <b>D</b> done · <b>L</b> later · <b>S</b> skip · <b>Z</b> undo · <b>J K</b> move
                {" "}
                · hold <b>Space</b> to talk
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
