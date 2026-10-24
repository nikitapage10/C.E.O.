import { useEffect, useRef, useState } from "react";
import { chronicleDay, dayTitle, hourLabel, sinceAway, useChronicle, useWorldFeed, type HistoryEntry, type RoomId } from "../chronicle.ts";
import { previousWeek, weekDaysOf, weekStartOf } from "../../../../api/_world/weeks.ts";
import { Bonds, Chevron, Edition, hoursOf, KIND_WORD, ROOM_NAME, Shelf, WeekInIlyr } from "./ChronicleWeave.tsx";
import { DayStory } from "./DayStory.tsx";
import { formatWait } from "./deskData.ts";
import { link } from "./nav.ts";
import { PORTRAITS } from "./portraits.ts";
import { useWidth } from "./motion.tsx";
import { Avatar } from "./ui.tsx";

/**
 * The Archive (#225; redesigned in #366): the Chronicle of Ilyr. Every hour the world takes a step and the Historian
 * writes it up (docs/WORLD.md): what happened, who said what to whom, how relationships moved, and what the builders
 * thought of the work that shipped; about every five hours Skippy, the Magnificent reads the day so far (#365), and the
 * whole day after midnight. Simple first, deeper on click: up top the latest edition of Today in Ilyr, then the week in
 * Ilyr as a tapestry, then the shown day hour by hour (each hour opens to its scenes), the bonds it moved and a shelf
 * of past days. The Tide sits under it (the children).
 */

const nameOf = (id: string) => PORTRAITS[id]?.name ?? id;
const roomTone = (room: RoomId) => ({ "--tone": `var(--room-${room})` }) as React.CSSProperties;
/** How many hours of the shown day show before "all the hours". */
const HOURS_SHOWN = 6;
/** How many past days sit on the shelf. */
const SHELF = 8;

export function Chronicle({ now, awaySince, children }: { now: number; awaySince: number; children?: React.ReactNode }) {
  const { status, feed } = useWorldFeed();
  const pages = useChronicle((s) => s.pages);
  const today = chronicleDay(now);
  const yesterday = chronicleDay(now - 86_400_000);
  const days = feed?.days.length ? feed.days : [today];
  const [day, setDay] = useState<string | null>(null);
  const shown = day ?? days[0]!;
  const week = weekStartOf(shown);
  const shelfDays = days.filter((d) => d !== today).slice(0, SHELF);
  const want = [...new Set([today, shown, ...weekDaysOf(week).filter((d) => days.includes(d)), ...shelfDays])].join(",");
  const dayRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (status !== "ready") return;
    for (const d of want.split(",")) void useChronicle.getState().loadDay(d);
  }, [status, want]);

  const recent = feed?.recent ?? [];
  const todays = hoursOf(today, pages[today], recent);
  const page = pages[shown];
  const entries = hoursOf(shown, page, recent);
  const recap = page && page !== "loading" && page !== "failed" ? page.recap : null;
  // The Desk can ask for today's or yesterday's story (api/day-story.ts); older days only ever get the step's.
  const canMake = shown === today || shown === yesterday;
  // The week in Ilyr (#211): the shown day's week, and on this week also the week just ended.
  const weeks = week === weekStartOf(today) ? [week, previousWeek(week)] : [week];
  const away = feed ? sinceAway(feed.recent, awaySince) : [];
  const changed = (feed?.relationships ?? []).filter((r) => r.since).sort((a, b) => Date.parse(b.since!) - Date.parse(a.since!)).slice(0, 8);
  const pick = (d: string) => {
    setDay(d);
    dayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const lead =
    status === "off"
      ? "The world isn't being saved yet. Once the step runs, every hour in Ilyr is written up here."
      : !feed
        ? status === "failed"
          ? "Can't reach the Archive right now; trying again shortly."
          : "Opening the Archive…"
        : !feed.at
          ? "The Archive opens with the first hourly step."
          : away.length
            ? `${away.length} ${away.length === 1 ? "hour has" : "hours have"} passed in Ilyr since you were last here.`
            : `The Lattice took its last step ${formatWait(now - Date.parse(feed.at))} ago${feed.nextAt ? `, the next ${nextIn(Date.parse(feed.nextAt) - now)}` : ""}.`;
  const [y, m, d] = today.split("-").map(Number);
  const dateLine = new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const idx = days.indexOf(shown);

  return (
    <div className="chron wv-page ax" data-room="archive" style={{ "--tone": "var(--room-archive)" } as React.CSSProperties}>
      <header className="ax-mast">
        <p className="wv-eyb ax-eyb">The Archive · {dateLine}</p>
        <h1 className="wv-h1 desk__title ax-title">
          The Chronicle of <em>Ilyr</em>
        </h1>
        <svg className="ax-flourish" viewBox="0 0 240 12" aria-hidden="true">
          <path d="M2 6 H100 M140 6 H238" pathLength={1} />
          <path d="M120 1 L125 6 L120 11 L115 6 Z" />
        </svg>
        <p className="ax-lead">{lead}</p>
      </header>

      {status === "ready" || todays.length ? (
        <Edition today={today} yesterday={yesterday} entries={todays} hourNow={mountainHour(now)} />
      ) : (
        <section className="ax-ed ax-ed-off">
          <p className="wv-note">{status === "off" ? "No pages yet. Today in Ilyr appears here once the world takes its first step." : status === "failed" ? "Can't reach the Archive right now." : "Turning the pages…"}</p>
        </section>
      )}

      <WeekInIlyr monday={week} shown={shown} today={today} days={days} pages={pages} recent={recent} weeks={weeks} onPick={pick} />

      <section ref={dayRef} className="ax-day" aria-label={`The Archive, ${dayTitle(shown, now)}`}>
        <div className="ax-day-head">
          <div>
            <p className="wv-eyb ax-eyb">Hour by hour</p>
            <h2 className="ax-h2">
              {dayTitle(shown, now)}, <em>as it was written</em>
            </h2>
          </div>
          {days.length > 1 && (
            <div className="ax-step" role="group" aria-label="Days">
              <button type="button" disabled={idx < 0 || idx >= days.length - 1} onClick={() => setDay(days[idx + 1]!)} aria-label="The day before">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M10 3L5 8l5 5" />
                </svg>
              </button>
              <select value={shown} onChange={(e) => setDay(e.target.value)} aria-label="Pick a day">
                {days.slice(0, 30).map((x) => (
                  <option key={x} value={x}>
                    {dayTitle(x, now)}
                  </option>
                ))}
              </select>
              <button type="button" disabled={idx <= 0} onClick={() => setDay(days[idx - 1]!)} aria-label="The day after">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </button>
            </div>
          )}
        </div>
        {recap && (
          <div className="ax-recap">
            <p className="wv-eyb">The day in Ilyr, as the Historian filed it</p>
            <p>{recap}</p>
          </div>
        )}
        {shown !== today && <DayStory day={shown} canMake={canMake && shown !== today} compact label={`Hear ${dayTitle(shown, now) === "Yesterday" ? "yesterday" : "the day"} in Ilyr`} />}
        <Hours key={shown} entries={entries} awaySince={awaySince} loading={page === "loading" || status === "loading"} off={status === "off"} />
        {entries.length > 0 && (
          <details className="ax-drawer">
            <summary>
              The day by room
              <Chevron />
            </summary>
            <DayInRooms entries={entries} />
          </details>
        )}
        {shown === today && entries.length > 0 && !recap && <p className="wv-note ax-day-foot">The Historian files the day in Ilyr after midnight.{feed?.nextAt ? ` Next hour ${nextIn(Date.parse(feed.nextAt) - now)}.` : ""}</p>}
      </section>

      <div className="ax-pair2">
        <Bonds entries={entries} today={shown === today}>
          <details className="ax-drawer">
            <summary>
              How everyone stands now{changed.length ? ` (${changed.length} moved lately)` : ""}
              <Chevron />
            </summary>
            {changed.length ? (
              <ul className="chron-rels">
                {changed.map((r) => (
                  <li key={`${r.a}|${r.b}`}>
                    <span className="chron-rels__pair">
                      <Avatar agent={nameOf(r.a)} size="sm" />
                      <Avatar agent={nameOf(r.b)} size="sm" />
                    </span>
                    <span>
                      <b>
                        {nameOf(r.a)} & {nameOf(r.b)}
                      </b>{" "}
                      <em>{KIND_WORD[r.kind] ?? r.kind}</em>
                      <small>{r.note}</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wv-note">No one's relationships have moved yet. Give them an hour or two.</p>
            )}
          </details>
        </Bonds>
        <Shelf days={shelfDays} pages={pages} recent={recent} onOpen={pick} />
      </div>

      {children}

      <details className="ax-drawer ax-how">
        <summary>
          How the Archive is written
          <Chevron />
        </summary>
        <p className="wv-note">
          Once an hour the Lattice takes a step: one Claude Haiku call writes the whole world's hour from the cast, how they stand, the last few hours and what really happened in the
          Foundry. Near the monthly budget it writes from the agents' own scripted lines instead. About every five hours, and once the day's recap is filed, Skippy, the Magnificent
          reads the day aloud from the Historian's notes: ElevenLabs' speech when it's connected, else Gemini's, one voice, from the Archive's own public lines. The story's lines light
          up in step with the reading by their share of it. On Sunday evening the cast tells the week. The Lattice plays the latest hour when you{" "}
          <a href="/lattice" onClick={link("lattice")}>
            walk in
          </a>
          .
        </p>
      </details>
    </div>
  );
}

/** The hour of a moment in Mountain time, the Chronicle's clock. */
function mountainHour(at: number): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "2-digit", hourCycle: "h23" }).format(new Date(at))) % 24;
}

/** The shown day's hours, newest first, as a thread: one line each, the scenes a click deeper. */
function Hours({ entries, awaySince, loading, off }: { entries: HistoryEntry[]; awaySince: number; loading: boolean; off: boolean }) {
  const [all, setAll] = useState(false);
  const newestFirst = [...entries].reverse();
  if (!newestFirst.length) return <p className="wv-note ax-hours-none">{loading ? "Turning the pages…" : off ? "No pages yet." : "No hours recorded on this day."}</p>;
  const list = all ? newestFirst : newestFirst.slice(0, HOURS_SHOWN);
  return (
    <>
      <ol className="ax-hours">
        {list.map((e, i) => (
          <Hour key={e.step} e={e} fresh={Date.parse(e.at) > awaySince} i={i} />
        ))}
      </ol>
      {newestFirst.length > HOURS_SHOWN && (
        <button className="ax-more" type="button" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Fewer hours" : `All ${newestFirst.length} hours`}
          <Chevron />
        </button>
      )}
    </>
  );
}

function Hour({ e, fresh, i }: { e: HistoryEntry; fresh: boolean; i: number }) {
  const [open, setOpen] = useState(false);
  const rooms = [...new Set(e.scenes.map((s) => s.room))];
  const deeper = e.scenes.length + e.remarks.length + e.changes.length + e.events.length > 0;
  return (
    <li className={`ax-hour${fresh ? " is-fresh" : ""}${open ? " is-open" : ""}`} id={`hour-${e.step}`} style={{ "--i": i } as React.CSSProperties}>
      <button className="ax-hour-row" type="button" aria-expanded={deeper ? open : undefined} onClick={() => deeper && setOpen(!open)} disabled={!deeper}>
        <time dateTime={e.at}>{hourLabel(e.at)}</time>
        <span className="ax-hour-s">
          {e.summary}
          {fresh && <span className="ax-tag is-new">New</span>}
          {e.source === "scripted" && (
            <span className="ax-tag" title="Written from the agents' own scripted lines (no Claude call this hour)">
              scripted
            </span>
          )}
        </span>
        <span className="ax-hour-r" aria-label={rooms.map((r) => ROOM_NAME[r]).join(", ")}>
          {rooms.map((r) => (
            <i key={r} data-room={r} title={ROOM_NAME[r]} />
          ))}
          {deeper && <Chevron />}
        </span>
      </button>
      {open && (
        <div className="ax-hour-x">
          {e.events.length > 0 && (
            <ul className="chron-events" aria-label="What really happened">
              {e.events.map((line, k) => (
                <li key={k}>{line}</li>
              ))}
            </ul>
          )}
          {e.scenes.map((s, k) => (
            <section key={k} className="chron-scene" style={roomTone(s.room)} aria-label={`${ROOM_NAME[s.room]}: ${s.title}`}>
              <h4 className="roomtag">
                <i aria-hidden="true" />
                {ROOM_NAME[s.room]}
                <em>{s.title}</em>
              </h4>
              <ul className="chron-lines">
                {s.lines.map((l, j) => (
                  <li key={j}>
                    <Avatar agent={nameOf(l.who)} size="sm" />
                    <span>
                      <b>{nameOf(l.who)}</b> {l.text}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {e.remarks.length > 0 && (
            <ul className="chron-remarks" aria-label="The builders on what shipped">
              {e.remarks.map((r) => (
                <li key={r.issue}>
                  <Avatar agent={nameOf(r.who)} size="sm" room="foundry" />
                  <span>
                    <b>{nameOf(r.who)}</b> on #{r.issue} {r.title}: <q>{r.text}</q>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {e.changes.length > 0 && (
            <ul className="chron-changes" aria-label="Relationships that moved">
              {e.changes.map((c, k) => (
                <li key={k}>
                  <b>
                    {nameOf(c.a)} & {nameOf(c.b)}
                  </b>
                  {c.was && c.was !== c.kind ? `: ${KIND_WORD[c.was] ?? c.was} → ${KIND_WORD[c.kind] ?? c.kind}. ` : `: ${KIND_WORD[c.kind] ?? c.kind}. `}
                  {c.note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function nextIn(ms: number): string {
  if (ms <= 60_000) return "any minute";
  return `in ${Math.round(ms / 60_000)} min`;
}

const ROOM_ROWS: RoomId[] = ["foundry", "relay", "boiler", "archive", "breakroom", "spire", "exchange", "green", "workshop", "studio"];

/**
 * The shown day as threads: a thread per room across the day's hours, a knot wherever the hour set a scene there.
 * Rooms the day never visited stay a faint dashed line. Tap a knot to jump to that hour above.
 */
function DayInRooms({ entries }: { entries: HistoryEntry[] }) {
  const [box, width] = useWidth<HTMLDivElement>(320);
  const label = width < 520 ? 76 : 104;
  const plot = width - label - 10;
  const hourOf = (e: HistoryEntry) => {
    const d = new Date(e.at);
    return d.getHours() + d.getMinutes() / 60;
  };
  const x = (h: number) => label + (h / 24) * plot;
  const row = 22;
  const top = 10;
  const h = top + ROOM_ROWS.length * row + 22;
  const go = (step: number) => document.getElementById(`hour-${step}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  return (
    <div className="chron-weave" ref={box} aria-label="The day's scenes by room">
      <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
        {[0, 6, 12, 18, 24].map((t) => (
          <g key={t} className="chron-weave__tick">
            <line x1={x(t)} x2={x(t)} y1={top - 4} y2={h - 18} />
            <text x={x(t)} y={h - 4} style={{ textAnchor: t === 0 ? "start" : t === 24 ? "end" : "middle" }}>
              {t === 0 || t === 24 ? "midnight" : t === 12 ? "noon" : t < 12 ? `${t} am` : `${t - 12} pm`}
            </text>
          </g>
        ))}
        {ROOM_ROWS.map((room, i) => {
          const y = top + i * row + row / 2;
          const scenes = entries.flatMap((e) => e.scenes.filter((sc) => sc.room === room).map((sc) => ({ e, sc })));
          return (
            <g key={room} className={`chron-weave__row ${scenes.length ? "on" : ""}`} style={{ "--c": `var(--room-${room})`, "--i": i } as React.CSSProperties}>
              <text x={0} y={y + 4} className="chron-weave__name">
                {ROOM_NAME[room]}
              </text>
              <line x1={label} x2={label + plot} y1={y} y2={y} className="chron-weave__rest" />
              {scenes.length > 0 && <line x1={label} x2={x(Math.max(...scenes.map(({ e }) => hourOf(e))))} y1={y} y2={y} className="chron-weave__line" pathLength={1} />}
              {scenes.map(({ e, sc }, k) => (
                <circle key={`${e.step}-${k}`} cx={x(hourOf(e))} cy={y} r="4.5" className="chron-weave__knot" style={{ "--k": k } as React.CSSProperties} role="button" tabIndex={0} aria-label={`${ROOM_NAME[room]}, ${hourLabel(e.at)}: ${sc.title}`} onClick={() => go(e.step)} onKeyDown={(ev) => ev.key === "Enter" && go(e.step)}>
                  <title>{`${hourLabel(e.at)} · ${sc.title}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
