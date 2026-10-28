import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { byWait, type DeskData } from "./deskData.ts";
import { ideaCounts, openIdeas, shippedToday, useFoundry } from "../foundry.ts";
import { loadLattice } from "../route.ts";
import { useSetup } from "./IdeaCard.tsx";
import { link } from "./nav.ts";
import { useSetupStatus } from "./SetupCard.tsx";
import { readTicked, remaining, SETUP_LIST } from "./setupList.ts";
import { startEmail, useEmail } from "./email/email.ts";
import { Icon } from "./todayIcons.tsx";
import { fires, TodayNow } from "./TodayNow.tsx";
import { DAY_STRIP_MS, usePulses } from "./usePulses.ts";
import { TodayBroadcast } from "./DayStory.tsx";
import { nextEdition, roman, until } from "./todaySchedule.ts";
import { PlanWatch } from "./skippy/PlanWatch.tsx";
import { SkippyAsk } from "./skippy/index.ts";
import { greeting, skippyLine } from "./roomPulse.ts";
import { Ephemeris, useRuns } from "./TodayRail.tsx";
import { mountainHour, PART } from "./ilyrTime.ts";
import { clockState, useWorldClock } from "../worldClock.ts";
import { Confluence } from "./confluence/Confluence.tsx";
import "@fontsource-variable/bodoni-moda/opsz.css";
import "@fontsource-variable/bodoni-moda/opsz-italic.css";
import "@fontsource-variable/jost/wght.css";
import "./today.css";
import "./confluence/confluence.css";

/** The rest of Today, loaded the first time "Not worth knowing now" is opened (or in the idle time after first paint). */
export const loadTodayMore = () => import("./TodayMore.tsx");
const TodayMore = lazy(() => loadTodayMore().then((m) => ({ default: m.TodayMore })));

/**
 * Today, as a confluence (#413; round 9's T1, Nikita's pick 2026-10-24 21:30Z, with Nikita's changes): one full-bleed
 * stage where every room's real work streams up into Skippy (confluence/). The Council of Skippies stands along the
 * bottom as figures of light that turn into Skippy's own shape and back, words rising off them and crumbling into sand
 * whenever something real happens. Over it in plain type: the top face (Skippy's greeting and the day's ledger), the
 * helm (the channel to Skippy, typed or said; the day's broadcast; what the crew runs next; the way into the Lattice),
 * and in the top right "Held for you", what needs Nikita now, each held thing an eddy on its room's stream. Tap a
 * figure to see what happened in its room today, and your talks with it. Below the stage, everything that can wait,
 * folded away under "Not worth knowing now" (TodayMore, loaded on demand). Bodoni Moda and Jost, Today's lane, set
 * larger. Real data only: anything not connected says it is waiting.
 */

/** Replies that make "Held for you": the ones marked sooner, and anything waiting longer than this. */
const NOW_WAIT = 8 * 3_600_000;
/** Never more than this many replies held; the rest wait in Relay. */
const NOW_REPLIES = 3;

export function Today({ data, now, awaySince }: { data: DeskData; now: number; connected: boolean; awaySince: number }) {
  const owed = byWait(data.owed);
  const replies = owed.filter((o) => !o.later && (o.urgency === "sooner" || now - o.since > NOW_WAIT)).slice(0, NOW_REPLIES);
  const otherReplies = owed.length - replies.length;
  const decisions = data.actions.filter((a) => a.when === "now");
  const foundry = useFoundry((s) => s.data);
  const pendingIdeas = useFoundry((s) => s.pending);
  const setup = useSetup();
  const setupList = useSetupStatus();
  const ideas = openIdeas(foundry.crates, pendingIdeas);
  const questions = ideaCounts(ideas).questions;
  const toPick = ideas.filter((c) => !c.revising && !(c.asking && c.question));
  // An idea waiting for its pick already has its own row in Held for you, so it isn't repeated under what can wait.
  const picking = new Set(toPick.map((c) => `foundry-${c.number}`));
  const later = data.actions.filter((a) => a.when === "later" && !picking.has(a.id));
  // The email agent's count (#263): mail Dialtone sorted as needing you, from the public counts (no subjects here).
  const emailNeeds = useEmail((s) => s.status?.needsYou ?? 0);
  useEffect(() => startEmail(), []);
  const todo = replies.length + decisions.length + questions.length + emailNeeds;
  const pulses = usePulses(owed.length, now);
  const [ticked] = useState(readTicked);
  const setupLeft = setupList ? remaining(setupList, ticked).length : 0;
  const shipped = useMemo(() => foundry.changelog.filter((c) => c.at > awaySince && c.at <= now).sort((a, b) => b.at - a.at), [foundry.changelog, awaySince, now]);
  const reading = useWorldClock((s) => s.reading);
  const clock = useWorldClock((s) => s.status);
  const fire = fires(pulses, clockState(reading, clock, now));

  const [more, setMore] = useState(() => typeof window !== "undefined" && window.location.hash === "#more");
  const waiting = later.length + otherReplies;
  const hot = useRef<(room: string | null) => void>(() => {});

  // The rooms with something held: their figures wear the hot ring.
  const needs = [
    ...fire.map((f) => f.room),
    ...decisions.map((a) => a.room),
    ...(replies.length || emailNeeds ? ["relay"] : []),
    ...(questions.length || toPick.length ? ["foundry"] : []),
    ...(setupLeft ? ["boiler"] : []),
  ].filter((r, i, a) => a.indexOf(r) === i);

  const openMore = () => {
    setMore((m) => !m);
    if (!more) window.setTimeout(() => document.getElementById("today-more")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const since = Math.min(new Date(now).setHours(0, 0, 0, 0), now - DAY_STRIP_MS);
  const hour = mountainHour(now);
  const says = skippyLine(todo, pulses);
  const live = pulses.filter((p) => p.real && p.state !== "sim").length;
  const shippedNow = shippedToday(foundry.changelog, now);
  const g = greeting(now);
  const comma = g.indexOf(", ");
  const held = todo + fire.length + (toPick.length ? 1 : 0) + (setupLeft ? 1 : 0);

  return (
    <div className="today wv-page td cf-page">
      <Confluence
        pulses={pulses}
        now={now}
        since={since}
        hour={hour}
        needs={needs}
        skippySays={says}
        hotRef={hot}
        top={
          <>
            <p className="cf-eyb">
              <span>Today</span> {new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1 className="desk__title cf-greet">
              {comma > 0 ? (
                <>
                  {g.slice(0, comma + 1)} <em>{g.slice(comma + 2)}</em>
                </>
              ) : (
                g
              )}
            </h1>
            <p className="cf-say">{says}</p>
            <dl className="cf-ledger">
              <div className={held ? "is-hot" : ""}>
                <dt>Held for you</dt>
                <dd>{held}</dd>
              </div>
              <div>
                <dt>Rooms live</dt>
                <dd>
                  {live}
                  <small> of {pulses.length}</small>
                </dd>
              </div>
              <div>
                <dt>Shipped today</dt>
                <dd>{shippedNow}</dd>
              </div>
              <div className="is-ilyr">
                <dt>{PART(hour)} in Ilyr</dt>
                <dd>
                  <span className="td-sr">Hour {Math.floor(hour) || 24} of 24</span>
                  <span aria-hidden="true">{roman(Math.floor(hour) || 24)}</span>
                  <small aria-hidden="true"> of XXIV</small>
                </dd>
              </div>
            </dl>
          </>
        }
        held={
          <TodayNow
            label="Held for you"
            now={now}
            pulses={pulses}
            questions={questions}
            decisions={decisions}
            replies={replies}
            emailNeeds={emailNeeds}
            toPick={toPick}
            setup={setup}
            setupStatus={setupList}
            setupLeft={setupLeft}
            setupTotal={SETUP_LIST.length}
            shipped={shipped}
            awaySince={awaySince}
            onHot={(r) => hot.current(r)}
          />
        }
        helm={
          <>
            <div className="td-comm">
              <SkippyAsk className="td-ask" />
            </div>
            <PlanWatch className="plan-watch--td" />
            <div className="cf-chips">
              <TodayBroadcast now={now} next={until(nextEdition(now).at, now)} />
              <ComingUp />
              <a className="td-door" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()}>
                <svg viewBox="0 0 28 28" aria-hidden="true">
                  <circle cx="14" cy="14" r="12.5" />
                  <path d="M3 14c4-5 7-5 11 0s7 5 11 0" />
                  <path d="M14 1.5v25" />
                </svg>
                <span>
                  <b>Enter the Lattice</b>
                  <small>Walk the ten rooms</small>
                </span>
              </a>
            </div>
          </>
        }
      />

      <section className={`td-later cf-later${more ? " is-open" : ""}`} aria-label="Not worth knowing now">
        <button type="button" className="td-later-bar" aria-expanded={more} aria-controls="today-more" onClick={openMore} onPointerEnter={() => void loadTodayMore()} onFocus={() => void loadTodayMore()}>
          <span className="td-later-k">
            <b>{more ? "Fold it away" : "Not worth knowing now"}</b>
            <small>{more ? "back to what matters" : "what can wait, the short version, what's warm, every room"}</small>
          </span>
          <span className="td-later-ics" aria-hidden="true">
            <span>
              <Icon name="later" />
              {waiting > 0 && <i>{waiting}</i>}
            </span>
            <span>
              <Icon name="short" />
            </span>
            <span>
              <Icon name="warm" />
            </span>
            <span>
              <Icon name="rooms" />
            </span>
          </span>
          <svg className="td-later-chev" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div id="today-more" className="wv-tmore-box">
          {more && (
            <Suspense fallback={<div className="desk__loading" role="status" aria-label="Loading" />}>
              <TodayMore data={data} now={now} awaySince={awaySince} pulses={pulses} owed={owed.length} later={later} moreReplies={otherReplies} />
            </Suspense>
          )}
        </div>
      </section>
    </div>
  );
}

/** "Coming up": the crew's next run as a chip, the whole ephemeris in a pop-over under it. */
function ComingUp() {
  const [open, setOpen] = useState(false);
  // Closed, the chip shows minutes, so it needn't redraw Today's helm every second (#417); open, the ephemeris counts
  // the last minute down in seconds.
  const { now, runs } = useRuns(open ? 1000 : 15_000);
  const [hotRun, setHotRun] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", off);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const next = runs[0];
  return (
    <div className="cf-cu" ref={box}>
      <button type="button" className="cf-cu-btn" aria-expanded={open} aria-controls="cf-cu-pop" onClick={() => setOpen((o) => !o)}>
        <span className="cf-cu-k">Coming up</span>
        {next ? (
          <span>
            {next.what.toLowerCase()} <b>{until(next.at, now)}</b>
          </span>
        ) : (
          <span>nothing scheduled</span>
        )}
      </button>
      <div id="cf-cu-pop" className="cf-cu-pop" hidden={!open}>
        {open && <Ephemeris runs={runs} now={now} hotRun={hotRun} onHotRun={setHotRun} />}
      </div>
    </div>
  );
}
