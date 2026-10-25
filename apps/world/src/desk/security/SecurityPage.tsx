import type { CSSProperties } from "react";
import { ago } from "../foundryGraph.ts";
import { SystemsNav } from "../SystemsNav.tsx";
import { useSecurityFeed, type FeedState, type SecurityFeed } from "./feed.ts";
import { BOUNDARIES, EVAL_AREAS, EVALS, OWASP_LLM, ROADMAP, ZONES, isShipped, partsOf, refsOf } from "./model.ts";
import { alertState, scanState, scoreState, switchState, type CheckState } from "./checks.ts";
import { ACCENT, CheckRack, Key, type Check, type Group } from "./Checks.tsx";
import { ALERT_EXPLAIN, EVAL_EXPLAIN, ROADMAP_EXPLAIN, SCAN_EXPLAIN, STAT_EXPLAIN, featureExplain, scorecardExplain, type ScanId } from "./explain.ts";
import { Chips, DOC_URL, Facts, Out, REPO_URL, Rich } from "./parts.tsx";
import { KeysPanel } from "./KeysPanel.tsx";

/**
 * Boiler Room > Security (#82; on Today's flow kit since #445): every check as a particle line. On the stage, the
 * headline and ledger read the scans in plain words, and under them each check is one line in the Pessimist's steel:
 * the five scans, the Scorecard, the two alert counts and the injection eval suite, area by area. It flows when it
 * passes, lies dashed while it waits to be reported, and stops dead at a red knot when it fails. Under the stage, in
 * the same lines: the repo's switches, the trust boundaries and the open risks and roadmap, R1 to R8.
 * Live from GitHub through api/security-feed.ts: the last result of each scan, the repo's security switches, alert
 * counts (never their details) and the Scorecard. From the repo: the trust boundaries, the open risks and the
 * injection eval suite (security/model.ts). Anything without data yet says it's waiting.
 */

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

const SCAN_IDS: ScanId[] = ["checks", "codeql", "scorecard", "dependency-review", "e2e"];
const SCAN_NAME: Record<ScanId, string> = {
  checks: "Checks",
  codeql: "CodeQL",
  scorecard: "Scorecard",
  "dependency-review": "Dependency review",
  e2e: "E2E",
};
const RUN_WORD: Record<SecurityFeed["workflows"][number]["state"], string> = {
  pass: "Passing",
  fail: "Failing",
  other: "",
  none: "No runs yet",
  unreported: "Not reported",
};
const FEATURE_WORD = { on: "On", off: "Off", unreported: "Not reported" } as const;
const ZONE_SHORT: Record<keyof typeof ZONES, string> = { browser: "The Desk", relay: "MacBook", vercel: "Azure", claude: "Claude, Gemini", github: "GitHub", builder: "Claude Code", public: "The internet" };

const n = (c: { more: boolean }, x: number) => `${x}${c.more && x >= 100 ? "+" : ""}`;

export function SecurityPage({ now }: { now: number }) {
  const state = useSecurityFeed();
  const feed = state.feed;
  const reported = feed?.workflows.filter((w) => w.state === "pass" || w.state === "fail") ?? [];
  const failing = reported.filter((w) => w.state === "fail");
  const todo = ROADMAP.filter((r) => !isShipped(r)).length;
  const switches = feed?.features.filter((f) => f.state !== "unreported") ?? [];
  const on = switches.filter((f) => f.state === "on").length;
  const card = feed?.scorecard ?? null;
  const cs = feed?.alerts.codeScanning ?? null;
  const dep = feed?.alerts.dependabot ?? null;
  const alertsKnown = !!cs || !!dep;
  const alerts = (cs?.open ?? 0) + (dep?.open ?? 0);
  const alertsMore = !!cs?.more || !!dep?.more;

  /* ---------- the stage: scans, the Scorecard, alerts, the eval suite ---------- */
  const scans: Check[] = SCAN_IDS.map((id) => {
    const w = feed?.workflows.find((x) => x.id === id);
    const word = !feed ? "Waiting" : !w ? "Not reported" : w.state === "other" ? (w.conclusion ? w.conclusion[0]!.toUpperCase() + w.conclusion.slice(1) : "Finished") : RUN_WORD[w.state];
    const at = w?.at ? Date.parse(w.at) : NaN;
    const when = Number.isFinite(at) ? ago(at, now) : null;
    return {
      id: `scan-${id}`,
      name: SCAN_NAME[id],
      label: SCAN_NAME[id],
      sub: word,
      state: scanState(feed, w),
      kicker: `Scan${w?.scope === "pull request" ? " · its latest pull request" : ""}`,
      about: SCAN_EXPLAIN[id],
      value: w?.url ? (
        <a className="sx-run" href={w.url} target="_blank" rel="noopener noreferrer">
          {when ?? "Run"}
          {w.scope === "pull request" ? ", latest PR" : ""}
          <span aria-hidden="true"> ↗</span>
        </a>
      ) : when ? (
        <span className="sx-when">{when}</span>
      ) : null,
    };
  });

  const scoreCheck: Check = {
    id: "scorecard",
    name: "Scorecard",
    label: "Scorecard",
    sub: card ? `${card.score.toFixed(1)} of 10, OpenSSF` : feed ? "Not reported" : "Waiting",
    state: scoreState(card),
    fill: card ? card.score / 10 : 1,
    kicker: "How the repo is run",
    about: STAT_EXPLAIN.scorecard,
    value: card ? (
      <span className="sx-pair">
        <b className="fl-num sx-fig">{card.score.toFixed(1)}</b>
        <small>of 10</small>
      </span>
    ) : (
      <span className="fl-wait">{feed ? "not reported" : "waiting"}</span>
    ),
    detail: <ScorecardDetail card={card} feed={feed} now={now} />,
  };

  const alertRow = (kind: keyof SecurityFeed["alerts"], name: string, c: SecurityFeed["alerts"]["codeScanning"]): Check => ({
    id: `alerts-${kind}`,
    name,
    label: name,
    sub: !c ? "Not reported" : c.open ? `${n(c, c.open)} open` : "None open",
    state: alertState(c, feed),
    kicker: "Counts only",
    about: ALERT_EXPLAIN[kind],
    value: c ? (
      <span className="sx-pair">
        <b className="fl-num sx-fig">{n(c, c.open)}</b>
        <small>open · {n(c, c.fixed)} fixed</small>
      </span>
    ) : (
      <span className="fl-wait">not reported</span>
    ),
  });

  const evals: Check[] = EVAL_AREAS.map((a) => {
    const c = EVALS.areas.find((x) => x.id === a.id);
    const st: CheckState = !c ? "wait" : c.passing + c.expectedFail < c.cases ? "fail" : c.expectedFail ? "part" : "pass";
    return {
      id: `eval-${a.id}`,
      name: a.area,
      label: a.area,
      sub: !c ? "Not counted" : c.expectedFail ? `${c.passing} pass, ${c.expectedFail} expected-fail` : `${c.passing} of ${c.cases} pass`,
      state: st,
      kicker: "Eval area",
      about: EVAL_EXPLAIN[a.id],
      value: c ? (
        <span className="sx-pair">
          <b className="fl-num sx-fig">{c.cases}</b>
          <small>cases</small>
        </span>
      ) : null,
      detail: (
        <p className="sx-p">
          <Rich text={a.proves} /> <span className="sx-file">(<code>api/_security/{a.file}</code>)</span>
        </p>
      ),
    };
  });

  const top: Group[] = [
    { id: "scans", title: "Scans", note: "the last run of each", aside: <Out href={`${REPO_URL}/actions`}>Actions</Out>, checks: scans },
    {
      id: "repo",
      title: "How the repo is run",
      note: "the Scorecard, and alerts as counts only",
      aside: <Out href={`${REPO_URL}/security`}>Security tab</Out>,
      checks: [scoreCheck, alertRow("codeScanning", "Code scanning alerts", cs), alertRow("dependabot", "Dependabot alerts", dep)],
    },
    {
      id: "evals",
      title: "Injection eval suite",
      note: (
        <>
          {EVALS.total} cases in {EVALS.areas.length} areas, {EVALS.passing} pass
          {EVALS.expectedFail > 0 ? `, ${EVALS.expectedFail} expected-fail (${EVALS.expectedFail === 1 ? "a known gap" : "known gaps"} kept visible until fixed)` : ""}. Counted from the suite itself, checked on every build, offline
        </>
      ),
      checks: evals,
    },
  ];

  /* ---------- below: the switches, the trust boundaries, the road ---------- */
  const unreported = feed ? feed.features.filter((f) => f.state === "unreported").length : 0;
  const guards: Check[] = (feed?.features ?? []).map((f) => ({
    id: `guard-${f.id}`,
    name: f.name,
    label: f.name,
    sub: FEATURE_WORD[f.state],
    state: switchState(f.state),
    kicker: "Security switch",
    about: featureExplain(f.id),
  }));

  const trust: Check[] = BOUNDARIES.map((b) => ({
    id: `tb-${b.id}`,
    name: (
      <>
        <span className="sx-id">{b.id}</span> {b.name}
      </>
    ),
    label: `${b.id} ${b.name}`,
    sub: b.planned ? "Waits on the Mac" : "Guarded",
    state: b.planned ? "wait" : "pass",
    kicker: `${ZONES[b.from].name} to ${ZONES[b.to].name}`,
    value: (
      <span className="sx-zones">
        {ZONE_SHORT[b.from]} <i aria-hidden="true">→</i> {ZONE_SHORT[b.to]}
      </span>
    ),
    detail: (
      <>
        <p className="sx-p">
          <em>What crosses:</em> {b.crosses}
        </p>
        <Chips items={partsOf(b.controls)} />
      </>
    ),
  }));

  const road: Check[] = ROADMAP.map((r) => {
    const shipped = isShipped(r);
    const risks = OWASP_LLM.filter((x) => refsOf(x.tracking).includes(r.id)).map((x) => x.id);
    const status = shipped && !/^Shipped\b/.test(r.status) ? `Shipped ${r.status}` : r.status;
    const short = r.item.split(/[:(]/)[0]!.trim();
    return {
      id: `road-${r.id}`,
      name: (
        <>
          <span className="sx-id">{r.id === "Shipped" ? "✓" : r.id}</span> {short}
        </>
      ),
      label: r.id === "Shipped" ? short : `${r.id} ${short}`,
      sub: shipped ? status.split(":")[0]! : status.split(/[;,]/)[0]!,
      state: shipped ? "pass" : "wait",
      kicker: shipped ? "Shipped" : `${r.id}${risks.length ? ` · follows up ${risks.join(", ")}` : ""}`,
      about: ROADMAP_EXPLAIN[r.id],
      value: risks.length ? <span className="sx-risks">{risks.join(" · ")}</span> : null,
      detail: (
        <dl className="sx-dl">
          <div>
            <dt>The item</dt>
            <dd>{r.item}</dd>
          </div>
          <div>
            <dt>Closes</dt>
            <dd>{r.closes}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{status}</dd>
          </div>
        </dl>
      ),
    };
  });

  const more: Group[] = [
    {
      id: "guards",
      title: "The repo's switches",
      note: switches.length ? `${on} of ${switches.length} on` : feed ? "not reported" : "waiting for GitHub",
      aside: <Out href={`${REPO_URL}/security`}>Security tab</Out>,
      checks: guards,
      foot: !feed ? (
        <p className="sx-note fl-wait">Waiting for GitHub.</p>
      ) : unreported > 0 ? (
        <p className="sx-note">“Not reported” means the Foundry's token can't read that setting; it says nothing about whether it's on. The Security tab shows it.</p>
      ) : null,
    },
    {
      id: "trust",
      title: "Trust map",
      note: `${WORDS[BOUNDARIES.length] ?? BOUNDARIES.length} boundaries, ${BOUNDARIES.filter((b) => !b.planned).length} guarded${BOUNDARIES.some((b) => b.planned) ? `, ${BOUNDARIES.filter((b) => b.planned).length} waits on the Mac` : ""}`,
      checks: trust,
    },
    {
      id: "road",
      title: "Open risks and the roadmap",
      note: `what's left, in order: ${todo} of ${ROADMAP.length} still to ship`,
      aside: <Out href={DOC_URL}>Threat model</Out>,
      checks: road,
    },
  ];

  const headline =
    !feed || !reported.length ? (
      <>
        Waiting on <em className="is-wait">GitHub's scans.</em>
      </>
    ) : failing.length ? (
      <>
        {WORDS[failing.length] ?? failing.length} {failing.length === 1 ? "scan is" : "scans are"} <em className="is-fail">failing.</em>
      </>
    ) : (
      <>
        Every scan is <em>passing.</em>
      </>
    );

  const header = (
    <>
      <SystemsNav />
      <header className="sx-top">
        <p className="fl-eyb">
          <span>Boiler Room</span>
          <i />
          Security · threat model and scans
        </p>
        <h1 className="fl-h1 desk__title">{headline}</h1>
        <p className="fl-say">
          Every check is a line: it flows while it passes and stops at a knot when it fails. Counts only here; the details of anything open stay with the crew. <FeedLine state={state} now={now} />
        </p>
        <dl className="fl-ledger sx-ledger">
          <div className={failing.length ? "is-fail is-hot" : reported.length ? "is-pass" : "is-wait"}>
            <dt>Scans</dt>
            <dd>{reported.length ? `${reported.length - failing.length}/${reported.length}` : "–"}</dd>
          </div>
          <div className={`is-${scoreState(card)}`}>
            <dt>Scorecard</dt>
            <dd>{card ? card.score.toFixed(1) : "–"}</dd>
          </div>
          <div className={!alertsKnown ? "is-wait" : alerts ? "is-part" : "is-pass"}>
            <dt>Open alerts</dt>
            <dd>{alertsKnown ? `${alerts}${alertsMore ? "+" : ""}` : "–"}</dd>
          </div>
          <div className={EVALS.passing + EVALS.expectedFail === EVALS.total ? "is-pass" : "is-fail is-hot"}>
            <dt>Evals</dt>
            <dd>
              {EVALS.passing}
              <small>/{EVALS.total}</small>
            </dd>
          </div>
          <div className="is-wait">
            <dt>To ship</dt>
            <dd>
              {todo}
              <small>/{ROADMAP.length}</small>
            </dd>
          </div>
        </dl>
      </header>
      <Key />
    </>
  );

  return (
    <div className="sx-page wv-page fl-page" data-room="boiler" style={{ "--fl-accent": ACCENT } as CSSProperties}>
      <CheckRack groups={top} header={header} label="Security: every check as a line" />
      {/* The Keys form (#330): signed in only, write-only, a passkey for each key. */}
      <KeysPanel now={now} />
      <div className="fl-below">
        <CheckRack groups={more} stage={false} label="The switches, the trust boundaries and the roadmap" />
      </div>
    </div>
  );
}

function FeedLine({ state, now }: { state: FeedState; now: number }) {
  if (state.status === "waiting" || !state.fetchedAt) return null;
  return <span className="sx-feedline">{state.status === "stale" ? `From ${ago(state.fetchedAt, now)}.` : `Live, ${ago(state.fetchedAt, now)}.`}</span>;
}

/** The Scorecard opened: every check it scores, as a hairline filled to its score, and the full report. */
function ScorecardDetail({ card, feed, now }: { card: SecurityFeed["scorecard"]; feed: SecurityFeed | null; now: number }) {
  if (!card) return <p className="sx-p fl-wait">{feed ? "Scorecard hasn't published a result for the repo yet." : "Waiting for the Scorecard result."}</p>;
  const at = Date.parse(card.date);
  return (
    <>
      <ul className="sx-bars" aria-label="Scorecard checks">
        {[...card.checks]
          .sort((a, b) => b.score - a.score)
          .map((c) => (
            <ScoreBar key={c.name} c={c} />
          ))}
      </ul>
      <p className="sx-note">
        OpenSSF Scorecard{Number.isFinite(at) ? `, scored ${ago(at, now)}` : ""}. <Out href={`https://scorecard.dev/viewer/?uri=github.com/nikitapage10/C.E.O.`}>Full report</Out>
      </p>
    </>
  );
}

function ScoreBar({ c }: { c: NonNullable<SecurityFeed["scorecard"]>["checks"][number] }) {
  const na = c.score < 0;
  const name = c.name.replace(/-/g, " ");
  const st = na ? "off" : c.score >= 7 ? "pass" : c.score >= 4 ? "part" : "fail";
  return (
    <li className={`is-${st}`} style={{ "--v": na ? 0 : c.score / 10 } as CSSProperties}>
      <details>
        <summary>
          <b>{name}</b>
          <i aria-hidden="true" />
          <em className="fl-num">{na ? "n/a" : c.score}</em>
        </summary>
        <Facts e={scorecardExplain(c.name, c.short)} />
      </details>
    </li>
  );
}
