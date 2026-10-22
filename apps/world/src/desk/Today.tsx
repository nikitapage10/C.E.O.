import { useCallback, useRef, useState } from "react";
import { byWait, DESK_ROOMS, roomImage, type DeskData, type DeskRoom } from "./deskData.ts";
import { ideaCounts, openIdeas, shippedToday, useFoundry } from "../foundry.ts";
import { chronicleDay, sinceAway, useWorldFeed } from "../chronicle.ts";
import { loadLattice } from "../route.ts";
import { useUsage } from "../usage.ts";
import { nextLine, useWorldClock } from "../worldClock.ts";
import { Council, CouncilButton } from "./Council.tsx";
import { useSetup } from "./IdeaCard.tsx";
import { LatticeThreads, labelTop } from "./LatticeThreads.tsx";
import { dailyOpening } from "./motion.tsx";
import { link } from "./nav.ts";
import { greeting, partOfDay, skippyLine, type RoomPulse } from "./roomPulse.ts";
import { SetupAct, useSetupStatus } from "./SetupCard.tsx";
import { DecisionAct, IdeasAct, LaterAct, QuestionAct, ReplyAct } from "./TodayActs.tsx";
import { ComingUp, LatticeToday, ShortVersion, shortVersion, WorthKnowing } from "./TodayWeave.tsx";
import { Avatar } from "./ui.tsx";
import { usePulses } from "./usePulses.ts";
import { SkippyAsk, SkippyAvatar } from "./skippy/index.ts";

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
  const later = data.actions.filter((a) => a.when === "later");
  const foundry = useFoundry((s) => s.data);
  const pendingIdeas = useFoundry((s) => s.pending);
  const setup = useSetup();
  const setupList = useSetupStatus();
  const usage = useUsage().feed;
  const ideas = openIdeas(foundry.crates, pendingIdeas);
  const questions = ideaCounts(ideas).questions;
  const toPick = ideas.filter((c) => !c.revising && !(c.asking && c.question));
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

  return (
    <div className="today wv-page wv-today">
      <TodayHero now={now} pulses={pulses} todo={todo} />

      <section className="wv-acts" aria-label="Needs you">
        {cards}
        {nothing && (
          <article className="wv-act wv-act-clear" data-room="boiler" style={at(i)}>
            <div className="wv-act-top">
              <i className="wv-dot is-faint" />
              <span>Needs you</span>
            </div>
            <div className="wv-act-body">
              <SkippyAvatar size="sm" className="wv-act-pf wv-act-can" />
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
                <a href={roomHref(r)} onClick={r === "relay" ? link("relay") : r === "foundry" ? link("foundry") : r === "boiler" ? link("systems") : undefined}>
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

/** "Lattice" pages for rooms without a Desk page yet; Relay, the Foundry and the Boiler Room have their own. */
function roomHref(room: DeskRoom) {
  return room === "relay" ? "/relay" : room === "foundry" ? "/foundry" : room === "boiler" ? "/systems" : `/lattice?room=${room}`;
}

/** In-app click for a room's address (a Desk page), or a plain link into the Lattice. */
function roomClick(href: string) {
  return href.startsWith("/lattice") ? link("lattice") : link(href === "/systems" ? "systems" : (href.slice(1) as "foundry"));
}

/* ── The hero ── */

function TodayHero({ now, pulses, todo }: { now: number; pulses: RoomPulse[]; todo: number }) {
  const [opening] = useState(() => dailyOpening(now));
  const hovered = useRef<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [council, setCouncil] = useState(false);
  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const clock = useWorldClock((s) => s.reading);
  const status = pulses.filter((p) => p.real);
  const closeCouncil = useCallback(() => setCouncil(false), []);
  const hover = (id: string | null) => {
    hovered.current = id;
    setHot(id);
  };

  return (
    <section className={`wv-hero wv-hero--${opening}`} aria-label="Today at a glance">
      <LatticeThreads pulses={pulses} opening={opening} hovered={hovered} />
      <div className="wv-hero__wash" aria-hidden="true" />
      <div className="wv-hero__text">
        <div className="wv-hero__skippy">
          {/* Skippy, the Magnificent (#224): a click opens his chat (mounted once at the Desk's root, Desk.tsx). */}
          <SkippyAvatar size="md" className="wv-hero__can" />
          <div className="wv-hero__who">
            <b>Skippy, the Magnificent</b>
            <span>
              {date} · Ilyr, {partOfDay(now)}
              {clock?.nextAt ? ` · next hour ${nextLine(clock, now)}` : ""}
            </span>
          </div>
        </div>
        <h1 className="desk__title wv-hero__title">{greeting(now)}</h1>
        <p className="wv-hero__line">{skippyLine(todo, pulses)}</p>
        <ul className="wv-hero__status" aria-label="The rooms with real work">
          {status.map((p) => (
            <li key={p.id} style={{ "--c": p.colour } as React.CSSProperties} className={`is-${p.state}`}>
              <i aria-hidden="true" />
              <b>{p.name}</b> <span>{p.status}</span>
            </li>
          ))}
        </ul>
        <div className="wv-hero__act">
          <a className="wv-enter" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()}>
            <img src="/desk/lattice.webp" alt="" aria-hidden="true" decoding="async" />
            <span>
              <b>Enter the Lattice</b>
              <small>Walk the nine rooms</small>
            </span>
            <i aria-hidden="true">→</i>
          </a>
          <CouncilButton pulses={pulses} onOpen={() => setCouncil(true)} />
        </div>
        <SkippyAsk className="wv-ask" />
      </div>
      <ul className="wv-hero__rooms" aria-label="The rooms">
        {pulses.map((p, i) => (
          <li key={p.id} style={{ "--c": p.colour, top: `${(labelTop(i, pulses.length) * 100).toFixed(2)}%`, "--i": i } as React.CSSProperties} className={`is-${p.state} ${hot && hot !== p.id ? "dim" : ""}`}>
            <a href={p.href} onClick={roomClick(p.href)} onMouseEnter={() => hover(p.id)} onMouseLeave={() => hover(null)} onFocus={() => hover(p.id)} onBlur={() => hover(null)}>
              <b>{p.name}</b>
              <span>{p.status}</span>
            </a>
          </li>
        ))}
      </ul>
      <Council pulses={pulses} open={council} onClose={closeCouncil} />
    </section>
  );
}
