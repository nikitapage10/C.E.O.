import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/overpass-mono";
import { usePings } from "@ceo/engine/web/pings.ts";
import { HOME_SCREEN_HINT } from "@ceo/engine/web/PingSwitch.tsx";
import { RECOVERY, type SiteStatus } from "@ceo/engine/web/SitePassword.tsx";
import { useWorldFeed } from "../../../apps/world/src/chronicle.ts";
import { useFoundry } from "../../../apps/world/src/foundry.ts";
import { navigateTo } from "../../../apps/world/src/route.ts";
import { useSystems, type LinkState } from "../../../apps/world/src/systems.ts";
import { CLAUDE_USAGE_URL, codeTokensByModel, foundryJobs, formatTokens, formatUsd, monthSpend, MODELS, SPEND_CAP_USD, useUsage, workByModel, type Trail } from "../../../apps/world/src/usage.ts";
import { startEmail, useEmail } from "../../relay/data/email.ts";
import { startPolymarket } from "../../exchange/data/polymarket.ts";
import { ago } from "../../../apps/world/src/desk/foundryGraph.ts";
import { startGreen } from "../../green/data/league.ts";
import { useSetup } from "../../../apps/world/src/desk/IdeaCard.tsx";
import { Private } from "@ceo/engine/web/Private.tsx";
import { KeysPanel } from "./KeysPanel.tsx";
import { PhonesPanel } from "./PhonesPanel.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { startInvoices } from "../../spire/data/invoices.ts";
import { SystemsNav } from "./SystemsNav.tsx";
import { startTexts } from "../../relay/data/texts.ts";
import { mtTime } from "../../today/data/todaySchedule.ts";
import { startHome, useHome } from "../../../apps/world/src/desk/homeDevices.ts";
import { GoogleLinks, HAVEN_RESULT, KrogerSetup, PetSetup, RoborockSetup } from "./HouseSetup.tsx";
import { ACCENT } from "./Rack.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { ToolsChart, ToolsDetail, toolsSub, useToolbelt } from "./ToolsPanel.tsx";
import { actionOf, actionWord, costumeState, houseRows, meterTone, monthClock, pipeOf, projectMonth, quietState, shareWidths, SKIPPY_AGENT_CAP_USD, SKIPPY_AGENT_WARN_USD, TONE_WORD, type MeterTone, type Share } from "../data/controls.ts";
import "./controls.css";
import { BoilerFrame, CapBar, Donut, Panel, Spark, SyncStrip, useOpen } from "./frame.tsx";
import { controlsNeeds, dailySeries, linkTally, monthSince, syncMark, type LinkRow, type MeterRead, type NeedGo } from "../data/pages.ts";

/**
 * Boiler Room > Controls (#647): every meter, switch, link and key in one panel board. The circuits run down one bus,
 * A to F: the meters (the Claude Code plan, the Claude API against its $10, Skippy as an agent against $60, voice,
 * and Relay), the breakers (pings, quiet hours, the site lock, the wake word, auto-approval, the costume party), every
 * connection with its lamp, the Settings (Hide, Hands-free, Ilyr's clock and what runs next, moved here from the bar
 * and Today in #666), Skippy's tools (#847: every tool his agent can call, room by room), then the Keys form and the
 * Phones (moved here from Security). Real data only: a meter with
 * nothing to read says it's waiting. Signed out, it shows states and counts only: no money, no keys, no contacts.
 */

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];

/* ── the meters ── */

interface MeterSpec {
  id: string;
  name: string;
  /** Who it pays, in a few words. */
  what: string;
  used: number | null;
  cap: number | null;
  warnAt?: number;
  shares?: Share[];
  /** What it waits on, when it has nothing to read. */
  waiting?: string;
  /** The setting that holds the cap, named only. */
  capFrom?: string;
  /** Extra lines under the readout. */
  foot?: ReactNode;
  /** A meter with no month (the plan) draws its own body. */
  body?: ReactNode;
}

function Meter({ m, n, signedIn, now }: { m: MeterSpec; n: number; signedIn: boolean; now: number }) {
  const tone: MeterTone = m.body ? "wait" : meterTone(m.used, m.cap, m.warnAt);
  const { daysLeft } = monthClock(now);
  const cap = m.cap ?? 0;
  const used = m.used ?? 0;
  const share = cap > 0 ? used / cap : 0;
  const proj = m.used !== null && cap > 0 ? projectMonth(used, now) : null;
  const warn = cap > 0 ? (m.warnAt ?? cap * 0.8) / cap : 0.8;
  const widths = m.shares && cap > 0 ? shareWidths(m.shares, cap) : [];
  const showFig = signedIn && m.used !== null && m.cap !== null;
  return (
    <article className={`ct-meter is-${tone}`} aria-label={`${m.name}: ${TONE_WORD[tone]}`} style={{ "--i": n } as CSSProperties}>
      <header className="ct-mh">
        <span className="ct-cir">A{n + 1}</span>
        <h3>{m.name}</h3>
        <i className="ct-lamp" aria-hidden="true" />
      </header>
      <p className="ct-what">{m.what}</p>
      {m.body ?? (
        <>
          <p className="ct-read">
            {showFig ? (
              <>
                <b>
                  <Private>{formatUsd(used)}</Private>
                </b>
                <span>
                  / <Private>{formatUsd(cap)}</Private>
                </span>
              </>
            ) : (
              <b className="ct-word">{TONE_WORD[tone]}</b>
            )}
          </p>
          <div
            className="ct-scale"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={showFig ? Math.round(share * 100) : undefined}
            aria-valuetext={showFig ? `${Math.round(share * 100)}% of its cap` : TONE_WORD[tone]}
            aria-label={`${m.name}, share of its cap`}
            style={{ "--warn": warn, "--v": showFig ? Math.min(1, share) : 0, "--p": showFig && proj !== null ? Math.min(1.08, proj / cap) : 0 } as CSSProperties}
          >
            <span className="ct-zone" aria-hidden="true" />
            {showFig
              ? widths.map((w, i) => <span key={w.id} className="ct-fill" style={{ "--from": w.from, "--w": w.width, "--k": i } as CSSProperties} aria-hidden="true" />)
              : null}
            {showFig && !widths.length ? <span className="ct-fill" style={{ "--from": 0, "--w": Math.min(1, share), "--k": 0 } as CSSProperties} aria-hidden="true" /> : null}
            {showFig ? <span className="ct-needle" aria-hidden="true" /> : null}
            {showFig && proj !== null && proj > used ? <span className="ct-ghost" aria-hidden="true" /> : null}
            <span className="ct-ticks" aria-hidden="true" />
          </div>
          <dl className="ct-facts">
            <div>
              <dt>Used</dt>
              <dd>{showFig ? `${share < 0.01 && used > 0 ? "<1" : Math.round(share * 100)}%` : "–"}</dd>
            </div>
            <div>
              <dt>Days left</dt>
              <dd>{m.cap !== null ? daysLeft : "–"}</dd>
            </div>
            <div>
              <dt>Month-end</dt>
              <dd>{showFig && proj !== null ? <Private>{`~${formatUsd(proj)}`}</Private> : "–"}</dd>
            </div>
          </dl>
          {m.shares && m.shares.length ? (
            <ul className="ct-shares" aria-label="Split by share">
              {m.shares.map((s, i) => (
                <li key={s.id} style={{ "--k": i } as CSSProperties}>
                  <i aria-hidden="true" />
                  <span>{s.label}</span>
                  {signedIn ? <b>{m.used !== null ? <Private>{formatUsd(s.usd)}</Private> : "–"}</b> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {m.waiting && tone === "wait" ? <p className="ct-note">{m.waiting}</p> : null}
          {m.foot}
          {signedIn && m.cap !== null ? <RaiseCap name={m.name} from={m.capFrom} /> : null}
        </>
      )}
    </article>
  );
}

/**
 * Raising a cap needs the passkey step-up, like a key (#330). The caps are settings on the Function App, which the
 * Desk can't write yet, so the control stays locked and says where the cap lives.
 */
function RaiseCap({ name, from }: { name: string; from?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ct-raise">
      <button type="button" className="ct-btn is-quiet" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Raise ${name}'s cap`}>
        Raise cap
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="none" stroke="currentColor" />
          <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" />
        </svg>
      </button>
      {open ? (
        <p className="ct-note" role="status">
          Raising a cap asks for your passkey, the way a key does. {from ? <>This one is {from}. </> : null}The Desk can't change caps yet, so it's still set where it lives.
        </p>
      ) : null}
    </div>
  );
}

function useMeterSpecs(now: number, signedIn: boolean): MeterSpec[] {
  const usage = useUsage();
  const world = useWorldFeed();
  const emailView = useEmail((s) => s.view);
  const feed = usage.feed;
  const w = world.feed;
  const shaping = feed ? monthSpend(feed.trails, now).usd : null;
  const claudeKnown = w !== null || shaping !== null;
  const claude: Share[] = [
    { id: "world", label: "The living Lattice, hourly", usd: w?.spend.usd ?? 0 },
    { id: "scripts", label: "Today's scripts", usd: w?.story?.scriptUsd ?? 0 },
    { id: "shaping", label: "Rivet's idea shaping", usd: shaping ?? 0 },
  ];
  const s = w?.story;
  const voice: Share[] = s ? [
    { id: "story", label: "Today in Ilyr, read aloud", usd: s.elevenUsd ?? 0 },
    { id: "talk", label: "Talk, Skippy's live voice", usd: s.voiceUsd ?? 0 },
  ] : [];
  const mail = emailView?.spend ?? null;
  const tok5 = feed ? codeTokensByModel(feed.trails, "5h", now) : null;
  const tokW = feed ? codeTokensByModel(feed.trails, "week", now) : null;
  const jobs = feed ? foundryJobs(feed.issues, feed.trails) : null;
  const job5 = jobs ? workByModel(jobs, "5h", now) : null;
  const jobW = jobs ? workByModel(jobs, "week", now) : null;
  const sum = (r: Record<string, number | null> | null) => (r ? MODELS.reduce<number | null>((a, m) => (r[m] === null ? a : (a ?? 0) + r[m]!), null) : null);
  const jobsIn = (r: ReturnType<typeof workByModel> | null) => (r ? MODELS.reduce((a, m) => a + r[m].jobs, 0) : null);

  const plan: MeterSpec = {
    id: "plan",
    name: "Claude Code plan",
    what: "The crew's Claude Code, on your plan, not API money",
    used: null,
    cap: null,
    body: (
      <>
        <div className="ct-plan">
          {[
            { k: "5-hour window", t: sum(tok5), j: jobsIn(job5) },
            { k: "This week", t: sum(tokW), j: jobsIn(jobW) },
          ].map((r) => (
            <div key={r.k}>
              <dt>{r.k}</dt>
              <dd>
                <b>{feed ? formatTokens(r.t) : "–"}</b>
                <span>{feed ? `tokens · ${r.j} ${r.j === 1 ? "job" : "jobs"}` : "reading the trails…"}</span>
              </dd>
            </div>
          ))}
        </div>
        <div className="ct-scale is-blank" aria-hidden="true">
          <span className="ct-zone" />
          <span className="ct-ticks" />
        </div>
        <p className="ct-note">
          Counted from the Foundry's trails. The plan's own limit lives on{" "}
          <a href={CLAUDE_USAGE_URL} target="_blank" rel="noreferrer">
            Claude's usage page ↗
          </a>
          , which a website can't read, so this meter has no needle.
        </p>
      </>
    ),
  };

  const meters: MeterSpec[] = [
    plan,
    {
      id: "claude",
      name: "Claude API",
      what: signedIn ? "The world, Today's scripts and Rivet, on one $10 cap" : "The world, Today's scripts and Rivet, on one shared cap",
      used: claudeKnown ? claude.reduce((a, x) => a + x.usd, 0) : null,
      cap: SPEND_CAP_USD,
      shares: claude,
      capFrom: "set in code at $10, with WORLD_BUDGET_USD for the world's share",
      waiting: "Waiting for the world's ledger and the Foundry's trails.",
      foot: <p className="ct-note">Skippy's chat (SKIPPY_BUDGET_USD) and the Kernel agent keep their own ledgers, which the Desk can't read yet.</p>,
    },
    {
      id: "skippy",
      name: "Skippy agent",
      what: "Skippy as a full agent: memory, room tools, subminds",
      used: null,
      cap: SKIPPY_AGENT_CAP_USD,
      warnAt: SKIPPY_AGENT_WARN_USD,
      capFrom: "SKIPPY_BUDGET_USD once #646 ships",
      waiting: signedIn ? `Waiting on #646: its ledger isn't built yet. The cap will be $${SKIPPY_AGENT_CAP_USD}, with a warning at $${SKIPPY_AGENT_WARN_USD}.` : "Waiting on #646: its ledger isn't built yet.",
    },
    {
      id: "voice",
      name: "Voice",
      what: "ElevenLabs: Today in Ilyr and Skippy's live Talk",
      used: s ? voice.reduce((a, x) => a + x.usd, 0) : null,
      cap: s ? s.elevenBudget : null,
      shares: voice,
      capFrom: "ELEVENLABS_BUDGET_USD",
      waiting: world.status === "off" ? "The world isn't saving yet, so there's no voice ledger." : world.status === "failed" ? "Can't reach the world right now." : "Reading the voice ledger…",
      foot: s && !s.eleven ? <p className="ct-note">No ElevenLabs key is set, so nothing is spent.</p> : null,
    },
    {
      id: "openai",
      name: "OpenAI · Relay",
      what: "Relay's OpenAI line",
      used: null,
      cap: null,
      waiting: "Waiting: Relay sorts and drafts on Claude today, so no OpenAI line is wired and nothing is spent.",
    },
    {
      id: "mail",
      name: "Relay mail",
      what: "The email agent's Claude, Dialtone and Blasto",
      used: signedIn && mail ? mail.usd : null,
      cap: signedIn && mail ? mail.budget : null,
      capFrom: "EMAIL_BUDGET_USD",
      waiting: signedIn ? "Waiting for the email agent's ledger (on the Azure copy)." : "Sign in to read it.",
    },
  ];

  // Signed out, the mail meter gives its state from the agent's public share of its cap (a percentage, never money).
  const pct = w?.email?.budgetPct;
  return meters.map((m) => (m.id === "mail" && !signedIn && typeof pct === "number" ? { ...m, waiting: undefined, used: pct, cap: 100 } : m));
}

function Meters({ shown, now, signedIn }: { shown: MeterSpec[]; now: number; signedIn: boolean }) {
  return (
    <div className="ct-meters">
      {shown.map((m, i) => (
        <Meter key={m.id} m={m} n={i} signedIn={signedIn} now={now} />
      ))}
    </div>
  );
}

/* ── the breakers ── */

interface BreakerSpec {
  id: string;
  name: string;
  line: string;
  on: boolean | null;
  kind: "switch" | "schedule" | "rule" | "not built";
  changed: string;
  /** The switch's own control, when it can be flipped here. */
  flip?: () => void;
  busy?: boolean;
  note?: string;
}

async function sitePassword(method: "GET" | "POST", body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch("/api/site-password", { method, credentials: "same-origin", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

function Breakers({ now, signedIn, compact = false }: { now: number; signedIn: boolean; compact?: boolean }) {
  const pings = usePings();
  const checkPings = usePings((p) => p.check);
  const [site, setSite] = useState<SiteStatus | null>(null);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteNote, setSiteNote] = useState("");
  const changelog = useFoundry((s) => s.data.changelog);
  useEffect(() => {
    void checkPings();
  }, [checkPings]);
  useEffect(() => {
    if (!signedIn) return setSite(null);
    let live = true;
    void sitePassword("GET")
      .then((r) => live && r.status === 200 && setSite(r.data as unknown as SiteStatus))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signedIn]);

  const flipSite = () => {
    if (!site || site.source === "off" || site.source === "none") return;
    const lock = !site.on;
    if (lock && !window.confirm(`Lock the site? Every device signs in once with your Desk passkey.\n\n${RECOVERY}`)) return;
    if (!lock && !window.confirm("Unlock the site? Anyone with the address can open it again.")) return;
    setSiteBusy(true);
    setSiteNote("");
    void sitePassword("POST", { action: lock ? "lock" : "off" }).then(
      (r) => {
        setSiteBusy(false);
        if (r.status === 401) return void useDeskAuth.getState().lost();
        if (r.status !== 200) return setSiteNote("That didn't go through. Try again.");
        setSite(r.data as unknown as SiteStatus);
      },
      () => {
        setSiteBusy(false);
        setSiteNote("That didn't go through. Try again.");
      },
    );
  };

  const quiet = quietState(now);
  const party = costumeState(now);
  const lastAuto = changelog.filter((c) => c.approval === "auto").reduce<number | null>((a, c) => (a === null || c.at > a ? c.at : a), null);
  const siteFixed = site?.source === "off" || site?.source === "none";
  const pingCan = signedIn && pings.support === "ok" && pings.state !== "blocked" && pings.state !== "not-set-up" && pings.state !== "checking";

  const breakers: BreakerSpec[] = [
    {
      id: "pings",
      name: "Pings",
      line: "One notification on this device when something needs your call.",
      on: pings.support === "unsupported" ? null : pings.state === "on",
      kind: "switch",
      changed: pings.support === "home-screen" ? HOME_SCREEN_HINT : pings.support === "unsupported" ? "This browser can't take pings." : !signedIn ? "Sign in to switch it." : pings.note || "This device only.",
      busy: pings.state === "busy" || pings.state === "checking",
      flip: pingCan ? () => (pings.state === "on" ? void pings.turnOff() : void pings.turnOn().then((r) => r === "signed-out" && useDeskAuth.getState().lost())) : undefined,
    },
    {
      id: "quiet",
      name: "Quiet hours",
      line: "Pings hold from 10 pm to 7 am, Mountain.",
      on: quiet.on,
      kind: "schedule",
      changed: `${quiet.on ? "Quiet" : "Open"} since ${ago(quiet.changed, now)}, ${quiet.on ? "ends" : "starts"} ${mtTime(quiet.next)}`,
    },
    {
      id: "site",
      name: "Site lock",
      line: "Every device signs in once with your Desk passkey.",
      on: site ? site.on : null,
      kind: "switch",
      changed: !signedIn ? "Sign in to see it." : !site ? "Reading…" : siteFixed ? (site.source === "off" ? "Off on the server (SITE_GATE=off)." : "No store on this server.") : site.on && site.locked ? `Locked ${ago(Date.parse(site.locked), now)}` : site.on ? "Locked" : "Unlocked",
      busy: siteBusy,
      note: siteNote,
      flip: signedIn && site && !siteFixed ? flipSite : undefined,
    },
    {
      id: "wake",
      name: "Wake word",
      line: "Nothing listens until you tap Talk.",
      on: false,
      kind: "not built",
      changed: "No wake word: Talk opens on a tap.",
    },
    {
      id: "auto",
      name: "Auto-approval",
      line: "The Builder may approve its own low-risk builds; you can stop one until it ships.",
      on: true,
      kind: "rule",
      changed: lastAuto ? `Last used ${ago(lastAuto, now)}` : "Not used on anything shipped yet.",
    },
    {
      id: "party",
      name: "Costume party",
      line: "The Hallowed Veil in the Lattice: on Halloween night, or when the Kernel console calls it.",
      on: party.on,
      kind: "schedule",
      changed: `${party.on ? "On" : "Off"} since ${new Date(party.changed).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
    },
  ];

  if (compact)
    return (
      <ul className="bx-lamps" aria-label="Breakers">
        {breakers.map((b) => (
          <li key={b.id}>
            <i className={`bx-dot is-${b.on === null ? "wait" : b.on ? "on" : "off"}`} aria-hidden="true" />
            <span>
              <b>{b.name}</b>
              <small>
                {b.on === null ? "–" : b.on ? "On" : "Off"} · {b.kind}
              </small>
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <ul className="ct-breakers">
      {breakers.map((b, i) => (
        <li key={b.id} className={`ct-brk is-${b.on === null ? "unk" : b.on ? "on" : "off"}`}>
          <span className="ct-cir">B{i + 1}</span>
          <button
            type="button"
            role="switch"
            className="ct-tog"
            aria-checked={b.on === true}
            aria-label={b.name}
            disabled={!b.flip || b.busy}
            onClick={b.flip}
            title={b.flip ? `Switch ${b.name.toLowerCase()} ${b.on ? "off" : "on"}` : b.kind === "switch" ? b.changed : `${b.name}: ${b.kind}`}
          >
            <i aria-hidden="true" />
          </button>
          <div className="ct-brk-t">
            <b>{b.name}</b>
            <span className="ct-brk-st">
              {b.on === null ? "–" : b.on ? "On" : "Off"} · {b.kind}
            </span>
            <p>{b.line}</p>
            <small>{b.changed}</small>
            {b.note ? (
              <small className="ct-warnline" role="status">
                {b.note}
              </small>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── the connections ── */

const LAMP_WORD: Record<LinkState, string> = { ok: "Live", slow: "Under load", down: "Down", off: "Waiting" };

function useLinkRows(): LinkRow[] {
  const links = useSystems((s) => s.links);
  const connected = useFoundry((s) => s.connected);
  const setup = useSetup();
  const extra: { id: string; label: string; what: string; room: string; state: LinkState; lastSeen: number | null; word?: string }[] = [
    { id: "github", label: "GitHub", what: "The Desk reads the crew's work from the repo", room: "foundry", state: connected ? "ok" : "off", lastSeen: null },
    { id: "buttons", label: "Idea buttons", what: "Build, Revise and Not this one change GitHub at once", room: "foundry", state: setup === null ? "off" : setup.buttons ? "ok" : "slow", lastSeen: null, word: setup && !setup.buttons ? "Needs setup" : undefined },
    { id: "images", label: "Pictures on ideas", what: "Paste, attach or drop pictures on an idea (Azure Blob)", room: "foundry", state: setup === null ? "off" : setup.images ? "ok" : "slow", lastSeen: null, word: setup && !setup.images ? "Needs setup" : undefined },
    { id: "shaping", label: "Quick shaping", what: "Rivet shapes an idea in a second or two (Claude)", room: "foundry", state: setup === null ? "off" : setup.shape ? "ok" : "off", lastSeen: null },
  ];
  // The house's own links (#672): Roborock, Petlibro, Whisker, Nest, Tasks and Instacart, from the home devices' real states.
  useEffect(() => startHome(), []);
  const homePub = useHome((s) => s.pub);
  const homeProblems = useHome((s) => s.view?.problems);
  const house = houseRows(homePub?.vendors ?? null, homePub?.links ?? null, homeProblems);
  return [...links.map((l) => ({ id: l.id, label: l.label, what: l.what, room: l.room as string, state: l.state, lastSeen: l.lastSeen, word: undefined as string | undefined })), ...house, ...extra];
}

function Connections({ rows, now, signedIn, openKeys }: { rows: LinkRow[]; now: number; signedIn: boolean; openKeys: () => void }) {
  const emailView = useEmail((s) => s.view);
  const emailBusy = useEmail((s) => s.busy);
  const emailError = useEmail((s) => s.error);
  const live = rows.filter((r) => r.state === "ok" || r.state === "slow").length;

  const toKeys = openKeys;
  const goPipe = (room: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateTo(`/boiler?room=${pipeOf(room)}`);
  };

  return (
    <>
      <p className="ct-sub">
        {live} of {rows.length} live
      </p>
      <ul className="ct-links">
        {rows.map((r) => {
          const action = actionOf(r.id);
          const word = signedIn ? actionWord(action, r.state) : null;
          const canGmail = action.kind === "gmail" && (emailView?.canConnect ?? false);
          const run =
            action.kind === "key"
              ? toKeys
              : action.kind === "gmail" && canGmail
                ? () => {
                    const st = useEmail.getState();
                    if (r.state === "ok" || r.state === "slow") {
                      if (window.confirm("Disconnect Gmail? The email agent stops reading until you connect it again.")) void st.disconnect();
                    } else void st.connect();
                  }
                : null;
          return (
            <li key={r.id} className={`ct-link is-${r.state}`}>
              <i className="ct-lamp" aria-hidden="true" />
              <b>{r.label}</b>
              <span className="ct-link-st">{r.word ?? LAMP_WORD[r.state]}</span>
              <span className="ct-link-what">{r.what}</span>
              <span className="ct-link-seen">{r.lastSeen ? ago(r.lastSeen, now) : ""}</span>
              <span className="ct-link-do">
                {word && run ? (
                  <button type="button" className="ct-btn" onClick={run} disabled={action.kind === "gmail" && emailBusy}>
                    {word}
                  </button>
                ) : null}
                <a href={`/boiler?room=${pipeOf(r.room)}`} onClick={goPipe(r.room)} className="ct-pipe">
                  Its pipe →
                </a>
              </span>
            </li>
          );
        })}
      </ul>
      {emailError && signedIn ? (
        <p className="ct-note" role="status">
          {emailError}
        </p>
      ) : null}
    </>
  );
}

/**
 * The house's own connections (#647; Nikita, 05:53Z): Connect Nest, Google Tasks and its list, Check now, and
 * Roborock, moved here from Today's Home chip, with Petlibro's and Whisker's state and why one is down (#672). Google's controls read /api/haven/google on their own, so they show
 * even before any home device is set up. Signed in only.
 */
function HouseSetup() {
  const [said] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("kroger")) return null;
      return HAVEN_RESULT[q.get("haven") ?? ""] ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => startHome(), []);
  useEffect(() => {
    if (said || new URLSearchParams(window.location.search).get("kroger")) requestAnimationFrame(() => document.getElementById("ct-house")?.scrollIntoView({ block: "start" }));
  }, [said]);
  return (
    <div className="ct-house" id="ct-house">
      <h3>The house · Google, Roborock, Petlibro, Whisker and King Soopers</h3>
      {said ? (
        <p className="ct-note ct-said" role="status">
          {said}
        </p>
      ) : null}
      <GoogleLinks />
      <RoborockSetup />
      <PetSetup />
      <KrogerSetup />
    </div>
  );
}

/* ── the page (#746, the C3 concept): Needs you, then the circuits as charts, each opening to its full detail ── */

const OPEN_FOR: Record<string, string> = { "ct-house": "ct-links", "ct-links": "ct-links", "ct-keys": "ct-keys", "ct-meters": "ct-meters", "ct-breakers": "ct-breakers", "ct-settings": "ct-settings", "ct-phones": "ct-phones", "ct-tools": "ct-tools" };
const ROW_CAP = 8;

function MeterChart({ shown, now, signedIn, trails }: { shown: MeterSpec[]; now: number; signedIn: boolean; trails: Trail[] | null }) {
  const tokens = trails ? dailySeries(trails, now, "code-tokens") : null;
  const shaping = trails ? dailySeries(trails, now, "shaping-calls") : null;
  const since = monthSince(now);
  return (
    <ul className="bx-rows" aria-label="Spend against each cap">
      {shown.map((m) => {
        const tone: MeterTone = m.body ? "wait" : meterTone(m.used, m.cap, m.warnAt);
        const showFig = signedIn && m.used !== null && m.cap !== null && m.cap > 0;
        const share = showFig ? m.used! / m.cap! : null;
        const proj = showFig ? projectMonth(m.used!, now) / m.cap! : null;
        const series = m.id === "plan" ? tokens : m.id === "claude" ? shaping : null;
        const said =
          m.id === "plan"
            ? tokens
              ? "Claude Code tokens a day, last 30 days"
              : trails
                ? "No shipped work with token counts in the last 30 days."
                : "Waiting for the Foundry's trails."
            : m.id === "claude"
              ? shaping
                ? `Rivet's shaping, calls a day · the world and scripts keep a month total ${since}`
                : `Month total only, ${since}`
              : tone === "wait"
                ? (m.waiting ?? "Waiting.")
                : `Month total only, ${since}; no daily history yet`;
        return (
          <li key={m.id} className={`is-${tone === "ok" ? "ok" : tone}`}>
            <i className="bx-dot" aria-hidden="true" />
            <b title={m.what}>{m.name}</b>
            <span className="bx-chart">{m.body ? <span className="bx-note">Plan limit lives on Claude's page</span> : <CapBar share={share} proj={proj} warn={m.cap && m.warnAt ? m.warnAt / m.cap : 0.8} tone={tone} />}</span>
            {m.body ? (
              <span className="bx-word">{tokens ? formatTokens(tokens.reduce((a, x) => a + x, 0)) + " · 30 d" : "–"}</span>
            ) : showFig ? (
              <span className="bx-fig">
                <Private>{formatUsd(m.used!)}</Private> / <Private>{formatUsd(m.cap!)}</Private>
              </span>
            ) : (
              <span className="bx-word">{TONE_WORD[tone]}</span>
            )}
            <span className="bx-sub2">
              {series ? <Spark values={series} /> : null}
              <span>{said}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function LinkChart({ rows, now }: { rows: LinkRow[]; now: number }) {
  const t = linkTally(rows);
  const rank = (r: LinkRow) => (r.state === "down" ? 0 : r.lastSeen !== null ? 1 : r.state === "ok" || r.state === "slow" ? 2 : 3);
  const shown = [...rows].sort((a, b) => rank(a) - rank(b) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0)).slice(0, ROW_CAP);
  const rest = rows.length - shown.length;
  return (
    <div className="bx-links">
      <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
        <Donut
          parts={[
            { n: t.live, tone: "live" },
            { n: t.waiting, tone: "waiting" },
            { n: t.down, tone: "down" },
          ]}
          label={
            <>
              <b>
                {t.live}/{rows.length}
              </b>
              <small>live</small>
            </>
          }
        />
        <ul className="bx-legend" aria-label="Connections by state">
          <li className="is-live">
            <i className="bx-dot" aria-hidden="true" />
            Live <b>{t.live}</b>
          </li>
          <li className="is-waiting">
            <i className="bx-dot" aria-hidden="true" />
            Waiting <b>{t.waiting}</b>
          </li>
          <li className="is-down">
            <i className="bx-dot" aria-hidden="true" />
            Down <b>{t.down}</b>
          </li>
        </ul>
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
        <ul className="bx-rows" aria-label="Each link's last day">
          {shown.map((r) => {
            const tone = r.state === "down" ? "down" : r.state === "off" ? "waiting" : "live";
            return (
              <li key={r.id} className={`is-${tone}`}>
                <i className="bx-dot" aria-hidden="true" />
                <b title={r.what}>{r.label}</b>
                <span className="bx-chart">
                  <SyncStrip pos={syncMark(r.lastSeen, now)} tone={tone} />
                </span>
                <span className="bx-word">{r.word ?? (r.lastSeen ? ago(r.lastSeen, now) : LAMP_WORD[r.state])}</span>
              </li>
            );
          })}
        </ul>
        <p className="bx-note">
          Strips are the last 24 hours; the tick is when a link last answered{rest > 0 ? ` · ${rest} more in Details` : ""}. Links that report only a state have no tick.
        </p>
      </div>
    </div>
  );
}

export function ControlsPage({ now }: { now: number }) {
  const signedIn = useDeskAuth((s) => s.auth.status === "in");
  // The links read their true state while this page is open, as the pipes page does.
  useEffect(() => startPolymarket(), []);
  useEffect(() => startEmail(), []);
  useEffect(() => startGreen(), []);
  useEffect(() => startInvoices(), []);
  useEffect(() => startHome(), []);
  useEffect(() => startTexts(), []);
  const usage = useUsage().feed;
  const shown = useMeterSpecs(now, signedIn);
  const rows = useLinkRows();
  const [open, toggle] = useOpen();
  const belt = useToolbelt();

  const reads: MeterRead[] = shown.filter((m) => !m.body).map((m) => ({ id: m.id, name: m.name, tone: meterTone(m.used, m.cap, m.warnAt), share: signedIn && m.used !== null && m.cap ? m.used / m.cap : null }));
  const needs = controlsNeeds(rows, reads, signedIn);
  const reading = reads.filter((m) => m.tone !== "wait").length;
  const hot = reads.filter((m) => m.tone === "warn" || m.tone === "over").length;
  const over = reads.filter((m) => m.tone === "over").length;
  const t = linkTally(rows);

  const openTo = (id: string) => {
    toggle(OPEN_FOR[id] ?? id, true);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" })));
  };
  // A down link named on Today or in the Senate (#link-hub) lands on its "Needs you" card, scrolled to and lit; if
  // the link isn't down by the time the links have read, it opens the connections instead.
  const [focus, setFocus] = useState<string | null>(null);
  const needIds = needs.map((x) => x.id).join(" ");
  useEffect(() => {
    if (!focus) return;
    const card = document.querySelector<HTMLElement>(`.bx-need[data-need="${CSS.escape(focus)}"]`);
    if (card) {
      card.classList.add("is-focus");
      card.scrollIntoView({ block: "center" });
      setFocus(null);
      return;
    }
    const t = window.setTimeout(() => {
      setFocus(null);
      openTo("ct-links");
    }, 5000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, needIds]);
  // A deep link (#ct-house, #ct-keys, a Haven or King Soopers return) opens the circuit it points into.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      const q = new URLSearchParams(window.location.search);
      if (OPEN_FOR[h]) openTo(h);
      else if (h.startsWith("link-")) setFocus(h);
      else if (q.get("haven") || q.get("kroger")) openTo("ct-house");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGo = (go: NeedGo) => {
    if (go.kind === "circuit") openTo(go.id);
    else if (go.kind === "gmail") void useEmail.getState().connect();
  };

  const title =
    reading === 0 ? (
      <>
        Meters <em className="is-wait">waiting</em>
      </>
    ) : over ? (
      <>
        {WORDS[over] ?? over} {over === 1 ? "meter is" : "meters are"} <em className="is-over">at the cap</em>
      </>
    ) : hot ? (
      <>
        {WORDS[hot] ?? hot} {hot === 1 ? "meter is" : "meters are"} <em className="is-warn">near the cap</em>
      </>
    ) : (
      <>
        Every meter <em>under 80%</em>
      </>
    );

  return (
    <div className="ct-page sx-page wv-page fl-page" data-room="boiler" style={{ "--fl-accent": ACCENT } as CSSProperties}>
      <BoilerFrame
        page="controls"
        tabs={<SystemsNav className="bx-tabs" />}
        title={title}
        say={`${t.live} of ${rows.length} links live${t.down ? `, ${t.down} down` : ""}. ${signedIn ? "Figures are yours alone." : "Signed out: states and counts only."}`}
        needs={needs}
        now={now}
        onGo={onGo}
      >
        <div className="bx-grid">
          <Panel id="ct-meters" title="Meters" sub="this month · amber at 80%, red at the cap" open={open.has("ct-meters")} onToggle={() => toggle("ct-meters")} chart={<MeterChart shown={shown} now={now} signedIn={signedIn} trails={usage?.trails ?? null} />}>
            <Meters shown={shown} now={now} signedIn={signedIn} />
          </Panel>
          <Panel id="ct-links" title="Connections" sub={`${t.live} of ${rows.length} live`} tone={t.down ? "down" : "live"} open={open.has("ct-links")} onToggle={() => toggle("ct-links")} chart={<LinkChart rows={rows} now={now} />}>
            {signedIn ? <HouseSetup /> : null}
            <Connections rows={rows} now={now} signedIn={signedIn} openKeys={() => openTo("ct-keys")} />
          </Panel>
        </div>
        <Panel id="ct-breakers" title="Breakers" sub="what each switch is doing" open={open.has("ct-breakers")} onToggle={() => toggle("ct-breakers")} chart={<Breakers now={now} signedIn={signedIn} compact />}>
          <Breakers now={now} signedIn={signedIn} />
        </Panel>
        <Panel id="ct-tools" title="Skippy's tools" sub={toolsSub(belt)} open={open.has("ct-tools")} onToggle={() => toggle("ct-tools")} chart={<ToolsChart belt={belt} />}>
          {belt?.total ? <ToolsDetail belt={belt} /> : null}
        </Panel>
        <div className="bx-grid is-3">
          <Panel id="ct-settings" title="Settings" sub="Hide, Hands-free, Ilyr's clock, what's next" open={open.has("ct-settings")} onToggle={() => toggle("ct-settings")}>
            <SettingsPanel />
          </Panel>
          <Panel id="ct-keys" title="Keys" sub={signedIn ? "write-only · each asks for your passkey" : "signed in only"} open={open.has("ct-keys")} onToggle={() => toggle("ct-keys")}>
            {signedIn ? <KeysPanel now={now} /> : <p className="ct-note">Signed in only. Keys are set here and never shown.</p>}
          </Panel>
          <Panel id="ct-phones" title="Phones" sub={signedIn ? "Hey Skippy from the iPhone" : "signed in only"} open={open.has("ct-phones")} onToggle={() => toggle("ct-phones")}>
            {signedIn ? <PhonesPanel now={now} /> : <p className="ct-note">Signed in only.</p>}
          </Panel>
        </div>
      </BoilerFrame>
    </div>
  );
}
