import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { byWait, type DeskData } from "./deskData.ts";
import { ideaCounts, openIdeas, useFoundry } from "../foundry.ts";
import { loadLattice } from "../route.ts";
import { TodayHero } from "./hero/TodayHero.tsx";
import { useSetup } from "./IdeaCard.tsx";
import { link } from "./nav.ts";
import { useSetupStatus } from "./SetupCard.tsx";
import { readTicked, remaining, SETUP_LIST } from "./setupList.ts";
import { startEmail, useEmail } from "./email/email.ts";
import { TodayCouncil } from "./TodayCouncil.tsx";
import { Icon } from "./todayIcons.tsx";
import { TodayNow } from "./TodayNow.tsx";
import { TodayRail } from "./TodayRail.tsx";
import { DAY_STRIP_MS, usePulses } from "./usePulses.ts";
import { SkippyAsk } from "./skippy/index.ts";
import "./today.css";

/** The rest of Today, loaded the first time "Not worth knowing now" is opened (or in the idle time after first paint). */
export const loadTodayMore = () => import("./TodayMore.tsx");
const TodayMore = lazy(() => loadTodayMore().then((m) => ({ default: m.TodayMore })));

/**
 * Today (#363, Nikita 2026-10-24: "the focus is what do I need to know right now?… the world clock stuff, what the
 * crew does next, little schedule, things not worth knowing now… I do like the strands… I still like the council of
 * Skippies"). From the top: Skippy's greeting and "Right now", the one list of what's on fire and what needs an answer
 * (TodayNow); beside it the rail, with the world clock and the next twelve hours (TodayRail); then the rooms' strands
 * with their subminds (TodayHero), the Council of Skippies reporting in under them (TodayCouncil), Ask Skippy, and
 * everything that can wait folded away under "Not worth knowing now" (TodayMore, loaded on demand).
 * Real data only: anything not connected says it is waiting.
 */

/** Replies that make "Right now": the ones marked sooner, and anything waiting longer than this. */
const NOW_WAIT = 8 * 3_600_000;
/** Never more than this many replies in "Right now"; the rest wait in Relay. */
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
  // An idea waiting for its pick already has its own row in "Right now", so it isn't repeated under what can wait.
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

  const [pre, setPre] = useState(true);
  const [hot, setHot] = useState<string | null>(null);
  const [more, setMore] = useState(() => typeof window !== "undefined" && window.location.hash === "#more");
  const waiting = later.length + otherReplies;

  const openMore = () => {
    setMore((m) => !m);
    if (!more) window.setTimeout(() => document.getElementById("today-more")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <div className={`today wv-page wv-today td${pre ? " is-pre" : ""}`}>
      <TodayHero
        now={now}
        pulses={pulses}
        todo={todo}
        since={Math.min(new Date(now).setHours(0, 0, 0, 0), now - DAY_STRIP_MS)}
        onPre={setPre}
        hot={hot}
        onHot={setHot}
        under={
          <>
            <TodayNow
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
            />
            <div className="wv-hero-do td-do" data-in>
              <SkippyAsk className="wv-ask" />
              <a className="wv-door" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()}>
                <svg viewBox="0 0 28 20" aria-hidden="true">
                  <path d="M1 10c4-7 8-7 13 0s9 7 13 0" />
                  <path d="M1 10c4 7 8 7 13 0s9-7 13 0" />
                </svg>
                <span>
                  <b>Enter the Lattice</b>
                  <small>Walk the ten rooms</small>
                </span>
              </a>
            </div>
          </>
        }
        aside={<TodayRail now={now} />}
      />

      <TodayCouncil pulses={pulses} hot={hot} onHot={setHot} />

      <section className={`td-later${more ? " is-open" : ""}`} data-in aria-label="Not worth knowing now">
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
