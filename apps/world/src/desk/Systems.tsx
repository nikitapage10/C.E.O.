import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { TalkTimings } from "./TalkTimings.tsx";
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
import { pressureHeadline, rackPressure } from "./boiler/pressure.ts";
import { ACCENT, Arrow, Rack, RoomDetail } from "./boiler/Rack.tsx";
import { reducedMotion } from "./wvCanvas.ts";
import "./rooms/rooms.css";
import "./boiler/boiler.css";
import { describeRun, useVisualQa } from "./visualqa/feed.ts";

/**
 * The Boiler Room (#390, on Today's flow kit; #369 before it): every real link C.E.O. depends on, drawn as particle
 * lines. On the stage, the headline and ledger read the whole rack's state in plain words, security stands beside them
 * as pass/fail and counts, and below them each room is one straight line of its connections (boiler/Rack.tsx): flowing,
 * under load, waiting or broken. A valve opens that one connection, a room's name opens its whole flow
 * (SystemsGraph.tsx, or RoomDetail for a room with no flow drawn yet). Under the stage, the instruments (the world
 * clock, Gmail, the scheduled jobs), the Lattice's load timings, what's still to build and the house. Counts and
 * states only, signed in or out; nothing is made up.
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
        Its whole flow
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
    <section className="bx-sec" aria-label="Security and compliance">
      <p className="fl-k">
        <span>Security</span> · pass or fail
      </p>
      <ul>
        {cells.map((c) => (
          <li key={c.k}>
            <a className={`is-${c.tone}`} href={c.href} onClick={go(c.href)}>
              <i aria-hidden="true" />
              <span>{c.k}</span>
              <b className="fl-num">{c.v}</b>
              <small>{c.s}</small>
            </a>
          </li>
        ))}
      </ul>
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

  // The rack is re-laid only when a state really changes, not on every tick of the clock.
  const sig = JSON.stringify(rows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => rows, [sig]);

  const detail = useRef<HTMLDivElement>(null);
  const openLine = (id: string | null) => setOpen(id);
  useEffect(() => {
    if (open && detail.current) detail.current.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [open]);
  useEffect(() => {
    if (!open || isFlow(open)) return; // the flow view has its own Esc
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const ctone: GState = cstate === "ok" ? "ok" : cstate === "down" ? "bad" : cstate === "slow" ? "run" : "wait";
  const day = new Date(now).toLocaleDateString(undefined, { weekday: "long" });

  const header = (
    <>
      <SystemsNav />
      <header className="bx-top">
        <div className="bx-top-t">
          <p className="fl-eyb">
            <span>Boiler Room</span>
            <i />
            {day} · {rows.length} rooms · {p.total} links
          </p>
          <h1 className="fl-h1 desk__title">
            {head.lead} <em className={`is-${head.tone}`}>{head.em}</em>
          </h1>
          <p className="fl-say">
            {p.flowing} of {p.total} links carry real data{p.dry ? `, ${p.dry} wait to be connected` : ""}. Tap a valve for one link, or a room for its whole flow.
          </p>
          <dl className="fl-ledger bx-ledger">
            <div className="is-ok">
              <dt>Flowing</dt>
              <dd>{p.flowing - p.run}</dd>
            </div>
            <div className="is-run">
              <dt>Under load</dt>
              <dd>{p.run}</dd>
            </div>
            <div className="is-wait">
              <dt>Waiting</dt>
              <dd>{p.dry}</dd>
            </div>
            <div className={`is-bad${p.burst ? " is-hot" : ""}`}>
              <dt>Broken</dt>
              <dd>{p.burst}</dd>
            </div>
          </dl>
        </div>
        <Posture />
      </header>
      <div className="bx-mhead">
        <p className="fl-k">
          <span>Every link</span> · one line a room, in the order its data flows
        </p>
        <ul className="bx-key" aria-label="Key">
          <li className="is-ok">Flowing</li>
          <li className="is-run">Under load</li>
          <li className="is-wait">Waiting</li>
          <li className="is-bad">Broken</li>
        </ul>
      </div>
    </>
  );

  return (
    <div className={`systems-page wv-page fl-page bx-page${row ? " is-open" : ""}`} data-room="boiler" style={{ "--fl-accent": ACCENT } as CSSProperties}>
      <Rack rows={stable} open={row ? row.id : null} onOpen={openLine} header={header} />

      {row && (
        <div className="bx-detail fl-below" key={row.id} ref={detail}>
          {isFlow(row.id) ? <SystemsGraph nodes={model.nodes} flows={model.flows} mode={row.id} setMode={(m) => setOpen(m === "overview" ? null : m)} /> : <RoomDetail r={row} onClose={() => setOpen(null)} />}
        </div>
      )}

      <div className="bx-cards fl-below">
        <section className={`bx-card is-${ctone}`} data-room="boiler" aria-label="World clock">
          <p className="bx-eyb">
            <i className={`bx-lampdot is-${ctone}`} aria-hidden="true" /> World clock · Ilyr's hourly step
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
            Its whole flow
            <Arrow />
          </button>
        </section>
        <EmailCard load={emailLoad} status={emailStatus} now={now} onFlow={() => openLine("relay")} />
        <JobBoard now={now} />
      </div>

      <div className="bx-folds fl-below">
        <LatticeTimings />
        <TalkTimings />

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
    </div>
  );
}
