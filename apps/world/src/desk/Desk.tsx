import { useEffect } from "react";
import { loadLattice, navigate, type Route } from "../route.ts";
import "./desk.css";

/**
 * The Desk: the plain, fast front page where the C.E.O. acts on what the real agents bring in. It shows only
 * real work (nothing from the demo) and never loads the 3D Lattice; "Enter the Lattice" fetches that on demand.
 * Phase 2 wires it to the hub on the MacBook; until then every list is honestly empty.
 */

type DeskTab = Exclude<Route, "lattice">;

const TABS: { id: DeskTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "relay", label: "Relay" },
];

/** The real agents and what they do for you. Relay is the first room to go live. */
const LIVE_AGENTS = [
  { id: "dialtone", name: "Dialtone", room: "Relay", job: "Keeps the list of who you owe a reply, and nudges you" },
  { id: "postmaster", name: "Blasto", room: "Relay", job: "Drafts your replies, in your voice" },
];

/** No hub yet: the MacBook side is phase 2. */
const HUB_CONNECTED = false;

export function Desk({ route }: { route: DeskTab }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("input, textarea")) return;
      const i = Number(e.key) - 1;
      if (TABS[i]) navigate(TABS[i].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = route === "relay" ? "Relay · C.E.O." : "C.E.O. — Desk";
  }, [route]);

  return (
    <div className="desk">
      <header className="desk__bar">
        <a className="desk__mark" href="/" onClick={link("today")}>
          C.E.O.
        </a>
        <nav className="desk__tabs" aria-label="Desk">
          {TABS.map((t, i) => (
            <a
              key={t.id}
              href={t.id === "today" ? "/" : `/${t.id}`}
              className={route === t.id ? "on" : ""}
              aria-current={route === t.id ? "page" : undefined}
              onClick={link(t.id)}
              title={`${t.label} (${i + 1})`}
            >
              {t.label}
            </a>
          ))}
        </nav>
        <div className="desk__right">
          <span className="desk__count" title="Waiting on you">
            0
          </span>
          <a className="desk__enter" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()}>
            Enter the Lattice
          </a>
        </div>
      </header>

      {!HUB_CONNECTED && (
        <p className="desk__notice" role="status">
          Not connected to your hub yet. Once the MacBook is set up, Relay's work shows up here.
        </p>
      )}

      <main className="desk__main">{route === "relay" ? <Relay /> : <Today />}</main>
    </div>
  );
}

/** In-app navigation for plain links (a new tab or a modified click still works as a normal link). */
function link(to: Route) {
  return (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="desk__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="desk__empty">{children}</p>;
}

function Today() {
  return (
    <>
      <h1 className="desk__title">Today</h1>
      <Section title="Needs you now">
        <Empty>Nobody is waiting on a reply from you. Replies you owe will appear here, with a draft ready to send.</Empty>
      </Section>
      <Section title="Waiting on you">
        <Empty>Nothing to approve.</Empty>
      </Section>
      <Section title="While you were away">
        <Empty>Quiet. The other rooms are still running drills, which you can watch in the Lattice.</Empty>
      </Section>
      <Section title="Agents">
        <ul className="desk__agents">
          {LIVE_AGENTS.map((a) => (
            <li key={a.id}>
              <span className={`desk__dot ${HUB_CONNECTED ? "desk__dot--ok" : ""}`} aria-hidden="true" />
              <span className="desk__agent-name">{a.name}</span>
              <span className="desk__agent-room">{a.room}</span>
              <span className="desk__agent-job">{a.job}</span>
              <span className="desk__agent-state">{HUB_CONNECTED ? "Connected" : "Not connected yet"}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Relay() {
  return (
    <>
      <h1 className="desk__title">Relay</h1>
      <p className="desk__lead">Who you owe a reply, the ones to answer sooner first, each with a draft in your voice.</p>
      <div className="relay">
        <section className="relay__list" aria-label="Owed replies">
          <h2>Owed replies</h2>
          <Empty>You're all caught up.</Empty>
          <h2 className="relay__muted">Nothing owed</h2>
          <Empty>Group chats, codes and promos land here. Nothing to clear.</Empty>
        </section>
        <section className="relay__thread" aria-label="Conversation">
          <Empty>Pick a conversation to see the thread and Blasto's draft. Send it as is, nudge it, or hold the mic and say what you mean.</Empty>
        </section>
      </div>
    </>
  );
}
