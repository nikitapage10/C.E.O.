import { CREW, crewWork, useFoundry, type CrateState, type CrewId } from "../foundry.ts";
import { LINK_STATE_LABEL, useSystems, type LinkState } from "../systems.ts";
import { DESK_ROOMS, FOUNDRY_THREAD, type DeskRoom } from "./deskData.ts";
import { SystemsPanel } from "./SystemsPanel.tsx";
import { PageHead, Panel } from "./ui.tsx";
import { ActivityMeter, BlastoGlyph, DialtoneGlyph } from "./viz.tsx";

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

      <FoundrySystem />

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

const CRATE_STATE: Record<CrateState, string> = { queued: "Queued", working: "Working", ready: "Waiting for your OK", stuck: "Stuck", shipped: "Shipped" };
const CREW_STATE: Record<CrateState, LinkState> = { queued: "ok", working: "ok", ready: "slow", stuck: "down", shipped: "ok" };

/** The Foundry's system: the checks on GitHub wake the Foundry thread in Claude Code, which ships to main. */
function FoundrySystem() {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const checks = useSystems((s) => s.links.find((l) => l.id === "checks")?.state ?? "off");
  const work = crewWork(data.crates);
  const steps: { name: string; what: string; state: LinkState; label: string }[] = [
    { name: "Checks", what: "Types, lint, tests and build on every push to main, on GitHub", state: checks, label: checks === "off" ? "No run yet" : LINK_STATE_LABEL[checks] },
    { name: "Wake routine", what: "A red check opens a fix and wakes the Foundry", state: connected ? "ok" : "off", label: connected ? "Watching" : "Not connected yet" },
    { name: "Foundry thread", what: "Fixes, upkeep and builds, coded in Claude Code on your plan, each on its own branch and pull request", state: connected ? "ok" : "off", label: connected ? "Ready" : "Not connected yet" },
    { name: "main → the site", what: "Small fixes and upkeep merge once green; bigger work gets a preview and waits for you", state: connected ? "ok" : "off", label: connected ? "Shipping" : "Not connected yet" },
  ];
  return (
    <section className="foundry-system" aria-label="The Foundry's system" style={{ "--tone": DESK_ROOMS.foundry.accent } as React.CSSProperties}>
      <header className="section-head">
        <h2>Foundry · coding in Claude Code</h2>
        <span className="panel__rule" aria-hidden="true" />
        <a className="panel__hint" href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
          Open the Foundry thread →
        </a>
      </header>
      <ol className="foundry-flow">
        {steps.map((st) => (
          <li key={st.name}>
            <span className="foundry-flow__name">{st.name}</span>
            <span className="foundry-flow__what">{st.what}</span>
            <span className={`pill pill--${st.state}`}>
              <i aria-hidden="true" />
              {st.label}
            </span>
          </li>
        ))}
      </ol>
      <ul className="foundry-crew">
        {(Object.keys(CREW) as CrewId[]).map((id) => {
          const crate = work[id];
          return (
            <li key={id}>
              <span className="foundry-crew__job">{CREW[id].job}</span>
              <span className="foundry-crew__name">{CREW[id].name}</span>
              {crate ? (
                <a className="foundry-crew__on" href={crate.url} target="_blank" rel="noreferrer">
                  #{crate.number} {crate.title}
                </a>
              ) : (
                <span className="foundry-crew__on foundry-crew__on--idle">Nothing in hand</span>
              )}
              <span className={`pill pill--${crate ? CREW_STATE[crate.state] : connected ? "ok" : "off"}`}>
                <i aria-hidden="true" />
                {crate ? CRATE_STATE[crate.state] : connected ? "Free" : "Not connected yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
