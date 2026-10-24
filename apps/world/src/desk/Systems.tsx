import { useEffect, useMemo, useRef, useState } from "react";
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
import { PipeRack, RoomDetail } from "./PipeRack.tsx";
import { SystemsGraph } from "./SystemsGraph.tsx";
import { pipeRows, systemsModel, type FlowId, type GState } from "./systemsGraph.ts";
import { SystemsNav } from "./SystemsNav.tsx";
import { emailLine, linkOf, startEmail, useEmail, type EmailLoad, type EmailStatus } from "./email/email.ts";
import { startInvoices } from "./spire/invoices.ts";
import { startPolymarket } from "./exchange/polymarket.ts";
import { startGreen } from "./green/league.ts";
import { roomLink } from "./hero/roomLink.ts";
import { navigateTo } from "../route.ts";
import { Private } from "./Private.tsx";
import { Home } from "./rooms/Home.tsx";
import { SetupAsks } from "./skippy/SetupAsks.tsx";
import { useSecurityFeed } from "./security/feed.ts";
import { OWASP_LLM, owaspTally, EVALS } from "./security/model.ts";
import { Gauge } from "./boiler/Gauge.tsx";
import { pressureHeadline, rackPressure } from "./boiler/pressure.ts";
import { reducedMotion } from "./wvCanvas.ts";
import "./rooms/rooms.css";
import "./boiler/boiler.css";
import { describeRun, useVisualQa } from "./visualqa/feed.ts";

/**
 * The Boiler Room (#369, redrawn from the Weave's Systems page): the Lattice's own dark, hairline language in the
 * Boiler Room's steel and brass. On top, the pressure gauge and its readout, from every real connection's state; then
 * the manifold (PipeRack.tsx), one line per room with a valve for each connection in connections.ts and
 * foundryGraph.ts. Progressive disclosure all the way down: a valve opens that one connection, a line opens the room's
 * whole flow (SystemsGraph.tsx), and the instruments below show counts first with their lists behind a fold. The
 * security and compliance instruments show only pass/fail, scores and counts. Real states only; nothing is made up.
 */

/** Rooms whose real systems are still to come, in the order they're likely to be built; each page says what it waits on. */
const PLANNED: { room: string; name: string; what: string; href?: string }[] = [
  { room: "spire", name: "Spire", what: "The idea scout (PayPal invoices are live)", href: "/spire" },
  { room: "exchange", name: "Exchange", what: "Crypto and stock prices (Polymarket's odds and your US positions are live)", href: "/exchange" },
  { room: "green", name: "Green", what: "The weekly take from OpenAI (Sleeper's league and FantasyPros are live)", href: "/green" },
  { room: "workshop", name: "Workshop", what: "Meshy and the Bambu Lab printer", href: "/workshop" },
  { room: "studio", name: "Studio", what: "OpenAI images, ElevenLabs voices, the render job, TikTok and Instagram", href: "/studio" },
  { room: "boiler", name: "The house", what: "Google Nest, below" },
  { room: "breakroom", name: "Break Room", what: "Off the clock; shows the Veil countdown" },
];

const FLOWS: FlowId[] = ["foundry", "boiler", "archive", "relay"];
const isFlow = (id: string | null): id is FlowId => FLOWS.includes(id as FlowId);

/** The line to open: `?room=foundry` (any line's id), else none. */
function firstOpen(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("room");
  } catch {
    return null;
  }
}

const VQA_STATE: Record<string, LinkState> = { ok: "ok", slow: "ok", down: "down", off: "off" };

const sinceWord = (at: number | null, now: number) => {
  if (at === null) return "not yet";
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "under a minute ago";
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

const Arrow = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

/**
 * The Gmail instrument (#322): the email agent's line, live on the Azure copy since 2026-10-23. Built from the public
 * counts only (`EmailStatus`: counts, states, times), so it reads the same signed in or out; the mail stays on Relay.
 */
function EmailCard({ load, status, now, onFlow }: { load: EmailLoad; status: EmailStatus | null; now: number; onFlow: () => void }) {
  const link = linkOf(status);
  const tone: GState = link === "ok" ? "ok" : link === "down" ? "bad" : link === "slow" ? "run" : "wait";
  const head = load === "off" ? "On the Azure copy" : !status ? emailLine(load, status).replace(/^Email:\s*/, "") : link === "ok" ? "Live, read-only" : emailLine(load, status).replace(/^Email(?: agent)?:?\s*/i, "");
  return (
    <section className={`bx-card is-${tone}`} data-room="relay" aria-label="Gmail">
      <p className="bx-eyb">
        <i className={`bx-lampdot is-${tone}`} aria-hidden="true" /> Gmail · Relay's email line
      </p>
      <h2 className="bx-h2">{head.charAt(0).toUpperCase() + head.slice(1)}</h2>
      <dl className="bx-readout">
        <div>
          <dt>Need you</dt>
          <dd>{status ? status.needsYou : "–"}</dd>
        </div>
        <div>
          <dt>New today</dt>
          <dd>{status ? status.newToday : "–"}</dd>
        </div>
        <div>
          <dt>Cap used</dt>
          <dd>{status ? `${status.budgetPct}%` : "–"}</dd>
        </div>
      </dl>
      <details className="bx-fold">
        <summary>More on this line</summary>
        <p className="bx-note">Your inbox, read from the Azure copy every minute with read-only access. Dialtone sorts, Blasto advises; nothing is ever sent. Only these counts leave the passkey.</p>
        <dl className="bx-facts is-tight">
          <div>
            <dt>Last check</dt>
            <dd>{load === "off" ? "–" : sinceWord(status?.lastCheck ?? null, now)}</dd>
          </div>
          <div>
            <dt>FYI · noise</dt>
            <dd>{status ? `${status.fyi} · ${status.noise}` : "–"}</dd>
          </div>
        </dl>
      </details>
      <button className="bx-go" type="button" onClick={onFlow}>
        Its line in the manifold
        <Arrow />
      </button>
    </section>
  );
}

/** Security and compliance, as the public may see them: pass or fail, scores and counts. The details stay inside. */
function Posture() {
  const sec = useSecurityFeed().feed;
  const reported = sec?.workflows.filter((w) => w.state === "pass" || w.state === "fail") ?? [];
  const failing = reported.filter((w) => w.state === "fail").length;
  const alerts = sec ? (sec.alerts.codeScanning?.open ?? 0) + (sec.alerts.dependabot?.open ?? 0) : null;
  const alertsKnown = !!sec && (sec.alerts.codeScanning !== null || sec.alerts.dependabot !== null);
  const tally = owaspTally();
  const covered = tally.covered + tally.tracked;
  const go = (path: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateTo(path + window.location.search);
  };
  const cells: { k: string; v: string; s: string; tone: GState; href: string }[] = [
    { k: "Scans", v: reported.length ? `${reported.length - failing}/${reported.length}` : "–", s: !reported.length ? "waiting on GitHub" : failing ? `${failing} failing` : "all passing", tone: !reported.length ? "wait" : failing ? "bad" : "ok", href: "/boiler/security" },
    { k: "Scorecard", v: sec?.scorecard ? sec.scorecard.score.toFixed(1) : "–", s: sec?.scorecard ? "of 10, OpenSSF" : "not reported", tone: !sec?.scorecard ? "wait" : sec.scorecard.score >= 4 ? "ok" : "bad", href: "/boiler/security" },
    { k: "Open alerts", v: alertsKnown && alerts !== null ? String(alerts) : "–", s: alertsKnown ? "code and dependencies" : "not reported", tone: !alertsKnown ? "wait" : alerts ? "run" : "ok", href: "/boiler/security" },
    { k: "Injection evals", v: `${EVALS.passing}/${EVALS.total}`, s: "pass, every build", tone: EVALS.passing + EVALS.expectedFail === EVALS.total ? "ok" : "bad", href: "/boiler/security" },
    { k: "OWASP LLM", v: `${covered}/${OWASP_LLM.length}`, s: "risks covered", tone: covered === OWASP_LLM.length ? "ok" : "run", href: "/boiler/compliance" },
  ];
  return (
    <section className="bx-posture" aria-label="Security and compliance">
      {cells.map((c) => (
        <a key={c.k} className={`bx-pc is-${c.tone}`} href={c.href} onClick={go(c.href)}>
          <span className="bx-eyb">
            <i className={`bx-lampdot is-${c.tone}`} aria-hidden="true" />
            {c.k}
          </span>
          <b>{c.v}</b>
          <small>{c.s}</small>
        </a>
      ))}
      {/* #373: the Lattice's boot-timing reading slots in beside these, as one more instrument. */}
    </section>
  );
}

export function Systems({ now }: { now: number }) {
  const [open, setOpen] = useState<string | null>(firstOpen);
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
  const p = rackPressure(rows);
  const head = pressureHeadline(p);
  const row = rows.find((r) => r.id === open) ?? null;
  const hour = reading?.step ?? null;
  const today = world?.recent.filter((e) => new Date(e.at).toDateString() === new Date(now).toDateString()).length ?? 0;

  const manifold = useRef<HTMLElement>(null);
  const openLine = (id: string | null) => {
    setOpen(id);
    const el = manifold.current;
    if (id && el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  };
  useEffect(() => {
    if (!open || isFlow(open)) return; // the flow view has its own Esc
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`systems-page wv-page bx-page rm-boiler${row ? " is-open" : ""}`}>
      <SystemsNav />
      <header className="bx-top">
        <div className="bx-top-t">
          <p className="bx-eyb">The Boiler Room · pressure across every line</p>
          <h1 className="bx-h1 desk__title">
            {head.lead} <em className={`is-${head.tone}`}>{head.em}</em>
          </h1>
          <p className="bx-sub">
            {p.flowing} of {p.total} connections carry flow. Tap a valve for one connection, or a line for its room's whole flow.
          </p>
          <dl className="bx-count">
            <div className="is-ok">
              <dt>Flowing</dt>
              <dd>{p.flowing - p.run}</dd>
            </div>
            <div className="is-run">
              <dt>Running hot</dt>
              <dd>{p.run}</dd>
            </div>
            <div className="is-wait">
              <dt>Dry</dt>
              <dd>{p.dry}</dd>
            </div>
            <div className={`is-bad${p.burst ? " is-on" : ""}`}>
              <dt>Burst</dt>
              <dd>{p.burst}</dd>
            </div>
          </dl>
        </div>
        <Gauge p={p} tone={head.tone} />
      </header>

      <Posture />

      <section ref={manifold} className="bx-manifold" aria-label="The manifold">
        <div className="bx-mhead">
          <p className="bx-eyb">
            Manifold · {rows.length} lines · {p.total} valves
          </p>
          <ul className="bx-key-l" aria-label="Key">
            <li className="is-ok">Flowing</li>
            <li className="is-run">Running hot</li>
            <li className="is-wait">Dry</li>
            <li className="is-bad">Burst</li>
          </ul>
        </div>
        <PipeRack rows={rows} open={row ? row.id : null} onOpen={openLine} />
      </section>

      {row && (
        <div className="bx-detail" key={row.id}>
          {isFlow(row.id) ? <SystemsGraph nodes={model.nodes} flows={model.flows} mode={row.id} setMode={(m) => setOpen(m === "overview" ? null : m)} /> : <RoomDetail r={row} onClose={() => setOpen(null)} />}
        </div>
      )}

      <div className="bx-cards">
        <section className={`bx-card is-${cstate === "ok" ? "ok" : cstate === "down" ? "bad" : cstate === "slow" ? "run" : "wait"}`} data-room="boiler" aria-label="World clock">
          <p className="bx-eyb">
            <i className={`bx-lampdot is-${cstate === "ok" ? "ok" : cstate === "down" ? "bad" : cstate === "slow" ? "run" : "wait"}`} aria-hidden="true" /> World clock · Ilyr's hourly step
          </p>
          <h2 className="bx-h2">{hour !== null && cstate !== "off" ? `Hour ${hour}, ${headline.toLowerCase()}` : headline}</h2>
          <dl className="bx-readout">
            <div>
              <dt>Today</dt>
              <dd>{world ? today : "–"}</dd>
            </div>
            <div>
              <dt>Next</dt>
              <dd className="is-sm">{nextLine(reading, now).replace(/^Next step\s*/i, "")}</dd>
            </div>
            <div>
              <dt>This month</dt>
              <dd className="is-sm">{world ? <Private>{formatUsd(world.spend.usd)}</Private> : "–"}</dd>
            </div>
          </dl>
          <details className="bx-fold">
            <summary>More on this line</summary>
            <p className="bx-note">
              The hourly step that moves Ilyr forward. Written by Claude, kept in Azure Blob, read by the Lattice and this Desk.{world ? <> Budget <Private>{formatUsd(world.spend.budget)}</Private> a month.</> : null}
            </p>
          </details>
          <button className="bx-go" type="button" onClick={() => openLine("boiler")}>
            Its line in the manifold
            <Arrow />
          </button>
        </section>
        <EmailCard load={emailLoad} status={emailStatus} now={now} onFlow={() => openLine("relay")} />
        <JobBoard now={now} />
      </div>

      <LatticeTimings />

      <details className="bx-more">
        <summary>
          <span className="bx-eyb">Still to build</span>
          <b>{PLANNED.length} lines not yet laid</b>
        </summary>
        <ul className="bx-tb">
          {PLANNED.map((x) => (
            <li key={x.name} data-room={x.room}>
              <i className="bx-stub" aria-hidden="true" />
              {x.href ? (
                <a href={x.href} onClick={roomLink(x.href)}>
                  <b>{x.name}</b>
                </a>
              ) : (
                <b>{x.name}</b>
              )}
              <span>{x.what}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className="bx-more">
        <summary>
          <span className="bx-eyb">The house · comes later</span>
          <b>Heating that follows you, waiting on Google Nest</b>
        </summary>
        <Home />
      </details>

      <SetupAsks room="boiler" />
    </div>
  );
}
