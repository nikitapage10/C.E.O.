import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { byWait, type DeskData } from "./deskData.ts";
import { ideaCounts, openIdeas, useFoundry } from "../foundry.ts";
import { useSetup } from "./IdeaCard.tsx";
import { useSetupStatus } from "./SetupCard.tsx";
import { readTicked, remaining, SETUP_LIST } from "./setupList.ts";
import { startEmail, useEmail } from "./email/email.ts";
import { Icon } from "./todayIcons.tsx";
import { fires, TodayNow } from "./TodayNow.tsx";
import { DAY_STRIP_MS, usePulses } from "./usePulses.ts";
import { skippyLine } from "./roomPulse.ts";
import { Iris } from "./council/Iris.tsx";
import { useDeskPulses } from "./council/deskPulses.ts";
import { forwardHavenResult } from "./homeDevices.ts";
import { clockState, useWorldClock } from "../worldClock.ts";
import { useTodoSync } from "./todos/TodoBits.tsx";
import { awayRefs, useTodos } from "./todos/todos.ts";
import "@fontsource-variable/bodoni-moda/opsz.css";
import "@fontsource-variable/bodoni-moda/opsz-italic.css";
import "@fontsource-variable/jost/wght.css";
import "./today.css";

/** The rest of Today, loaded the first time "Not worth knowing now" is opened (or in the idle time after first paint). */
export const loadTodayMore = () => import("./TodayMore.tsx");
const TodayMore = lazy(() => loadTodayMore().then((m) => ({ default: m.TodayMore })));

/**
 * Today, as the Iris (#666; concept 2 of 2026-11-04, Nikita: "too much going on... Can we get a much simplified
 * view?"). Two things only. On the left, standing alone, the priority: the date, "N things, Nikita.", what needs him
 * numbered with its Answer, then his own to-dos under "still left" and the add line (TodayNow). On the right, the
 * Council of Skippies in 3D round Skippy, the pupil of a nanite eye (council/Iris.tsx): point at a member for a light
 * from above and what it's doing, click for its card. Under the fold, everything that can wait stays folded away under
 * "Not worth knowing now" (TodayMore, loaded on demand). What used to crowd the page moved: the stat row's clock, Coming
 * up, Hide and Hands-free to the Boiler Room's Settings (/boiler/controls), Today in Ilyr to the Archive's edition,
 * the Kitchen list to the Haven, Enter the Lattice to the bar. Ask Skippy stays bottom right. Real data only.
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
  // Google sends a Nest or Tasks connect back here (`/?haven=…`): on to Controls, where the house setup lives.
  useEffect(forwardHavenResult, []);
  const todo = replies.length + decisions.length + questions.length + emailNeeds;
  const pulses = usePulses(owed.length, now);
  // The Council seats the ten rooms' subminds and the Desk's own, the Steward and the Stagehand (#717).
  const deskPulses = useDeskPulses(now);
  const council = useMemo(() => [...pulses, ...deskPulses], [pulses, deskPulses]);
  const [ticked] = useState(readTicked);
  const setupLeft = setupList ? remaining(setupList, ticked).length : 0;
  const shipped = useMemo(() => foundry.changelog.filter((c) => c.at > awaySince && c.at <= now).sort((a, b) => b.at - a.at), [foundry.changelog, awaySince, now]);
  const reading = useWorldClock((s) => s.reading);
  const clock = useWorldClock((s) => s.status);
  // Nikita's own to-dos, and the held rows they put away for now (#622): counted the way "Held for you" lists them.
  useTodoSync();
  const todoState = useTodos((s) => s.state);
  const away = awayRefs(todoState, now);
  const fire = fires(pulses, clockState(reading, clock, now)).filter((f) => !away.has(f.key));

  const [more, setMore] = useState(() => typeof window !== "undefined" && window.location.hash === "#more");
  const waiting = later.length + otherReplies;
  const hot = useRef<(room: string | null) => void>(() => {});


  const openMore = () => {
    setMore((m) => !m);
    if (!more) window.setTimeout(() => document.getElementById("today-more")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const since = Math.min(new Date(now).setHours(0, 0, 0, 0), now - DAY_STRIP_MS);
  const says = skippyLine(todo, pulses);

  // How many things are held for him in each room: each member's card says it.
  const heldBy: Record<string, number> = {};
  const add = (room: string, k = 1) => (heldBy[room] = (heldBy[room] ?? 0) + k);
  fire.forEach((f) => add(f.room));
  decisions.filter((a) => !away.has(a.id)).forEach((a) => add(a.room));
  const repliesHeld = replies.filter((o) => !away.has(o.id)).length + (emailNeeds && !away.has("email") ? 1 : 0);
  if (repliesHeld) add("relay", repliesHeld);
  const foundryHeld = questions.filter((c) => !away.has(`q${c.number}`)).length + (toPick.length && !away.has("ideas") ? 1 : 0);
  if (foundryHeld) add("foundry", foundryHeld);
  if (setupLeft && !away.has("setup")) add("boiler");

  return (
    <div className="today wv-page td ti-page">
      <section className="ti" aria-label="Today">
        <div className="ti-list">
          <TodayNow
            iris={{ name: "Nikita" }}
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
        </div>
        <Iris pulses={council} now={now} since={since} held={heldBy} skippySays={says} hotRef={hot} />
      </section>

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
