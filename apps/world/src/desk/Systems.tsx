import { useEffect, useMemo, useState } from "react";
import { useWorldFeed } from "../chronicle.ts";
import { CREW, crewOf, useFoundry } from "../foundry.ts";
import { useSystems, type LinkState } from "../systems.ts";
import { formatUsd } from "../usage.ts";
import { clockHeadline, clockState, nextLine, useWorldClock } from "../worldClock.ts";
import { foundryGraph } from "./foundryGraph.ts";
import { nextCheck, useSetup } from "./IdeaCard.tsx";
import { useSetupStatus } from "./SetupCard.tsx";
import { JobBoard } from "./JobBoard.tsx";
import { LatticeTimings } from "./LatticeTimings.tsx";
import { PipeRack } from "./PipeRack.tsx";
import { SystemsGraph } from "./SystemsGraph.tsx";
import { pipeRows, systemsModel, type FlowId } from "./systemsGraph.ts";
import { SystemsNav } from "./SystemsNav.tsx";
import { emailLine, linkOf, startEmail, useEmail, type EmailLoad, type EmailStatus } from "./email/email.ts";
import { startInvoices } from "./spire/invoices.ts";
import { startPolymarket } from "./exchange/polymarket.ts";
import { startGreen } from "./green/league.ts";
import { roomLink } from "./hero/roomLink.ts";
import { Private } from "./Private.tsx";
import { Home } from "./rooms/Home.tsx";
import { AskedSkippy } from "./skippy/AskedSkippy.tsx";
import { RoomFeed } from "./skippy/RoomFeed.tsx";
import { SetupAsks } from "./skippy/SetupAsks.tsx";
import "./rooms/rooms.css";
import { describeRun, useVisualQa } from "./visualqa/feed.ts";

/**
 * Systems, in the approved Weave (desk-concepts round five): the Pessimist's headline, then the whole system as a pipe rack
 * (#241), one straight pipe per room with every real connection a fitting on it (connections.ts, foundryGraph.ts),
 * dashed while it isn't connected. Tap a pipe and it flows open into the room's whole flow, with every step's sign-in
 * and timing in a panel beside it. Below: the rooms still to build, the world clock every room lives by, and the Pessimist's board of scheduled jobs
 * (JobBoard.tsx). Real states only.
 */

/** Rooms whose real systems are still to come, in the order they're likely to be built; each page says what it waits on. */
const PLANNED: { room: string; name: string; what: string; href?: string }[] = [
  { room: "spire", name: "Spire", what: "The idea scout (PayPal invoices are live)", href: "/spire" },
  { room: "exchange", name: "Exchange", what: "Your Polymarket US positions (read-only, behind the passkey), Polymarket's live odds, and later crypto and stock prices", href: "/exchange" },
  { room: "green", name: "Green", what: "The weekly take from OpenAI (Sleeper's league and FantasyPros are live)", href: "/green" },
  { room: "workshop", name: "Workshop", what: "Meshy and the Bambu Lab printer", href: "/workshop" },
  { room: "studio", name: "Studio", what: "OpenAI images, ElevenLabs voices, the render job, TikTok and Instagram", href: "/studio" },
  { room: "boiler", name: "The house", what: "Google Nest, below" },
  { room: "breakroom", name: "Break Room", what: "Off the clock; shows the Veil countdown" },
];

const FLOWS: FlowId[] = ["foundry", "boiler", "archive", "relay"];
const FLOW_ROOM: Record<FlowId, string> = { foundry: "Foundry", boiler: "Boiler Room", archive: "Archive", relay: "Relay" };
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** The flow to open: `?room=foundry` first, else the overview. */
function firstMode(): "overview" | FlowId {
  try {
    const asked = new URLSearchParams(window.location.search).get("room");
    return FLOWS.find((r) => r === asked) ?? "overview";
  } catch {
    return "overview";
  }
}

const VQA_STATE: Record<string, LinkState> = { ok: "ok", slow: "ok", down: "down", off: "off" };

const sinceWord = (at: number | null, now: number) => {
  if (at === null) return "not yet";
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "under a minute ago";
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/**
 * The Gmail card (#322): the email agent's line, live on the Azure copy since 2026-10-23. Built from the public counts
 * only (`EmailStatus`: counts, states, times), so it reads the same signed in or out; the mail itself stays on Relay.
 */
function EmailCard({ load, status, now, onFlow }: { load: EmailLoad; status: EmailStatus | null; now: number; onFlow: () => void }) {
  const link = linkOf(status);
  const tone = link === "ok" ? "var(--wv-ok)" : link === "down" ? "var(--wv-bad)" : link === "slow" ? "#e8b04f" : "var(--wv-mute)";
  const head = load === "off" ? "On the Azure copy" : !status ? emailLine(load, status).replace(/^Email:\s*/, "") : link === "ok" ? "Live, read-only" : emailLine(load, status).replace(/^Email(?: agent)?:?\s*/i, "");
  return (
    <section className="wv-sysclock wv-sysmail" data-room="relay" aria-label="Gmail">
      <p className="wv-eyb">
        <i className={`wv-dot${link === "off" ? " is-ring" : ""}`} style={{ "--rc": tone } as React.CSSProperties} aria-hidden="true" /> Gmail · Relay's email line
      </p>
      <h2 className="wv-h2">{head.charAt(0).toUpperCase() + head.slice(1)}</h2>
      <p className="wv-note" style={{ marginTop: 8 }}>
        Your inbox, read from the Azure copy every minute with read-only access. Dialtone sorts, Blasto advises; nothing is ever sent. Only these counts leave the passkey.
      </p>
      <dl className="wv-facts">
        <div>
          <dt>Last check</dt>
          <dd>{load === "off" ? "–" : sinceWord(status?.lastCheck ?? null, now)}</dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd>{status ? `${status.needsYou} need you · ${status.fyi} FYI` : "–"}</dd>
        </div>
        <div>
          <dt>Today</dt>
          <dd>{status ? `${status.newToday} new · ${status.noise} noise` : "–"}</dd>
        </div>
        <div>
          <dt>Monthly cap</dt>
          <dd>{status ? `${status.budgetPct}% used` : "–"}</dd>
        </div>
      </dl>
      <button className="wv-link" type="button" onClick={onFlow}>
        See its flow
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      </button>
    </section>
  );
}

export function Systems({ now }: { now: number }) {
  const [mode, setMode] = useState<"overview" | FlowId>(firstMode);
  // Polymarket's thread is real (#240): read its odds while this page is open, so the thread shows its true state.
  useEffect(() => startPolymarket(), []);
  useEffect(() => startEmail(), []);
  const emailLoad = useEmail((s) => s.load);
  const emailStatus = useEmail((s) => s.status);
  // So are Sleeper and FantasyPros, through the Green's board (#252).
  useEffect(() => startGreen(), []);
  // And PayPal, through the Spire's invoice counts (#279).
  useEffect(() => startInvoices(), []);
  const linkList = useSystems((s) => s.links);
  const links = useMemo(() => Object.fromEntries(linkList.map((l) => [l.id, l.state])) as Record<string, LinkState>, [linkList]);
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const setup = useSetup();
  const next = nextCheck(now);
  const fg = useMemo(() => foundryGraph({ now, connected, data, setup: setup ? { direct: setup.direct, shape: setup.shape, images: setup.images } : null, nextCheck: next }), [now, connected, data, setup, next]);
  const reading = useWorldClock((s) => s.reading);
  const status = useWorldClock((s) => s.status);
  const cstate = clockState(reading, status, now);
  const headline = clockHeadline(reading, status, now);
  const world = useWorldFeed().feed;
  const setupList = useSetupStatus();
  const pings = setupList?.pings.vercel === "done" && setupList.pings.actions === "done";
  const vqa = useVisualQa().feed?.latest ?? null;
  const working = data.crates.find((c) => c.state === "working");
  const building = working ? CREW[crewOf(working, data.crates)].name : null;
  const model = systemsModel({ links, foundry: fg, connected, building, clock: { state: cstate, headline }, world, pings, vqa: vqa ? (VQA_STATE[describeRun(vqa).tone] ?? "off") : "off" });

  const rows = pipeRows(model.nodes, model.over, model.flows);

  const live = model.over.filter((e) => e.state === "ok" || e.state === "run").length;
  const waiting = model.over.filter((e) => e.state === "wait").length;
  const bad = Object.values(model.nodes)
    .filter((n) => n.state === "bad")
    .map((n) => n.l);
  const hour = reading?.step ?? null;
  const today = world?.recent.filter((e) => new Date(e.at).toDateString() === new Date(now).toDateString()).length ?? 0;

  return (
    <div className={`systems-page wv-page wv-sys rm-boiler${mode !== "overview" ? " is-focus" : ""}`}>
      <SystemsNav />
      <header className="wv-syshead">
        <img className="wv-syshead-pf" src="/desk/agent-soot.webp" alt="" />
        <div>
          <p className="wv-eyb">The Boiler Room · what's connected</p>
          <h1 className="wv-h1 desk__title">
            {bad.length ? (
              <>
                The Pessimist <em style={{ color: "var(--wv-bad)" }}>called it.</em>
              </>
            ) : (
              <>
                The Pessimist says the pipes are <em style={{ color: "var(--wv-ok)" }}>holding. For now.</em>
              </>
            )}
          </h1>
          <p className="wv-sub">
            {WORDS[live] ?? live} {live === 1 ? "connection" : "connections"} live{waiting ? `, ${waiting} not connected yet` : ""}
            {bad.length ? `, and ${bad.join(" and ")} ${bad.length === 1 ? "is" : "are"} down` : ""}. Every pipe is a room and every fitting on it a real connection. Tap a pipe to see its whole flow.
          </p>
        </div>
      </header>

      {mode === "overview" ? <PipeRack rows={rows} onOpen={setMode} /> : <SystemsGraph nodes={model.nodes} flows={model.flows} mode={mode} setMode={setMode} />}

      <div className="wv-gpick">
        {mode !== "overview" && (
          <div className="wv-gpick-l" role="group" aria-label="Open a room's flow">
            {FLOWS.map((f) => {
              const fl = model.flows[f];
              return (
                <button key={f} type="button" data-room={fl.room} className={mode === f ? "is-on" : undefined} aria-pressed={mode === f} onClick={() => setMode(mode === f ? "overview" : f)}>
                  <i className={`wv-dot${fl.stc === "wait" ? " is-ring" : ""}`} />
                  {FLOW_ROOM[f]}
                  <span>{f === "foundry" ? `${fl.edges.length} steps` : fl.stc === "wait" ? "not connected yet" : fl.t.replace(/^The /, "the ")}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="wv-gkey">
          <span>
            <i className="is-live" />
            Live
          </span>
          <span>
            <i className="is-run" />
            Running now
          </span>
          <span>
            <i className="is-wait" />
            Not connected yet
          </span>
        </div>
      </div>

      <div className="wv-sysrow">
        <section className="wv-tobuild">
          <div className="wv-sechead">
            <div>
              <p className="wv-eyb">Still to build</p>
              <h2 className="wv-h2">{WORDS[PLANNED.length]} pipes, not yet laid</h2>
            </div>
          </div>
          <ul className="wv-tb-l">
            {PLANNED.map((p) => (
              <li key={p.name} data-room={p.room}>
                <i className="wv-dot is-ring" />
                {p.href ? (
                  <a href={p.href} onClick={roomLink(p.href)}>
                    <b>{p.name}</b>
                  </a>
                ) : (
                  <b>{p.name}</b>
                )}
                <span>{p.what}</span>
              </li>
            ))}
          </ul>
        </section>
        <div className="wv-syscol">
        <section className="wv-sysclock" data-room="boiler">
          <p className="wv-eyb">World clock</p>
          <h2 className="wv-h2">{hour !== null && cstate !== "off" ? `Hour ${hour}, ${headline.toLowerCase()}` : headline}</h2>
          <p className="wv-note" style={{ marginTop: 8 }}>
            The hourly step that moves Ilyr forward. Written by Claude, kept in Azure Blob, read by the Lattice and this Desk.
          </p>
          <dl className="wv-facts">
            <div>
              <dt>Next step</dt>
              <dd>{nextLine(reading, now)}</dd>
            </div>
            <div>
              <dt>Hours written today</dt>
              <dd>{world ? today : "–"}</dd>
            </div>
            <div>
              <dt>This month</dt>
              <dd>
                {world ? (
                  <>
                    <Private>{formatUsd(world.spend.usd)}</Private> of {formatUsd(world.spend.budget)}
                  </>
                ) : (
                  "–"
                )}
              </dd>
            </div>
          </dl>
          <button className="wv-link" type="button" onClick={() => setMode("boiler")}>
            See its flow
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
        </section>
        <EmailCard load={emailLoad} status={emailStatus} now={now} onFlow={() => setMode("relay")} />
        </div>
      </div>

      <JobBoard now={now} />
      <LatticeTimings />

      <AskedSkippy room="boiler" />
      <SetupAsks room="boiler" />
      <RoomFeed room="boiler" />

      <Home />
    </div>
  );
}
