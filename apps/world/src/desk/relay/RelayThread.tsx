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
import { ghost, ghosted, INK, quill, rise, SigilStage, sink } from "./sigils.ts";
import { agoShort, askLine, initialOf, lastRequest, passesOf, pendingOf, type Command, type Exchange, type Why } from "./thread.ts";
import { errorText, useThread, type Notice } from "./useThread.ts";
import { useVoice } from "./voice.ts";
import "./thread.css";

/**
 * Relay's Thread (#615) in the Codex look Nikita picked: a glowing spine down the page, the sender in serif italic in
 * its margin under a large glowing initial, and one column of text written in, left to right, by a quill of sigils
 * from the spine. Your words climb from the listening point at the spine's foot (the ear); the "how you write" passes
 * tick between what you said and the draft; a yes seals it, and the sigils run up the spine and out the top.
 *
 * The to-do queue is one continuous codex: each exchange a full-height entry, soft-snapped, sigils dissolving and
 * re-forming as you scroll across. The entry in focus is the only one voice and keys act on, and a send needs its
 * draft on screen there. "Open the codex" is the dashboard below: what's pending, who has waited longest, what is
 * high priority, then the rules Relay keeps.
 *
 * This file only draws: the queue, the state machine and the gate live in ./useThread.ts and ./thread.ts, the glyph
 * engine in ./sigils.ts, listening in ./voice.ts. Every word of mail or text is wrapped in <Private> for Hide mode, and
 * only the signed-in passkey session ever has any; signed out, the page shows counts and states.
 */

const CMD_WORDS: Record<Command, string> = { yes: "yes", no: "no", change: "change it", skip: "skip", later: "later", filter: "filter these out", block: "block this sender", undo: "undo", words: "" };
const WHY: Record<Why, string> = { sooner: "sooner", "needs-you": "needs you", overdue: "overdue" };
const PARTS = ".cx-init, .cx-subj, .cx-msg, .cx-draft";
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const rnd = Math.random;
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const first = (who: string) => who.trim().split(/\s+/)[0] || who;

function CopyLink({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cx-opt"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1_600);
          })
          .catch(() => undefined)
      }
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** The dock's right line: the undo countdown with its sigils, a send that went, or a quiet notice. */
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
                <Private>{n.text}</Private> in <span className="cx-n">{left}</span>
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
              {n.act.label === "Undo" && n.kind === "undo" ? " · Z" : ""}
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
    p = "Connect Gmail or pair the MacBook in the codex below, and what needs you is written in here, one at a time.";
  } else if (!signedIn) {
    h = waiting ? `${waiting} waiting on you.` : "Nothing waiting on you.";
    p = "Who they are, what they said and Blasto's drafts show only when you sign in.";
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

interface EntryProps {
  x: Exchange;
  focus: boolean;
  now: number;
  t: ReturnType<typeof useThread>;
  passes: string[];
  passOn: number;
}

/** One exchange: what came in, then you. Only the entry in focus asks "Send to X?". */
function Entry({ x, focus, now, t, passes, passOn }: EntryProps) {
  const hidden = t.hidden;
  const sealed = t.pending === x.key;
  const phase = focus ? t.phase : null;
  const connect = useEmail((s) => s.connect);
  const canConnect = useEmail((s) => s.view?.canConnect === true);
  const textsView = useTexts((s) => s.view);
  const req = x.line === "text" ? lastRequest(textsView?.requests, x.id) : undefined;
  return (
    <article className="cx-entry" data-key={x.key} data-focus={focus || undefined} aria-label={`From ${hidden ? "someone" : x.who}`} aria-current={focus || undefined}>
      <div className="cx-folio">
        <div className="cx-verse cx-them">
          <div className="cx-mar">
            <span className="cx-init" aria-hidden="true">
              {hidden ? "·" : initialOf(x.who)}
            </span>
            <Private className="cx-rub">{x.who}</Private>
            <span className="cx-meta">
              {x.line === "email" ? "email" : x.channel === "SMS" ? "sms" : "text"} · {agoShort(now - x.at)}
            </span>
          </div>
          <div className="cx-body">
            {x.line === "email" && (
              <>
                <div className="cx-subj">
                  <Private>{x.subject}</Private>
                </div>
                <div className="cx-addr">
                  <Private>{x.who}</Private> to you · {clock(x.at)}
                </div>
              </>
            )}
            <p className="cx-msg">
              <Private>{x.body || "No summary yet: the agent hasn't read this one."}</Private>
            </p>
            {x.line === "text" && <p className="cx-note">Dialtone's gist · the text itself stays on your Mac</p>}
          </div>
        </div>

        <div className="cx-verse cx-you">
          <div className="cx-mar">
            <span className="cx-rub is-you">you</span>
            <span className="cx-meta">
              {x.said ? (
                <>
                  heard{" "}
                  <q>
                    <Private>{x.said}</Private>
                  </q>
                </>
              ) : x.draft ? (
                "drafted ahead"
              ) : (
                ""
              )}
            </span>
          </div>
          <div className="cx-body">
            {x.draft && (
              <p className="cx-pass" aria-label="How you write: the checks this draft passed">
                <span className="cx-lam" aria-hidden="true">
                  λ
                </span>
                {passes.map((p, i) => (
                  <span key={p} data-on={!focus || i < passOn || undefined}>
                    {p}
                  </span>
                ))}
              </p>
            )}
            {focus && phase === "drafting" ? (
              <p className="cx-quiet">Blasto is writing it in your voice…</p>
            ) : x.draft ? (
              <>
                <p className="cx-draft" data-sent={sealed || undefined}>
                  <Private>{x.draft}</Private>
                </p>
                <div className="cx-tag">
                  <span>{sealed ? <>Sealed · sending to {hidden ? "them" : <Private>{first(x.who)}</Private>}</> : x.said ? "Drafted · in your voice" : "Drafted ahead · in your voice"}</span>
                  {focus && !sealed && (
                    <>
                      {x.line === "email" && (
                        <a href={gmailHref(x.id)} target="_blank" rel="noopener noreferrer">
                          Open in Gmail
                        </a>
                      )}
                      <button type="button" onClick={() => t.done(x)}>
                        Done
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="cx-quiet">{focus ? "Say what to tell them, or skip." : "Waiting for your words."}</p>
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
                        Yes <kbd>Y</kbd>
                      </button>
                    )}
                    <button type="button" className="cx-opt" onClick={() => t.say("no")}>
                      No <kbd>N</kbd>
                    </button>
                    <button type="button" className="cx-opt" onClick={() => t.say("change")}>
                      Change it
                    </button>
                  </>
                ) : (
                  <>
                    <p>Send it from Gmail?</p>
                    <CopyLink text={x.draft} />
                    <a className="cx-opt is-yes" href={gmailHref(x.id)} target="_blank" rel="noopener noreferrer">
                      Open in Gmail
                    </a>
                    <button type="button" className="cx-opt" onClick={() => t.say("no")}>
                      No <kbd>N</kbd>
                    </button>
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
  const voice = useVoice((l) => void t.line(l));
  const [typed, setTyped] = useState("");
  const [back] = useState(() => takeGmailReturn());
  const style = useEmail((s) => s.view?.style ?? null);
  const traits = style?.traits ?? null;
  const [passOn, setPassOn] = useState(0);
  const run = useRef(0);
  fx.current.listening = voice.listening;
  fx.current.loud = voice.tail ? 1 : 0;

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

  /** Your draft climbs from the ear and the quill writes it in, after the passes tick one by one. */
  const writeDraft = useCallback(async (el: HTMLElement, id: number) => {
    const s = sg.current;
    const d = el.querySelector<HTMLElement>(".cx-draft");
    if (!s || !d) return;
    ghost(d, !s.reduced);
    const n = el.querySelectorAll(".cx-pass span:not(.cx-lam)").length;
    for (let i = 1; i <= n; i++) {
      if (run.current !== id) return;
      setPassOn(i);
      if (!s.reduced) await sleep(220);
    }
    if (run.current !== id || !earRef.current) return;
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
    setPassOn(0);
    const old = entryOf(prev);
    const el = entryOf(key);
    fx.current.lit = el?.querySelector(".cx-them") ?? null;
    fx.current.to = el ? 1 : 0;
    if (hidden) {
      setPassOn(99);
      return;
    }
    const X = spineX();
    if (old && !s.reduced) for (const p of old.querySelectorAll<HTMLElement>(PARTS)) void s.dissolve(p, { dur: 700, stagger: 200, to: (_i, _x, y) => [X + (rnd() - 0.5) * 8, y + (rnd() - 0.5) * 60] });
    if (!el) return;
    void (async () => {
      fx.current.rush = 1;
      const init = el.querySelector<HTMLElement>(".cx-init");
      const subj = el.querySelector<HTMLElement>(".cx-subj");
      const msg = el.querySelector<HTMLElement>(".cx-msg");
      for (const p of el.querySelectorAll<HTMLElement>(PARTS)) ghost(p, !s.reduced);
      // The illuminated initial gathers first, poured down the spine.
      if (init) void s.form(init, { gap: 3, size: 8, ltr: false, swirl: 120, dur: 1300, stagger: 300, glow: 0.3, from: () => [X + (rnd() - 0.5) * 6, -10 - rnd() * 140] });
      if (!s.reduced) await sleep(380);
      if (run.current !== id) return;
      const vb = s.rel(el.querySelector(".cx-them") ?? el);
      const top = (): [number, number] => [X + (rnd() - 0.5) * 4, Math.max(0, vb.y - 20 - rnd() * 160)];
      if (subj) void s.form(subj, { from: top, path: quill(X), dur: 1000, stagger: 700, jitter: 80, max: 300 });
      if (msg) await s.form(msg, { from: top, path: quill(X), dur: 1100, stagger: 1100, jitter: 90, max: 620, pre: 0 });
      if (run.current !== id) return;
      if (el.querySelector(".cx-draft")) await writeDraft(el, id);
      else setPassOn(99);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex?.key, engine]);

  // A new draft on the entry in focus (from your words): the passes tick, then it climbs from the ear.
  useLayoutEffect(() => {
    const d = ex?.draft ?? null;
    if (!ex || shown.current !== ex.key || d === draftShown.current || phase === "drafting") return;
    draftShown.current = d;
    if (!d || hidden) {
      setPassOn(99);
      return;
    }
    const el = entryOf(ex.key);
    const id = ++run.current;
    setPassOn(0);
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

  // Keys: Y yes, N no, S skip, Z undo, L later; J and K move through the codex; hold Space to talk. Never while typing.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        if (!voice.supported) return;
        e.preventDefault();
        if (!e.repeat) voice.hold(true);
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
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && voice.supported && !typing(e)) voice.hold(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [t, voice, ex?.key, goTo]);

  const submit = (raw: string) => {
    const r = t.line(raw);
    voice.setHeard(raw);
    if (r.ok) setTyped("");
  };

  const m = t.metrics;
  const prevM = useRef(m);
  const bumped = (k: keyof typeof m) => prevM.current[k] !== null && m[k] !== null && prevM.current[k] !== m[k];
  useEffect(() => {
    const id = window.setTimeout(() => (prevM.current = m), 900);
    return () => window.clearTimeout(id);
  });
  const num = (v: number | null) => (v === null ? "—" : v.toLocaleString());
  const rest = t.queue ? t.queue.filter((x) => x.key !== ex?.key).slice(0, 5) : [];

  return (
    <div className="cx" data-phase={phase} data-still={engine?.reduced || undefined}>
      <section className="cx-stage" ref={stageRef} aria-label="Relay at a glance">
        <header className="cx-top">
          <h1 className="cx-mark">
            <b>Relay</b>
            <span>C.E.O.</span>
          </h1>
          <a href="#cx-codex">Open the codex ↓</a>
        </header>

        <nav className="cx-index" aria-label="The margin index">
          {rest.length > 0 && (
            <>
              <h4>Waiting</h4>
              {rest.map((x) => (
                <button type="button" className="cx-i" key={x.key} onClick={() => goTo(x.key)}>
                  <Private>{first(x.who)}</Private>
                  <em>{x.draft ? "drafted" : agoShort(now - x.at)}</em>
                </button>
              ))}
            </>
          )}
          {t.sentList.length > 0 && (
            <>
              <span className="cx-gap" />
              <h4>Sent today</h4>
              {t.sentList.slice(0, 2).map((s) => (
                <span className="cx-i is-sent" key={`${s.key}${s.at}`}>
                  <Private>{first(s.who)}</Private>
                  <em>{clock(s.at)}</em>
                </span>
              ))}
            </>
          )}
        </nav>

        <div className="cx-pages" ref={pagesRef} tabIndex={-1}>
          {t.queue && t.queue.length > 0 ? t.queue.map((x) => <Entry key={x.key} x={x} focus={x.key === ex?.key} now={now} t={t} passes={passesOf(x, traits)} passOn={passOn} />) : <Waiting signedIn={t.signedIn} waiting={m.waiting} />}
        </div>

        <div className="cx-dock">
          <div className="cx-dl">
            <span className="cx-labrow">
              {voice.supported && (
                <button type="button" className="cx-listen" aria-pressed={voice.mode === "on"} onClick={() => voice.turn(voice.mode !== "on")}>
                  {voice.mode === "on" ? "Stop listening" : "Listen hands-free"}
                </button>
              )}
              <span className="cx-lab">{!voice.supported ? "Type" : voice.mode === "on" ? "Listening" : voice.mode === "hold" ? "Listening while you hold Space" : "Not listening"}</span>
            </span>
            <span className="cx-heard" data-private="" data-loud={!!voice.tail || undefined}>
              {voice.tail || voice.heard}
            </span>
            {ex && (phase === "incoming" || phase === "ask") && (
              <form
                className="cx-type"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typed.trim()) submit(typed);
                }}
              >
                <label className="cx-sr" htmlFor="cx-words">
                  Reply in a few words, or a command
                </label>
                <input id="cx-words" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={phase === "ask" ? "or say what to write instead" : "tell them I'll be 10 late"} autoComplete="off" maxLength={400} data-private="" />
                <button type="submit" disabled={!typed.trim()}>
                  Draft it
                </button>
              </form>
            )}
            {t.offered.length > 0 && (
              <span className="cx-say">
                {t.offered.map((c) => (
                  <span key={c}>{CMD_WORDS[c]}</span>
                ))}
              </span>
            )}
            <span className="cx-keys">
              <b>Y</b> yes · <b>N</b> no · <b>S</b> skip · <b>Z</b> undo · <b>J K</b> move
              {voice.supported ? (
                <>
                  {" "}
                  · hold <b>Space</b> to talk
                </>
              ) : null}
            </span>
            {voice.error && <span className="cx-warn">{voice.error}</span>}
          </div>
          <div className="cx-dr">
            <UndoLine n={t.notice} now={now} sg={engine} />
            <dl className="cx-metrics" aria-label="Today">
              {(
                [
                  ["waiting", "waiting", " on you"],
                  ["drafted", "drafted", ""],
                  ["sent", "sent", " today"],
                  ["filtered", "filtered", ""],
                ] as const
              ).map(([k, w, lg]) => (
                <div key={k}>
                  <dd data-bump={bumped(k) || undefined}>{num(m[k])}</dd>
                  <dt>
                    {w}
                    {lg && <span className="cx-lg">{lg}</span>}
                  </dt>
                </div>
              ))}
            </dl>
          </div>
          <span className="cx-ear" ref={earRef} data-on={voice.listening || undefined} aria-hidden="true" />
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

/** Open the codex: the dashboard. Pending, waiting longest, high priority; then the rules Relay keeps. */
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
  const p = pendingOf(t.queue, now, { email: gmailOn ? status.needsYou : null, texts: textsOn ? textsStatus.owed : null });
  const num = (v: number | null) => (v === null ? "—" : v.toLocaleString());
  const total = p.email === null && p.texts === null ? null : (p.email ?? 0) + (p.texts ?? 0);

  return (
    <section className="cx-all" id="cx-codex" aria-label="The codex">
      <div className="cx-verse">
        <div className="cx-mar">
          <h2>The codex</h2>
        </div>
        <div className="cx-body">
          <p className="cx-sub">What waits on you, who has waited longest, and what shouldn't wait. Then the rules Relay keeps.</p>
          {back && <p className="cx-note">{RETURN_TEXT[back]}</p>}
          {error && <p className="cx-warn">{error}</p>}
        </div>
      </div>

      <div className="cx-verse cx-sec">
        <div className="cx-mar">
          <span className="cx-lab">Pending</span>
        </div>
        <div className="cx-body">
          <dl className="cx-counts">
            <div>
              <dd>{num(total)}</dd>
              <dt>waiting on you</dt>
            </div>
            <div>
              <dd>{num(p.texts)}</dd>
              <dt>texts</dt>
            </div>
            <div>
              <dd>{num(p.email)}</dd>
              <dt>email</dt>
            </div>
          </dl>
          {!t.signedIn && <p className="cx-note">Counts only until you sign in.</p>}
        </div>
      </div>

      {t.queue && (
        <>
          <div className="cx-verse cx-sec">
            <div className="cx-mar">
              <span className="cx-lab">Waiting longest</span>
            </div>
            <div className="cx-body">
              {p.longest.length ? (
                <ol className="cx-rows">
                  {p.longest.map(({ ex: x, waited }) => (
                    <li key={x.key} data-cur={x.key === ex?.key || undefined}>
                      <button type="button" onClick={() => goTo(x.key)}>
                        <Private as="b">{x.who}</Private>
                        <Private className="cx-what">{x.line === "email" ? x.subject : x.body}</Private>
                        <em>
                          {x.line === "email" ? "email" : "text"} · {agoShort(waited)}
                        </em>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="cx-quiet">Nothing waiting. Quiet is the point.</p>
              )}
            </div>
          </div>

          <div className="cx-verse cx-sec">
            <div className="cx-mar">
              <span className="cx-lab">High priority</span>
            </div>
            <div className="cx-body">
              {p.high.length ? (
                <ol className="cx-rows">
                  {p.high.map(({ ex: x, why }) => (
                    <li key={x.key} data-cur={x.key === ex?.key || undefined}>
                      <button type="button" onClick={() => goTo(x.key)}>
                        <Private as="b">{x.who}</Private>
                        <Private className="cx-what">{x.line === "email" ? x.subject : x.body}</Private>
                        <em>{why.map((w) => (w === "overdue" ? `waiting ${agoShort(now - x.at)}` : WHY[w])).join(" · ")}</em>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="cx-quiet">Nothing urgent. This lists what needs you, what a texter wants sooner, and anything waiting past a day.</p>
              )}
            </div>
          </div>
        </>
      )}

      <div className="cx-verse cx-sec">
        <div className="cx-mar">
          <span className="cx-lab">Marginalia</span>
        </div>
        <div className="cx-body cx-wide">
          <div className="cx-cols">
            <div>
              <h3>{ex && !t.hidden ? <Private>{ex.who}</Private> : "The sender in focus"}</h3>
              {ex?.line === "email" ? (
                <>
                  <div className="cx-row">
                    <button type="button" className="cx-lnk" onClick={() => t.say("filter")}>
                      Filter these out
                    </button>
                    <span>their whole domain · or say it</span>
                  </div>
                  <div className="cx-row">
                    <button type="button" className="cx-lnk is-danger" onClick={() => t.say("block")}>
                      Block this sender
                    </button>
                    <span>this address · or say it</span>
                  </div>
                </>
              ) : ex ? (
                <>
                  <div className="cx-row">
                    Filter or block a texter<span className="cx-coming">coming: the Mac hub's skip list</span>
                  </div>
                  <div className="cx-row">
                    Later<span>say “later” · back at the next nudge</span>
                  </div>
                </>
              ) : (
                <p className="cx-quiet">No one in focus.</p>
              )}
              <h3 className="cx-h3gap">Filter rules</h3>
              {rules.map((r) => (
                <div className="cx-row" key={r.id}>
                  <span>
                    {r.kind === "block" ? "Blocked " : "Filtered "}
                    <Private>{r.label}</Private>
                  </span>
                  <span>
                    <button type="button" className="cx-lnk" onClick={() => void useEmail.getState().unrule(r.id)}>
                      {r.kind === "block" ? "Unblock" : "Undo"}
                    </button>
                  </span>
                </div>
              ))}
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
              <div className="cx-row">
                Send without asking<span className="cx-off">never</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {!textsView?.paired && <TextsSection now={now} />}
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
