import { useState } from "react";
import { LINK_STATE_LABEL, useSystems } from "../systems.ts";
import { CONNECTIONS, type Connection } from "./connections.ts";
import { DESK_ROOMS, roomImage, type DeskRoom } from "./deskData.ts";
import { FoundryDiagram } from "./FoundryDiagram.tsx";
import { FoundrySystem } from "./FoundryPage.tsx";
import { SystemsPanel } from "./SystemsPanel.tsx";
import { SystemsNav } from "./SystemsNav.tsx";
import { Avatar, PageHead, Panel, Pill } from "./ui.tsx";
import { ActivityMeter } from "./viz.tsx";
import { WorldClockPanel } from "./WorldClockPanel.tsx";

/**
 * Systems: what's connected and what isn't, one system per room as each becomes real: Relay and the Foundry so
 * far; the others are listed as planned until their agents go live. The world clock (the living Lattice's hourly
 * step) sits above them all, since every room lives by it.
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

/** The rooms whose systems are drawn here; the rest show in the picker as not set up yet. */
type SystemRoom = "relay" | "foundry";
const LIVE_ROOMS: SystemRoom[] = ["relay", "foundry"];
const ROOM_KEY = "ceo.systemsRoom";

/** The room to show: `?room=foundry` first, then the last one picked on this device, then Relay. */
function firstRoom(): SystemRoom {
  try {
    const asked = new URLSearchParams(window.location.search).get("room") ?? localStorage.getItem(ROOM_KEY);
    return LIVE_ROOMS.find((r) => r === asked) ?? "relay";
  } catch {
    return "relay";
  }
}

function RoomPicker({ room, onPick }: { room: SystemRoom; onPick: (r: SystemRoom) => void }) {
  return (
    <nav className="room-pick" aria-label="Rooms">
      <span className="room-pick__label">Rooms</span>
      <div className="room-pick__list">
        {LIVE_ROOMS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={room === r}
            className={`room-pick__tab ${room === r ? "is-on" : ""}`}
            style={{ "--tone": DESK_ROOMS[r].accent } as React.CSSProperties}
            onClick={() => onPick(r)}
          >
            <i aria-hidden="true" />
            {DESK_ROOMS[r].name}
          </button>
        ))}
        {PLANNED.map((p) => (
          <span key={p.room} className="room-pick__tab room-pick__tab--off" style={{ "--tone": DESK_ROOMS[p.room].accent } as React.CSSProperties} title={p.what}>
            <i aria-hidden="true" />
            {DESK_ROOMS[p.room].name}
            <small>Not set up yet</small>
          </span>
        ))}
      </div>
    </nav>
  );
}

export function Systems({ now }: { now: number }) {
  const [room, setRoom] = useState<SystemRoom>(firstRoom);
  const pick = (r: SystemRoom) => {
    setRoom(r);
    try {
      localStorage.setItem(ROOM_KEY, r);
    } catch {
      // Private window: the pick lasts for this visit.
    }
  };
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

      <SystemsNav />

      <WorldClockPanel now={now} />

      <RoomPicker room={room} onPick={pick} />

      {room === "relay" && (
        <>
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
        </>
      )}

      {room === "foundry" && (
        <>
          <Panel
            eyebrow="Foundry: from an idea to the live site"
            aside={<span className="panel__hint">Desk → issues → Builder → crew → checks → main</span>}
            className="panel--systems panel--foundry-system"
          >
            <FoundryDiagram now={now} />
          </Panel>

          <FoundrySystem />
        </>
      )}

      <Connections />

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

/** The distinct connections and how each is called (issue #69): the ones in use first, then Relay's planned ones. */
function Connections() {
  const list = [...CONNECTIONS].sort((a, b) => (a.status === b.status ? 0 : a.status === "live" ? -1 : 1));
  return (
    <section className="conn" aria-label="How it connects">
      <header className="section-head">
        <h2>How it connects</h2>
        <span className="panel__hint">The notable links, and how each is called</span>
      </header>
      <ul className="conn__grid">
        {list.map((c) => (
          <ConnectionCard key={c.id} {...c} />
        ))}
      </ul>
    </section>
  );
}

function ConnectionCard({ name, room, serves, kinds, status, how, auth, when }: Connection) {
  return (
    <li className={`conn__card conn__card--${status}`} style={{ "--tone": DESK_ROOMS[room].accent } as React.CSSProperties}>
      <div className="conn__top">
        <span className="conn__serves">{serves}</span>
        <Pill tone={status === "live" ? "ok" : "off"}>{status === "live" ? "In use" : "Planned"}</Pill>
      </div>
      <h3 className="conn__name">{name}</h3>
      <ul className="conn__kinds" aria-label="Kind">
        {kinds.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
      <p className="conn__how">{how}</p>
      <dl className="conn__facts">
        <div>
          <dt>Signs in</dt>
          <dd>{auth}</dd>
        </div>
        <div>
          <dt>How often</dt>
          <dd>{when}</dd>
        </div>
      </dl>
    </li>
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
