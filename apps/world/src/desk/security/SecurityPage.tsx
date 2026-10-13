import { ago } from "../foundryGraph.ts";
import { SystemsNav } from "../SystemsNav.tsx";
import { RoomBanner } from "../RoomBanner.tsx";
import { Avatar, Panel, Pill, type Tone } from "../ui.tsx";
import { useSecurityFeed, type FeedState, type SecurityFeed } from "./feed.ts";
import { EVAL_AREAS, EVALS, OWASP_LLM, ROADMAP, owaspTally, refsOf } from "./model.ts";
import { DOC_URL, Out, REPO_URL, Rich } from "./parts.tsx";
import { TrustMap } from "./TrustMap.tsx";

/**
 * Systems > Security (#82): how C.E.O. is defended, at a glance. Live from GitHub through api/security-feed.ts: the
 * last result of each scan, the repo's security switches, alert counts (never their details) and the Scorecard.
 * From the repo: the trust boundaries, the open risks and the injection eval suite (security/model.ts). Anything
 * without data yet says it's waiting.
 */

export function SecurityPage({ now }: { now: number }) {
  const state = useSecurityFeed();
  const feed = state.feed;
  const tally = owaspTally();
  const reported = feed?.workflows.filter((w) => w.state === "pass" || w.state === "fail") ?? [];
  const passing = reported.filter((w) => w.state === "pass").length;
  const todo = ROADMAP.filter((r) => r.id !== "Shipped").length;

  return (
    <div className="sec-page">
      <RoomBanner
        page="security"
        lead="The scans every change goes through, live from GitHub, and the threat model they answer to."
        aside={
          <div className="page-head__crew">
            <Avatar agent="Gary" room="boiler" />
            <FeedPill state={state} now={now} />
          </div>
        }
      />

      <SystemsNav />

      <ul className="sec-stats" aria-label="Security at a glance">
        <Stat label="Scans passing" value={feed && reported.length ? `${passing}/${reported.length}` : "—"} note={feed ? (reported.length ? "last run of each" : "No runs reported") : "Waiting for GitHub"} tone={!feed || !reported.length ? "off" : passing === reported.length ? "ok" : "down"} />
        <Stat label="Scorecard" value={feed?.scorecard ? feed.scorecard.score.toFixed(1) : "—"} note={feed?.scorecard ? "out of 10, OpenSSF" : feed ? "Not reported yet" : "Waiting"} tone={feed?.scorecard ? scoreTone(feed.scorecard.score) : "off"} />
        <Stat label="Injection evals" value={String(EVALS.total)} note={`${EVALS.passing} pass · ${EVALS.expectedFail} known gap`} tone="ok" />
        <Stat label="LLM risks open" value={String(tally.open)} note={`of 10 · ${todo} on the roadmap`} tone={tally.open ? "slow" : "ok"} />
      </ul>

      <Panel eyebrow="Scans" aside={<Out href={`${REPO_URL}/actions`}>All runs</Out>} className="sec-panel">
        <Scans feed={feed} now={now} />
      </Panel>

      <div className="sec-two">
        <Panel eyebrow="OpenSSF Scorecard" aside={<span className="panel__hint">How the repo is run</span>} className="sec-panel">
          <Scorecard feed={feed} now={now} />
        </Panel>
        <Panel eyebrow="Guards" aside={<Out href={`${REPO_URL}/security`}>Security tab</Out>} className="sec-panel">
          <Guards feed={feed} />
        </Panel>
      </div>

      <Panel eyebrow="Trust boundaries" aside={<Out href={DOC_URL}>Threat model</Out>} className="sec-panel">
        <TrustMap />
      </Panel>

      <Panel eyebrow="Open risks and the roadmap" aside={<span className="panel__hint">What's left, in order</span>} className="sec-panel">
        <Roadmap />
      </Panel>

      <Panel eyebrow="Injection eval suite" aside={<span className="panel__hint">Runs on every build, offline</span>} className="sec-panel">
        <Evals />
      </Panel>
    </div>
  );
}

function scoreTone(score: number): Tone {
  return score >= 7 ? "ok" : score >= 4 ? "slow" : "down";
}

function FeedPill({ state, now }: { state: FeedState; now: number }) {
  if (state.status === "waiting" || !state.fetchedAt) return <Pill tone="off">Waiting for GitHub</Pill>;
  if (state.status === "stale") return <Pill tone="slow">From {ago(state.fetchedAt, now)}</Pill>;
  return <Pill tone="ok">Live · {ago(state.fetchedAt, now)}</Pill>;
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: Tone }) {
  return (
    <li className={`sec-stat sec-stat--${tone}`}>
      <span className="sec-stat__label">{label}</span>
      <span className="sec-stat__value">{value}</span>
      <span className="sec-stat__note">{note}</span>
    </li>
  );
}

const RUN_WORD: Record<SecurityFeed["workflows"][number]["state"], string> = {
  pass: "Passing",
  fail: "Failing",
  other: "",
  none: "No runs yet",
  unreported: "Not reported",
};
const RUN_TONE: Record<SecurityFeed["workflows"][number]["state"], Tone> = { pass: "ok", fail: "down", other: "slow", none: "off", unreported: "off" };

/** What each scan is for, from docs/SECURITY.md. */
const SCAN_WHAT: Record<string, string> = {
  checks: "Typecheck, lint, tests (the eval suite among them), build, package provenance and known vulnerabilities",
  codeql: "Security bugs and code quality in the TypeScript, JavaScript and workflows",
  scorecard: "How the repo is run: pinned actions, permissions, branch protection, updates",
  "dependency-review": "Packages or actions a change adds that carry a known vulnerability",
  e2e: "The browser tests, nightly and on labelled pull requests",
};
const SCAN_IDS = ["checks", "codeql", "scorecard", "dependency-review", "e2e"];
const SCAN_NAME: Record<string, string> = { checks: "Checks", codeql: "CodeQL", scorecard: "Scorecard", "dependency-review": "Dependency review", e2e: "E2E" };

function Scans({ feed, now }: { feed: SecurityFeed | null; now: number }) {
  return (
    <ul className="scans">
      {SCAN_IDS.map((id) => {
        const w = feed?.workflows.find((x) => x.id === id);
        const tone: Tone = w ? RUN_TONE[w.state] : "off";
        const word = !feed ? "Waiting" : !w ? "Not reported" : w.state === "other" ? (w.conclusion ? w.conclusion[0]!.toUpperCase() + w.conclusion.slice(1) : "Finished") : RUN_WORD[w.state];
        const at = w?.at ? Date.parse(w.at) : NaN;
        return (
          <li key={id} className={`scan scan--${tone}`} tabIndex={0} aria-label={`${SCAN_NAME[id]}: ${word}${Number.isFinite(at) ? `, ${ago(at, now)}` : ""}`}>
            <span className="scan__ring" aria-hidden="true">
              <i />
            </span>
            <span className="scan__name">{SCAN_NAME[id]}</span>
            <span className="scan__state">{word}</span>
            <span className="scan__when">
              {Number.isFinite(at) ? ago(at, now) : "—"}
              {w?.scope === "pull request" && <small> · latest pull request</small>}
            </span>
            {w?.url && (
              <a className="scan__link" href={w.url} target="_blank" rel="noopener noreferrer">
                Run <span aria-hidden="true">↗</span>
              </a>
            )}
            <span className="scan__what" role="note">
              {SCAN_WHAT[id]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ScoreDial({ score }: { score: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / 10));
  return (
    <svg className={`dial dial--${scoreTone(score)}`} viewBox="0 0 120 120" role="img" aria-label={`Scorecard ${score.toFixed(1)} out of 10`}>
      <circle className="dial__track" cx="60" cy="60" r={r} />
      <circle className="dial__arc" cx="60" cy="60" r={r} strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 60 60)" />
      <text className="dial__num" x="60" y="64" textAnchor="middle">
        {score.toFixed(1)}
      </text>
      <text className="dial__of" x="60" y="82" textAnchor="middle">
        / 10
      </text>
    </svg>
  );
}

function Scorecard({ feed, now }: { feed: SecurityFeed | null; now: number }) {
  const card = feed?.scorecard;
  if (!card) return <p className="quiet">{feed ? "Scorecard hasn't published a result for the repo yet." : "Waiting for the Scorecard result."}</p>;
  const checks = [...card.checks].sort((a, b) => b.score - a.score);
  const at = Date.parse(card.date);
  return (
    <div className="scorecard">
      <div className="scorecard__head">
        <ScoreDial score={card.score} />
        <p className="quiet">
          OpenSSF Scorecard grades how the repo is run, check by check.
          {Number.isFinite(at) && <> Scored {ago(at, now)}.</>} <Out href={`https://scorecard.dev/viewer/?uri=github.com/nikitapage10/C.E.O.`}>Full report</Out>
        </p>
      </div>
      <ul className="bars" aria-label="Scorecard checks">
        {checks.map((c) => {
          const na = c.score < 0;
          return (
            <li key={c.name} className={`bar bar--${na ? "off" : scoreTone(c.score)}`} title={c.short || undefined} tabIndex={0}>
              <span className="bar__name">{c.name.replace(/-/g, " ")}</span>
              <span className="bar__track" aria-hidden="true">
                <i style={{ width: `${na ? 0 : c.score * 10}%` }} />
              </span>
              <span className="bar__num">{na ? "n/a" : c.score}</span>
              {c.short && (
                <span className="bar__tip" role="note">
                  {c.short}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const FEATURE_WORD = { on: "On", off: "Off", unreported: "Not reported" } as const;
const FEATURE_TONE: Record<keyof typeof FEATURE_WORD, Tone> = { on: "ok", off: "down", unreported: "off" };

function Guards({ feed }: { feed: SecurityFeed | null }) {
  if (!feed) return <p className="quiet">Waiting for GitHub.</p>;
  const unreported = feed.features.filter((f) => f.state === "unreported").length;
  return (
    <div className="guards">
      <ul className="guards__list" aria-label="Security switches">
        {feed.features.map((f) => (
          <li key={f.id}>
            <span>{f.name}</span>
            <Pill tone={FEATURE_TONE[f.state]}>{FEATURE_WORD[f.state]}</Pill>
          </li>
        ))}
      </ul>
      <div className="guards__alerts">
        <AlertCount name="Code scanning alerts" count={feed.alerts.codeScanning} />
        <AlertCount name="Dependabot alerts" count={feed.alerts.dependabot} />
      </div>
      {unreported > 0 && <p className="guards__note">“Not reported” means the Foundry's token can't read that setting; it says nothing about whether it's on. The Security tab shows it.</p>}
    </div>
  );
}

function AlertCount({ name, count }: { name: string; count: SecurityFeed["alerts"]["codeScanning"] }) {
  if (!count)
    return (
      <div className="alerts alerts--off">
        <span className="alerts__name">{name}</span>
        <span className="alerts__none">Not reported</span>
      </div>
    );
  const n = (x: number) => `${x}${count.more && x >= 100 ? "+" : ""}`;
  const total = count.open + count.fixed;
  return (
    <div className={`alerts ${count.open ? "alerts--open" : "alerts--clear"}`}>
      <span className="alerts__name">{name}</span>
      <span className="alerts__nums">
        <b>{n(count.open)}</b> open · {n(count.fixed)} fixed
      </span>
      <span className="alerts__bar" aria-hidden="true">
        {total > 0 && (
          <>
            <i className="alerts__fixed" style={{ width: `${(count.fixed / total) * 100}%` }} />
            <i className="alerts__open" style={{ width: `${(count.open / total) * 100}%` }} />
          </>
        )}
      </span>
    </div>
  );
}

function Roadmap() {
  return (
    <ol className="roadmap">
      {ROADMAP.map((r) => {
        const shipped = r.id === "Shipped";
        const risks = OWASP_LLM.filter((x) => refsOf(x.tracking).includes(r.id)).map((x) => x.id);
        return (
          <li key={r.id} className={`roadmap__row ${shipped ? "is-shipped" : ""}`}>
            <span className="roadmap__id">{shipped ? "✓" : r.id}</span>
            <span className="roadmap__item">
              <span className="roadmap__what">{r.item}</span>
              <span className="roadmap__closes">Closes: {r.closes}</span>
            </span>
            <span className="roadmap__side">
              {risks.length > 0 && (
                <span className="roadmap__risks" title="The OWASP LLM risks it follows up">
                  {risks.join(" · ")}
                </span>
              )}
              <Pill tone={shipped ? "ok" : "off"}>{shipped ? `Shipped ${r.status}` : r.status}</Pill>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Evals() {
  const max = Math.max(...EVALS.areas.map((a) => a.cases));
  return (
    <div className="evals">
      <div className="evals__head">
        <span className="evals__total">{EVALS.total}</span>
        <span className="evals__words">
          cases in {EVALS.areas.length} areas: <b className="evals__pass">{EVALS.passing} pass</b>
          {EVALS.expectedFail > 0 && (
            <>
              , <b className="evals__xfail">{EVALS.expectedFail} expected-fail</b>: {EVALS.expectedFail === 1 ? "a known gap" : "known gaps"} kept visible until fixed
            </>
          )}
          . Counted from the suite itself, and checked on every build.
        </span>
      </div>
      <ul className="evals__areas">
        {EVAL_AREAS.map((a) => {
          const c = EVALS.areas.find((x) => x.id === a.id);
          if (!c) return null;
          return (
            <li key={a.id}>
              <details className="eval">
                <summary>
                  <span className="eval__name">{a.area}</span>
                  <span className="eval__bar" aria-hidden="true" style={{ width: `${(c.cases / max) * 100}%` }}>
                    <i className="eval__pass" style={{ flex: c.passing }} />
                    {c.expectedFail > 0 && <i className="eval__xfail" style={{ flex: c.expectedFail }} />}
                  </span>
                  <span className="eval__num">
                    {c.cases}
                    {c.expectedFail > 0 && <small> · {c.expectedFail} expected-fail</small>}
                  </span>
                </summary>
                <p className="eval__proves">
                  <Rich text={a.proves} />
                  <span className="eval__file">
                    {" "}
                    (<code>api/_security/{a.file}</code>)
                  </span>
                </p>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
