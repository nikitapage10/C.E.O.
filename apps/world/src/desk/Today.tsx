import { LINK_STATE_LABEL, useSystems } from "../systems.ts";
import { byWait, formatWait, nextNudge, type DeskData } from "./deskData.ts";
import { link } from "./nav.ts";
import { SystemsPanel } from "./SystemsPanel.tsx";
import { PageHead, Panel } from "./ui.tsx";
import { ActivityMeter, BlastoGlyph, DialtoneGlyph, Listening, PressureDial, ReplyStrip, Streak, waitTone } from "./viz.tsx";

/** Today: how much is pressing on you, what needs you, and whether the machinery behind it is up. */

const AGENTS = [
  {
    id: "dialtone",
    name: "Dialtone",
    role: "Relay · Switchboard",
    job: "Keeps the list of who you owe a reply, and nudges you at half twelve and seven.",
    Glyph: DialtoneGlyph,
    tone: "var(--violet)",
  },
  {
    id: "postmaster",
    name: "Blasto",
    role: "Relay · Postmaster",
    job: "Drafts your replies in your voice, and holds them until you say send.",
    Glyph: BlastoGlyph,
    tone: "var(--ice)",
  },
];

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 5 ? "Still up, Nikita." : h < 12 ? "Good morning, Nikita." : h < 18 ? "Good afternoon, Nikita." : "Good evening, Nikita.";
}

export function Today({ data, now, connected }: { data: DeskData; now: number; connected: boolean }) {
  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const next = nextNudge(data.nudges, now);
  const owed = byWait(data.owed);

  return (
    <div className="today">
      <PageHead eyebrow={`Desk · ${date}`} title="Today" lead={<em className="page-head__greet">{greeting(now)}</em>} />

      <section className="hero" aria-label="Reply pressure">
        <div className="hero__dial">
          <PressureDial owed={owed} now={now} connected={connected} />
        </div>
        <div className="hero__side">
          <Panel eyebrow="Reply time · last 7 days" className="panel--strip">
            <ReplyStrip week={data.week} />
          </Panel>
          <div className="hero__pair">
            <Panel eyebrow="Streak">
              <Streak days={data.streakDays} />
            </Panel>
            <Panel eyebrow="Next nudge">
              <div className="nudge-mini">
                <span className="nudge-mini__time">{next === null ? "—" : new Date(next).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                <span className="nudge-mini__in">{next === null ? "No nudges set" : `in ${formatWait(next - now)}`}</span>
                <div className="nudge-mini__track" aria-hidden="true">
                  {data.nudges.map(([h, m]) => (
                    <i key={`${h}${m}`} style={{ left: `${((h * 60 + m) / 1440) * 100}%` }} />
                  ))}
                  <b style={{ left: `${((new Date(now).getHours() * 60 + new Date(now).getMinutes()) / 1440) * 100}%` }} />
                </div>
                <span className="nudge-mini__cap">Dialtone · {data.nudges.map(([h, m]) => `${h}:${String(m).padStart(2, "0")}`).join(" & ")}</span>
              </div>
            </Panel>
          </div>
        </div>
      </section>

      <div className="today__row">
        <Panel eyebrow="Needs you now" aside={<span className="badge">{owed.length}</span>} className="panel--needs">
          {owed.length ? (
            <ul className="needs">
              {owed.slice(0, 5).map((o, i) => {
                const wait = now - o.since;
                const tone = waitTone(Math.min(1, wait / (12 * 3_600_000)));
                return (
                  <li key={o.id} style={{ "--tone": tone, animationDelay: `${i * 60}ms` } as React.CSSProperties}>
                    <a href="/relay" onClick={link("relay")}>
                      <span className="needs__initial">{o.name.slice(0, 1)}</span>
                      <span className="needs__who">
                        {o.name}
                        {o.urgency === "sooner" && <em>sooner</em>}
                      </span>
                      <span className="needs__preview">{o.preview}</span>
                      <span className="needs__wait">{formatWait(wait)}</span>
                      <span className="needs__draft">{o.draft ? "Draft ready" : "Drafting…"}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="empty empty--wide">
              <Listening />
              <div>
                <p className="empty__title">Nobody is waiting on you</p>
                <p className="empty__text">
                  {connected
                    ? "Replies you owe will appear here, the ones to answer sooner first, each with a draft ready to send."
                    : "When the hub is connected, replies you owe land here, the ones to answer sooner first, each with Blasto's draft ready."}
                </p>
                <a className="empty__link" href="/relay" onClick={link("relay")}>
                  Open Relay →
                </a>
              </div>
            </div>
          )}
        </Panel>

        <div className="today__stack">
          <Panel eyebrow="Waiting on you" aside={<span className="badge">{data.approvals.length}</span>}>
            {data.approvals.length ? (
              <ul className="approvals">
                {data.approvals.map((a) => (
                  <li key={a.id}>
                    <span className="approvals__agent">{a.agent}</span>
                    <span className="approvals__title">{a.title}</span>
                    <span className="approvals__detail">{a.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty empty--small">
                <span className="empty__seal" aria-hidden="true">
                  ✓
                </span>
                <p className="empty__text">Nothing to approve. Agents ask here before they act for you.</p>
              </div>
            )}
          </Panel>
          <Panel eyebrow="While you were away">
            <p className="away">
              <span className="away__line" aria-hidden="true" />
              <span>
                Quiet. The other rooms are still running drills, which you can watch in the{" "}
                <a href="/lattice" onClick={link("lattice")}>
                  Lattice
                </a>
                .
              </span>
            </p>
          </Panel>
        </div>
      </div>

      <Panel eyebrow="Systems" aside={<span className="panel__hint">MacBook → Hub → services → agents</span>} className="panel--systems">
        <SystemsPanel now={now} />
      </Panel>

      <section className="agents" aria-label="Agents">
        <header className="section-head">
          <h2>Agents on duty</h2>
          <span className="panel__rule" aria-hidden="true" />
        </header>
        <div className="agents__grid">
          {AGENTS.map((a) => (
            <AgentCard key={a.id} {...a} />
          ))}
        </div>
      </section>
    </div>
  );
}

function AgentCard({ id, name, role, job, Glyph, tone }: (typeof AGENTS)[number]) {
  const linkState = useSystems((s) => s.links.find((l) => l.id === id));
  const state = linkState?.state ?? "off";
  const load = linkState?.load ?? 0;
  const seen = linkState?.lastSeen;
  return (
    <article className={`agent agent--${state}`} style={{ "--tone": tone } as React.CSSProperties}>
      <div className="agent__portrait">
        <Glyph />
      </div>
      <div className="agent__body">
        <p className="agent__role">{role}</p>
        <h3 className="agent__name">{name}</h3>
        <p className="agent__job">{job}</p>
        <div className="agent__foot">
          <span className={`pill pill--${state}`}>
            <i aria-hidden="true" />
            {LINK_STATE_LABEL[state]}
          </span>
          <ActivityMeter load={load} live={state === "ok" || state === "slow"} />
          <span className="agent__seen">{seen ? `heard ${new Date(seen).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}` : "never heard from"}</span>
        </div>
      </div>
    </article>
  );
}
