import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { byWait, DESK_ROOMS, formatWait, roomImage, useDesk, type DeskAction, type DeskData, type DeskRoom, type OwedReply } from "./deskData.ts";
import { ideaCounts, openIdeas, shippedToday, useFoundry } from "../foundry.ts";
import { chronicleDay, sinceAway, useWorldFeed, type HistoryEntry } from "../chronicle.ts";
import { loadLattice } from "../route.ts";
import { nextLine, useWorldClock } from "../worldClock.ts";
import { Council, CouncilButton } from "./Council.tsx";
import { countdown, nextRuns, runTime } from "./crewRuns.ts";
import { DayStory } from "./DayStory.tsx";
import { IdeaCard, useSetup } from "./IdeaCard.tsx";
import { LatticeThreads, labelTop } from "./LatticeThreads.tsx";
import { CountUp, dailyOpening, useWidth } from "./motion.tsx";
import { link } from "./nav.ts";
import { greeting, partOfDay, skippyLine, type RoomPulse } from "./roomPulse.ts";
import { SetupCard, useSetupStatus } from "./SetupCard.tsx";
import { AskSkippySlot, SkippyAvatarSlot } from "./SkippySlot.tsx";
import { Avatar } from "./ui.tsx";
import { DAY_STRIP_MS, usePulses } from "./usePulses.ts";
import { Listening } from "./viz.tsx";

/**
 * Today, in the Weave (Nikita, 2026-10-22): Skippy, the Magnificent guiding the day. A hero first: the nine rooms as
 * living threads through the Lattice, Skippy's line on what needs a human, the way into the Lattice and the Ask
 * Skippy box, and the Council one click away. Then what needs you, each card answerable in place; the Lattice's day as
 * threads with knots for what happened; while you were away, as a short story until you mark it read; and what the
 * crew does next. Real data only: anything not connected says it is waiting.
 */

/** Replies that make "Needs you": the ones marked sooner, and anything waiting longer than this. */
const NOW_WAIT = 8 * 3_600_000;
/** Never more than this many replies in "Needs you"; the rest wait in Relay. */
const NOW_REPLIES = 3;
/** Today's Ask Skippy box listens for this, so the can in the bar can bring it into view. */
export const ASK_SKIPPY_EVENT = "desk:ask-skippy";

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
  const crates = useFoundry((s) => s.data.crates);
  const pendingIdeas = useFoundry((s) => s.pending);
  const setup = useSetup();
  const setupList = useSetupStatus();
  const ideas = openIdeas(crates, pendingIdeas);
  const questions = ideaCounts(ideas).questions;
  const todo = replies.length + decisions.length + questions.length;
  const canWait = later.length + otherReplies;
  const shipped = shippedToday(useFoundry((s) => s.data.changelog), now);
  const pulses = usePulses(owed.length, now);

  return (
    <div className="today">
      <TodayHero now={now} pulses={pulses} todo={todo} />

      <section className="wv-section wv-needs" aria-label="Needs you">
        <header className="wv-head">
          <div>
            <p className="eyebrow">Needs you</p>
            <h2>{todo ? (todo === 1 ? "One thing, then you're free" : `${todo} things, in the order I'd do them`) : "Nothing needs you right now"}</h2>
          </div>
          <dl className="wv-tally">
            <div className={todo ? "hot" : ""}>
              <dd>
                <CountUp value={todo} />
              </dd>
              <dt>now</dt>
            </div>
            <div>
              <dd>
                <CountUp value={canWait} />
              </dd>
              <dt>can wait</dt>
            </div>
            <div>
              <dd>
                <CountUp value={data.doneToday + shipped} />
              </dd>
              <dt>done today</dt>
            </div>
          </dl>
        </header>
        {todo ? (
          <ol className="todo wv-cards">
            {questions.map((c, i) => (
              <li key={c.number} className="todo__item todo__item--question wv-card" style={{ "--tone": DESK_ROOMS.foundry.accent, "--i": i } as React.CSSProperties}>
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
          <div className="empty empty--wide wv-empty">
            <Listening />
            <div>
              <p className="empty__title">All quiet. Enjoy it; I arranged it.</p>
              <p className="empty__text">
                {connected
                  ? "When an agent needs a reply sent or a decision made, it lands here with the answer one tap away."
                  : "Once the hub on your MacBook is connected, replies you owe and decisions from your agents land here."}
              </p>
            </div>
          </div>
        )}
        <SetupCard status={setupList} />
      </section>

      <DayWeave now={now} pulses={pulses} awaySince={awaySince} />

      <div className="wv-split">
        <AwayStory data={data} awaySince={awaySince} ilyr={ilyr} shipped={shipped} storyDay={storyDay} />
        <section className="wv-section wv-later" aria-label="Later today">
          <header className="wv-head wv-head--small">
            <div>
              <p className="eyebrow">Later today</p>
              <h2>{later.length + (otherReplies > 0 ? 1 : 0) ? "Can wait, but not forever" : "Nothing scheduled"}</h2>
            </div>
          </header>
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
            <p className="quiet">Nothing on the calendar. Suspicious, but welcome.</p>
          )}
          <ComingUp now={now} />
        </section>
      </div>

      <section className="wv-section rooms" aria-label="Your rooms">
        <header className="wv-head wv-head--small">
          <div>
            <p className="eyebrow">The rooms</p>
            <h2>Walk in anywhere</h2>
          </div>
          <a className="section-head__link" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()}>
            Enter the Lattice →
          </a>
        </header>
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
  const ask = useRef<HTMLInputElement>(null);
  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const clock = useWorldClock((s) => s.reading);
  const status = pulses.filter((p) => p.real);
  const closeCouncil = useCallback(() => setCouncil(false), []);
  const hover = (id: string | null) => {
    hovered.current = id;
    setHot(id);
  };

  useEffect(() => {
    const focus = () => {
      ask.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      ask.current?.focus({ preventScroll: true });
    };
    window.addEventListener(ASK_SKIPPY_EVENT, focus);
    return () => window.removeEventListener(ASK_SKIPPY_EVENT, focus);
  }, []);

  return (
    <section className={`wv-hero wv-hero--${opening}`} aria-label="Today at a glance">
      <LatticeThreads pulses={pulses} opening={opening} hovered={hovered} />
      <div className="wv-hero__wash" aria-hidden="true" />
      <div className="wv-hero__text">
        <div className="wv-hero__skippy">
          <SkippyAvatarSlot size={52} onOpen={() => ask.current?.focus()} />
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
        <AskSkippySlot inputRef={ask} />
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

/* ── The Lattice's day: one thread per room, a knot for each real event, the away band and now ── */

const HOUR = 3_600_000;

function DayWeave({ now, pulses, awaySince }: { now: number; pulses: RoomPulse[]; awaySince: number }) {
  const [box, width] = useWidth<HTMLDivElement>(900);
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const start = Math.min(day.getTime() + 6 * HOUR, now - DAY_STRIP_MS);
  const end = now + 2 * HOUR;
  const span = end - start;
  const narrow = width < 560;
  const label = narrow ? 84 : 128;
  const right = narrow ? 8 : 190;
  const plot = width - label - right;
  const x = (t: number) => label + Math.max(0, Math.min(1, (t - start) / span)) * plot;
  const rowH = narrow ? 26 : 30;
  const top = 26;
  const h = top + pulses.length * rowH + 30;
  const nx = x(now);
  const ticks: number[] = [];
  const first = Math.ceil(start / (3 * HOUR)) * 3 * HOUR;
  for (let t = first; t <= end; t += (narrow ? 6 : 3) * HOUR) ticks.push(t);
  const away = Math.max(start, awaySince);
  const events = pulses.reduce((n, p) => n + p.events.filter((t) => t >= start).length, 0);
  const lead = pulses.find((p) => p.state === "busy") ?? pulses.find((p) => p.real && p.events.length);

  return (
    <section className="wv-section wv-day" aria-label="The Lattice, today">
      <header className="wv-head">
        <div>
          <p className="eyebrow">The Lattice, today</p>
          <h2>Nine rooms, nine threads</h2>
          <p className="wv-head__lead">
            {events ? `${events} ${events === 1 ? "moment" : "moments"} in the last ${Math.round((now - start) / HOUR)} hours. ` : "A quiet stretch. "}
            {lead ? `${lead.name} is doing most of the talking. ` : ""}Hover a knot for when; tap a room to step in.
          </p>
        </div>
        <ul className="wv-legend" aria-hidden="true">
          <li className="solid">Live</li>
          <li className="dash">Waiting or simulated</li>
          <li className="knot">Something happened</li>
          <li className="band">While you were away</li>
        </ul>
      </header>
      <div className="wv-day__plot" ref={box}>
        <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={`The rooms' threads through today, with ${events} events`}>
          <defs>
            <linearGradient id="wv-away" x1="0" x2="1">
              <stop offset="0" stopColor="#9fd2ff" stopOpacity="0" />
              <stop offset="0.3" stopColor="#9fd2ff" stopOpacity="0.06" />
              <stop offset="1" stopColor="#9fd2ff" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          {away < now && <rect className="wv-day__away" x={x(away)} y={top - 14} width={Math.max(2, nx - x(away))} height={pulses.length * rowH + 10} rx="8" fill="url(#wv-away)" />}
          {ticks.map((t) => (
            <g key={t} className="wv-day__tick">
              <line x1={x(t)} x2={x(t)} y1={top - 10} y2={h - 22} />
              <text x={x(t)} y={h - 6}>
                {new Date(t).toLocaleTimeString(undefined, { hour: "numeric" })}
              </text>
            </g>
          ))}
          {pulses.map((p, i) => {
            const y = top + i * rowH + rowH / 2 - 4;
            return (
              <a key={p.id} href={p.href} onClick={roomClick(p.href)} className={`wv-day__row is-${p.state} ${p.real ? "real" : ""}`} style={{ "--c": p.colour, "--i": i } as React.CSSProperties}>
                <rect className="wv-day__hit" x={0} y={y - rowH / 2} width={width} height={rowH} />
                <text x={4} y={y + 4} className="wv-day__name">
                  {p.name}
                </text>
                <line className="wv-day__rest" x1={label} x2={label + plot} y1={y} y2={y} />
                <line className="wv-day__live" x1={label} x2={nx} y1={y} y2={y} pathLength={1} style={{ strokeWidth: p.real ? 1.2 + p.activity * 1.6 : 1 }} />
                {p.events
                  .filter((t) => t >= start)
                  .map((t, k) => (
                    <circle key={k} className="wv-day__knot" cx={x(t)} cy={y} r={p.real ? 4 : 2.8} style={{ "--k": k } as React.CSSProperties}>
                      <title>{`${p.name}, ${new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}</title>
                    </circle>
                  ))}
                {!narrow && (
                  <text x={label + plot + 16} y={y + 4} className="wv-day__status">
                    {p.status}
                  </text>
                )}
              </a>
            );
          })}
          <g className="wv-day__now">
            <line x1={nx} x2={nx} y1={top - 14} y2={h - 22} />
            <circle cx={nx} cy={top - 14} r="3" />
            <text x={nx} y={h - 6}>
              Now
            </text>
          </g>
        </svg>
      </div>
    </section>
  );
}

/* ── While you were away, as a short story, until you mark it read ── */

function AwayStory({ data, awaySince, ilyr, shipped, storyDay }: { data: DeskData; awaySince: number; ilyr: HistoryEntry[]; shipped: number; storyDay: string | null }) {
  const [read, setRead] = useState(false);
  const notesRef = useRef<HTMLOListElement>(null);
  const fadeNotes = () => {
    const el = notesRef.current;
    if (el) el.dataset.more = String(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useLayoutEffect(fadeNotes, [data.notes, read]);
  const latest = ilyr.at(-1) ?? null;
  const moments = data.notes.length + (latest ? 1 : 0);
  const since = new Date(awaySince).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <section className="wv-section wv-away" aria-label="While you were away">
      <header className="wv-head wv-head--small">
        <div>
          <p className="eyebrow">While you were away · since {since}</p>
          <h2>{read || !moments ? "You're all caught up" : "The short version"}</h2>
        </div>
        {!read && moments > 0 && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setRead(true)}>
            Mark read
          </button>
        )}
      </header>
      {!read && moments > 0 ? (
        <ol className="wv-story" ref={notesRef} onScroll={fadeNotes}>
          {data.notes.map((n, i) => (
            <li key={i} style={{ "--tone": DESK_ROOMS[n.room].accent, "--i": i } as React.CSSProperties}>
              <Avatar agent={DESK_ROOMS[n.room].lead} size="sm" room={n.room} />
              <span className="wv-story__body">
                <span className="wv-story__text">{n.text}</span>
                <span className="wv-story__room">{DESK_ROOMS[n.room].name}</span>
              </span>
            </li>
          ))}
          {latest && (
            <li className="wv-story__ilyr" style={{ "--tone": "var(--room-archive)", "--i": data.notes.length } as React.CSSProperties}>
              <Avatar agent="vellum" size="sm" room="archive" />
              <span className="wv-story__body">
                <span className="wv-story__text">{latest.summary}</span>
                <span className="wv-story__room">
                  In Ilyr{ilyr.length > 1 ? `, ${ilyr.length} hours while you were out` : ""} ·{" "}
                  <a href="/chronicle" onClick={link("chronicle")}>
                    Read the Chronicle →
                  </a>
                </span>
              </span>
            </li>
          )}
        </ol>
      ) : (
        <p className="quiet">{shipped ? `${shipped} shipped today; it's all on the Foundry tab.` : `Nothing new since ${since}.`}</p>
      )}
      {storyDay && <DayStory day={storyDay} canMake={false} compact label="Hear yesterday in Ilyr" />}
    </section>
  );
}

/* ── Coming up: when the crew and the world move next ── */

function ComingUp({ now }: { now: number }) {
  const at = new Date(now);
  const runs = nextRuns(at);
  const clock = useWorldClock((s) => s.reading);
  const items: { k: string; what: string; who: string; at: Date; c: string; about?: boolean }[] = [
    { k: "queue", what: "Queue check", who: "the dock crew", at: runs.queue, c: "var(--room-foundry)" },
    { k: "upkeep", what: "Upkeep", who: "Rusty", at: runs.upkeep, c: "var(--room-workshop)", about: true },
    { k: "ideas", what: "Morning ideas", who: "Rusty", at: runs.ideas, c: "var(--room-spire)" },
  ];
  if (clock?.nextAt) items.push({ k: "world", what: "Ilyr's next hour", who: "the world clock", at: new Date(clock.nextAt), c: "var(--room-archive)" });
  items.sort((a, b) => a.at.getTime() - b.at.getTime());
  return (
    <div className="wv-next" aria-label="Coming up">
      <p className="eyebrow">Coming up</p>
      <ol>
        {items.map((it) => (
          <li key={it.k} style={{ "--c": it.c } as React.CSSProperties}>
            <i aria-hidden="true" />
            <b>{it.what}</b>
            <span>
              {countdown(it.at, at, it.about)} · {runTime(it.at)}, {it.who}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── The cards ── */

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
    <li className="todo__item todo__item--reply wv-card" style={{ "--tone": DESK_ROOMS.relay.accent } as React.CSSProperties}>
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
    <li className="todo__item wv-card" style={{ "--tone": DESK_ROOMS[a.room].accent } as React.CSSProperties}>
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
