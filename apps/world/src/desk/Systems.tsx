import { LINK_STATE_LABEL, useSystems } from "../systems.ts";
import { DESK_ROOMS, roomImage, type DeskRoom } from "./deskData.ts";
import { FoundrySystem } from "./FoundryPage.tsx";
import { SystemsPanel } from "./SystemsPanel.tsx";
import { Avatar, PageHead, Panel, Pill } from "./ui.tsx";
import { ActivityMeter } from "./viz.tsx";

/**
 * Systems: what's connected and what isn't, one system per room as each becomes real: Relay and the Foundry so
 * far; the others are listed as planned until their agents go live.
 */

const AGENTS = [
  {
    id: "dialtone",
    name: "Dialtone",
    role: "Relay · Switchboard",
    job: "Keeps the list of who you owe a reply, and nudges you at half twelve and seven.",
    tone: "var(--violet)",
  },
  {
    id: "postmaster",
    name: "Blasto",
    role: "Relay · Postmaster",
    job: "Drafts your replies in your voice, and holds them until you say send.",
    tone: "var(--ice)",
  },
];

/** Rooms whose real systems are still to come, in the order they're likely to be built. */
const PLANNED: { room: DeskRoom; what: string }[] = [
  { room: "spire", what: "Invoices, bookings and the business inbox" },
  { room: "exchange", what: "Kalshi and the portfolio" },
  { room: "green", what: "Sleeper fantasy football" },
  { room: "archive", what: "The Tide's notes and campaign" },
  { room: "workshop", what: "New models: an image, then Meshy, then imported and animated here" },
];

export function Systems({ now }: { now: number }) {
  return (
    <div className="systems-page">
      <PageHead
        eyebrow="The Boiler Room"
        title="Systems"
        room="boiler"
        lead="What's connected, what isn't, and what each agent depends on."
        aside={
          <div className="page-head__crew">
            <Avatar agent="Gary" room="boiler" />
            <span>Gary keeps the gauges</span>
          </div>
        }
      />

      <Panel
        eyebrow="Relay: iMessage and SMS"
        aside={<span className="panel__hint">MacBook → Hub → services → agents</span>}
        className="panel--systems"
      >
        <SystemsPanel now={now} />
      </Panel>

      <section className="agents" aria-label="Relay's agents">
        <header className="section-head">
          <h2>Relay's agents</h2>
        </header>
        <div className="agents__grid">
          {AGENTS.map((a) => (
            <AgentCard key={a.id} {...a} />
          ))}
        </div>
      </section>

      <FoundrySystem />

      <section className="planned" aria-label="Systems to come">
        <header className="section-head">
          <h2>Still to build</h2>
        </header>
        <ul className="planned__grid">
          {PLANNED.map((p) => (
            <li key={p.room} style={{ "--tone": DESK_ROOMS[p.room].accent } as React.CSSProperties}>
              <img className="planned__pic" src={roomImage(p.room)} alt="" loading="lazy" decoding="async" />
              <span className="planned__text">
                <span className="planned__name">{DESK_ROOMS[p.room].name}</span>
                <span className="planned__what">{p.what}</span>
              </span>
              <span className="planned__foot">
                <Avatar agent={DESK_ROOMS[p.room].lead} size="sm" room={p.room} />
                <Pill tone="off">Not built yet</Pill>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AgentCard({ id, name, role, job, tone }: (typeof AGENTS)[number]) {
  const linkState = useSystems((s) => s.links.find((l) => l.id === id));
  const state = linkState?.state ?? "off";
  const load = linkState?.load ?? 0;
  const seen = linkState?.lastSeen;
  return (
    <article className={`agent agent--${state}`} style={{ "--tone": tone } as React.CSSProperties}>
      <div className="agent__portrait">
        <Avatar agent={name} size="lg" />
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
          <span className="agent__seen">{seen ? `Heard ${new Date(seen).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}` : "Never heard from"}</span>
        </div>
      </div>
    </article>
  );
}
