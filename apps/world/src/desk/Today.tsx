import { useState } from "react";
import { byWait, DESK_ROOMS, roomImage, type DeskData, type DeskRoom } from "./deskData.ts";
import { ideaCounts, openIdeas, shippedToday, useFoundry } from "../foundry.ts";
import { chronicleDay, sinceAway, useWorldFeed } from "../chronicle.ts";
import { loadLattice } from "../route.ts";
import { useUsage } from "../usage.ts";
import { TodayHero } from "./hero/TodayHero.tsx";
import { roomLink } from "./hero/roomLink.ts";
import { useSetup } from "./IdeaCard.tsx";
import { link } from "./nav.ts";
import { SetupAct, useSetupStatus } from "./SetupCard.tsx";
import { DecisionAct, IdeasAct, LaterAct, QuestionAct, ReplyAct } from "./TodayActs.tsx";
import { ComingUp, LatticeToday, ShortVersion, shortVersion, WorthKnowing } from "./TodayWeave.tsx";
import { Avatar } from "./ui.tsx";
import { usePulses } from "./usePulses.ts";
import { SKIPPY_PORTRAIT } from "./skippy/index.ts";

/**
 * Today, in the Weave (Nikita, 2026-10-22): Skippy, the Magnificent guiding the day. A hero first: the nine rooms as
 * living threads through the Lattice, Skippy's line on what needs a human, the way into the Lattice and the Ask
 * Skippy box, and the Council one click away. Then the approved Weave's sections: what needs you as cards answerable in
 * place, the nine rooms as lanes beside the world clock, what is worth knowing now, the short version of what happened
 * until you mark it read, and what the crew does next. Real data only: anything not connected says it is waiting.
 */

/** Replies that make "Needs you": the ones marked sooner, and anything waiting longer than this. */
const NOW_WAIT = 8 * 3_600_000;
/** Never more than this many replies in "Needs you"; the rest wait in Relay. */
const NOW_REPLIES = 3;

const at = (i: number) => ({ "--i": i }) as React.CSSProperties;

export function Today({ data, now, connected, awaySince }: { data: DeskData; now: number; connected: boolean; awaySince: number }) {
  const world = useWorldFeed().feed;
  const ilyr = world ? sinceAway(world.recent, awaySince) : [];
  const yesterday = chronicleDay(now - 86_400_000);
  const storyDay = world?.days.includes(yesterday) ? yesterday : null;
  const owed = byWait(data.owed);
  const replies = owed.filter((o) => !o.later && (o.urgency === "sooner" || now - o.since > NOW_WAIT)).slice(0, NOW_REPLIES);
  const otherReplies = owed.length - replies.length;
  const decisions = data.actions.filter((a) => a.when === "now");
  const foundry = useFoundry((s) => s.data);
  const pendingIdeas = useFoundry((s) => s.pending);
  const setup = useSetup();
  const setupList = useSetupStatus();
  const usage = useUsage().feed;
  const ideas = openIdeas(foundry.crates, pendingIdeas);
  const questions = ideaCounts(ideas).questions;
  const toPick = ideas.filter((c) => !c.revising && !(c.asking && c.question));
  // An idea waiting for its pick already has its own card (IdeasAct), so it isn't repeated under "can wait".
  const picking = new Set(toPick.map((c) => `foundry-${c.number}`));
  const later = data.actions.filter((a) => a.when === "later" && !picking.has(a.id));
  const todo = replies.length + decisions.length + questions.length;
  const shipped = shippedToday(foundry.changelog, now);
  const pulses = usePulses(owed.length, now);
  const moments = shortVersion({ data, changes: foundry.changelog, ilyr, awaySince });

  let i = 0;
  const cards = [
    ...questions.map((c) => <QuestionAct key={`q${c.number}`} crate={c} setup={setup} now={now} style={at(i++)} />),
    ...decisions.map((a) => <DecisionAct key={a.id} a={a} style={at(i++)} />),
    ...replies.map((o) => <ReplyAct key={o.id} o={o} now={now} style={at(i++)} />),
    ...(toPick.length ? [<IdeasAct key="ideas" ideas={toPick} setup={setup} now={now} style={at(i++)} />] : []),
    <SetupAct key="setup" status={setupList} style={at(i++)} />,
    ...(later.length || otherReplies > 0 ? [<LaterAct key="later" items={later} moreReplies={otherReplies} style={at(i++)} />] : []),
  ];
  const nothing = !todo && !toPick.length && !later.length && !otherReplies;

  const [pre, setPre] = useState(true);

  return (
    <div className={`today wv-page wv-today${pre ? " is-pre" : ""}`}>
      <TodayHero now={now} pulses={pulses} todo={todo} onPre={setPre} />

      <section className="wv-acts" aria-label="Needs you">
        {cards}
        {nothing && (
          <article className="wv-act wv-act-clear" data-room="boiler" data-in style={at(i)}>
            <div className="wv-act-top">
              <i className="wv-dot is-faint" />
              <span>Needs you</span>
            </div>
            <div className="wv-act-body">
              <img className="wv-act-pf" src={SKIPPY_PORTRAIT} alt="" width={44} height={44} decoding="async" />
              <div>
                <h3 className="wv-h3">All quiet. Enjoy it; I arranged it.</h3>
                <p className="wv-act-p">
                  {connected
                    ? "When an agent needs a reply sent or a decision made, it lands here with the answer one tap away."
                    : "Once the hub on your MacBook is connected, replies you owe and decisions from your agents land here."}
                </p>
              </div>
            </div>
          </article>
        )}
      </section>

      <LatticeToday pulses={pulses} now={now} awaySince={awaySince} world={world} />
      <WorthKnowing data={foundry} usage={usage} world={world} owed={owed.length} />
      <ShortVersion moments={moments} awaySince={awaySince} now={now} storyDay={storyDay} shipped={shipped} />
      <ComingUp now={now} />

      <section className="wv-section rooms" aria-label="Your rooms">
        <div className="wv-sechead">
          <div>
            <p className="wv-eyb">The rooms</p>
            <h2 className="wv-h2">Walk in anywhere</h2>
          </div>
          <a className="wv-link" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()}>
            Enter the Lattice →
          </a>
        </div>
        <ul className="rooms__grid">
          {(Object.keys(DESK_ROOMS) as DeskRoom[]).map((r) => {
            const waiting = data.actions.filter((a) => a.room === r).length + (r === "relay" ? owed.length : 0);
            const room = DESK_ROOMS[r];
            const p = pulses.find((x) => x.id === r);
            return (
              <li key={r} className={`room ${waiting ? "room--hot" : ""}`} style={{ "--tone": room.accent } as React.CSSProperties}>
                <a href={p?.href ?? `/lattice?room=${r}`} onClick={roomLink(p?.href ?? "/lattice")}>
                  <img className="room__pic" src={roomImage(r)} alt="" loading="lazy" decoding="async" />
                  <span className="room__text">
                    <span className="room__name">{room.name}</span>
                    <span className="room__what">{p?.status ?? room.what}</span>
                  </span>
                  <span className="room__foot">
                    <Avatar agent={room.lead} size="sm" room={r} />
                    <span className="room__cap">{waiting ? `${waiting} waiting on you` : room.what}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
