import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { gmailHref } from "../email/EmailSection.tsx";
import { takeGmailReturn, useEmail } from "../email/email.ts";
import { useTexts } from "../texts/texts.ts";
import { TextsSection } from "../texts/TextsSection.tsx";
import { setRelayHandler } from "./bridge.ts";
import { RelayRail } from "./RelayRail.tsx";
import { ghost, ghosted, INK, quill, rise, SigilStage, sink } from "./sigils.ts";
import { agoShort, askLine, codexOf, initialOf, lastRequest, weekSent, type Exchange } from "./thread.ts";
import { errorText, useThread, type Notice } from "./useThread.ts";
import { useRoomMic } from "../roomvoice/roomVoice.ts";
import "./thread.css";

/**
 * Relay's Thread (#615, simplified in #642) in the Codex look Nikita picked: a glowing spine down the page, the sender
 * in serif italic in its margin under their photo, their logo or a large glowing initial, and one column written in by
 * a quill of sigils from the spine. Each entry is one gist, Blasto's advice for a mail, and one row of actions: Draft it
 * (or Reply), Done, Later, and "…" for the rest. A draft appears only when asked for, with Send and Change. What you
 * say shows at the spine's foot while you speak, then fades; the keys hide behind "?".
 *
 * The to-do queue is one continuous codex: each exchange a full-height entry, soft-snapped. The entry in focus is the
 * only one voice and keys act on, and a send needs its draft on screen there. The Codex below is one line of numbers,
 * then Email and Texts, oldest first; everything else sits behind Settings.
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
        <button type="button" role="menuitem" onClick={pick(() => t.say("skip"))}>
          Skip <kbd>S</kbd>
        </button>
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

const focusWords = () => document.getElementById("cx-words")?.focus();

/** One exchange: who, the gist, Blasto's advice, one row of actions; a draft only once asked for. */
function Entry({ x, focus, now, t }: { x: Exchange; focus: boolean; now: number; t: ReturnType<typeof useThread> }) {
  const hidden = t.hidden;
  const sealed = t.pending === x.key;
  const phase = focus ? t.phase : null;
  const connect = useEmail((s) => s.connect);
  const canConnect = useEmail((s) => s.view?.canConnect === true);
  const textsView = useTexts((s) => s.view);
  const req = x.line === "text" ? lastRequest(textsView?.requests, x.id) : undefined;
  const reading = t.reading === x.key;
  return (
    <article className="cx-entry" data-key={x.key} data-focus={focus || undefined} aria-label={`From ${hidden ? "someone" : x.who}`} aria-current={focus || undefined}>
      <div className="cx-folio">
        <div className="cx-verse cx-them">
          <div className="cx-mar">
            <Face x={x} hidden={hidden} />
            <Private className="cx-rub">{x.who}</Private>
            <span className="cx-meta">
              {x.line === "email" ? "email" : x.channel === "SMS" ? "sms" : "text"} · {agoShort(now - x.at)}
            </span>
          </div>
          <div className="cx-body">
            <p className="cx-msg">
              <Private>{x.body || "No gist yet: Dialtone hasn't read this one."}</Private>
            </p>
            {x.line === "email" && x.advice && (
              <p className="cx-adv">
                <span className="cx-lab">Blasto</span> <Private>{x.advice}</Private>
              </p>
            )}
          </div>
        </div>

        {(focus || x.draft) && (
          <div className="cx-verse cx-you">
            <div className="cx-mar">
              <span className="cx-rub is-you">you</span>
              {x.said && (
                <span className="cx-meta">
                  heard{" "}
                  <q>
                    <Private>{x.said}</Private>
                  </q>
                </span>
              )}
            </div>
            <div className="cx-body">
              {focus && reading ? (
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

              {focus && phase === "incoming" && !reading && (
                <div className="cx-ask cx-acts">
                  {x.line === "email" || x.ready ? (
                    <button type="button" className="cx-opt is-yes" onClick={() => t.say("draft")}>
                      {x.line === "email" ? "Draft it" : "Reply"} <kbd>R</kbd>
                    </button>
                  ) : (
                    <button type="button" className="cx-opt is-yes" onClick={focusWords} disabled={!x.sendable}>
                      Reply
                    </button>
                  )}
                  <button type="button" className="cx-opt" onClick={() => t.say("done")}>
                    Done <kbd>D</kbd>
                  </button>
                  <button type="button" className="cx-opt" onClick={() => t.say("later")}>
                    Later <kbd>L</kbd>
                  </button>
                  <More x={x} t={t} />
                </div>
              )}

              {focus && phase === "ask" && x.draft && (
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

export function RelayThread({ now }: { now: number }) {
  const stageRef = useRef<HTMLElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const earRef = useRef<HTMLSpanElement>(null);
  const sg = useRef<SigilStage | null>(null);
  const [engine, setEngine] = useState<SigilStage | null>(null);
  /** The spine's lit stretch (and its alpha, easing to `to`), the rush of its falling sigils, how loud the ear is. */
  const fx = useRef({ lit: null as Element | null, a: 0, to: 0, rush: 0, loud: 0, listening: false });
  const spineX = () => (sg.current && earRef.current ? sg.current.rel(earRef.current).cx : 0);
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
    await Promise.all([...el.querySelectorAll<HTMLElement>(PARTS)].map((p) => s.dissolve(p, { color: INK.sink, rtl: true, dur: 1300, stagger: 600, to: () => [X + (rnd() - 0.5) * 6, H + 20], path: sink })));
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
        s.glyph(c, INK.hi, a.g, X + a.o, a.y * (E.y - 10), a.s, 0.4 * Math.sin(a.y * Math.PI));
      }
      // The ear: a short wick of sigils at the foot of the spine, brighter while it hears you.
      const live = f.listening ? 1 : 0.55;
      for (let k = 0; k < 4; k++) {
        const gi = Math.floor(time * (2 + loud * 10) + k * 7) % 40;
        const al = (0.25 + 0.75 * Math.max(0, Math.sin(time * (2 + loud * 6) - k * 0.9)) * (0.4 + loud * 0.6)) * live;
        s.glyph(c, k ? INK.hi : INK.white, gi, X, E.y + E.h - 6 - k * 12, 10 + loud * 2, al, k === 0);
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
    await s.form(d, { from: () => [X + (rnd() - 0.5) * 6, E.y + rnd() * E.h], path: quill(X), dur: 1300, stagger: 1300, jitter: 90, pre: 0.2 });
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
    if (old && !s.reduced) for (const p of old.querySelectorAll<HTMLElement>(PARTS)) void s.dissolve(p, { dur: 700, stagger: 200, to: (_i, _x, y) => [X + (rnd() - 0.5) * 8, y + (rnd() - 0.5) * 60] });
    if (!el) return;
    void (async () => {
      fx.current.rush = 1;
      const init = el.querySelector<HTMLElement>(".cx-init");
      const msg = el.querySelector<HTMLElement>(".cx-msg");
      const adv = el.querySelector<HTMLElement>(".cx-adv");
      for (const p of el.querySelectorAll<HTMLElement>(PARTS)) ghost(p, !s.reduced);
      // The illuminated initial gathers first, poured down the spine.
      if (init) void s.form(init, { gap: 3, size: 8, ltr: false, swirl: 120, dur: 1300, stagger: 300, glow: 0.3, from: () => [X + (rnd() - 0.5) * 6, -10 - rnd() * 140] });
      if (!s.reduced) await sleep(380);
      if (run.current !== id) return;
      const vb = s.rel(el.querySelector(".cx-them") ?? el);
      const top = (): [number, number] => [X + (rnd() - 0.5) * 4, Math.max(0, vb.y - 20 - rnd() * 160)];
      if (msg) await s.form(msg, { from: top, path: quill(X), dur: 1100, stagger: 1100, jitter: 90, max: 620, pre: 0 });
      if (run.current !== id) return;
      if (adv) void s.form(adv, { from: top, path: quill(X), dur: 800, stagger: 600, jitter: 60, max: 300 });
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

  // The seal: on a yes the draft goes white and its sigils run up the spine and out the top.
  useEffect(() => {
    const s = sg.current;
    if (!s || !ex || t.pending !== ex.key || hidden) return;
    const d = entryOf(ex.key)?.querySelector<HTMLElement>(".cx-draft");
    if (!d) return;
    const r = s.rel(d);
    const X = spineX();
    fx.current.rush = 1;
    s.burst(r.cx, r.cy, { n: 160, w: r.w, h: r.h, dur: 1500, stagger: 600, size: 8, color: INK.you, to: () => [X, -30], path: rise });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.pending]);

  // A rule that didn't take: the words come back.
  useEffect(() => {
    const s = sg.current;
    if (t.notice?.kind !== "warn" || !ex || !s) return;
    const el = entryOf(ex.key);
    for (const p of el?.querySelectorAll<HTMLElement>(PARTS) ?? []) if (ghosted(p) && !hidden) void s.form(p, { dur: 700, stagger: 300 });
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
      if (!e.repeat && t.key(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [t, ex?.key, goTo]);

  const submit = (raw: string) => {
    const r = t.line(raw);
    if (r.ok) setTyped("");
  };

  const waiting = t.metrics.waiting;

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

        <div className="cx-pages" ref={pagesRef} tabIndex={-1}>
          {t.queue && t.queue.length > 0 ? t.queue.map((x) => <Entry key={x.key} x={x} focus={x.key === ex?.key} now={now} t={t} />) : <Waiting signedIn={t.signedIn} waiting={waiting} />}
        </div>

        {/* The rail (#765): the whole queue down the left edge, Dock-style; a click jumps the codex there. */}
        {t.queue && t.queue.length > 1 && <RelayRail queue={t.queue} cur={ex?.key ?? null} now={now} hidden={hidden} goTo={goTo} scroller={pagesRef} />}

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
                  <input id="cx-words" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={phase === "ask" ? "or say what to change" : ex.line === "email" ? "tell them yes, or: invites can wait" : "tell them I'll be 10 late"} autoComplete="off" maxLength={300} data-private="" />
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
                <b>Y</b> send · <b>N</b> no · <b>R</b> draft it · <b>D</b> done · <b>L</b> later · <b>S</b> skip · <b>Z</b> undo · <b>J K</b> move
                {" "}
                · hold <b>Space</b> to talk
              </p>
            )}
          </div>
          <span className="cx-ear" ref={earRef} data-on={micPhase === "listening" || undefined} aria-hidden="true" />
        </div>
      </section>

      <Codex now={now} t={t} back={back} goTo={goTo} />
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

/** One list of the Codex: who · gist · age, oldest first; a tap opens it in the Thread. */
function Rows({ rows, cur, goTo, empty }: { rows: ReturnType<typeof codexOf>["email"]; cur: string | null; goTo: (key: string) => void; empty: string }) {
  if (!rows.length) return <p className="cx-quiet">{empty}</p>;
  return (
    <ol className="cx-rows">
      {rows.map(({ ex: x, waited }) => (
        <li key={x.key} data-cur={x.key === cur || undefined}>
          <button type="button" onClick={() => goTo(x.key)}>
            <Private as="b">{x.who}</Private>
            <Private className="cx-what">{x.body || x.subject}</Private>
            <em>{agoShort(waited)}</em>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The Codex (#642): one line of numbers, Email and Texts, then everything else behind Settings. */
function Codex({ now, t, back, goTo }: { now: number; t: ReturnType<typeof useThread>; back: string | null; goTo: (key: string) => void }) {
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
  const rules = view?.rules ?? [];
  const style = view?.style ?? null;
  const gmailOn = !!status && status.gmail === "connected" && status.agent !== "waiting";
  const textsOn = !!textsStatus && textsStatus.hub !== "off" && textsStatus.hub !== "wiped";
  const c = codexOf(t.queue, now, { email: gmailOn ? status.needsYou : null, texts: textsOn ? textsStatus.owed : null });
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
              <b>{num(sent)}</b> sent this week
            </span>
            <span>
              <b>{num(t.metrics.filtered)}</b> filtered
            </span>
          </p>
          {back && <p className="cx-note">{RETURN_TEXT[back]}</p>}
          {error && <p className="cx-warn">{error}</p>}
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
            </div>
            <div className="cx-body">
              <Rows rows={c.texts} cur={ex?.key ?? null} goTo={goTo} empty={textsView?.paired ? "Nobody's waiting on a text." : "The MacBook isn't paired."} />
            </div>
          </div>
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
