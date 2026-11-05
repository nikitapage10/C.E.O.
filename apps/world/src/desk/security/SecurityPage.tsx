import type { CSSProperties } from "react";
import { ago } from "../foundryGraph.ts";
import { SystemsNav } from "../SystemsNav.tsx";
import { useSecurityFeed, type FeedState, type SecurityFeed } from "./feed.ts";
import { BOUNDARIES, EVAL_AREAS, EVALS, OWASP_LLM, ROADMAP, ZONES, isShipped, partsOf, refsOf } from "./model.ts";
import { alertState, scanState, scoreState, switchState, type CheckState } from "./checks.ts";
import { ACCENT, type Check, type Group } from "./Checks.tsx";
import { ALERT_EXPLAIN, EVAL_EXPLAIN, ROADMAP_EXPLAIN, SCAN_EXPLAIN, STAT_EXPLAIN, featureExplain, scorecardExplain, type ScanId } from "./explain.ts";
import { Chips, DOC_URL, Facts, Out, REPO_URL, Rich } from "./parts.tsx";
import { BoilerFrame, Panel, Ring, RunStrip, useOpen } from "../boiler/frame.tsx";
import { scanTrend, securityNeeds, severityTotals } from "../boiler/pages.ts";
import { CheckList, TrustMap } from "./CheckList.tsx";

/**
 * Boiler Room > Security (#82; one screen since #746, the S3 concept: the trust map first, the scans' last twenty runs, the
 * open alerts by severity, and every check one folded line away, with failing scans and critical alerts in "Needs you").
 * Before #746: every check as a particle line. On the stage, the
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

  const needs = securityNeeds(feed);
  const [open, toggle] = useOpen();
  const sev = severityTotals(feed?.alerts);
  const sevMax = sev ? Math.max(1, ...Object.values(sev)) : 1;

  return (
    <div className="sx-page wv-page fl-page" data-room="boiler" style={{ "--fl-accent": ACCENT } as CSSProperties}>
      <BoilerFrame
        page="security"
        tabs={<SystemsNav className="bx-tabs" />}
        title={headline}
        say={
          <>
            Counts only here; the details of anything open stay with the crew. <FeedLine state={state} now={now} />
          </>
        }
        needs={needs}
        now={now}
        onGo={() => undefined}
      >
        <div className="bx-sec">
          <section className="bx-panel" aria-labelledby="sx-trust-h">
            <header className="bx-ph">
              <h2 id="sx-trust-h">Trust map</h2>
              <span className="bx-psub">{more[1]!.note}</span>
              <span className="bx-psub" style={{ marginLeft: "auto" }}>
                <Out href={DOC_URL}>Threat model</Out>
              </span>
            </header>
            <TrustMap
              caption={(b) =>
                b ? (
                  <>
                    <b>
                      {b.id} {b.name} · {b.planned ? "waits on the Mac" : "guarded"}
                    </b>
                    <p>
                      {ZONES[b.from].name} to {ZONES[b.to].name}. What crosses: {b.crosses}
                    </p>
                  </>
                ) : (
                  <>
                    <b>{BOUNDARIES.length} boundaries between seven zones</b>
                    <p>Point at a line, or tab to it, for what crosses it and whether it's guarded. Dashed lines wait on hardware that isn't set up yet.</p>
                  </>
                )
              }
            />
            <div className="bx-grid bx-folds">
              <Panel id="sx-score" title="Scorecard" sub={card ? `${card.score.toFixed(1)} of 10, OpenSSF` : feed ? "not reported" : "waiting"} tone={scoreState(card)} open={open.has("sx-score")} onToggle={() => toggle("sx-score")}>
                <ScorecardDetail card={card} feed={feed} now={now} />
              </Panel>
              <Panel id="sx-guards" title="The repo's switches" sub={more[0]!.note} open={open.has("sx-guards")} onToggle={() => toggle("sx-guards")}>
                <CheckList checks={guards} label="The repo's switches" />
                {more[0]!.foot}
              </Panel>
              <Panel id="sx-road" title="Roadmap" sub={`${ROADMAP.length - todo} of ${ROADMAP.length} shipped`} tone={todo ? "wait" : "pass"} open={open.has("sx-road")} onToggle={() => toggle("sx-road")}>
                <CheckList checks={road} label="Open risks and the roadmap" />
              </Panel>
              <Panel id="sx-bounds" title="Every boundary" sub="what crosses, and its controls" open={open.has("sx-bounds")} onToggle={() => toggle("sx-bounds")}>
                <CheckList checks={trust} label="Trust boundaries" />
              </Panel>
            </div>
          </section>
          <div className="bx-side">
            <Panel
              id="sx-scans"
              title="Scans"
              sub={reported.length ? `${reported.length - failing.length} of ${reported.length} passing · last 20 runs` : "waiting for GitHub"}
              tone={failing.length ? "fail" : reported.length ? "pass" : "wait"}
              open={open.has("sx-scans")}
              onToggle={() => toggle("sx-scans")}
              chart={
                <ul className="bx-rows" aria-label="Each scan's last runs">
                  {SCAN_IDS.map((id) => {
                    const w = feed?.workflows.find((x) => x.id === id);
                    const trend = scanTrend(w);
                    const st = scanState(feed, w);
                    return (
                      <li key={id} className={`is-${st}`}>
                        <i className="bx-dot" aria-hidden="true" />
                        <b>{SCAN_NAME[id]}</b>
                        <span className="bx-chart">{trend ? <RunStrip marks={trend} /> : <span className="bx-note">trend on the next read</span>}</span>
                        <span className="bx-word">{trend ? `${trend.filter((m) => m.state === "pass").length}/${trend.length}` : scans.find((c) => c.id === `scan-${id}`)!.sub}</span>
                      </li>
                    );
                  })}
                </ul>
              }
            >
              <CheckList checks={scans} label="Scans" />
            </Panel>
            <Panel
              id="sx-alerts"
              title="Alerts"
              sub={alertsKnown ? `${alerts}${alertsMore ? "+" : ""} open · counts only` : "not reported"}
              tone={!alertsKnown ? "wait" : alerts ? "part" : "pass"}
              open={open.has("sx-alerts")}
              onToggle={() => toggle("sx-alerts")}
              chart={
                sev ? (
                  <div className="bx-sev" aria-label={`Open alerts by severity: ${sev.critical} critical, ${sev.high} high, ${sev.medium} medium, ${sev.low} low`}>
                    {(["critical", "high", "medium", "low"] as const).map((k) => (
                      <div key={k} className={`is-${k}`}>
                        <b>{sev[k]}</b>
                        <i style={{ "--h": sev[k] / sevMax } as CSSProperties} aria-hidden="true" />
                        <small>{k}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="bx-note">{alertsKnown ? "The split by severity comes with the feed's next read." : "Waiting for GitHub's alert counts."}</p>
                )
              }
            >
              <CheckList checks={top[1]!.checks.slice(1)} label="Alerts" />
            </Panel>
            <Panel
              id="sx-evals"
              title="Injection evals"
              sub={`${EVALS.passing} of ${EVALS.total} pass in ${EVALS.areas.length} areas`}
              tone={EVALS.passing + EVALS.expectedFail === EVALS.total ? "pass" : "fail"}
              open={open.has("sx-evals")}
              onToggle={() => toggle("sx-evals")}
              chart={
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Ring v={EVALS.total ? EVALS.passing / EVALS.total : 0} tone={EVALS.passing + EVALS.expectedFail === EVALS.total ? "pass" : "fail"} text={String(EVALS.passing)} size={52} />
                  <ul className="bx-legend" aria-label="Cases per area">
                    {EVALS.areas.map((a) => (
                      <li key={a.id} className={a.passing + a.expectedFail < a.cases ? "is-fail" : "is-pass"}>
                        <i className="bx-dot" aria-hidden="true" />
                        {EVAL_AREAS.find((x) => x.id === a.id)?.area ?? a.id} <b>{a.cases}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              }
            >
              <CheckList checks={evals} label="Eval areas" />
            </Panel>
          </div>
        </div>
      </BoilerFrame>
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
