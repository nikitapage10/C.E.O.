import { byWait, DESK_ROOMS, formatWait, SAMPLES, useDesk, type DeskAction, type DeskData, type DeskRoom, type OwedReply } from "./deskData.ts";
import { link } from "./nav.ts";
import { PageHead, Panel } from "./ui.tsx";
import { Listening } from "./viz.tsx";

/**
 * Today: what needs you, plainly. A short "Do now" list (replies with drafts ready, decisions with the answers
 * as buttons), what can wait until later, what happened while you were away, and the rooms at a glance.
 */

/** Replies that make "Do now": the ones marked sooner, and anything waiting longer than this. */
const NOW_WAIT = 8 * 3_600_000;
/** Never more than this many replies in "Do now"; the rest wait in Relay. */
const NOW_REPLIES = 3;

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 5 ? "Still up, Nikita." : h < 12 ? "Good morning, Nikita." : h < 18 ? "Good afternoon, Nikita." : "Good evening, Nikita.";
}

/** "Lattice" pages for rooms without a Desk page yet; Relay and the Boiler Room have their own. */
function roomHref(room: DeskRoom) {
  return room === "relay" ? "/relay" : room === "boiler" ? "/systems" : `/lattice?room=${room}`;
}

export function Today({ data, now, connected }: { data: DeskData; now: number; connected: boolean }) {
  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const owed = byWait(data.owed);
  const replies = owed.filter((o) => !o.later && (o.urgency === "sooner" || now - o.since > NOW_WAIT)).slice(0, NOW_REPLIES);
  const otherReplies = owed.length - replies.length;
  const decisions = data.actions.filter((a) => a.when === "now");
  const later = data.actions.filter((a) => a.when === "later");
  const todo = replies.length + decisions.length;
  const total = todo + later.length + otherReplies + data.doneToday;

  return (
    <div className="today">
      <PageHead
        eyebrow={`Desk · ${date}`}
        title="Today"
        lead={
          <>
            <em className="page-head__greet">{greeting(now)}</em>
            <span className="today__summary">
              {todo ? `${todo} ${todo === 1 ? "thing needs" : "things need"} you now, about ${todo} minutes.` : "Nothing needs you right now."}
              {later.length + otherReplies > 0 && ` ${later.length + otherReplies} more can wait.`}
            </span>
          </>
        }
        aside={<DayRing done={data.doneToday} total={total} />}
      />

      <Panel eyebrow="Do now" aside={<span className="badge">{todo}</span>} className="panel--now">
        {todo ? (
          <ol className="todo">
            {replies.map((o, i) => (
              <ReplyCard key={o.id} o={o} now={now} i={i} />
            ))}
            {decisions.map((a, i) => (
              <DecisionCard key={a.id} a={a} i={replies.length + i} />
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
                  <span className="later-list__due">Any time</span>
                  <a className="later-list__title" href="/relay" onClick={link("relay")}>
                    {otherReplies} more {otherReplies === 1 ? "reply" : "replies"} waiting in Relay →
                  </a>
                </li>
              )}
            </ul>
          ) : (
            <p className="quiet">Nothing scheduled.</p>
          )}
        </Panel>

        <Panel eyebrow="While you were away">
          {data.notes.length ? (
            <ul className="notes">
              {data.notes.map((n, i) => (
                <li key={i} style={{ "--tone": DESK_ROOMS[n.room].accent } as React.CSSProperties}>
                  <span className="notes__room">{DESK_ROOMS[n.room].name}</span>
                  {n.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet">
              Quiet. The rooms are still running drills, which you can watch in the{" "}
              <a href="/lattice" onClick={link("lattice")}>
                Lattice
              </a>
              .
            </p>
          )}
        </Panel>
      </div>

      <section className="rooms" aria-label="Your rooms">
        <header className="section-head">
          <h2>Your rooms</h2>
          <span className="panel__rule" aria-hidden="true" />
        </header>
        <ul className="rooms__grid">
          {(Object.keys(DESK_ROOMS) as DeskRoom[]).map((r) => {
            const waiting = data.actions.filter((a) => a.room === r).length + (r === "relay" ? owed.length : 0);
            return (
              <li key={r} style={{ "--tone": DESK_ROOMS[r].accent } as React.CSSProperties}>
                <a href={roomHref(r)} onClick={r === "relay" ? link("relay") : r === "boiler" ? link("systems") : undefined}>
                  <span className="rooms__name">{DESK_ROOMS[r].name}</span>
                  <span className={`rooms__count ${waiting ? "rooms__count--on" : ""}`}>{waiting || "✓"}</span>
                  <span className="rooms__cap">{waiting ? "waiting on you" : "all clear"}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** How much of today is handled: a ring that fills as you clear things. */
function DayRing({ done, total }: { done: number; total: number }) {
  const f = total ? done / total : 1;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <div className="dayring" aria-label={`${done} of ${total} done today`}>
      <svg viewBox="-56 -56 112 112" aria-hidden="true">
        <circle r={r} className="dayring__track" />
        <circle r={r} className="dayring__fill" strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform="rotate(-90)" />
      </svg>
      <span className="dayring__big">{done}</span>
      <span className="dayring__cap">
        {total ? (
          <>
            of {total}
            <br />
            done
          </>
        ) : (
          "all clear"
        )}
      </span>
    </div>
  );
}

function RoomTag({ room, agent, live }: { room: DeskRoom; agent: string; live?: boolean }) {
  return (
    <span className="roomtag">
      <i aria-hidden="true" />
      {DESK_ROOMS[room].name} · {agent}
      {SAMPLES && !live && <em>sample</em>}
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

function ReplyCard({ o, now, i }: { o: OwedReply; now: number; i: number }) {
  const { send, later, pick } = useDesk();
  return (
    <li className="todo__item todo__item--reply" style={{ "--tone": DESK_ROOMS.relay.accent, animationDelay: `${i * 60}ms` } as React.CSSProperties}>
      <div className="todo__top">
        <RoomTag room="relay" agent="Blasto" />
        <span className="todo__due">waiting {formatWait(now - o.since)}</span>
      </div>
      <h3 className="todo__title">Reply to {o.name}</h3>
      <p className="todo__quote">“{o.preview}”</p>
      {o.draft && <p className="todo__draft">{o.draft}</p>}
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
    </li>
  );
}

function DecisionCard({ a, i }: { a: DeskAction; i: number }) {
  return (
    <li className="todo__item" style={{ "--tone": DESK_ROOMS[a.room].accent, animationDelay: `${i * 60}ms` } as React.CSSProperties}>
      <div className="todo__top">
        <RoomTag room={a.room} agent={a.agent} live={a.live} />
        {a.due && <span className="todo__due">{a.due}</span>}
      </div>
      <h3 className="todo__title">{a.title}</h3>
      {a.detail && <p className="todo__detail">{a.detail}</p>}
      <div className="todo__actions">
        {a.choices.map((c, k) => (
          <Choice key={c} a={a} k={k} />
        ))}
      </div>
    </li>
  );
}

function LaterRow({ a }: { a: DeskAction }) {
  return (
    <li style={{ "--tone": DESK_ROOMS[a.room].accent } as React.CSSProperties}>
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
