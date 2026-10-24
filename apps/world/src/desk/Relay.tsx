import { useEffect, useMemo, useRef, useState } from "react";
import { averageReply, byWait, formatWait, nextNudge, OVERDUE_MS, useDesk, type DeskData } from "./deskData.ts";
import { useMasked } from "./hide.ts";
import { EmailSection } from "./email/EmailSection.tsx";
import { startEmail, useEmail, type EmailLoad, type EmailStatus } from "./email/email.ts";
import { Allowance, flowOf, Switchboard } from "./relay/Switchboard.tsx";
import { Private } from "./Private.tsx";
import { RoomBanner } from "./RoomBanner.tsx";
import { Avatar, Panel } from "./ui.tsx";
import { Listening, NudgeClock, Outbox, ReplyStrip, Streak, waitTone } from "./viz.tsx";
import { isPhone, knot, Parts, Poly, RC, ring, spr, useViz, type VizSpec } from "./wvCanvas.ts";

/** Relay: who you owe a reply, the ones to answer sooner first, each with Blasto's draft in your voice. */

const CHIPS = ["On my way", "Can I call you later?", "Love that", "Let me check and get back to you"];
const WAIT_SCALE = 12 * 3_600_000;

/** The chain Relay waits on (desk-concepts round five, "relaychain"): a dashed thread, the Mac's knot alive, the rest rings. */
function chainSpec(): VizSpec {
  let ks: { x: number; y: number }[] = [];
  let poly = new Poly();
  const P = new Parts(40, 0);
  return {
    lay(V) {
      const ph = isPhone(V.cv.parentElement);
      const lis = [...(V.cv.parentElement?.querySelectorAll(".wv-chain-l li") ?? [])];
      ks = lis.map((li) => {
        const r = V.rel(li);
        return ph ? { x: 22, y: r.y + 14 } : { x: r.x + r.w / 2, y: 35 };
      });
      if (ks.length < 2) return;
      const a = ks[0]!;
      const b = ks[ks.length - 1]!;
      poly = ph ? new Poly().set([22, 22], [a.y, b.y]) : new Poly().set([a.x, b.x], [35, 35]);
    },
    draw(_V, c, t) {
      if (ks.length < 2) return;
      const rgb = RC.relay!;
      c.globalAlpha = 1;
      c.strokeStyle = `rgba(${rgb},.45)`;
      c.lineWidth = 1;
      c.setLineDash([3, 5]);
      poly.stroke(c);
      c.setLineDash([]);
      const k0 = ks[0]!;
      for (let i = 0; i < P.n; i++) {
        const r = 10 + Math.abs(P.o[i]!) * 14;
        const a = P.p[i]! + t * 0.6 * (i % 2 ? 1 : -1);
        c.globalAlpha = 0.3 + 0.45 * P.z[i]!;
        const sz = 1 + P.z[i]! * 1.8;
        c.drawImage(spr(rgb), k0.x + Math.cos(a) * r - sz, k0.y + Math.sin(a) * r * 0.5 - sz, sz * 2, sz * 2);
      }
      ks.forEach((k, i) => (i === 0 ? knot(c, k.x, k.y, 0.6, t, rgb, 0.9) : ring(c, k.x, k.y, 5, rgb, 0.55, [2, 3])));
    },
  };
}

const CHAIN = [
  { b: "MacBook", s: "Awake, on power, online" },
  { b: "The hub", s: "Runs on the Mac, keeps messages there" },
  { b: "Messages", s: "Read and sent through BlueBubbles" },
  { b: "Dialtone and Blasto", s: "Sort, then draft" },
  { b: "You", s: "A tap to send" },
];

/** The page's headline, from the email agent's public state. */
function headOf(load: EmailLoad, status: EmailStatus | null): { lead: string; em: string; sub: string } {
  if (load === "off") return { lead: "Email lives on", em: "the Azure copy.", sub: "Dialtone and Blasto read your inbox there, where their keys are. Texts follow once the MacBook's hub is up." };
  if (!status) return { lead: "Relay is", em: load === "failed" ? "not answering." : "listening…", sub: "Who you owe a reply, the ones to answer sooner first, each with a draft in your voice." };
  if (status.gmail === "refused") return { lead: "Gmail needs", em: "reconnecting.", sub: "Google stopped accepting the connection; reconnect below and the line picks up where it left off." };
  if (status.gmail !== "connected" || status.agent === "waiting") return { lead: "Email is", em: "ready to connect.", sub: "Connect Gmail below and Dialtone starts sorting from the next new mail." };
  if (status.agent === "paused") return { lead: "Email is live,", em: "paused at the cap.", sub: "New mail is still counted; the models wait for the month to turn." };
  if (status.agent === "error") return { lead: "Email is live,", em: "one check missed.", sub: "Dialtone tries again every minute." };
  return { lead: "Email is", em: "live.", sub: "Dialtone sorts each new mail within a minute; Blasto drafts advice for the ones that need you." };
}

/** Relay's crew, with the words they live by (packages/simulator/src/cast.ts). */
const CREW = [
  { id: "static", name: "Static", role: "The Messenger · Relay's lead", line: "Didn't hear it from me. You heard it from me." },
  { id: "dialtone", name: "Dialtone", role: "Switchboard · sorts", line: "Please hold. Not you, darling." },
  { id: "postmaster", name: "Blasto", role: "Correspondence · drafts", line: "This one has read your message. This one has feelings about it." },
];

function Crew({ live }: { live: boolean }) {
  return (
    <section className="rl-crew" aria-label="Relay's crew">
      {CREW.map((c, i) => (
        <figure key={c.id} className="rl-mate" data-on={live && c.id !== "static" ? "" : undefined} style={{ "--i": i } as React.CSSProperties}>
          <img src={`/desk/agent-${c.id}.webp`} alt="" width={56} height={56} decoding="async" loading="lazy" />
          <figcaption>
            <b>{c.name}</b>
            <span>{c.role}</span>
            <q>{c.line}</q>
          </figcaption>
        </figure>
      ))}
    </section>
  );
}

/**
 * Before the hub is connected: email live from the Azure copy (#263, live since #322) on the switchboard, and the texts
 * line with the one thing it waits on. Real states only; no made-up messages.
 */
function RelayLater({ now }: { now: number }) {
  const spec = useMemo(() => chainSpec(), []);
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  useEffect(() => startEmail(), []);
  const load = useEmail((s) => s.load);
  const status = useEmail((s) => s.status);
  const head = headOf(load, status);
  const flow = flowOf(load, status);
  const live = flow === "live" || flow === "slow";
  return (
    <div className="relay-page wv-page wv-relay rl" data-room="relay" data-flow={flow}>
      <div className="rl-sky" aria-hidden="true" />
      <header className="wv-pghead rl-head">
        <p className="wv-eyb" style={{ color: "var(--rc-relay)" }}>
          Relay · the switchboard
        </p>
        <h1 className="wv-h1 desk__title">
          {head.lead} <em style={{ color: "var(--rc-relay)" }}>{head.em}</em>
        </h1>
        <p className="wv-sub">{head.sub}</p>
      </header>

      <Switchboard load={load} status={status} now={now} />

      <div className="rl-tiles">
        <Allowance pct={load === "live" && status && status.gmail === "connected" ? status.budgetPct : null} />
        <Crew live={live} />
      </div>

      <EmailSection now={now} />

      <section className="rl-texts" aria-label="What the texts line waits on">
        <header>
          <p className="wv-eyb">Texts</p>
          <h2>
            Waiting on <em>the MacBook.</em>
          </h2>
          <p>Once its hub is up, Relay keeps track of who you owe a reply and drafts answers in your voice for a tap to send.</p>
        </header>
        <div className="wv-chain">
          <canvas ref={cv} className="wv-cv" aria-hidden="true" />
          <ol className="wv-chain-l">
            {CHAIN.map((c) => (
              <li key={c.b}>
                <b>{c.b}</b>
                <span>{c.s}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <figure className="wv-relay-q">
        <img src="/desk/agent-postmaster.webp" alt="" width={62} height={62} decoding="async" />
        <blockquote>&ldquo;The letters are in, and this one has drafted for the ones that matter. The texts still wait for a laptop to wake up, which is a humbling thing to wait for.&rdquo;</blockquote>
        <figcaption>
          <b>Blasto</b>Relay's drafter
        </figcaption>
      </figure>
    </div>
  );
}

export function Relay({ data, now, connected }: { data: DeskData; now: number; connected: boolean }) {
  if (!connected) return <RelayLater now={now} />;
  return <RelayLive data={data} now={now} connected={connected} />;
}

function RelayLive({ data, now, connected }: { data: DeskData; now: number; connected: boolean }) {
  const owed = byWait(data.owed);
  const { picked, pick, send, later, setDraft } = useDesk();
  const current = owed.find((o) => o.id === picked) ?? null;
  const mask = useMasked();
  const canAct = connected;
  // Voice: what you said, then Blasto's light pass in your style. The words stream from OpenAI speech-to-text
  // through the hub and the styled version comes back from Blasto.
  const [heard, setHeard] = useState<Record<string, string>>({});
  const [voicePhase, setVoicePhase] = useState<"idle" | "listening" | "styling">("idle");
  const timers = useRef<number[]>([]);
  const speak = () => {
    if (!current?.voice || voicePhase !== "idle") return;
    const { id, voice } = current;
    const styled = current.draft ?? "";
    timers.current.forEach(clearTimeout);
    setVoicePhase("listening");
    setDraft(id, "");
    timers.current = [
      window.setTimeout(() => {
        setHeard((h) => ({ ...h, [id]: voice }));
        setVoicePhase("styling");
      }, 1400),
      window.setTimeout(() => {
        setDraft(id, styled);
        setVoicePhase("idle");
      }, 2400),
    ];
  };
  const said = current ? heard[current.id] : undefined;
  const micReady = canAct && !!current?.voice;
  const overdue = owed.filter((o) => now - o.since > OVERDUE_MS).length;
  const avg = averageReply(data.week);
  const next = nextNudge(data.nudges, now);
  const hhmm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

  const stats = [
    { label: "Owed", value: String(owed.length), tone: owed.length ? "var(--warn)" : "var(--ok)", fill: Math.min(1, owed.length / 10), cap: owed.length ? "waiting on you" : "all caught up" },
    { label: "Overdue", value: String(overdue), tone: overdue ? "var(--bad)" : "var(--ok)", fill: owed.length ? overdue / owed.length : 0, cap: `past ${OVERDUE_MS / 3_600_000}h` },
    { label: "Avg reply", value: avg === null ? "—" : formatWait(avg * 60_000), tone: "var(--ice)", fill: avg === null ? 0 : Math.min(1, avg / 240), cap: avg === null ? "no replies tracked" : "median, 7 days" },
    { label: "Sent today", value: String(data.sentToday), tone: "var(--room-relay)", fill: Math.min(1, data.sentToday / 20), cap: data.sentToday ? "replies out" : "nothing sent yet" },
  ];

  return (
    <div className="relay-page">
      <RoomBanner
        page="relay"
        lead="Who you owe a reply, the ones to answer sooner first, each with a draft in your voice."
        aside={
          <div className="page-head__crew" aria-label="Relay's agents">
            <Avatar agent="Dialtone" room="relay" />
            <Avatar agent="Blasto" room="relay" />
            <span>Dialtone keeps the list; Blasto drafts</span>
          </div>
        }
      />

      <section className="stats" aria-label="Relay at a glance">
        {stats.map((s) => (
          <div key={s.label} className="stat" style={{ "--tone": s.tone } as React.CSSProperties}>
            <span className="stat__label">{s.label}</span>
            <span className="stat__value">{s.value}</span>
            <span className="stat__bar" aria-hidden="true">
              <b style={{ width: `${Math.max(2, s.fill * 100)}%` }} />
            </span>
            <span className="stat__cap">{s.cap}</span>
          </div>
        ))}
      </section>

      <div className="relay">
        <div className="relay__left">
          <Panel eyebrow="Owed replies" aside={<span className="badge">{owed.length}</span>} className="panel--owed">
            {owed.length ? (
              <ul className="owed">
                {owed.map((o) => {
                  const wait = now - o.since;
                  const f = Math.min(1, wait / WAIT_SCALE);
                  return (
                    <li key={o.id}>
                      <button type="button" className={current?.id === o.id ? "on" : ""} onClick={() => pick(o.id)} style={{ "--tone": waitTone(f) } as React.CSSProperties}>
                        <span className="owed__name">
                          <Private>{o.name}</Private>
                          {o.later ? <em className="later">later</em> : o.urgency === "sooner" && <em>sooner</em>}
                          <small>{o.channel}</small>
                        </span>
                        <span className="owed__wait">{formatWait(wait)}</span>
                        <span className="owed__preview">
                          <Private>{o.preview}</Private>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="empty empty--stack">
                <Listening />
                <p className="empty__title">You're all caught up</p>
                <p className="empty__text">{connected ? "Dialtone is listening. New threads you owe land here." : "Dialtone starts listening once the hub is connected."}</p>
              </div>
            )}
            <div className="owed__muted">
              <h3>Nothing owed</h3>
              <span className="owed__settled">{data.settled}</span>
              <p>Group chats, codes and promos land here. Nothing to clear.</p>
            </div>
          </Panel>

          <Panel eyebrow="Nudges" aside={next === null ? undefined : <span className="panel__hint">next {hhmm(next)}</span>} className="panel--clock">
            <div className="clock-wrap">
              <NudgeClock nudges={data.nudges} now={now} next={next} />
              <div className="clock-wrap__text">
                <span className="clock-wrap__big">{next === null ? "—" : formatWait(next - now)}</span>
                <span className="clock-wrap__cap">until Dialtone's next nudge</span>
                <ul>
                  {data.nudges.map(([h, m]) => (
                    <li key={`${h}${m}`}>
                      <i aria-hidden="true" />
                      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")} · {h < 15 ? "midday sweep" : "evening sweep"}
                    </li>
                  ))}
                  <li className="night">
                    <i aria-hidden="true" />
                    22:00–07:00 · quiet hours
                  </li>
                </ul>
              </div>
            </div>
          </Panel>
        </div>

        <Panel eyebrow={current ? mask(current.name, "A conversation") : "Conversation"} className="panel--thread" label="Conversation">
          <div className="thread">
            {current ? (
              <div className="thread__body">
                <p className="thread__meta">
                  {current.channel} · waiting {formatWait(now - current.since)}
                </p>
                {(current.thread ?? [{ from: "them" as const, text: current.preview, at: current.since }]).map((m, i) => (
                  <p key={i} className={`bubble bubble--${m.from === "me" ? "out" : "in"}`}>
                    <Private>{m.text}</Private>
                    <time>{hhmm(m.at)}</time>
                  </p>
                ))}
                <div className="draft">
                  <Avatar agent="Blasto" size="sm" room="relay" />
                  <span className="draft__eyebrow">
                    {voicePhase === "listening"
                      ? "Listening…"
                      : voicePhase === "styling"
                        ? "Putting it in your style…"
                        : said
                          ? "Your words, in your style"
                          : current.draft
                            ? "Blasto's draft · in your voice"
                            : "Blasto is drafting…"}
                  </span>
                  {said && (
                    <p className="draft__heard">
                      <span>You said</span>
                      <Private>“{said}”</Private>
                    </p>
                  )}
                  {canAct ? (
                    <textarea
                      className="draft__edit"
                      value={current.draft ?? ""}
                      placeholder="Drafting… or write your own"
                      rows={2}
                      onChange={(e) => setDraft(current.id, e.target.value)}
                      aria-label={`Reply to ${mask(current.name, "them")}`}
                      data-private=""
                    />
                  ) : (
                    <p>{current.draft ? <Private>{current.draft}</Private> : "Drafting…"}</p>
                  )}
                  {canAct && (
                    <div className="draft__actions">
                      <button type="button" className="draft__send" disabled={!current.draft} onClick={() => send(current.id)}>
                        Send
                      </button>
                      <button type="button" className="draft__later" onClick={() => later(current.id)}>
                        Later
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="thread__empty">
                <Outbox />
                <p className="empty__title">The outbox is empty</p>
                <p className="empty__text">Pick a conversation to see the thread and Blasto's draft. Send it as is, nudge it, or hold the mic and say what you mean.</p>
              </div>
            )}
            <div className="dock">
              <div className="chips" role="group" aria-label="Quick replies">
                {CHIPS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    disabled={!canAct || !current}
                    title={canAct ? "Use as the reply" : "Quick replies arrive with the hub"}
                    onClick={() => current && setDraft(current.id, c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="dock__row">
                <div className="dock__input" aria-hidden="true">
                  <span>Say what you mean…</span>
                  <i />
                </div>
                <span className="mic-wrap" data-tip={micReady ? "Say it your way; Blasto keeps your words and puts them in your style" : "Voice arrives with the hub"}>
                  <button
                    type="button"
                    className={`mic ${voicePhase === "listening" ? "mic--live" : ""}`}
                    disabled={!micReady}
                    onClick={speak}
                    aria-label={micReady ? "Talk: say your reply, and Blasto puts it in your style" : "Hold to talk (voice arrives with the hub)"}
                    title={micReady ? "Say your reply" : "Voice arrives with the hub"}
                  >
                    <span className="mic__ring" aria-hidden="true" />
                    <span className="mic__ring mic__ring--2" aria-hidden="true" />
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
                    </svg>
                  </button>
                </span>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <EmailSection now={now} />


      <div className="habits">
        <Panel eyebrow="Reply time, last 7 days" className="panel--strip">
          <ReplyStrip week={data.week} />
        </Panel>
        <Panel eyebrow="Streak">
          <Streak days={data.streakDays} />
        </Panel>
      </div>
    </div>
  );
}
