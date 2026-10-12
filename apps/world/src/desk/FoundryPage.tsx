import { CREW, crewFor, crewWork, useFoundry, type Crate, type CrateKind, type CrateState, type CrewId } from "../foundry.ts";
import { LINK_STATE_LABEL, useSystems, type LinkState } from "../systems.ts";
import { DESK_ROOMS, FOUNDRY_THREAD, formatWait } from "./deskData.ts";
import { PageHead, Panel } from "./ui.tsx";

/**
 * The Foundry's own Desk page: what needs you, what the crew worked on today, the ideas waiting for a pick, and
 * how the system runs. Everything here is read live from GitHub (see foundry.ts); the buttons open the Foundry
 * thread, where approvals happen.
 */

const KIND_LABEL: Record<CrateKind, string> = { fix: "Fix", build: "Build", upkeep: "Upkeep", idea: "Idea" };

const SCHEDULE = [
  { when: "Any time", what: "A red check on main opens a fix and wakes Skippy" },
  { when: "9:00 every morning", what: "Rusty proposes three ideas for you to pick from" },
  { when: "Every 6 hours", what: "Rusty does one small piece of upkeep, if nothing is broken" },
];

export function FoundryPage({ now }: { now: number }) {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const checks = data.checks;
  const needs = data.crates.filter((c) => c.state === "ready" || c.state === "stuck");
  const today = data.crates.filter((c) => c.state !== "queued" && !(c.state === "ready" || c.state === "stuck"));
  const ideas = data.crates.filter((c) => c.kind === "idea" && c.state === "queued");
  const queued = data.crates.filter((c) => c.kind !== "idea" && c.state === "queued");
  const checksLine =
    checks.state === "pass" ? "The checks on main are green." : checks.state === "fail" ? "The checks on main are red; a fix is on its way." : checks.state === "running" ? "The checks on main are running." : "No checks have run on main yet.";
  const lead = !connected
    ? "Connecting to GitHub…"
    : `${checksLine} ${needs.length ? `${needs.length} ${needs.length === 1 ? "thing needs" : "things need"} you.` : "Nothing needs you."}`;

  return (
    <div className="foundry-page" style={{ "--tone": DESK_ROOMS.foundry.accent } as React.CSSProperties}>
      <PageHead
        eyebrow="Desk · Foundry"
        title="Foundry"
        lead={lead}
        aside={
          <a className="foundry-page__open" href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
            Open the Foundry thread →
          </a>
        }
      />

      <div className="foundry-page__row">
        <Panel eyebrow="Needs you" aside={<span className="badge">{needs.length}</span>}>
          {needs.length ? <CrateList crates={needs} now={now} /> : <p className="quiet">Nothing waiting on you. Small fixes and upkeep ship on their own.</p>}
        </Panel>
        <Panel eyebrow="This morning's ideas" aside={<span className="badge">{ideas.length}</span>}>
          {ideas.length ? (
            <>
              <CrateList crates={ideas} now={now} />
              <p className="foundry-page__hint">
                Pick one on the card in the{" "}
                <a href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
                  Foundry thread
                </a>
                .
              </p>
            </>
          ) : (
            <p className="quiet">No ideas waiting. Rusty brings three every morning at 9:00.</p>
          )}
        </Panel>
      </div>

      <Panel eyebrow="Today's work" aside={<span className="badge">{today.length + queued.length}</span>}>
        {today.length + queued.length ? <CrateList crates={[...today, ...queued]} now={now} /> : <p className="quiet">Nothing picked up yet today. What the crew works on shows here, and on the belt in the Lattice.</p>}
      </Panel>

      <section className="foundry-page__schedule" aria-label="When the Foundry works">
        <header className="section-head">
          <h2>When it works</h2>
          <span className="panel__rule" aria-hidden="true" />
        </header>
        <ul>
          {SCHEDULE.map((s) => (
            <li key={s.when}>
              <span className="foundry-page__when">{s.when}</span>
              <span>{s.what}</span>
            </li>
          ))}
        </ul>
      </section>

      <FoundrySystem />
    </div>
  );
}

function CrateList({ crates, now }: { crates: Crate[]; now: number }) {
  return (
    <ul className="crates">
      {crates.map((c) => (
        <li key={c.number} className={`crates__item crates__item--${c.state}`}>
          <span className="crates__kind">
            {KIND_LABEL[c.kind]} #{c.number}
          </span>
          <a className="crates__title" href={c.url} target="_blank" rel="noreferrer">
            {c.title}
          </a>
          <span className="crates__who">
            {CREW[crewFor(c)].name}
            {c.rung ? ` · rung ${c.rung}` : ""} · {formatWait(now - c.updatedAt)} ago
          </span>
          <span className={`pill pill--${CREW_STATE[c.state]}`}>
            <i aria-hidden="true" />
            {CRATE_STATE[c.state]}
          </span>
        </li>
      ))}
    </ul>
  );
}

const CRATE_STATE: Record<CrateState, string> = { queued: "Queued", working: "Working", ready: "Waiting for your OK", stuck: "Stuck", shipped: "Shipped" };
const CREW_STATE: Record<CrateState, LinkState> = { queued: "ok", working: "ok", ready: "slow", stuck: "down", shipped: "ok" };

/** The Foundry's system: the checks on GitHub wake the Foundry thread in Claude Code, which ships to main. */
export function FoundrySystem() {
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
