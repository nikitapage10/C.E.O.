import { lazy, Suspense, useEffect, useState } from "react";
import { byWait, type DeskData } from "./deskData.ts";
import { ideaCounts, openIdeas, useFoundry } from "../foundry.ts";
import { loadLattice } from "../route.ts";
import { TodayHero } from "./hero/TodayHero.tsx";
import { useSetup } from "./IdeaCard.tsx";
import { link } from "./nav.ts";
import { SetupAct, useSetupStatus } from "./SetupCard.tsx";
import { readTicked, remaining, SETUP_LIST } from "./setupList.ts";
import { EmailAct } from "./email/EmailAct.tsx";
import { startEmail, useEmail } from "./email/email.ts";
import { DecisionAct, IdeasAct, QuestionAct, ReplyAct } from "./TodayActs.tsx";
import { DAY_STRIP_MS, usePulses } from "./usePulses.ts";
import { SkippyAsk } from "./skippy/index.ts";

/** The rest of Today, loaded the first time "More from today" is opened (or in the idle time after first paint). */
export const loadTodayMore = () => import("./TodayMore.tsx");
const TodayMore = lazy(() => loadTodayMore().then((m) => ({ default: m.TodayMore })));

/**
 * Today as one calm picture (#336, Nikita 2026-10-23: "I really want the today page to really be seamless… not have so
 * many different sections… clicking into each individual room obviously gives me more detail"). Skippy's greeting,
 * one slim strip when something actually needs Nikita (the cards open from it, answerable in place), the rooms'
 * strands with their subminds (TodayHero), the Ask Skippy line, and one quiet link to everything else (TodayMore).
 * Real data only: anything not connected says it is waiting.
 */

/** Replies that make "Needs you": the ones marked sooner, and anything waiting longer than this. */
const NOW_WAIT = 8 * 3_600_000;
/** Never more than this many replies in "Needs you"; the rest wait in Relay. */
const NOW_REPLIES = 3;

const at = (i: number) => ({ "--i": i }) as React.CSSProperties;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
  // An idea waiting for its pick already has its own card (IdeasAct), so it isn't repeated under "can wait".
  const picking = new Set(toPick.map((c) => `foundry-${c.number}`));
  const later = data.actions.filter((a) => a.when === "later" && !picking.has(a.id));
  // The email agent's count (#263): mail Dialtone sorted as needing you, from the public counts (no subjects here).
  const emailNeeds = useEmail((s) => s.status?.needsYou ?? 0);
  useEffect(() => startEmail(), []);
  const todo = replies.length + decisions.length + questions.length + emailNeeds;
  const pulses = usePulses(owed.length, now);
  const [ticked] = useState(readTicked);
  const setupLeft = setupList ? remaining(setupList, ticked).length : 0;

  const [pre, setPre] = useState(true);
  const [needsOpen, setNeedsOpen] = useState(false);
  const [more, setMore] = useState(() => typeof window !== "undefined" && window.location.hash === "#more");

  // What the strip says, one short phrase per kind; it shows only when there is something.
  const asks = [
    questions.length ? count(questions.length, "question from Rivet", "questions from Rivet") : "",
    decisions.length ? count(decisions.length, "decision") : "",
    replies.length ? count(replies.length, "reply", "replies") : "",
    emailNeeds ? count(emailNeeds, "email") : "",
    toPick.length ? count(toPick.length, "idea to pick", "ideas to pick") : "",
    setupLeft ? `a setup step (${SETUP_LIST.length - setupLeft} of ${SETUP_LIST.length} done)` : "",
  ].filter(Boolean);

  let i = 0;
  const cards = [
    ...questions.map((c) => <QuestionAct key={`q${c.number}`} crate={c} setup={setup} now={now} style={at(i++)} />),
    ...decisions.map((a) => <DecisionAct key={a.id} a={a} style={at(i++)} />),
    ...replies.map((o) => <ReplyAct key={o.id} o={o} now={now} style={at(i++)} />),
    ...(emailNeeds ? [<EmailAct key="email" count={emailNeeds} style={at(i++)} />] : []),
    ...(toPick.length ? [<IdeasAct key="ideas" ideas={toPick} setup={setup} now={now} style={at(i++)} />] : []),
    <SetupAct key="setup" status={setupList} style={at(i++)} />,
  ];

  const openMore = () => {
    setMore((m) => !m);
    if (!more) window.setTimeout(() => document.getElementById("today-more")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <div className={`today wv-page wv-today${pre ? " is-pre" : ""}`}>
      <TodayHero now={now} pulses={pulses} todo={todo} since={Math.min(new Date(now).setHours(0, 0, 0, 0), now - DAY_STRIP_MS)} onPre={setPre} />

      {asks.length > 0 && (
        <section className={`wv-needs${needsOpen ? " is-open" : ""}`} data-in aria-label="Needs you">
          <button type="button" className="wv-needs-bar" aria-expanded={needsOpen} aria-controls="today-needs" onClick={() => setNeedsOpen((o) => !o)}>
            <i className="wv-needs-dot" aria-hidden="true" />
            <span className="wv-needs-k">Needs you</span>
            <span className="wv-needs-t">{asks.join(" · ")}</span>
            <span className="wv-needs-go">{needsOpen ? "Fold away" : "Answer here"}</span>
          </button>
          <div id="today-needs" className="wv-acts" hidden={!needsOpen}>
            {needsOpen && cards}
          </div>
        </section>
      )}

      <div className="wv-hero-do" data-in>
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

      <p className="wv-tmore" data-in>
        <button type="button" className="wv-tmore-link" aria-expanded={more} aria-controls="today-more" onClick={openMore} onPointerEnter={() => void loadTodayMore()} onFocus={() => void loadTodayMore()}>
          {more ? "Less" : "More from today"}
          <small>{more ? "fold it away" : "the short version, what's worth knowing, what's next, every room"}</small>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </p>
      <div id="today-more" className="wv-tmore-box">
        {more && (
          <Suspense fallback={<div className="desk__loading" role="status" aria-label="Loading" />}>
            <TodayMore data={data} now={now} awaySince={awaySince} pulses={pulses} owed={owed.length} later={later} moreReplies={otherReplies} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
