import { LINK_STATE_LABEL, useSystems } from "../systems.ts";
import { DESK_ROOMS, type DeskRoom } from "./deskData.ts";
import { SystemsPanel } from "./SystemsPanel.tsx";
import { PageHead, Panel } from "./ui.tsx";
import { ActivityMeter, BlastoGlyph, DialtoneGlyph } from "./viz.tsx";

/**
 * Systems: what's connected and what isn't, one system per room as each becomes real. Relay is the first; the
 * others are listed as planned until their agents go live.
 */

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

/** Rooms whose real systems are still to come, in the order they're likely to be built. */
const PLANNED: { room: DeskRoom; what: string }[] = [
  { room: "foundry", what: "Coding agents on the Mac, through Claude" },
  { room: "spire", what: "Invoices, bookings and the business inbox" },
  { room: "exchange", what: "Kalshi and the portfolio" },
  { room: "green", what: "Sleeper fantasy football" },
  { room: "archive", what: "The Tide's notes and campaign" },
];

export function Systems({ now }: { now: number }) {
  return (
    <div className="systems-page">
      <PageHead eyebrow="Desk · Systems" title="Systems" lead="What's connected, what isn't, and what each agent depends on." />

      <Panel
        eyebrow="Relay · iMessage and SMS"
        aside={<span className="panel__hint">MacBook → Hub → services → agents</span>}
        className="panel--systems"
      >
        <SystemsPanel now={now} />
      </Panel>

      <section className="agents" aria-label="Relay's agents">
        <header className="section-head">
          <h2>Relay's agents</h2>
          <span className="panel__rule" aria-hidden="true" />
        </header>
        <div className="agents__grid">
          {AGENTS.map((a) => (
            <AgentCard key={a.id} {...a} />
          ))}
        </div>
      </section>

      <section className="planned" aria-label="Systems to come">
        <header className="section-head">
          <h2>Still to build</h2>
          <span className="panel__rule" aria-hidden="true" />
        </header>
        <ul className="planned__grid">
          {PLANNED.map((p) => (
            <li key={p.room} style={{ "--tone": DESK_ROOMS[p.room].accent } as React.CSSProperties}>
              <span className="planned__name">{DESK_ROOMS[p.room].name}</span>
              <span className="planned__what">{p.what}</span>
              <span className="planned__state">Not built yet</span>
            </li>
          ))}
        </ul>
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
