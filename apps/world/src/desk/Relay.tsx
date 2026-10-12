import { useState } from "react";
import { averageReply, byWait, formatWait, nextNudge, OVERDUE_MS, type DeskData } from "./deskData.ts";
import { PageHead, Panel } from "./ui.tsx";
import { Listening, NudgeClock, Outbox, waitTone } from "./viz.tsx";

/** Relay: who you owe a reply, the ones to answer sooner first, each with Blasto's draft in your voice. */

const CHIPS = ["On my way", "Can I call you later?", "Love that", "Let me check and get back to you"];
const WAIT_SCALE = 12 * 3_600_000;

export function Relay({ data, now, connected }: { data: DeskData; now: number; connected: boolean }) {
  const owed = byWait(data.owed);
  const [picked, setPicked] = useState<string | null>(null);
  const current = owed.find((o) => o.id === picked) ?? null;
  const overdue = owed.filter((o) => now - o.since > OVERDUE_MS).length;
  const avg = averageReply(data.week);
  const next = nextNudge(data.nudges, now);
  const hhmm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

  const stats = [
    { label: "Owed", value: String(owed.length), tone: owed.length ? "var(--amber)" : "var(--mint)", fill: Math.min(1, owed.length / 10), cap: owed.length ? "waiting on you" : "all caught up" },
    { label: "Overdue", value: String(overdue), tone: overdue ? "var(--rose)" : "var(--mint)", fill: owed.length ? overdue / owed.length : 0, cap: `past ${OVERDUE_MS / 3_600_000}h` },
    { label: "Avg reply", value: avg === null ? "—" : formatWait(avg * 60_000), tone: "var(--ice)", fill: avg === null ? 0 : Math.min(1, avg / 240), cap: avg === null ? "no replies tracked" : "median, 7 days" },
    { label: "Sent today", value: String(data.sentToday), tone: "var(--relay)", fill: Math.min(1, data.sentToday / 20), cap: data.sentToday ? "replies out" : "nothing sent yet" },
  ];

  return (
    <div className="relay-page">
      <PageHead
        eyebrow="Room · Relay · the switchboard"
        title="Relay"
        lead="Who you owe a reply, the ones to answer sooner first, each with a draft in your voice."
      />

      <section className="stats" aria-label="Relay at a glance">
        {stats.map((s, i) => (
          <div key={s.label} className="stat" style={{ "--tone": s.tone, animationDelay: `${i * 70}ms` } as React.CSSProperties}>
            <span className="stat__label">{s.label}</span>
            <span className="stat__value">{s.value}</span>
            <span className="stat__bar" aria-hidden="true">
              <b style={{ width: `${s.fill * 100}%` }} />
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
                      <button type="button" className={picked === o.id ? "on" : ""} onClick={() => setPicked(o.id)} style={{ "--tone": waitTone(f) } as React.CSSProperties}>
                        <span className="owed__name">
                          {o.name}
                          {o.urgency === "sooner" && <em>sooner</em>}
                        </span>
                        <span className="owed__wait">{formatWait(wait)}</span>
                        <span className="owed__preview">{o.preview}</span>
                        <span className="owed__bar" aria-hidden="true">
                          <b style={{ width: `${Math.max(3, f * 100)}%` }} />
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
                <div className="owed__ghosts" aria-hidden="true">
                  {[0.82, 0.56, 0.34].map((w, i) => (
                    <span key={i} style={{ width: `${w * 100}%`, animationDelay: `${i * 0.4}s` }} />
                  ))}
                </div>
              </div>
            )}
            <div className="owed__muted">
              <h3>Nothing owed</h3>
              <span className="owed__settled">{data.settled}</span>
              <p>Group chats, codes and promos land here. Nothing to clear.</p>
            </div>
          </Panel>

          <Panel eyebrow="Nudges · 24h" aside={next === null ? undefined : <span className="panel__hint">next {hhmm(next)}</span>} className="panel--clock">
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

        <Panel eyebrow={current ? current.name : "Conversation"} className="panel--thread" label="Conversation">
          <div className="thread">
            {current ? (
              <div className="thread__body">
                <p className="thread__meta">
                  {current.channel} · waiting {formatWait(now - current.since)}
                </p>
                <p className="bubble bubble--in">{current.preview}</p>
                <div className="draft">
                  <span className="draft__eyebrow">Blasto's draft</span>
                  <p>{current.draft ?? "Drafting…"}</p>
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
                  <button key={c} type="button" className="chip" disabled title="Quick replies arrive with the hub">
                    {c}
                  </button>
                ))}
              </div>
              <div className="dock__row">
                <div className="dock__input" aria-hidden="true">
                  <span>Say what you mean…</span>
                  <i />
                </div>
                <span className="mic-wrap" data-tip="Voice arrives with the hub">
                  <button type="button" className="mic" disabled aria-label="Hold to talk (voice arrives with the hub)" title="Voice arrives with the hub">
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
    </div>
  );
}
