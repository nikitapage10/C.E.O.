import { useMemo, useRef, useState } from "react";
import { ago } from "../foundryGraph.ts";
import { SystemsNav } from "../SystemsNav.tsx";
import { Pill, type Tone } from "../ui.tsx";
import { useViz } from "../wvCanvas.ts";
import { useSecurityFeed, type FeedState, type SecurityFeed } from "./feed.ts";
import { BOUNDARIES, EVAL_AREAS, EVALS, OWASP_LLM, ROADMAP, ZONES, isShipped, partsOf, refsOf, type ZoneId } from "./model.ts";
import { beadsSpec, tmapSpec, type Bead } from "./secViz.ts";
import { ALERT_EXPLAIN, EVAL_EXPLAIN, ROADMAP_EXPLAIN, SCAN_EXPLAIN, STAT_EXPLAIN, featureExplain, scorecardExplain, type ScanId } from "./explain.ts";
import { DOC_URL, ExplainInline, Out, REPO_URL, Rich, useExplain } from "./parts.tsx";
import { PopScope } from "../Popovers.tsx";

/**
 * Systems > Security (#82), in the approved Weave (desk-concepts round five): a headline from the scans, a thread
 * through every scan with a knot each, the trust map woven between its zones beside the Scorecard, and the counts.
 * Live from GitHub through api/security-feed.ts: the last result of each scan, the repo's security switches, alert
 * counts (never their details) and the Scorecard. From the repo: the trust boundaries, the open risks and the
 * injection eval suite (security/model.ts). Anything without data yet says it's waiting.
 */

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function SecurityPage({ now }: { now: number }) {
  const state = useSecurityFeed();
  const feed = state.feed;
  const reported = feed?.workflows.filter((w) => w.state === "pass" || w.state === "fail") ?? [];
  const failing = reported.filter((w) => w.state === "fail");
  const todo = ROADMAP.filter((r) => !isShipped(r)).length;
  const switches = feed?.features.filter((f) => f.state !== "unreported") ?? [];
  const on = switches.filter((f) => f.state === "on").length;

  return (
    <div className="sec-page wv-page wv-sec rm-boiler">
      <SystemsNav />
      <header className="wv-pghead">
        <p className="wv-eyb">Threat model and scans</p>
        <h1 className="wv-h1 desk__title">
          {!feed || !reported.length ? (
            <>
              Waiting on <em>GitHub's scans.</em>
            </>
          ) : failing.length ? (
            <>
              {WORDS[failing.length] ?? failing.length} {failing.length === 1 ? "scan is" : "scans are"} <em style={{ color: "var(--wv-bad)" }}>failing.</em>
            </>
          ) : (
            <>
              Every scan is <em style={{ color: "var(--wv-ok)" }}>passing.</em>
            </>
          )}
        </h1>
        <p className="wv-sub">
          Counts only here. The details of anything open stay with the crew. <FeedLine state={state} now={now} />
        </p>
      </header>

      {/* Sign-in and the site lock live here too, where Nikita looks for them (05:23Z); the Foundry keeps its copy. */}

      <PopScope prefix="sec">
        <ScanBeads feed={feed} now={now} />

        <div className="wv-sec2">
          <section className="wv-panel wv-trust">
            <div className="wv-sechead">
              <div>
                <p className="wv-eyb">Trust map</p>
                <h2 className="wv-h2">{WORDS[BOUNDARIES.length] ?? BOUNDARIES.length} boundaries</h2>
              </div>
              <p className="wv-note">
                {BOUNDARIES.filter((b) => !b.planned).length} guarded{BOUNDARIES.some((b) => b.planned) ? `, ${BOUNDARIES.filter((b) => b.planned).length} waits on the Mac` : ""}
              </p>
            </div>
            <WovenTrust />
          </section>
          <section className="wv-panel wv-score">
            <Scorecard feed={feed} now={now} />
          </section>
        </div>

        <section className="wv-counts" aria-label="Counts">
          <CountCell n={feed?.alerts.codeScanning ? String(feed.alerts.codeScanning.open) + (feed.alerts.codeScanning.more ? "+" : "") : "–"} what={feed?.alerts.codeScanning ? "code scanning alerts open" : "code scanning alerts, not reported"} />
          <CountCell n={feed?.alerts.dependabot ? String(feed.alerts.dependabot.open) + (feed.alerts.dependabot.more ? "+" : "") : "–"} what={feed?.alerts.dependabot ? "dependency alerts open" : "dependency alerts, not reported"} />
          <CountCell n={switches.length ? `${on} of ${switches.length}` : "–"} what={switches.length ? "security switches on" : "security switches, not reported"} />
          <CountCell n={`${todo} of ${ROADMAP.length}`} what="roadmap items still to ship" />
        </section>

        <div className="wv-sec2 wv-sec-more">
          <section className="wv-panel">
            <div className="wv-sechead">
              <div>
                <p className="wv-eyb">Guards</p>
                <h2 className="wv-h2">The repo's switches</h2>
              </div>
              <Out href={`${REPO_URL}/security`}>Security tab</Out>
            </div>
            <Guards feed={feed} />
          </section>
          <section className="wv-panel">
            <div className="wv-sechead">
              <div>
                <p className="wv-eyb">Injection eval suite</p>
                <h2 className="wv-h2">
                  {EVALS.passing} of {EVALS.total} pass
                </h2>
              </div>
              <p className="wv-note">Runs on every build, offline</p>
            </div>
            <Evals />
          </section>
        </div>

        <section className="wv-panel wv-sec-road">
          <div className="wv-sechead">
            <div>
              <p className="wv-eyb">Open risks and the roadmap</p>
              <h2 className="wv-h2">What's left, in order</h2>
            </div>
            <Out href={DOC_URL}>Threat model</Out>
          </div>
          <Roadmap />
        </section>
      </PopScope>
    </div>
  );
}

function CountCell({ n, what }: { n: string; what: string }) {
  return (
    <div>
      <b>{n}</b>
      <span>{what}</span>
    </div>
  );
}

function FeedLine({ state, now }: { state: FeedState; now: number }) {
  if (state.status === "waiting" || !state.fetchedAt) return null;
  return <span className="wv-feedline">{state.status === "stale" ? `From ${ago(state.fetchedAt, now)}.` : `Live, ${ago(state.fetchedAt, now)}.`}</span>;
}

/** The scans as a thread with a knot each, then the eval suite and the Scorecard at its end. */
function ScanBeads({ feed, now }: { feed: SecurityFeed | null; now: number }) {
  const rows = SCAN_IDS.map((id) => {
    const w = feed?.workflows.find((x) => x.id === id);
    const word = !feed ? "Waiting" : !w ? "Not reported" : w.state === "other" ? (w.conclusion ? w.conclusion[0]!.toUpperCase() + w.conclusion.slice(1) : "Finished") : RUN_WORD[w.state];
    const bead: Bead = w?.state === "pass" ? "ok" : w?.state === "fail" ? "bad" : "off";
    return { id, w, word, bead };
  });
  const card = feed?.scorecard;
  const beads: Bead[] = [...rows.map((r) => r.bead), EVALS.passing + EVALS.expectedFail === EVALS.total ? "ok" : "bad", card ? (card.score >= 4 ? "ok" : "bad") : "off"];
  const spec = useMemo(() => beadsSpec(beads), [beads.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  return (
    <section className="wv-scans" aria-label="Scans">
      <canvas ref={cv} className="wv-cv" aria-hidden="true" />
      <ul className="wv-scans-l">
        {rows.map((r) => (
          <Scan key={r.id} id={r.id} w={r.w} word={r.word} bead={r.bead} now={now} />
        ))}
        <EvalBead />
        <li className={card ? "" : "is-off"}>
          <b>Scorecard</b>
          <span>{card ? `${card.score.toFixed(1)} of 10` : feed ? "Not reported" : "Waiting"}</span>
        </li>
      </ul>
    </section>
  );
}

function EvalBead() {
  const pop = useExplain("stat-evals", "Injection evals", STAT_EXPLAIN.evals);
  return (
    <li className={`has-pop ${pop.open ? "is-open" : ""}`} tabIndex={0} {...pop.anchor}>
      {pop.card}
      <b>Injection evals</b>
      <span>
        {EVALS.passing} of {EVALS.total}
        {EVALS.expectedFail ? `, ${EVALS.expectedFail} known` : ""}
      </span>
    </li>
  );
}

/** The trust boundaries as threads between the zones, columns from where you sit out to the public. */
const TZ: { x: number; label: string; zones: ZoneId[] }[] = [
  { x: 0, label: "You", zones: ["browser", "relay"] },
  { x: 0.34, label: "Edge", zones: ["vercel"] },
  { x: 0.68, label: "Services", zones: ["claude", "github", "builder"] },
  { x: 1, label: "Public", zones: ["public"] },
];
const ZONE_SHORT: Record<ZoneId, string> = { browser: "The Desk", relay: "MacBook", vercel: "Vercel", claude: "Claude, Gemini", github: "GitHub", builder: "Claude Code", public: "The internet" };

function WovenTrust() {
  const [picked, setPicked] = useState<string | null>(null);
  const hot = useRef<string | null>(null);
  hot.current = picked;
  const spec = useMemo(() => tmapSpec(BOUNDARIES.map((b) => ({ id: b.id, from: b.from, to: b.to, wait: Boolean(b.planned) })), hot), []);
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  const b = BOUNDARIES.find((x) => x.id === picked);
  const ends = b ? [b.from, b.to] : [];
  return (
    <>
      <div className="wv-tmap">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        {TZ.map((z) => (
          <div key={z.label} className="wv-tz" style={{ "--x": z.x } as React.CSSProperties}>
            <p>{z.label}</p>
            {z.zones.map((id) => (
              <span key={id} data-tn={id} className={`${ZONES[id].planned ? "is-wait" : ""}${ends.includes(id) ? " is-on" : ""}`} title={`${ZONES[id].name}: ${ZONES[id].trust}`}>
                {ZONE_SHORT[id]}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="wv-tb" role="group" aria-label="Pick a boundary">
        {BOUNDARIES.map((x) => (
          <button key={x.id} type="button" className={`${x.planned ? "is-wait" : ""}${picked === x.id ? " is-on" : ""}`} aria-pressed={picked === x.id} onClick={() => setPicked(picked === x.id ? null : x.id)} onMouseEnter={() => (hot.current = x.id)} onMouseLeave={() => (hot.current = picked)}>
            {x.id}
          </button>
        ))}
      </div>
      {b ? (
        <div className="wv-tb-d">
          <p className="wv-tb-n">
            <b>{b.name}</b> <span>{ZONES[b.from].name} to {ZONES[b.to].name}</span>
          </p>
          <p className="wv-note">
            <i>What crosses:</i> {b.crosses}
          </p>
          <ul className="wv-tb-c">
            {partsOf(b.controls).map((c) => (
              <li key={c}>
                <Rich text={c} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="wv-note wv-tb-hint">Pick a boundary to see what crosses it and every control on it.</p>
      )}
    </>
  );
}

const RUN_WORD: Record<SecurityFeed["workflows"][number]["state"], string> = {
  pass: "Passing",
  fail: "Failing",
  other: "",
  none: "No runs yet",
  unreported: "Not reported",
};
export const SCAN_IDS: ScanId[] = ["checks", "codeql", "scorecard", "dependency-review", "e2e"];
const SCAN_NAME: Record<ScanId, string> = {
  checks: "Checks",
  codeql: "CodeQL",
  scorecard: "Scorecard",
  "dependency-review": "Dependency review",
  e2e: "E2E",
};

function Scan({ id, w, word, bead, now }: { id: ScanId; w: SecurityFeed["workflows"][number] | undefined; word: string; bead: Bead; now: number }) {
  const pop = useExplain(`scan-${id}`, SCAN_NAME[id], SCAN_EXPLAIN[id], { kicker: "Scan" });
  const at = w?.at ? Date.parse(w.at) : NaN;
  return (
    <li className={`${bead === "bad" ? "is-bad" : bead === "off" ? "is-off" : ""} has-pop ${pop.open ? "is-open" : ""}`} tabIndex={0} aria-label={`${SCAN_NAME[id]}: ${word}${Number.isFinite(at) ? `, ${ago(at, now)}` : ""}`} {...pop.anchor}>
      {pop.card}
      <b>{SCAN_NAME[id]}</b>
      <span>{word}</span>
      {w?.url ? (
        <a className="wv-scan-a" href={w.url} target="_blank" rel="noopener noreferrer">
          {Number.isFinite(at) ? ago(at, now) : "Run"}
          {w.scope === "pull request" ? ", latest PR" : ""}
        </a>
      ) : (
        Number.isFinite(at) && <small>{ago(at, now)}</small>
      )}
    </li>
  );
}

/** The Scorecard as bars: its three best and three weakest checks, and every check folded below. */
function Scorecard({ feed, now }: { feed: SecurityFeed | null; now: number }) {
  const card = feed?.scorecard;
  const head = (title: string) => (
    <div className="wv-sechead">
      <div>
        <p className="wv-eyb">How the repo is run</p>
        <h2 className="wv-h2">{title}</h2>
      </div>
    </div>
  );
  if (!card)
    return (
      <>
        {head("Scorecard")}
        <p className="wv-note">{feed ? "Scorecard hasn't published a result for the repo yet." : "Waiting for the Scorecard result."}</p>
      </>
    );
  const scored = [...card.checks].filter((c) => c.score >= 0).sort((a, b) => b.score - a.score);
  const pick = scored.length > 6 ? [...scored.slice(0, 3), ...scored.slice(-3)] : scored;
  const at = Date.parse(card.date);
  return (
    <>
      {head(`Scorecard, ${card.score.toFixed(1)}`)}
      <ul className="wv-score-l" aria-label="Scorecard checks">
        {pick.map((c) => (
          <ScoreBar key={c.name} c={c} />
        ))}
      </ul>
      <details className="wv-more-d">
        <summary>All {card.checks.length} checks</summary>
        <ul className="wv-score-l">
          {[...card.checks]
            .sort((a, b) => b.score - a.score)
            .map((c) => (
              <ScoreBar key={c.name} c={c} />
            ))}
        </ul>
      </details>
      <p className="wv-note wv-score-n">
        OpenSSF Scorecard{Number.isFinite(at) ? `, scored ${ago(at, now)}` : ""}. <Out href={`https://scorecard.dev/viewer/?uri=github.com/nikitapage10/C.E.O.`}>Full report</Out>
      </p>
    </>
  );
}

function ScoreBar({ c }: { c: NonNullable<SecurityFeed["scorecard"]>["checks"][number] }) {
  const na = c.score < 0;
  const name = c.name.replace(/-/g, " ");
  const pop = useExplain(`score-${c.name}`, name, scorecardExplain(c.name, c.short), {
    kicker: na ? "Scorecard check · n/a" : `Scorecard check · ${c.score}/10`,
  });
  return (
    <li className={`${na || c.score === 0 ? "is-z" : ""} has-pop ${pop.open ? "is-open" : ""}`} style={{ "--v": na ? 0 : c.score / 10, "--c": na ? undefined : c.score >= 7 ? "var(--wv-ok)" : c.score >= 4 ? "var(--wv-warn, #e0b26b)" : "var(--wv-bad)" } as React.CSSProperties} tabIndex={0} {...pop.anchor}>
      {pop.card}
      <b>{name}</b>
      <i aria-hidden="true" />
      <em>{na ? "n/a" : c.score}</em>
    </li>
  );
}

const FEATURE_WORD = {
  on: "On",
  off: "Off",
  unreported: "Not reported",
} as const;
const FEATURE_TONE: Record<keyof typeof FEATURE_WORD, Tone> = {
  on: "ok",
  off: "down",
  unreported: "off",
};

function Guards({ feed }: { feed: SecurityFeed | null }) {
  if (!feed) return <p className="quiet">Waiting for GitHub.</p>;
  const unreported = feed.features.filter((f) => f.state === "unreported").length;
  return (
    <div className="guards">
      <ul className="guards__list" aria-label="Security switches">
        {feed.features.map((f) => (
          <Guard key={f.id} f={f} />
        ))}
      </ul>
      <div className="guards__alerts">
        <AlertCount kind="codeScanning" name="Code scanning alerts" count={feed.alerts.codeScanning} />
        <AlertCount kind="dependabot" name="Dependabot alerts" count={feed.alerts.dependabot} />
      </div>
      {unreported > 0 && <p className="guards__note">“Not reported” means the Foundry's token can't read that setting; it says nothing about whether it's on. The Security tab shows it.</p>}
    </div>
  );
}

function Guard({ f }: { f: SecurityFeed["features"][number] }) {
  const pop = useExplain(`guard-${f.id}`, f.name, featureExplain(f.id), {
    kicker: "Security switch",
  });
  return (
    <li className={`has-pop ${pop.open ? "is-open" : ""}`} tabIndex={0} {...pop.anchor}>
      {pop.card}
      <span>{f.name}</span>
      <Pill tone={FEATURE_TONE[f.state]}>{FEATURE_WORD[f.state]}</Pill>
    </li>
  );
}

function AlertCount({ kind, name, count }: { kind: keyof SecurityFeed["alerts"]; name: string; count: SecurityFeed["alerts"]["codeScanning"] }) {
  const pop = useExplain(`alerts-${kind}`, name, ALERT_EXPLAIN[kind], {
    kicker: "Counts only",
  });
  const open = pop.open ? "is-open" : "";
  if (!count)
    return (
      <div className={`alerts alerts--off has-pop ${open}`} tabIndex={0} {...pop.anchor}>
        {pop.card}
        <span className="alerts__name">{name}</span>
        <span className="alerts__none">Not reported</span>
      </div>
    );
  const n = (x: number) => `${x}${count.more && x >= 100 ? "+" : ""}`;
  const total = count.open + count.fixed;
  return (
    <div className={`alerts ${count.open ? "alerts--open" : "alerts--clear"} has-pop ${open}`} tabIndex={0} {...pop.anchor}>
      {pop.card}
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
      {ROADMAP.map((r) => (
        <RoadmapRow key={r.id} r={r} />
      ))}
    </ol>
  );
}

function RoadmapRow({ r }: { r: (typeof ROADMAP)[number] }) {
  const shipped = isShipped(r);
  const risks = OWASP_LLM.filter((x) => refsOf(x.tracking).includes(r.id)).map((x) => x.id);
  const pop = useExplain(`road-${r.id}`, r.item.split(/[:(]/)[0]!.trim(), ROADMAP_EXPLAIN[r.id]!, {
    kicker: shipped ? "Shipped" : `${r.id}${risks.length ? ` · follows up ${risks.join(", ")}` : ""}`,
  });
  return (
    <li className={`roadmap__row ${shipped ? "is-shipped" : ""} has-pop ${pop.open ? "is-open" : ""}`} tabIndex={0} {...pop.anchor}>
      {pop.card}
      <span className="roadmap__id">{shipped ? "✓" : r.id}</span>
      <span className="roadmap__item">
        <span className="roadmap__what">{r.item}</span>
        <span className="roadmap__closes">Closes: {r.closes}</span>
      </span>
      <span className="roadmap__side">
        {risks.length > 0 && <span className="roadmap__risks">{risks.join(" · ")}</span>}
        <Pill tone={shipped ? "ok" : "off"}>{shipped && !/^Shipped\b/.test(r.status) ? `Shipped ${r.status}` : r.status}</Pill>
      </span>
    </li>
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
        {EVAL_AREAS.map((a) => (
          <EvalArea key={a.id} a={a} max={max} />
        ))}
      </ul>
    </div>
  );
}

function EvalArea({ a, max }: { a: (typeof EVAL_AREAS)[number]; max: number }) {
  const pop = useExplain(`eval-${a.id}`, a.area, EVAL_EXPLAIN[a.id], {
    kicker: "Eval area",
    pin: false,
  });
  const c = EVALS.areas.find((x) => x.id === a.id);
  if (!c) return null;
  return (
    <li>
      <details className="eval">
        <summary className={`has-pop ${pop.open ? "is-open" : ""}`} {...pop.anchor}>
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
        {pop.card}
        <ExplainInline e={EVAL_EXPLAIN[a.id]} />
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
}
