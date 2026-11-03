import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { Private } from "../Private.tsx";
import { useHide } from "../hide.ts";
import { useDeskAuth } from "../signin.ts";
import { gmailHref } from "../email/EmailSection.tsx";
import { takeGmailReturn, useEmail } from "../email/email.ts";
import { useTexts } from "../texts/texts.ts";
import { TextsSection } from "../texts/TextsSection.tsx";
import { SigilStage } from "./sigils.ts";
import { agoShort, askLine, initialOf, lastRequest, type Command } from "./thread.ts";
import { errorText, useThread, type Notice } from "./useThread.ts";
import { useVoice } from "./voice.ts";
import "./thread.css";

/**
 * Relay's Thread (#615): the Desk's Relay page as one exchange at a time. What came in forms out of sigils, Nikita
 * answers in a few words (said or typed), Blasto's draft forms under it, "Send to X?", and yes sends with a five-second
 * undo. Below the stage, everything opened up: the queue, the whole exchange, the sender's controls, how he writes, the
 * filter rules and the two lines' setup.
 *
 * This file only draws: the queue, the state machine and the gate live in ./useThread.ts and ./thread.ts, the glyph
 * engine in ./sigils.ts, listening in ./voice.ts. Every word of mail or text is wrapped in <Private> for Hide mode, and
 * only the signed-in passkey session ever has any; signed out, the page shows counts and states.
 */

const CMD_WORDS: Record<Command, string> = { yes: "yes", no: "no", change: "change it", skip: "skip", later: "later", filter: "filter these out", block: "block this sender", undo: "undo", words: "" };

function Countdown({ until, now }: { until: number; now: number }) {
  return <b className="rt-n">{Math.max(0, Math.ceil((until - now) / 1000))}</b>;
}

function Toast({ n, now }: { n: Notice | null; now: number }) {
  const live = !!n && now - n.at < (n.kind === "undo" ? 6_000 : n.kind === "rule" ? 12_000 : 6_000);
  return (
    <div className="rt-toast" data-on={live || undefined} data-kind={n?.kind} role="status" aria-live="polite">
      {live && n && (
        <>
          <i className="rt-dot" aria-hidden="true" />
          <span>
            {n.text}
            {n.kind === "undo" && n.until && (
              <>
                {" "}
                in <Countdown until={n.until} now={now} />
              </>
            )}
          </span>
          {n.kind === "undo" && n.until && (
            <span className="rt-bar" aria-hidden="true">
              <i style={{ animationDuration: `${Math.max(0, n.until - n.at)}ms` }} />
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

function CopyButton({ text, label = "Copy draft" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rt-btn"
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
      {done ? "Copied" : label}
    </button>
  );
}

/** Where the page's words come from when there is no exchange: signed out, a line not connected, or nothing waiting. */
function Waiting({ signedIn, waiting }: { signedIn: boolean; waiting: number | null }) {
  const emailLoad = useEmail((s) => s.load);
  const emailStatus = useEmail((s) => s.status);
  const textsStatus = useTexts((s) => s.status);
  const textsView = useTexts((s) => s.view);
  const emailView = useEmail((s) => s.view);
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
    p = "Connect Gmail or pair the MacBook below, and what needs you comes through here, one at a time.";
  } else if (!signedIn) {
    h = waiting ? `${waiting} waiting on you.` : "Nothing waiting on you.";
    p = "Who they are, what they said and Blasto's drafts show only when you sign in.";
  } else if (!textsView && !emailView) {
    h = "Reading…";
    p = "";
  } else {
    h = "Nothing waiting on you.";
    p = "Dialtone sorts each new mail and text as it lands. Anything that needs you forms here.";
  }
  return (
    <div className="rt-wait">
      <p className="rt-wait-h">{h}</p>
      {p && <p className="rt-wait-p">{p}</p>}
      {!signedIn && auth === "out" && (gmailOn || textsOn) && (
        <button type="button" className="rt-btn is-yes" onClick={() => void signIn()}>
          Sign in
        </button>
      )}
    </div>
  );
}

export function RelayThread({ now }: { now: number }) {
  const t = useThread(now);
  const { ex, phase } = t;
  const hidden = useHide((s) => s.on);
  const voice = useVoice((l) => void t.line(l));
  const [typed, setTyped] = useState("");
  const stageRef = useRef<HTMLElement>(null);
  const sg = useRef<SigilStage | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const subjRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLSpanElement>(null);
  const [back] = useState(() => takeGmailReturn());

  useEffect(() => {
    if (!stageRef.current) return;
    const s = new SigilStage(stageRef.current, { ambient: 46 });
    sg.current = s;
    (window as unknown as { __relaySigils?: SigilStage }).__relaySigils = s;
    return () => s.destroy();
  }, []);

  // A new exchange on screen: what they said forms out of sigils, streaming in from the left. Never while Hide is on.
  useLayoutEffect(() => {
    const s = sg.current;
    const body = bodyRef.current;
    if (!s || !body || !ex || hidden) return;
    const from = (_i: number, _x: number, y: number) => [-30 - Math.random() * 200, y + (Math.random() - 0.5) * 240] as [number, number];
    if (subjRef.current) void s.form(subjRef.current, { from, stagger: 420 });
    void s.form(body, { from, dur: 1000, stagger: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex?.key]);

  // A new draft: it forms up out of the listening wave.
  const draftText = ex?.draft ?? null;
  useLayoutEffect(() => {
    const s = sg.current;
    const d = draftRef.current;
    if (!s || !d || !draftText || hidden) return;
    const w = waveRef.current ? s.rel(waveRef.current) : null;
    void s.form(d, { ink: "light", dur: 1100, stagger: 700, from: w ? () => [w.cx + (Math.random() - 0.5) * 150, w.cy - 20 + (Math.random() - 0.5) * 40] : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftText, ex?.key]);

  // The send leaves in a spray of sigils.
  useEffect(() => {
    if (phase !== "undo" || !draftRef.current || !sg.current) return;
    const r = sg.current.rel(draftRef.current);
    sg.current.burst(r.x + r.w, r.y, { n: 90, ang: -Math.PI / 3, spread: 1, dist: 220, ink: "light" });
  }, [phase]);

  // Keys: Y yes, N no, S skip, Z undo, L later; hold Space to talk. Never while typing.
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
  }, [t, voice]);

  const send = (raw: string) => {
    const r = t.line(raw);
    voice.setHeard(raw);
    if (r.ok) setTyped("");
  };

  const m = t.metrics;
  const num = (v: number | null) => (v === null ? "—" : v.toLocaleString());
  const said = ex?.said || "";
  const draftNote = !ex?.draft ? "" : said ? "Drafted from your words · in your voice" : "Drafted ahead · in your voice";
  const textsView = useTexts((s) => s.view);
  const req = ex?.line === "text" ? lastRequest(textsView?.requests, ex.id) : undefined;

  return (
    <div className="rt" data-phase={phase}>
      <section className="rt-stage" ref={stageRef} aria-label="Relay at a glance">
        <header className="rt-top">
          <h1 className="rt-logo">
            <i aria-hidden="true" />
            Relay <span>· C.E.O.</span>
          </h1>
          <a className="rt-open" href="#rt-all">
            Open everything ↓
          </a>
        </header>

        {t.queue && t.queue.length > 0 && (
          <ol className="rt-rail" aria-label="Waiting on you">
            {t.queue.slice(0, 7).map((x) => (
              <li key={x.key} data-now={x.key === ex?.key || undefined}>
                <button type="button" onClick={() => t.pick(x.key)}>
                  <span className="rt-av" aria-hidden="true">
                    {hidden ? "·" : initialOf(x.who)}
                  </span>
                  <span>
                    <Private>{x.who}</Private>
                    <small>
                      {x.line === "email" ? "email" : "text"} · {agoShort(now - x.at)}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="rt-col">
          {ex ? (
            <article className="rt-conv" key={ex.key} aria-label={`From ${hidden ? "someone" : ex.who}`}>
              <div className="rt-head">
                <span className="rt-av" aria-hidden="true">
                  {hidden ? "·" : initialOf(ex.who)}
                </span>
                <Private as="b">{ex.who}</Private>
                <span className="rt-chip" data-mail={ex.line === "email" || undefined}>
                  {ex.channel} · {agoShort(now - ex.at)}
                </span>
              </div>
              <div className="rt-in">
                {ex.line === "email" && (
                  <>
                    <p className="rt-from">
                      <Private>{ex.who}</Private> → you
                    </p>
                    <div className="rt-subj" ref={subjRef}>
                      <Private>{ex.subject}</Private>
                    </div>
                  </>
                )}
                <div className="rt-body" ref={bodyRef}>
                  <Private>{ex.body || "No summary yet: the agent hasn't read this one."}</Private>
                </div>
                {ex.line === "text" && <p className="rt-gist-note">Dialtone's gist · the text itself stays on your Mac</p>}
              </div>

              {said && (
                <p className="rt-said">
                  you said <q><Private>{said}</Private></q>
                </p>
              )}

              {phase === "drafting" && <p className="rt-drafting">Blasto is writing it in your voice…</p>}

              {ex.draft && (
                <>
                  <div className="rt-draft" ref={draftRef} data-sending={phase === "undo" || undefined}>
                    <Private>{ex.draft}</Private>
                  </div>
                  <p className="rt-tag">{phase === "undo" ? "Sending…" : draftNote}</p>
                </>
              )}

              {phase === "ask" && ex.draft && (
                <div className="rt-ask">
                  {ex.sendable ? (
                    <>
                      <p>{hidden ? "Send it?" : askLine(ex)}</p>
                      {t.unlocked ? (
                        <button type="button" className="rt-btn is-yes" onClick={() => t.say("yes")}>
                          Yes <kbd>Y</kbd>
                        </button>
                      ) : (
                        <button type="button" className="rt-btn is-yes" onClick={() => void useTexts.getState().unlock()} title="One passkey check unlocks sending on this device for 72 hours">
                          Unlock to send
                        </button>
                      )}
                      <button type="button" className="rt-btn" onClick={() => t.say("no")}>
                        No <kbd>N</kbd>
                      </button>
                      <button type="button" className="rt-btn" onClick={() => t.say("change")}>
                        Change it
                      </button>
                    </>
                  ) : (
                    <>
                      <p>Email sends from Gmail for now.</p>
                      <CopyButton text={ex.draft} />
                      <a className="rt-btn" href={gmailHref(ex.id)} target="_blank" rel="noopener noreferrer">
                        Open in Gmail
                      </a>
                      <button type="button" className="rt-btn" onClick={() => t.say("no")}>
                        No <kbd>N</kbd>
                      </button>
                      <span className="rt-coming" title="Gmail is connected read-only; sending from Relay needs Nikita's go-ahead on a send scope">
                        sending email from here · coming
                      </span>
                    </>
                  )}
                </div>
              )}
              {req && ex.line === "text" && (req.state === "expired" || req.state === "failed" || req.state === "refused") && req.kind === "send" && <p className="rt-warn">The last send didn't go: {req.state === "expired" ? "the Mac was offline." : req.state === "failed" ? "it may have sent, check Messages." : "the Mac refused it."}</p>}

              {(phase === "incoming" || phase === "ask") && (
                <form
                  className="rt-reply"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (typed.trim()) send(typed);
                  }}
                >
                  <label className="rt-sr" htmlFor="rt-words">
                    Reply in a few words, or a command
                  </label>
                  <input id="rt-words" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={phase === "ask" ? "Change it: say what to write instead" : "Reply in a few words: “tell them I'll be 10 late”"} autoComplete="off" maxLength={400} data-private="" />
                  <button type="submit" className="rt-btn" disabled={!typed.trim()}>
                    Draft it
                  </button>
                </form>
              )}
            </article>
          ) : (
            <Waiting signedIn={t.signedIn} waiting={m.waiting} />
          )}
        </div>

        <div className="rt-dock">
          <Toast n={t.notice} now={now} />
          <div className="rt-listen">
            <span className="rt-wave" ref={waveRef} data-on={voice.listening || undefined} data-loud={!!voice.tail || undefined} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            {voice.supported ? (
              <>
                <span>{voice.mode === "on" ? "Listening, heard" : voice.mode === "hold" ? "Listening while you hold Space, heard" : "Not listening"}</span>
                <span className="rt-heard" data-private="">
                  {voice.tail || voice.heard}
                </span>
                <button type="button" className="rt-link" aria-pressed={voice.mode === "on"} onClick={() => voice.turn(voice.mode !== "on")}>
                  {voice.mode === "on" ? "Stop listening" : "Listen hands-free"}
                </button>
              </>
            ) : (
              <span>This browser can't listen. Type a few words, or use the keys.</span>
            )}
            {voice.error && <span className="rt-warn">{voice.error}</span>}
          </div>
          {t.offered.length > 0 && (
            <div className="rt-listen">
              <span>Say</span>
              <span className="rt-cmds">
                {t.offered.map((c) => (
                  <span key={c}>{CMD_WORDS[c]}</span>
                ))}
              </span>
              <span className="rt-keys">· Y yes · N no · S skip · Z undo{voice.supported ? " · hold Space to talk" : ""}</span>
            </div>
          )}
          <dl className="rt-metrics" aria-label="Today">
            <div>
              <dd>{num(m.waiting)}</dd>
              <dt>
                waiting<span className="rt-lg"> on you</span>
              </dt>
            </div>
            <div>
              <dd>{num(m.drafted)}</dd>
              <dt>drafted</dt>
            </div>
            <div>
              <dd>{num(m.sent)}</dd>
              <dt>
                sent<span className="rt-lg"> today</span>
              </dt>
            </div>
            <div>
              <dd>{num(m.filtered)}</dd>
              <dt>filtered</dt>
            </div>
          </dl>
        </div>
      </section>

      <Everything now={now} t={t} back={back} />
    </div>
  );
}

const RETURN_TEXT: Record<string, string> = {
  connected: "Gmail is connected. Dialtone catches up on unread mail from the last two days, then watches new mail.",
  cancelled: "Connect Gmail was cancelled at Google. Nothing was connected.",
  refused: "That Connect Gmail link didn't match this session. Try again from here.",
  failed: "Google didn't hand over access. Try Connect Gmail again.",
};

function Everything({ now, t, back }: { now: number; t: ReturnType<typeof useThread>; back: string | null }) {
  const ex = t.ex;
  const hidden = useHide((s) => s.on);
  const view = useEmail((s) => s.view);
  const status = useEmail((s) => s.status);
  const busy = useEmail((s) => s.busy);
  const error = useEmail((s) => s.error);
  const textsView = useTexts((s) => s.view);
  const lock = useTexts((s) => s.lock);
  const unlock = useTexts((s) => s.unlock);
  const [learning, setLearning] = useState<string | null>(null);
  const rules = view?.rules ?? [];
  const style = view?.style ?? null;

  return (
    <section className="rt-all" id="rt-all" aria-label="Everything, opened up">
      <h2>Everything, opened up</h2>
      <p className="rt-sub">The whole queue, the whole exchange, the sender's controls, how you write, and the filter rules. Tap a name to put it on screen.</p>
      {back && <p className="rt-note">{RETURN_TEXT[back]}</p>}
      {error && <p className="rt-warn">{error}</p>}
      <div className="rt-grid">
        <div className="rt-card">
          <h3>Waiting on you · {t.queue ? t.queue.length : (t.metrics.waiting ?? "—")}</h3>
          {t.queue ? (
            t.queue.length ? (
              <ul className="rt-ql">
                {t.queue.map((x) => (
                  <li key={x.key} data-cur={x.key === ex?.key || undefined}>
                    <button type="button" onClick={() => t.pick(x.key)}>
                      <span className="rt-av" aria-hidden="true">
                        {hidden ? "·" : initialOf(x.who)}
                      </span>
                      <span className="rt-ql-w">
                        <Private as="b">{x.who}</Private>
                        <Private className="rt-ql-s">{x.line === "email" ? `Email · ${x.subject}` : x.body}</Private>
                      </span>
                      <em>{x.draft ? "drafted" : agoShort(now - x.at)}</em>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rt-note">Nothing waiting. Quiet is the point.</p>
            )
          ) : (
            <p className="rt-note">{t.signedIn ? "Reading…" : "Counts only until you sign in."}</p>
          )}
        </div>

        <div className="rt-card rt-thc">
          <h3>{ex ? <>{hidden ? "This exchange" : <Private>{ex.who}</Private>} · {ex.line === "email" ? "email" : "texts"}</> : "The exchange"}</h3>
          {ex ? (
            <div className="rt-th">
              {ex.line === "email" ? (
                <>
                  <p className="rt-k">Subject</p>
                  <Private as="p">{ex.subject}</Private>
                  <p className="rt-k">Dialtone's summary</p>
                  <Private as="p">{ex.body}</Private>
                  {ex.action && (
                    <>
                      <p className="rt-k">Dialtone suggests</p>
                      <Private as="p">{ex.action}</Private>
                    </>
                  )}
                  {ex.advice && (
                    <>
                      <p className="rt-k">Blasto's advice</p>
                      <Private as="p">{ex.advice}</Private>
                    </>
                  )}
                  <p className="rt-note">The mail itself stays in Gmail: Relay keeps the sender, the subject and the agents' notes, a week at most.</p>
                </>
              ) : (
                <>
                  <p className="rt-k">What they want</p>
                  <Private as="p">{ex.body}</Private>
                  <p className="rt-note">The texts themselves never leave your Mac: the hub sends who, when, Dialtone's gist and Blasto's draft.</p>
                </>
              )}
              {ex.draft && (
                <>
                  <p className="rt-k">{ex.said ? `Drafted from “${hidden ? "…" : ex.said}” · not sent` : "Blasto's draft · not sent"}</p>
                  <Private block as="p">
                    {ex.draft}
                  </Private>
                </>
              )}
              <div className="rt-do">
                {ex.line === "email" && (
                  <a className="rt-btn" href={gmailHref(ex.id)} target="_blank" rel="noopener noreferrer">
                    Open in Gmail
                  </a>
                )}
                <button type="button" className="rt-btn" onClick={() => t.done(ex)}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <p className="rt-note">Nothing on screen.</p>
          )}
        </div>

        <div className="rt-side">
          <div className="rt-card">
            <h3>{ex ? (hidden ? "This sender" : <Private>{ex.who}</Private>) : "The sender"}</h3>
            {ex?.line === "email" ? (
              <>
                <div className="rt-row">
                  <button type="button" className="rt-link" onClick={() => t.say("filter")}>
                    Filter these out
                  </button>
                  <span>their whole domain · say “filter these out”</span>
                </div>
                <div className="rt-row">
                  <button type="button" className="rt-link is-danger" onClick={() => t.say("block")}>
                    Block this sender
                  </button>
                  <span>this address · say “block this sender”</span>
                </div>
              </>
            ) : ex ? (
              <>
                <div className="rt-row">
                  Filter or block a texter<span className="rt-coming">coming: the Mac hub's skip list</span>
                </div>
                <div className="rt-row">
                  Later<span>say “later” · back at the next nudge</span>
                </div>
              </>
            ) : (
              <p className="rt-note">Waiting for someone to be on screen.</p>
            )}
          </div>

          <div className="rt-card">
            <h3>How you write</h3>
            {style ? (
              <div className="rt-chips">
                {style.traits.map((s, i) => (
                  <span key={s} data-hi={i === 0 || undefined}>
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="rt-note">{view ? "Not learned yet from your email." : "Waiting for Gmail."}</p>
            )}
            <p className="rt-ex">
              {style ? `Learned from ${style.from} sent emails. ` : ""}Texts learn from your past replies to each person, on the Mac.{" "}
              {view && status?.gmail === "connected" && (
                <button
                  type="button"
                  className="rt-link"
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
            {learning && learning !== "busy" && <p className="rt-warn">{learning}</p>}
          </div>

          <div className="rt-card">
            <h3>Filter rules</h3>
            {rules.map((r) => (
              <div className="rt-row" key={r.id}>
                <span className="rt-row-l">
                  {r.kind === "block" ? "Blocked: " : "Filtered: "}
                  <Private>{r.label}</Private>
                </span>
                <span>
                  <button type="button" className="rt-link" onClick={() => void useEmail.getState().unrule(r.id)}>
                    {r.kind === "block" ? "Unblock" : "Undo"}
                  </button>
                </span>
              </div>
            ))}
            {view && view.ruled > 0 && (
              <div className="rt-row">
                Filtered by your rules today<span>{view.ruled}</span>
              </div>
            )}
            <div className="rt-row">
              Money, bills, payments, legal<span>never shown · {status ? `${status.skipped} today` : "kept out"}</span>
            </div>
            <div className="rt-row">
              Promotions and noise<span>{status ? `${status.noise} handled today` : "handled without you"}</span>
            </div>
            {view && view.urgentSkipped > 0 && <p className="rt-warn">{view.urgentSkipped} urgent money or legal {view.urgentSkipped === 1 ? "alert" : "alerts"} skipped; check those accounts directly.</p>}
          </div>

          <div className="rt-card">
            <h3>The lines</h3>
            <GmailLine busy={busy} />
            <div className="rt-row">
              Texts sending
              <span>
                {textsView?.paired ? (
                  t.unlocked ? (
                    <button type="button" className="rt-link" onClick={() => void lock()}>
                      Unlocked here · Lock
                    </button>
                  ) : (
                    <button type="button" className="rt-link" onClick={() => void unlock()}>
                      Locked · Unlock for 72 h
                    </button>
                  )
                ) : (
                  "waiting on the MacBook"
                )}
              </span>
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
  const state = load === "off" ? "on the Azure copy" : !status ? "reading…" : status.gmail === "connected" ? (status.agent === "paused" ? "paused at the monthly cap" : status.agent === "error" ? "the last check failed" : "live, read-only") : status.gmail === "refused" ? "needs reconnecting" : "waiting to connect";
  return (
    <div className="rt-row">
      Gmail
      <span>
        {state}
        {view && status?.gmail === "connected" ? (
          <>
            {" · "}
            <button type="button" className="rt-link" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </>
        ) : view ? (
          <>
            {" · "}
            <button type="button" className="rt-link" disabled={!view.canConnect || busy} onClick={() => void connect()} title={view.canConnect ? "Opens Google's consent page" : "Waiting for the Gmail keys on Azure"}>
              {status?.gmail === "refused" ? "Reconnect" : "Connect"}
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}

