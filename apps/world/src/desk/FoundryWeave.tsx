import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CREW, CREW_ORDER, CREW_RANK, DOCK_CREW, crewFor, crewOf, modelOf, recentWork, shippedToday, sparesAwake, type Change, type Crate, type CrewId, type FoundryData } from "../foundry.ts";
import type { WorldFeed } from "../chronicle.ts";
import { formatUsd, foundryJobs, monthSpend, SPEND_CAP_USD, workByModel, type UsageFeed } from "../usage.ts";
import { countdown, nextRuns, runTime } from "./crewRuns.ts";
import { FOUNDRY_THREAD } from "./deskData.ts";
import { ideaTitle, Mic, soon, useIdeaChoice, type Setup } from "./IdeaCard.tsx";
import { usePictureLinks } from "./ideaImages.ts";
import { ROOM_META, ROOM_ORDER } from "./roomPulse.ts";
import { DeskSignIn } from "./SignIn.tsx";
import { loomSpec, type LoomCtl, type LoomItems } from "./stageEngine.ts";
import { barSpecOf, progSpecOf, type Seg } from "./TodayWeave.tsx";
import { describeRun, useVisualQa } from "./visualqa/feed.ts";
import { knot, OK, Parts, Poly, RC, ring, smoothPts, spr, useViz, weave, WHITE, type VizSpec } from "./wvCanvas.ts";

/**
 * The Foundry in the approved Weave (desk-concepts round five): a headline with the Builder's word, the loom with every
 * real item as a knot you can open, the job in flight with its stages, the ideas on the bench beside the Suggest box,
 * the crew as portraits, and the changelog, runs, usage and Visual QA below. Every number and name comes from GitHub,
 * the issue trails, the world's ledger and the Visual QA feed; anything not connected says so.
 */

const HOUR = 3_600_000;
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const pic = (id: string) => `/desk/agent-${id}.webp`;
const NUM = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const words = (n: number) => NUM[n] ?? String(n);
/** The room colour each crew member's work wears on the Weave. */
const CREW_ROOM: Record<CrewId, string> = { semicolon: "exchange", tessellate: "foundry", caret: "archive" };

const Arrow = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

export function isBuild(c: Crate) {
  return c.kind !== "idea" || c.state === "working";
}

/* ── The headline and the Builder's word ── */

export function FoundryHead({ data, ideas, now, connected, lead }: { data: FoundryData; ideas: Crate[]; now: number; connected: boolean; lead: string }) {
  const working = data.crates.filter((c) => isBuild(c) && c.state === "working");
  const who = working[0] ? CREW[crewOf(working[0], data.crates)].name : null;
  const week = data.changelog.filter((c) => now - c.at < 7 * 24 * HOUR).length;
  const today = shippedToday(data.changelog, now);
  const checks = data.checks.state;
  const checksLine = checks === "pass" ? "checks on main came back green" : checks === "fail" ? "checks on main are red" : checks === "running" ? "checks on main are running" : "no check run read yet";
  const quote = !connected
    ? "I can't see the shop floor yet. GitHub hasn't answered. I'm told patience is a virtue. I'm told a lot of things."
    : checks === "fail"
      ? "Main went red. Rivet's already on it, and nothing new ships until it's green. That's the rule. I wrote the rule."
      : working[0]
        ? `${who} is on “${ideaTitle(working[0].title)}”. Tests are the slow part. They always are. I've stopped hovering. Mostly.`
        : ideas.length
          ? `${words(ideas.length)} ${ideas.length === 1 ? "idea is" : "ideas are"} on the bench waiting for your pick. The loom's warm. Say the word.`
          : today
            ? `${words(today)} shipped today and the loom is resting. I'd call that a good day, if I called days anything.`
            : `The loom is quiet. The next ideas arrive ${countdown(nextRuns(new Date(now)).ideas, new Date(now))}. I'll pretend I'm not counting.`;
  return (
    <header className="wv-fhead">
      <div>
        <p className="wv-eyb">Foundry, the coding crew</p>
        <h1 className="wv-h1 desk__title">
          {who ? (
            <>
              {who} is at <em style={{ color: "var(--rc-foundry)" }}>the loom.</em>
            </>
          ) : ideas.length ? (
            <>
              The loom is waiting on <em style={{ color: "var(--wv-hot)" }}>your pick.</em>
            </>
          ) : (
            <>
              The loom is <em style={{ color: "var(--wv-ok)" }}>resting.</em>
            </>
          )}
        </h1>
        <p className="wv-sub">
          Ideas come in on the left, warm, and ship on the right, cool. {week ? `${words(week)} shipped this week` : "Nothing shipped this week yet"}, and {checksLine}. {lead} Open any knot to follow its thread.
        </p>
      </div>
      <figure className="wv-builder" data-room="foundry">
        <img src={pic(ROOM_META.foundry.submind.id)} alt="" />
        <blockquote>“{quote}”</blockquote>
        <figcaption>
          <b>{ROOM_META.foundry.submind.title}</b>Skippy's submind in the Foundry
        </figcaption>
      </figure>
    </header>
  );
}

/* ── The loom ── */

interface StageProps {
  data: FoundryData;
  ideas: Crate[];
  now: number;
  setup: Setup;
  /** The one control the page owns for a crate in flight: Stop, for a build the Builder approved itself. */
  stop: (c: Crate) => ReactNode;
  onSuggest: () => void;
  /** Open a knot from outside the stage ("Follow the thread"). */
  openRef?: React.MutableRefObject<((id: string) => void) | null>;
}

export function FoundryStage({ data, ideas, now, setup, stop, onSuggest, openRef }: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const [hover, setHover] = useState<string | null>(null);
  const flight = data.crates.filter((c) => isBuild(c) && c.state === "working").sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  const bench = ideas.filter((c) => c.number > 0).slice(0, 2);
  const latest = data.changelog[0] ?? null;
  const items: LoomItems = useMemo(
    () => ({
      flight: flight ? `c${flight.number}` : null,
      ideas: bench.map((c) => `c${c.number}`),
      shipped: latest ? "shipped" : null,
      aux: { "crew-semicolon": RC.exchange!, "crew-tessellate": RC.foundry!, "crew-caret": RC.archive!, "crew-dock": RC.workshop! },
    }),
    // The loom is rebuilt only when which items it holds changes, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flight?.number, bench.map((c) => c.number).join(), Boolean(latest)],
  );
  const ctl = useRef<LoomCtl>({ focus: null, level: 0, hover: null, host: null, open: () => {} });
  const open = useCallback((id: string) => {
    setFocus((f) => {
      if (f === id) {
        setLevel((l) => (l === 1 ? 2 : l));
        return f;
      }
      setLevel(1);
      return id;
    });
  }, []);
  const goBack = useCallback(() => {
    setLevel((l) => {
      if (l === 2) return 1;
      setFocus(null);
      return 0;
    });
  }, []);
  ctl.current.focus = focus;
  ctl.current.level = level;
  ctl.current.hover = hover;
  ctl.current.host = host.current;
  ctl.current.open = open;
  if (openRef) openRef.current = open;
  const spec = useMemo(() => loomSpec(items, ctl), [items]);
  const vz = useViz(cv, spec);
  useEffect(() => {
    ctl.current.host = host.current;
    vz.current?.relayout();
  }, [focus, level, vz]);
  useEffect(() => {
    if (!focus) return;
    const t = window.setTimeout(() => back.current?.focus({ preventScroll: true }), 60);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && goBack();
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [focus, goBack]);

  const working = data.crates.filter((c) => isBuild(c) && c.state === "working").length;
  const checks = data.checks.state;
  const today = shippedToday(data.changelog, now);
  const runs = nextRuns(new Date(now));
  const knotBtn = (id: string, colour: string, eyebrow: string, title: string, avatar?: string) => (
    <button key={id} className="wv-knot" type="button" data-item={id} style={{ "--sc": colour } as React.CSSProperties} aria-label={`${eyebrow}: ${title}`} onClick={() => open(id)} onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(id)} onBlur={() => setHover(null)}>
      <span className="wv-kl">
        <span className="wv-ke">{eyebrow}</span>
        {avatar && <img className="wv-kav" src={avatar} alt="" />}
        {title}
      </span>
    </button>
  );

  return (
    <div className="wv-fstage">
      <div className="wv-stagekey" aria-hidden="true">
        <span style={{ "--c": "var(--wv-hot)" } as React.CSSProperties}>Ideas</span>
        <span style={{ "--c": "var(--rc-foundry)" } as React.CSSProperties}>Building</span>
        <span style={{ "--c": "var(--wv-run)" } as React.CSSProperties}>Checks</span>
        <span style={{ "--c": "var(--wv-ok)" } as React.CSSProperties}>Shipped</span>
      </div>
      <div ref={host} className={`wv-stage${focus ? " is-focus" : ""}`} aria-label="The loom: the crew's work from idea to shipped">
        <canvas ref={cv} className="wv-scv" aria-hidden="true" />
        <div className="wv-top">
          <button ref={back} className="wv-back" type="button" aria-label="Back one level" onClick={goBack} tabIndex={focus ? 0 : -1}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3 5 8l5 5" />
            </svg>
            Back<span className="wv-back-k">Esc</span>
          </button>
          <button className="wv-btn is-sm wv-sugg" type="button" onClick={onSuggest}>
            Suggest
          </button>
        </div>
        <div className="wv-col">
          <p>Ideas</p>
          <b>{ideas.length}</b>
        </div>
        <div className={`wv-col${working ? " is-live" : ""}`}>
          <p>Building</p>
          <b>{working}</b>
        </div>
        <div className="wv-col">
          <p>Checks</p>
          <b>{checks === "pass" ? "Green" : checks === "fail" ? "Red" : checks === "running" ? "Running" : "None yet"}</b>
        </div>
        <div className="wv-col">
          <p>Shipped today</p>
          <b>{today}</b>
        </div>

        {flight && knotBtn(`c${flight.number}`, "var(--rc-foundry)", flight.state === "working" ? "In flight" : "On the bench", ideaTitle(flight.title), pic(crewOf(flight, data.crates)))}
        {bench.map((c) => knotBtn(`c${c.number}`, "var(--wv-hot)", c.asking ? "Idea, Rivet asks first" : `Idea${c.builder ? `, for ${CREW[c.builder].name}` : ""}`, ideaTitle(c.title)))}
        {latest && knotBtn("shipped", "var(--wv-ok)", "Shipped, latest", ideaTitle(latest.title))}

        <div className="wv-foot">
          <div className="wv-crew">
            <p>At the loom</p>
            <ul>
              {CREW_ORDER.map((id) => (
                <li key={id}>
                  <button type="button" className={focus === `crew-${id}` ? "is-on" : undefined} onClick={() => open(`crew-${id}`)}>
                    <img src={pic(id)} alt="" />
                    {CREW[id].name}
                  </button>
                </li>
              ))}
              {DOCK_CREW.map((d) => (
                <li key={d.name}>
                  <button type="button" className={focus === "crew-dock" ? "is-on" : undefined} onClick={() => open("crew-dock")}>
                    <span className="wv-cmono">{d.name[0]}</span>
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="wv-side">
            <p className="wv-snext">
              Next, a queue check <b>{countdown(runs.queue, new Date(now))}</b>
            </p>
            <button className="wv-btn is-sm" type="button" onClick={onSuggest}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
              Suggest an idea
            </button>
          </div>
        </div>

        {flight && (
          <Detail id={`c${flight.number}`} focus={focus} level={level} onDeeper={() => setLevel(2)} eyebrow={flight.paused ? "In flight, paused for a fix" : "In flight"} colour="var(--rc-foundry)" title={ideaTitle(flight.title)} more="Its history">
            {{
              body: (
                <>
                  <p className="wv-txt">
                    {CREW[crewOf(flight, data.crates)].name} is building it on {modelOf(flight, crewOf(flight, data.crates))}.{flight.pitch ? ` ${flight.pitch}` : ""}
                  </p>
                  <div className="wv-steps" aria-label="Stage">
                    <span className="is-past">Idea</span>
                    <span className="is-now">Building</span>
                    <span>Checks</span>
                    <span>Shipped</span>
                  </div>
                  <div className="wv-dacts">
                    <a className="wv-btn is-pri" href={flight.url} target="_blank" rel="noreferrer">
                      Watch it on GitHub
                    </a>
                    {stop(flight)}
                  </div>
                </>
              ),
              deep: (
                <>
                  <p className="wv-eb2">History</p>
                  {flight.createdAt && <Row b="Opened" span={`#${flight.number}`} st={clock(flight.createdAt)} i={0} />}
                  <Row b="Last change" span={`${flight.kind === "fix" ? "A fix" : flight.kind === "upkeep" ? "Upkeep" : "A build"}${flight.short ? `, ${flight.short.toLowerCase()}` : ""}`} st={clock(flight.updatedAt)} i={1} c="run" />
                </>
              ),
            }}
          </Detail>
        )}
        {bench.map((c) => (
          <IdeaDetail key={c.number} crate={c} setup={setup} focus={focus} level={level} onDeeper={() => setLevel(2)} />
        ))}
        {latest && (
          <Detail id="shipped" focus={focus} level={level} onDeeper={() => setLevel(2)} eyebrow="Shipped" colour="var(--wv-ok)" title={shippedTitle(data.changelog, now)} more="The changelog">
            {{
              body: (
                <ul className="wv-list">
                  {data.changelog.slice(0, 4).map((c) => (
                    <li key={c.key}>{ideaTitle(c.title)}</li>
                  ))}
                </ul>
              ),
              deep: (
                <>
                  {data.changelog.slice(0, 8).map((c, i) => (
                    <Row key={c.key} b={ideaTitle(c.title)} span={c.by ? `${CREW[c.by].name}` : undefined} st={dayTime(c.at, now)} i={i} c="ok" href={c.landed?.url ?? c.issue?.url} />
                  ))}
                </>
              ),
            }}
          </Detail>
        )}
        {CREW_ORDER.map((id) => (
          <CrewDetail key={id} id={id} data={data} now={now} focus={focus} level={level} onDeeper={() => setLevel(2)} />
        ))}
        <Detail id="crew-dock" focus={focus} level={level} onDeeper={() => setLevel(2)} eyebrow="The dock crew" title="Dusty, Gusty and Musty" more="Next runs">
          {{
            body: <p className="wv-txt">Frames Rusty pulled off the scrapheap and patched up himself. They keep the loom running between builds: the queue checks, the upkeep and the morning ideas. {sparesAwake(data.crates) ? `${words(sparesAwake(data.crates))} out on a job right now.` : "All three are in their bays."}</p>,
            deep: (
              <>
                <Row b="Queue check" span="Every 15 minutes" st={countdown(runs.queue, new Date(now))} i={0} c="run" />
                <Row b="Upkeep" span="Every 5 hours" st={runTime(runs.upkeep)} i={1} />
                <Row b="Morning ideas" span="Daily, 9:00 Mountain" st={runTime(runs.ideas)} i={2} />
              </>
            ),
          }}
        </Detail>
      </div>
    </div>
  );
}

function shippedTitle(changes: Change[], now: number) {
  const day = new Date(now).setHours(0, 0, 0, 0);
  const today = changes.filter((c) => c.at >= day).length;
  const yesterday = changes.filter((c) => c.at < day && c.at >= day - 24 * HOUR).length;
  if (!today && !yesterday) return "The latest to reach the Lattice";
  return `${words(today)} today, ${words(yesterday).toLowerCase()} yesterday`;
}

function dayTime(at: number, now: number) {
  const day = new Date(now).setHours(0, 0, 0, 0);
  return at >= day ? clock(at) : new Date(at).toLocaleDateString(undefined, { weekday: "short" }) + ", " + clock(at);
}

function Row({ b, span, st, i, c, href }: { b: string; span?: string; st?: string; i: number; c?: "ok" | "run" | "wait"; href?: string }) {
  return (
    <div className={`wv-row${c ? "" : " wv-h"}`} data-c={c} style={{ "--i": i } as React.CSSProperties}>
      <div>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            <b>{b}</b>
          </a>
        ) : (
          <b>{b}</b>
        )}
        {span && <span>{span}</span>}
      </div>
      {st && <p className={`wv-st${c === "ok" ? " is-ok" : c === "run" ? " is-run" : ""}`}>{st}</p>}
    </div>
  );
}

/** One item's details over the loom: its title beside the knot, its answers, and one level deeper on request. */
function Detail({ id, focus, level, onDeeper, eyebrow, colour, title, more, portrait, children }: { id: string; focus: string | null; level: number; onDeeper: () => void; eyebrow: string; colour?: string; title: string; more?: string; portrait?: string; children: { body: ReactNode; deep?: ReactNode } }) {
  const on = focus === id;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(r);
  }, [on]);
  const deep = on && level === 2;
  return (
    <article className={`wv-detail${on ? " is-open" : ""}${shown ? " is-in" : ""}`} hidden={!on} aria-label={title}>
      {portrait && <img className="wv-portrait" src={portrait} alt="" />}
      <p className="wv-eb" style={colour ? { color: colour } : undefined}>
        {eyebrow}
      </p>
      <h3 className="wv-ttl">{title}</h3>
      {children.body}
      {children.deep && !deep && more && (
        <div className="wv-dacts">
          <button className="wv-more" type="button" onClick={onDeeper}>
            {more} <Arrow />
          </button>
        </div>
      )}
      {children.deep && deep && <div className="wv-deep is-in">{children.deep}</div>}
    </article>
  );
}

function IdeaDetail({ crate, setup, focus, level, onDeeper }: { crate: Crate; setup: Setup; focus: string | null; level: number; onDeeper: () => void }) {
  const c = useIdeaChoice(crate, setup);
  const id = `c${crate.number}`;
  const by = crate.builder ? CREW[crate.builder].name : null;
  return (
    <Detail id={id} focus={focus} level={level} onDeeper={() => (c.setMode("revise"), onDeeper())} eyebrow={crate.asking ? "Idea, Rivet asks first" : `Idea${by ? `, for ${by}` : ""}${crate.size ? `, ${crate.size}` : ""}`} title={ideaTitle(crate.title)} more={c.ready ? "Revise it" : undefined}>
      {{
        body: (
          <>
            {crate.pitch && <p className="wv-txt">{crate.pitch}</p>}
            {crate.asking && crate.question && (
              <p className="wv-quote">
                <img src={pic("semicolon")} alt="" />“{crate.question}”
              </p>
            )}
            <IdeaAnswers c={c} crate={crate} setup={setup} />
          </>
        ),
        deep: c.ready ? (
          <form
            className="wv-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (c.note.trim()) void c.go("revise");
            }}
          >
            <input className="wv-input" type="text" value={c.note} onChange={(e) => c.setNote(e.target.value)} placeholder="What should change?" aria-label="Revise the idea" maxLength={2000} />
            <button className="wv-btn is-sm is-pri" type="submit" disabled={!c.note.trim() || c.mode === "busy"}>
              Revise
            </button>
          </form>
        ) : undefined,
      }}
    </Detail>
  );
}

/** Build, Not this one and (for a question) the answer box, in the Weave's buttons; the sign-in step when it's needed. */
function IdeaAnswers({ c, crate, setup, small }: { c: ReturnType<typeof useIdeaChoice>; crate: Crate; setup: Setup; small?: boolean }) {
  const sm = small ? " is-sm" : "";
  if (crate.number < 0 && !crate.revising) return <p className="wv-act-note">Shaped. Saving it to GitHub…</p>;
  if (crate.revising) return <p className="wv-act-note">{`Waiting for Rivet: she picks up your notes ${soon()}.`}</p>;
  if (c.mode === "done") return <p className="wv-act-ok wv-idea-said">{c.result}</p>;
  if (c.mode === "failed")
    return (
      <p className="wv-act-note">
        That didn't go through. Try again, or pick in the{" "}
        <a href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
          Foundry thread
        </a>
        .
      </p>
    );
  if (c.mode === "signin") return <DeskSignIn compact onDone={c.resume} onCancel={c.cancelSignIn} />;
  const busy = c.mode === "busy";
  return (
    <>
      <div className={small ? "wv-idea-do" : "wv-dacts"} title={!c.ready ? (setup ? "Set the Vercel variables to pick from here" : "Checking…") : undefined}>
        <button className={`wv-btn is-pri${sm}`} type="button" disabled={!c.ready || busy} onClick={() => void c.go("build")}>
          {c.asking ? "Build as is" : "Build"}
        </button>
        {c.asking ? (
          <button className={`wv-btn${sm}`} type="button" disabled={!c.ready || busy} onClick={() => c.setMode(c.mode === "answer" ? "idle" : "answer")}>
            Answer Rivet
          </button>
        ) : (
          small && (
            <button className={`wv-btn${sm}`} type="button" disabled={!c.ready || busy} onClick={() => c.setMode(c.mode === "revise" ? "idle" : "revise")}>
              Revise
            </button>
          )
        )}
        <button className={`wv-btn is-ghost${sm}`} type="button" disabled={!c.ready || busy} onClick={() => void c.go("pass")}>
          Not this one
        </button>
      </div>
      {(c.mode === "answer" || (small && c.mode === "revise")) && (
        <form
          className="wv-act-reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (c.note.trim()) void c.go(c.mode === "answer" ? "answer" : "revise");
          }}
        >
          <input className="wv-input" type="text" value={c.note} onChange={(e) => c.setNote(e.target.value)} placeholder={c.dictation.listening ? "Listening…" : c.mode === "answer" ? "Your answer for Rivet" : "What should change?"} aria-label={c.mode === "answer" ? "Answer Rivet" : "Revise the idea"} autoFocus maxLength={2000} />
          {c.mode === "answer" && <Mic dictation={c.dictation} onToggle={c.toggleMic} label="Say your answer" />}
          <button type="submit" className="wv-btn is-pri is-sm" disabled={!c.note.trim()}>
            Send
          </button>
        </form>
      )}
      {c.held && (
        <p className="wv-act-note" role="alert">
          {c.held}
        </p>
      )}
    </>
  );
}

function CrewDetail({ id, data, now, focus, level, onDeeper }: { id: CrewId; data: FoundryData; now: number; focus: string | null; level: number; onDeeper: () => void }) {
  const jobs = data.crates.filter((c) => isBuild(c) && c.state !== "shipped" && c.state !== "queued" && crewOf(c, data.crates) === id);
  const done = recentWork(data.changelog, id, 4);
  return (
    <Detail id={`crew-${id}`} focus={focus} level={level} onDeeper={onDeeper} portrait={pic(id)} eyebrow={`${CREW[id].job}, on ${CREW_RANK[id].models.replace("/", " or ")}`} title={CREW[id].name} more={`What ${CREW[id].name} did lately`}>
      {{
        body: <p className="wv-txt">{jobs.length ? `${jobs.length === 1 ? "On one job" : `On ${jobs.length} jobs`} now: ${jobs.map((c) => `“${ideaTitle(c.title)}”`).join(", ")}.` : done[0] ? `Free right now. Last shipped “${done[0].name}”, ${ago(now - done[0].at)} ago.` : "Free right now, and nothing shipped yet."}</p>,
        deep: (
          <>
            {jobs.map((c, i) => (
              <Row key={c.number} b={ideaTitle(c.title)} st={c.state === "working" ? "Building" : c.state === "ready" ? "Your OK" : "Stuck"} c="run" i={i} href={c.url} />
            ))}
            {done.map((r, i) => (
              <Row key={r.number} b={r.name} st={dayTime(r.at, now)} i={jobs.length + i} href={r.url} />
            ))}
            {!jobs.length && !done.length && <p className="wv-txt">Nothing yet.</p>}
          </>
        ),
      }}
    </Detail>
  );
}

function ago(ms: number) {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 24 * HOUR) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / (24 * HOUR))} d`;
}

/* ── In flight ── */

export function InFlight({ data, now, stop, onFollow }: { data: FoundryData; now: number; stop: (c: Crate) => ReactNode; onFollow: (id: string) => void }) {
  const running = data.crates.filter((c) => isBuild(c) && c.state === "working").sort((a, b) => b.updatedAt - a.updatedAt);
  const c = running[0];
  const steps: Seg[] = c ? (c.paused ? ["ok", "wait", "wait", "wait"] : ["ok", "run", "wait", "wait"]) : ["wait", "wait", "wait", "wait"];
  const spec = useMemo(() => progSpecOf(steps), [steps.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  if (!c) {
    const runs = nextRuns(new Date(now));
    return (
      <section className="wv-flight is-empty" data-room="foundry" aria-label="In flight now">
        <div className="wv-flight-who">
          <span className="wv-ring is-idle">
            <img src={pic("tessellate")} alt="" />
          </span>
          <div>
            <p className="wv-eyb">In flight now</p>
            <h2 className="wv-h2">Nothing on the loom</h2>
            <p className="wv-note">The next queue check is {countdown(runs.queue, new Date(now))}; it picks up anything approved or red.</p>
          </div>
        </div>
        <div className="wv-flight-checks">
          <canvas ref={cv} className="wv-flight-cv" aria-hidden="true" />
        </div>
        <div className="wv-flight-do" />
      </section>
    );
  }
  const who = crewOf(c, data.crates);
  const labels: [string, string, string][] = [
    ["Picked up", c.createdAt ? `#${c.number}, ${ago(now - c.createdAt)} ago` : `#${c.number}`, "is-ok"],
    ["Building", c.paused ? "Paused for a fix" : `${CREW[who].name} on ${modelOf(c, who)}`, c.paused ? "" : "is-run"],
    ["Checks", "On its pull request", ""],
    ["Ships", c.kind === "fix" || c.kind === "upkeep" || c.auto ? "Once green" : "Once green, with your OK", ""],
  ];
  return (
    <section className="wv-flight" data-room="foundry" aria-label="In flight now">
      <div className="wv-flight-who">
        <span className="wv-ring">
          <img src={pic(who)} alt="" />
        </span>
        <div>
          <p className="wv-eyb" style={{ color: "var(--rc-foundry)" }}>
            In flight now, updated {ago(now - c.updatedAt)} ago
          </p>
          <h2 className="wv-h2">{ideaTitle(c.title)}</h2>
          <p className="wv-note">
            {CREW[who].name} on {modelOf(c, who)}
            {c.short ? `, ${c.short.toLowerCase()}` : ""}
            {running.length > 1 ? `. ${words(running.length - 1)} more on the bench.` : ""}
          </p>
        </div>
      </div>
      <div className="wv-flight-checks">
        <canvas ref={cv} className="wv-flight-cv" aria-hidden="true" />
        <ol className="wv-flight-l">
          {labels.map(([b, s, cls]) => (
            <li key={b} className={cls}>
              <b>{b}</b>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="wv-flight-do">
        {stop(c)}
        <a className="wv-btn is-sm" href={c.url} target="_blank" rel="noreferrer">
          Open on GitHub
        </a>
        <button className="wv-link" type="button" onClick={() => onFollow(`c${c.number}`)}>
          Follow the thread
          <Arrow />
        </button>
      </div>
    </section>
  );
}

/* ── The ideas on the bench ── */

const IDEA_SCENES = ["lattice", "room-archive", "room-spire", "room-green", "room-workshop", "room-exchange"];

export function WeaveIdea({ crate, setup, now, i }: { crate: Crate; setup: Setup; now: number; i: number }) {
  const c = useIdeaChoice(crate, setup);
  const pictures = usePictureLinks(crate.images);
  const scene = IDEA_SCENES[Math.abs(crate.number) % IDEA_SCENES.length]!;
  const by = crate.builder ?? crewFor(crate);
  const age = crate.number > 0 && crate.createdAt ? `${ago(now - crate.createdAt)} ago` : "";
  return (
    <article className={`wv-idea${c.mode === "done" ? " is-said" : ""}`} style={{ "--i": i } as React.CSSProperties}>
      <div className={`wv-idea-img${pictures.length ? "" : i % 2 ? " is-dusk" : " is-night"}`}>
        <img src={pictures[0] ?? `/desk/${scene}.webp`} alt={pictures.length ? "Your picture" : ""} loading="lazy" />
        {crate.size && <span className="wv-chip">{crate.size[0]!.toUpperCase() + crate.size.slice(1)}</span>}
      </div>
      <div className="wv-idea-b">
        <p className="wv-idea-by">
          <img src={pic(crate.asking ? "semicolon" : by)} alt="" />
          {crate.asking ? "Rivet asks first" : `For ${CREW[by].name}`}
          {age ? `, ${age}` : ""}
          {crate.number > 0 && (
            <a className="wv-idea-n" href={crate.url} target="_blank" rel="noreferrer">
              #{crate.number}
            </a>
          )}
        </p>
        <h3 className="wv-h3">{ideaTitle(crate.title)}</h3>
        {crate.pitch && <p className="wv-idea-p">{crate.pitch}</p>}
        {crate.asking && crate.question && <p className="wv-idea-q">“{crate.question}”</p>}
        {pictures.length > 1 && (
          <ul className="wv-idea-pics">
            {pictures.slice(1).map((u, n) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer" title="Open the picture">
                  <img src={u} alt={`Picture ${n + 2}`} loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <IdeaAnswers c={c} crate={crate} setup={setup} small />
      </div>
    </article>
  );
}

/* ── The crew ── */

export function CrewRow({ data, now }: { data: FoundryData; now: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = CREW_ORDER.map((id) => data.crates.some((c) => isBuild(c) && c.state === "working" && crewOf(c, data.crates) === id));
  const spec = useMemo(() => crewSpec(), []);
  useViz(cv, spec);
  const runs = nextRuns(new Date(now));
  const awake = sparesAwake(data.crates);
  return (
    <section className="wv-crewrow" aria-label="The crew">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">The crew</p>
          <h2 className="wv-h2">Who's doing what</h2>
        </div>
      </div>
      <canvas ref={cv} className="wv-cv" aria-hidden="true" />
      <ul className="wv-crew-l">
        {CREW_ORDER.map((id, i) => {
          const jobs = data.crates.filter((c) => isBuild(c) && c.state !== "shipped" && c.state !== "queued" && crewOf(c, data.crates) === id);
          const last = recentWork(data.changelog, id, 1)[0];
          const line = jobs.length
            ? `${jobs[0]!.state === "working" ? "Building" : jobs[0]!.state === "ready" ? "Waiting on your OK for" : "Stuck on"} “${ideaTitle(jobs[0]!.title)}”${jobs.length > 1 ? `, and ${words(jobs.length - 1).toLowerCase()} more` : ""}.`
            : last
              ? `Free. Last shipped “${last.name}”, ${ago(now - last.at)} ago.`
              : "Free, and nothing shipped yet.";
          return (
            <li key={id} data-room={CREW_ROOM[id]} className={live[i] ? "is-live" : undefined}>
              <span className={`wv-ring${live[i] ? "" : " is-idle"}`}>
                <img src={pic(id)} alt="" />
              </span>
              <b>{CREW[id].name}</b>
              <em>
                {CREW_RANK[id].models.replace("/", " or ")}, {CREW[id].job.toLowerCase()}
              </em>
              <p>{line}</p>
            </li>
          );
        })}
        <li className="wv-dock" data-room="workshop">
          <span className="wv-dock-m">
            {DOCK_CREW.map((d) => (
              <i key={d.name} style={{ borderColor: d.colour }}>
                {d.name[0]}
              </i>
            ))}
          </span>
          <b>Dusty, Gusty, Musty</b>
          <em>The dock crew</em>
          <p>
            {awake ? `${words(awake)} out on a job. ` : ""}Next queue check {countdown(runs.queue, new Date(now))}, upkeep at {runTime(runs.upkeep)}.
          </p>
        </li>
      </ul>
    </section>
  );
}

function crewSpec(): VizSpec {
  let poly = new Poly();
  let P: Parts | null = null;
  let ks: { x: number; y: number; rgb: string }[] = [];
  return {
    lay(V) {
      const host = V.cv.parentElement;
      const lis = host ? [...host.querySelectorAll<HTMLElement>(".wv-crew-l li")] : [];
      ks = lis.map((li) => {
        const e = li.querySelector(".wv-ring, .wv-dock-m") ?? li;
        const r = V.rel(e);
        return { x: r.x + r.w / 2, y: r.y + r.h / 2, rgb: RC[li.dataset.room ?? "workshop"] ?? RC.workshop! };
      });
      if (!ks.length) return;
      const px = [-10];
      const py = [ks[0]!.y];
      for (const k of ks) {
        px.push(k.x);
        py.push(k.y);
      }
      px.push(V.W + 10);
      py.push(ks[0]!.y);
      const [sx, sy] = smoothPts(px, py, 12);
      poly = new Poly().set(sx, sy);
      P ??= new Parts(220, 0);
    },
    draw(_V, c, t, dt) {
      if (!ks.length) return;
      const near = (x: number) => ks.reduce((b, k) => (Math.abs(k.x - x) < Math.abs(b.x - x) ? k : b), ks[0]!);
      const mid = ks[1] ?? ks[0]!;
      weave(c, poly, P, { a: 0.7, sp: 2, sz: 0.7, v: 24, line: 0.1, jit: 0.4, col: (_u, x) => spr(near(x).rgb), I: (u) => 0.35 + 0.65 * Math.exp(-(((poly.at(u).x - mid.x) / 180) ** 2)) }, t, dt);
    },
  };
}

/* ── Changelog thread ── */

/** The changelog's thread down the left: a ring for each day, a knot for each change. */
export function logSpec(): VizSpec {
  let poly = new Poly();
  let P: Parts | null = null;
  let ks: { y: number; first: boolean; today: boolean }[] = [];
  let days: { y: number }[] = [];
  let split = 0;
  return {
    lay(V) {
      const host = V.cv.parentElement;
      if (!host) return;
      ks = [...host.querySelectorAll<HTMLElement>(".wv-log-i")].map((el, i) => {
        const r = V.rel(el.querySelector("b") ?? el);
        return { y: r.y + r.h / 2, first: i === 0, today: el.dataset.c === "ok" };
      });
      days = [...host.querySelectorAll<HTMLElement>(".wv-log-day")].map((el) => {
        const r = V.rel(el.querySelector("b") ?? el);
        return { y: r.y + r.h / 2 };
      });
      poly = new Poly().set([16, 16], [4, V.H - 4]);
      P ??= new Parts(120, 0);
      split = days[1]?.y ?? V.H;
    },
    draw(_V, c, t, dt) {
      weave(c, poly, P, { a: 0.7, sp: 1.2, sz: 0.55, v: -16, line: 0.12, jit: 0.25, col: (_u, _x, y) => (y < split ? spr(OK) : spr(WHITE)), I: (u) => (poly.at(u).y < split ? 1 : 0.45) }, t, dt);
      days.forEach((d, i) => ring(c, 16, d.y, 6, i ? WHITE : OK, i ? 0.35 : 0.7));
      for (const k of ks) {
        if (k.today) knot(c, 16, k.y, k.first ? 0.55 : 0.42, t, OK, 1);
        else {
          c.globalAlpha = 0.6;
          c.drawImage(spr(WHITE), 12, k.y - 4, 8, 8);
        }
      }
      c.globalAlpha = 1;
    },
  };
}

/* ── On the clock ── */

export function RunDials({ now }: { now: number }) {
  const at = new Date(now);
  const runs = nextRuns(at);
  const dials: { k: string; at: Date; every: number; c: string; what: string; who: string; about?: boolean; short?: boolean }[] = [
    { k: "queue", at: runs.queue, every: 15 * 60_000, c: "var(--rc-foundry)", what: "Queue check", who: "Dusty, every 15 min", short: true },
    { k: "upkeep", at: runs.upkeep, every: 5 * HOUR, c: "var(--rc-workshop)", what: "Upkeep", who: "Gusty, every 5 h", about: true },
    { k: "ideas", at: runs.ideas, every: 24 * HOUR, c: "var(--wv-hot)", what: "Morning ideas", who: "Musty, daily at 9:00 MT" },
  ];
  return (
    <section className="wv-runs" aria-label="Next runs">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Next runs</p>
          <h2 className="wv-h2">On the clock</h2>
        </div>
      </div>
      <div className="wv-runclock">
        {dials.map((d) => {
          const left = d.at.getTime() - now;
          const f = Math.max(0.03, Math.min(1, 1 - left / d.every));
          return (
            <div key={d.k} className="wv-rc" style={{ "--f": f.toFixed(3), "--c": d.c } as React.CSSProperties} title={`${d.what} ${countdown(d.at, at, d.about)}`}>
              <svg viewBox="0 0 60 60" aria-hidden="true">
                <circle cx="30" cy="30" r="26" />
                <circle className="is-f" cx="30" cy="30" r="26" />
              </svg>
              <b>{d.short || left < HOUR ? countdown(d.at, at).replace(/^in /, "") : runTime(d.at)}</b>
              <span>{d.what}</span>
              <em>{d.who}</em>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Usage, woven ── */

export function UsageWoven({ usage, world, now, children }: { usage: UsageFeed | null; world: WorldFeed | null; now: number; children?: ReactNode }) {
  const month = usage ? monthSpend(usage.trails, now) : null;
  const worldUsd = world?.spend.usd ?? 0;
  const scripts = world?.story?.scriptUsd ?? 0;
  const speech = world?.story?.usd ?? 0;
  const speechCap = world?.story?.budget ?? 0;
  const cap = SPEND_CAP_USD + speechCap;
  const parts = [
    { k: "boiler", b: "The living Lattice", s: "Claude API, hourly", usd: worldUsd },
    { k: "archive", b: "The day's story", s: "Gemini speech", usd: speech },
    { k: "foundry", b: "Idea shaping", s: "Claude API, Rivet", usd: month?.usd ?? 0 },
    { k: "workshop", b: "Story scripts", s: "Claude API, the Historian", usd: scripts },
  ];
  const total = parts.reduce((a, p) => a + p.usd, 0);
  const known = Boolean(usage || world);
  const spec = useMemo(() => barSpecOf(parts.map((p) => ({ f: cap ? p.usd / cap : 0, rgb: RC[p.k]! })), true), [worldUsd, speech, month?.usd, scripts, cap]); // eslint-disable-line react-hooks/exhaustive-deps
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  const week = usage ? workByModel(foundryJobs(usage.issues, usage.trails), "week", now) : null;
  return (
    <section className="wv-usage" aria-label="Usage">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Usage this month</p>
          <h2 className="wv-h2">{known ? `${formatUsd(total)} of ${formatUsd(cap)} in caps` : "Reading the ledgers…"}</h2>
        </div>
      </div>
      <canvas ref={cv} className="wv-usage-cv" aria-hidden="true" />
      <ul className="wv-usage-l">
        {parts.map((p) => (
          <li key={p.k} data-room={p.k}>
            <i className="wv-dot" />
            <b>{p.b}</b>
            <span>{p.s}</span>
            <em>{known ? formatUsd(p.usd) : "…"}</em>
          </li>
        ))}
      </ul>
      <p className="wv-usage-m">
        Foundry work runs on the Claude Code plan, so it costs no API money.{" "}
        {week ? (
          <>
            This week:{" "}
            <b style={{ color: "var(--rc-workshop)" }}>
              {week.Sonnet.jobs} on Sonnet
            </b>
            ,{" "}
            <b style={{ color: "var(--rc-archive)" }}>
              {week.Opus.jobs} on Opus
            </b>
            ,{" "}
            <b style={{ color: "var(--rc-exchange)" }}>
              {week.Haiku.jobs} on Haiku
            </b>
            .
          </>
        ) : (
          "Waiting for the issue trails from GitHub…"
        )}
      </p>
      {children}
    </section>
  );
}

/* ── Visual QA ── */

export function VqaChips() {
  const { feed } = useVisualQa();
  const run = feed?.latest ?? null;
  const d = describeRun(run);
  const checked = run && run.run !== "fail" ? run.rooms : 0;
  return (
    <section className="wv-vqa" aria-label="Visual QA">
      <div className="wv-vqa-h">
        <p className="wv-eyb">Visual QA</p>
        <p className="wv-note">
          {run ? `${d.line}. Last run ${new Date(run.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Gemini watches every room after each push to main. Waiting for the first run."}{" "}
          {run && (
            <a className="wv-link" href={run.url} target="_blank" rel="noreferrer">
              Open the run ↗
            </a>
          )}
        </p>
      </div>
      <ul className="wv-vqa-l" aria-label={run ? `${checked} rooms checked` : "No run yet"}>
        {ROOM_ORDER.map((r, i) => (
          <li key={r} data-room={r} className={i < checked ? undefined : "is-off"}>
            <i />
            {ROOM_META[r].name}
          </li>
        ))}
      </ul>
    </section>
  );
}

