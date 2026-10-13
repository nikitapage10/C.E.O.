import { useLayoutEffect, useRef } from "react";
import { byWait, DESK_ROOMS, formatWait, roomImage, useDesk, type DeskAction, type DeskData, type DeskRoom, type OwedReply } from "./deskData.ts";
import { ideaCounts, openIdeas, shippedToday, useFoundry } from "../foundry.ts";
import { sinceAway, useWorldFeed } from "../chronicle.ts";
import { link } from "./nav.ts";
import { Avatar, Panel } from "./ui.tsx";
import { Listening } from "./viz.tsx";
import { IdeaCard, useSetup } from "./FoundryPage.tsx";

/**
 * Today: what needs you, plainly, in the Lattice's own light. A hero over the Lattice with the day's count, a
 * "Do now" board (replies with drafts ready, decisions with the answers as buttons, each with the agent asking),
 * what can wait, what happened while you were away, and the rooms as pictures.
 */

/** Replies that make "Do now": the ones marked sooner, and anything waiting longer than this. */
const NOW_WAIT = 8 * 3_600_000;
/** Never more than this many replies in "Do now"; the rest wait in Relay. */
const NOW_REPLIES = 3;

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 5 ? "Still up, Nikita." : h < 12 ? "Good morning, Nikita." : h < 18 ? "Good afternoon, Nikita." : "Good evening, Nikita.";
}

/** "Lattice" pages for rooms without a Desk page yet; Relay, the Foundry and the Boiler Room have their own. */
function roomHref(room: DeskRoom) {
  return room === "relay" ? "/relay" : room === "foundry" ? "/foundry" : room === "boiler" ? "/systems" : `/lattice?room=${room}`;
}

export function Today({ data, now, connected, awaySince }: { data: DeskData; now: number; connected: boolean; awaySince: number }) {
  // The living Lattice (docs/WORLD.md): the latest hour in Ilyr, and how many have passed since you were here.
  const world = useWorldFeed().feed;
  const ilyr = world ? sinceAway(world.recent, awaySince) : [];
  const latest = world?.recent.at(-1) ?? null;
  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const owed = byWait(data.owed);
  const replies = owed.filter((o) => !o.later && (o.urgency === "sooner" || now - o.since > NOW_WAIT)).slice(0, NOW_REPLIES);
  const otherReplies = owed.length - replies.length;
  const decisions = data.actions.filter((a) => a.when === "now");
  const later = data.actions.filter((a) => a.when === "later");
  // Rivet's questions about ideas wait on you too: answered right here with the Foundry's own card.
  const crates = useFoundry((s) => s.data.crates);
  const pendingIdeas = useFoundry((s) => s.pending);
  const setup = useSetup();
  const ideas = openIdeas(crates, pendingIdeas);
  const questions = ideaCounts(ideas).questions;
  const todo = replies.length + decisions.length + questions.length;
  const canWait = later.length + otherReplies;
  const shipped = shippedToday(useFoundry((s) => s.data.changelog), now);
  const notesRef = useRef<HTMLUListElement>(null);
  const fadeNotes = () => {
    const el = notesRef.current;
    if (el) el.dataset.more = String(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useLayoutEffect(fadeNotes, [data.notes]);
  const total = todo + canWait + data.doneToday;
  const working = (Object.keys(DESK_ROOMS) as DeskRoom[]).filter((r) => data.notes.some((n) => n.room === r) || data.actions.some((a) => a.room === r));

  return (
    <div className="today">
      <section className="hero" aria-label="Today at a glance">
        <img className="hero__pic" src="/desk/lattice.webp" alt="" decoding="async" />
        <div className="hero__text">
          <p className="eyebrow">{date}</p>
          <h1 className="desk__title hero__title">Today</h1>
          <p className="hero__greet">{greeting(now)}</p>
          <p className="hero__lead">
            {questions.length > 0 && `${questions.length === 1 ? "Rivet has a question" : `Rivet has ${questions.length} questions`}. `}
            {todo ? `${todo} ${todo === 1 ? "thing needs" : "things need"} you now, about ${todo} ${todo === 1 ? "minute" : "minutes"}.` : "Nothing needs you right now."}
            {canWait > 0 && ` ${canWait} more can wait.`}
          </p>
        </div>
        <dl className="hero__stats">
          <div className={todo ? "hot" : ""}>
            <dd>{todo}</dd>
            <dt>{todo === 1 ? "needs you" : "need you"}</dt>
          </div>
          <div>
            <dd>{canWait}</dd>
            <dt>can wait</dt>
          </div>
          <div>
            <dd>{data.doneToday}</dd>
            <dt>done today</dt>
          </div>
          <div>
            <dd>{working.length}</dd>
            <dt>rooms busy</dt>
          </div>
        </dl>
        <p className="hero__foot" aria-label={`${data.doneToday} of ${total} done today`}>
          <span className="hero__bar" aria-hidden="true">
            <b style={{ width: `${total ? (data.doneToday / total) * 100 : 100}%` }} />
          </span>
          <span>{total ? `${data.doneToday} of ${total} handled today` : "All clear today"}</span>
        </p>
      </section>

      <Panel eyebrow="Do now" aside={<span className="badge badge--hot">{todo}</span>} className="panel--now">
        {todo ? (
          <ol className="todo">
            {questions.map((c) => (
              <li key={c.number} className="todo__item todo__item--question" style={{ "--tone": DESK_ROOMS.foundry.accent } as React.CSSProperties}>
                <IdeaCard crate={c} index={ideas.indexOf(c) + 1} setup={setup} focus={false} />
              </li>
            ))}
            {replies.map((o) => (
              <ReplyCard key={o.id} o={o} now={now} />
            ))}
            {decisions.map((a) => (
              <DecisionCard key={a.id} a={a} />
            ))}
          </ol>
        ) : (
          <div className="empty empty--wide">
            <Listening />
            <div>
              <p className="empty__title">Nothing needs you right now</p>
              <p className="empty__text">
                {connected
                  ? "When an agent needs a reply sent or a decision made, it shows up here with the answer one tap away."
                  : "Once the hub on your MacBook is connected, replies you owe and decisions from your agents land here."}
              </p>
            </div>
          </div>
        )}
      </Panel>

      <div className="today__row">
        <Panel eyebrow="Later today" aside={<span className="badge">{later.length + (otherReplies > 0 ? 1 : 0)}</span>}>
          {later.length || otherReplies ? (
            <ul className="later-list">
              {later.map((a) => (
                <LaterRow key={a.id} a={a} />
              ))}
              {otherReplies > 0 && (
                <li style={{ "--tone": DESK_ROOMS.relay.accent } as React.CSSProperties}>
                  <Avatar agent="Blasto" size="sm" room="relay" />
                  <span className="later-list__due">Any time</span>
                  <a className="later-list__title later-list__title--link" href="/relay" onClick={link("relay")}>
                    {otherReplies} more {otherReplies === 1 ? "reply" : "replies"} waiting in Relay →
                  </a>
                </li>
              )}
            </ul>
          ) : (
            <p className="quiet">Nothing scheduled.</p>
          )}
        </Panel>

        <Panel
          eyebrow="While you were away"
          aside={
            shipped > 0 && (
              <a className="section-head__link" href="/foundry" onClick={link("foundry")}>
                Shipped today: {shipped}
              </a>
            )
          }
        >
          {data.notes.length ? (
            <ul className="notes" ref={notesRef} onScroll={fadeNotes}>
              {data.notes.map((n, i) => (
                <li key={i} style={{ "--tone": DESK_ROOMS[n.room].accent } as React.CSSProperties}>
                  <Avatar agent={DESK_ROOMS[n.room].lead} size="sm" room={n.room} />
                  <span className="notes__body">
                    <span className="notes__room">{DESK_ROOMS[n.room].name}</span>
                    <span className="notes__text">{n.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet">Nothing new since you were last here.</p>
          )}
          {latest && (
            <p className="today-world">
              <b>In Ilyr</b>
              {ilyr.length > 1 ? `${ilyr.length} hours passed. Latest: ` : ""}
              {latest.summary}{" "}
              <a href="/chronicle" onClick={link("chronicle")}>
                Read the Chronicle →
              </a>
            </p>
          )}
        </Panel>
      </div>

      <section className="rooms" aria-label="Your rooms">
        <header className="section-head">
          <h2>Your rooms</h2>
          <a className="section-head__link" href="/lattice" onClick={link("lattice")}>
            Walk the Lattice →
          </a>
        </header>
        <ul className="rooms__grid">
          {(Object.keys(DESK_ROOMS) as DeskRoom[]).map((r) => {
            const waiting = data.actions.filter((a) => a.room === r).length + (r === "relay" ? owed.length : 0);
            const room = DESK_ROOMS[r];
            return (
              <li key={r} className={`room ${waiting ? "room--hot" : ""}`} style={{ "--tone": room.accent } as React.CSSProperties}>
                <a href={roomHref(r)} onClick={r === "relay" ? link("relay") : r === "foundry" ? link("foundry") : r === "boiler" ? link("systems") : undefined}>
                  <img className="room__pic" src={roomImage(r)} alt="" loading="lazy" decoding="async" />
                  <span className="room__text">
                    <span className="room__name">{room.name}</span>
                    <span className="room__what">{room.what}</span>
                  </span>
                  <span className="room__foot">
                    <Avatar agent={room.lead} size="sm" room={r} />
                    <span className="room__cap">{waiting ? `${waiting} waiting on you` : "All clear"}</span>
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

function RoomTag({ room, agent }: { room: DeskRoom; agent: string }) {
  return (
    <span className="roomtag" style={{ "--tone": DESK_ROOMS[room].accent } as React.CSSProperties}>
      <i aria-hidden="true" />
      <span>
        {DESK_ROOMS[room].name} · {agent}
      </span>
    </span>
  );
}

/** An action's button: a link when it opens something (the Foundry thread, an issue), otherwise an answer. */
function Choice({ a, k, small }: { a: DeskAction; k: number; small?: boolean }) {
  const act = useDesk((s) => s.act);
  const c = a.choices[k]!;
  const cls = `btn ${small ? "btn--sm " : ""}${k === 0 ? "btn--go" : small ? "btn--quiet" : ""}`;
  const href = a.hrefs?.[k];
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer">
      {c}
    </a>
  ) : (
    <button type="button" className={cls} onClick={() => act(a.id)}>
      {c}
    </button>
  );
}

function ReplyCard({ o, now }: { o: OwedReply; now: number }) {
  const { send, later, pick } = useDesk();
  return (
    <li className="todo__item todo__item--reply" style={{ "--tone": DESK_ROOMS.relay.accent } as React.CSSProperties}>
      <Avatar agent="Blasto" room="relay" />
      <div className="todo__body">
        <div className="todo__top">
          <RoomTag room="relay" agent="Blasto" />
          <span className="todo__due">waiting {formatWait(now - o.since)}</span>
        </div>
        <h3 className="todo__title">Reply to {o.name}</h3>
        <p className="todo__quote">“{o.preview}”</p>
        {o.draft && (
          <p className="todo__draft">
            <span className="todo__draft-label">Blasto's draft</span>
            {o.draft}
          </p>
        )}
        <div className="todo__actions">
          <button type="button" className="btn btn--go" disabled={!o.draft} onClick={() => send(o.id)}>
            Send
          </button>
          <a
            className="btn"
            href="/relay"
            onClick={(e) => {
              pick(o.id);
              link("relay")(e);
            }}
          >
            Edit
          </a>
          <button type="button" className="btn btn--quiet" onClick={() => later(o.id)}>
            Later
          </button>
        </div>
      </div>
    </li>
  );
}

function DecisionCard({ a }: { a: DeskAction }) {
  return (
    <li className="todo__item" style={{ "--tone": DESK_ROOMS[a.room].accent } as React.CSSProperties}>
      <Avatar agent={a.agent} room={a.room} />
      <div className="todo__body">
        <div className="todo__top">
          <RoomTag room={a.room} agent={a.agent} />
          {a.due && <span className="todo__due">{a.due}</span>}
        </div>
        <h3 className="todo__title">{a.title}</h3>
        {a.detail && <p className="todo__detail">{a.detail}</p>}
        <div className="todo__actions">
          {a.choices.map((c, k) => (
            <Choice key={c} a={a} k={k} />
          ))}
        </div>
      </div>
    </li>
  );
}

function LaterRow({ a }: { a: DeskAction }) {
  return (
    <li style={{ "--tone": DESK_ROOMS[a.room].accent } as React.CSSProperties}>
      <Avatar agent={a.agent} size="sm" room={a.room} />
      <span className="later-list__due">{a.due ?? "Later"}</span>
      <span className="later-list__title">{a.title}</span>
      <span className="later-list__room">
        {DESK_ROOMS[a.room].name} · {a.agent}
      </span>
      <span className="later-list__actions">
        {a.choices.map((c, k) => (
          <Choice key={c} a={a} k={k} small />
        ))}
      </span>
    </li>
  );
}
