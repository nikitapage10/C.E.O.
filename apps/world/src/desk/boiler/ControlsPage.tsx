import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/overpass-mono";
import { usePings } from "@ceo/engine/web/pings.ts";
import { HOME_SCREEN_HINT } from "@ceo/engine/web/PingSwitch.tsx";
import { RECOVERY, type SiteStatus } from "@ceo/engine/web/SitePassword.tsx";
import { useWorldFeed } from "../../chronicle.ts";
import { useFoundry } from "../../foundry.ts";
import { navigateTo } from "../../route.ts";
import { useSystems, type LinkState } from "../../systems.ts";
import { CLAUDE_USAGE_URL, codeTokensByModel, foundryJobs, formatTokens, formatUsd, monthSpend, MODELS, SPEND_CAP_USD, useUsage, workByModel } from "../../usage.ts";
import { startEmail, useEmail } from "../email/email.ts";
import { startPolymarket } from "../exchange/polymarket.ts";
import { ago } from "../foundryGraph.ts";
import { startGreen } from "../green/league.ts";
import { useSetup } from "../IdeaCard.tsx";
import { Private } from "../Private.tsx";
import { KeysPanel } from "../security/KeysPanel.tsx";
import { PhonesPanel } from "../security/PhonesPanel.tsx";
import { useDeskAuth } from "../signin.ts";
import { startInvoices } from "../spire/invoices.ts";
import { SystemsNav } from "../SystemsNav.tsx";
import { mtTime } from "../todaySchedule.ts";
import { startHome } from "../homeDevices.ts";
import { GoogleLinks, HAVEN_RESULT, RoborockSetup } from "./HouseSetup.tsx";
import { ACCENT } from "./Rack.tsx";
import { actionOf, actionWord, costumeState, meterTone, monthClock, pipeOf, projectMonth, quietState, shareWidths, SKIPPY_AGENT_CAP_USD, SKIPPY_AGENT_WARN_USD, TONE_WORD, type MeterTone, type Share } from "./controls.ts";
import "./controls.css";

/**
 * Boiler Room > Controls (#647): every meter, switch, link and key in one panel board. The circuits run down one bus,
 * A to E: the meters (the Claude Code plan, the Claude API against its $10, Skippy as an agent against $60, voice,
 * and Relay), the breakers (pings, quiet hours, the site lock, the wake word, auto-approval, the costume party), every
 * connection with its lamp, then the Keys form and the Phones (moved here from Security). Real data only: a meter with
 * nothing to read says it's waiting. Signed out, it shows states and counts only: no money, no keys, no contacts.
 */

const LETTERS = ["A", "B", "C", "D", "E"] as const;
const CIRCUITS: { id: string; label: string }[] = [
  { id: "ct-meters", label: "Meters" },
  { id: "ct-breakers", label: "Breakers" },
  { id: "ct-links", label: "Connections" },
  { id: "ct-keys", label: "Keys" },
  { id: "ct-phones", label: "Phones" },
];

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

function Meters({ now, signedIn }: { now: number; signedIn: boolean }) {
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
  const shown = meters.map((m) => (m.id === "mail" && !signedIn && typeof pct === "number" ? { ...m, waiting: undefined, used: pct, cap: 100 } : m));

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

function Breakers({ now, signedIn }: { now: number; signedIn: boolean }) {
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

function Connections({ now, signedIn }: { now: number; signedIn: boolean }) {
  const links = useSystems((s) => s.links);
  const connected = useFoundry((s) => s.connected);
  const setup = useSetup();
  const emailView = useEmail((s) => s.view);
  const emailBusy = useEmail((s) => s.busy);
  const emailError = useEmail((s) => s.error);
  const extra: { id: string; label: string; what: string; room: string; state: LinkState; lastSeen: number | null; word?: string }[] = [
    { id: "github", label: "GitHub", what: "The Desk reads the crew's work from the repo", room: "foundry", state: connected ? "ok" : "off", lastSeen: null },
    { id: "buttons", label: "Idea buttons", what: "Build, Revise and Not this one change GitHub at once", room: "foundry", state: setup === null ? "off" : setup.buttons ? "ok" : "slow", lastSeen: null, word: setup && !setup.buttons ? "Needs setup" : undefined },
    { id: "images", label: "Pictures on ideas", what: "Paste, attach or drop pictures on an idea (Azure Blob)", room: "foundry", state: setup === null ? "off" : setup.images ? "ok" : "slow", lastSeen: null, word: setup && !setup.images ? "Needs setup" : undefined },
    { id: "shaping", label: "Quick shaping", what: "Rivet shapes an idea in a second or two (Claude)", room: "foundry", state: setup === null ? "off" : setup.shape ? "ok" : "off", lastSeen: null },
  ];
  const rows = [...links.map((l) => ({ id: l.id, label: l.label, what: l.what, room: l.room as string, state: l.state, lastSeen: l.lastSeen, word: undefined as string | undefined })), ...extra];
  const live = rows.filter((r) => r.state === "ok" || r.state === "slow").length;

  const toKeys = () => document.getElementById("ct-keys")?.scrollIntoView({ block: "start" });
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
 * Roborock, moved here from Today's Home chip. Google's controls read /api/haven/google on their own, so they show
 * even before any home device is set up. Signed in only.
 */
function HouseSetup() {
  const [said] = useState(() => {
    try {
      return HAVEN_RESULT[new URLSearchParams(window.location.search).get("haven") ?? ""] ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => startHome(), []);
  useEffect(() => {
    if (said) requestAnimationFrame(() => document.getElementById("ct-house")?.scrollIntoView({ block: "start" }));
  }, [said]);
  return (
    <div className="ct-house" id="ct-house">
      <h3>The house · Google and Roborock</h3>
      {said ? (
        <p className="ct-note ct-said" role="status">
          {said}
        </p>
      ) : null}
      <GoogleLinks />
      <RoborockSetup />
    </div>
  );
}

/* ── the page ── */

function Circuit({ n, id, title, aside, children }: { n: number; id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ct-circuit" id={id}>
      <header className="ct-ch">
        <span className="ct-tap" aria-hidden="true">
          {LETTERS[n]}
        </span>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function ControlsPage({ now }: { now: number }) {
  const signedIn = useDeskAuth((s) => s.auth.status === "in");
  // The links read their true state while this page is open, as the pipes page does.
  useEffect(() => startPolymarket(), []);
  useEffect(() => startEmail(), []);
  useEffect(() => startGreen(), []);
  useEffect(() => startInvoices(), []);
  const world = useWorldFeed().feed;
  const usage = useUsage().feed;

  // The headline's count: meters near or at a cap, from the data the meters read.
  const s = world?.story;
  const claudeUsed = world || usage ? (world?.spend.usd ?? 0) + (s?.scriptUsd ?? 0) + (usage ? monthSpend(usage.trails, now).usd : 0) : null;
  const tones = [meterTone(claudeUsed, SPEND_CAP_USD), meterTone(s ? (s.elevenUsd ?? 0) + (s.voiceUsd ?? 0) : null, s?.elevenBudget ?? null), meterTone(typeof world?.email?.budgetPct === "number" ? world.email.budgetPct : null, 100)];
  const hot = tones.filter((t) => t === "warn" || t === "over").length;
  const over = tones.filter((t) => t === "over").length;
  const reading = tones.filter((t) => t !== "wait").length;

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="ct-page sx-page wv-page fl-page" data-room="boiler" style={{ "--fl-accent": ACCENT } as CSSProperties}>
      <header className="ct-top">
        <SystemsNav />
        <p className="ct-eyb">
          <span>Boiler Room</span> · Controls · usage, switches, links and keys
        </p>
        <h1 className="ct-h1 desk__title">
          {reading === 0 ? (
            <>
              Meters <em className="is-wait">waiting.</em>
            </>
          ) : over ? (
            <>
              {WORDS[over] ?? over} {over === 1 ? "meter is" : "meters are"} <em className="is-over">at the cap.</em>
            </>
          ) : hot ? (
            <>
              {WORDS[hot] ?? hot} {hot === 1 ? "meter is" : "meters are"} <em className="is-warn">near the cap.</em>
            </>
          ) : (
            <>
              Every meter <em>under 80%.</em>
            </>
          )}
        </h1>
        <nav className="ct-index" aria-label="Circuits">
          {CIRCUITS.map((c, i) => (
            <a key={c.id} href={`#${c.id}`} onClick={go(c.id)}>
              <span>{LETTERS[i]}</span>
              {c.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="ct-board">
        <Circuit n={0} id="ct-meters" title="Meters" aside={<p className="ct-sub">this month · amber at 80%, red at the cap</p>}>
          <Meters now={now} signedIn={signedIn} />
        </Circuit>
        <Circuit n={1} id="ct-breakers" title="Breakers">
          <Breakers now={now} signedIn={signedIn} />
        </Circuit>
        <Circuit n={2} id="ct-links" title="Connections">
          {signedIn ? <HouseSetup /> : null}
          <Connections now={now} signedIn={signedIn} />
        </Circuit>
        <Circuit n={3} id="ct-keys" title="Keys" aside={<p className="ct-sub">write-only · each one asks for your passkey</p>}>
          {signedIn ? <KeysPanel now={now} /> : <p className="ct-note">Signed in only. Keys are set here and never shown.</p>}
        </Circuit>
        <Circuit n={4} id="ct-phones" title="Phones" aside={<p className="ct-sub">Hey Skippy from the iPhone</p>}>
          {signedIn ? <PhonesPanel now={now} /> : <p className="ct-note">Signed in only.</p>}
        </Circuit>
      </div>
    </div>
  );
}
