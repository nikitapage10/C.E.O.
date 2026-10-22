import { useEffect, useState } from "react";
import { chronicleDay, dayTitle, hourLabel, sinceAway, useChronicle, useWorldFeed, type HistoryEntry, type RoomId } from "../chronicle.ts";
import { previousWeek, weekDaysOf, weekStartOf } from "../../../../api/_world/weeks.ts";
import { Bonds, hoursOf, KIND_WORD, ROOM_NAME, Shelf, Tale, WeekStrip } from "./ChronicleWeave.tsx";
import { formatWait } from "./deskData.ts";
import { link } from "./nav.ts";
import { PORTRAITS } from "./portraits.ts";
import { useWidth } from "./motion.tsx";
import { Avatar } from "./ui.tsx";

/**
 * The Chronicle: the Lattice, hour by hour, while you were away (docs/WORLD.md), in the approved Weave (desk-concepts
 * round five). Every hour the world takes a step and the Historian writes it up: what happened, who said what to whom,
 * how relationships moved, and what the builders thought of the work that shipped. The first step after midnight files
 * the day in Ilyr and the Historian reads it aloud. Up top the day's story plays as a player; then the week, the bonds
 * that moved, a shelf of past days, and every hour of the shown day.
 */

const nameOf = (id: string) => PORTRAITS[id]?.name ?? id;
const roomTone = (room: RoomId) => ({ "--tone": `var(--room-${room})` }) as React.CSSProperties;
/** How many of the hours since you were away the top panel lists before "more". */
const AWAY_SHOWN = 6;
/** How many past days sit on the shelf. */
const SHELF = 8;

export function Chronicle({ now, awaySince }: { now: number; awaySince: number }) {
  const { status, feed } = useWorldFeed();
  const pages = useChronicle((s) => s.pages);
  const today = chronicleDay(now);
  const days = feed?.days.length ? feed.days : [today];
  const [day, setDay] = useState<string | null>(null);
  const shown = day ?? days[0]!;
  const week = weekStartOf(shown);
  const shelfDays = days.filter((d) => d !== today).slice(0, SHELF);
  const want = [...new Set([shown, ...weekDaysOf(week).filter((d) => days.includes(d)), ...shelfDays])].join(",");

  useEffect(() => {
    if (status !== "ready") return;
    for (const d of want.split(",")) void useChronicle.getState().loadDay(d);
  }, [status, want]);

  const page = pages[shown];
  const recent = feed?.recent ?? [];
  const entries = hoursOf(shown, page, recent);
  const newestFirst = [...entries].reverse();
  const recap = page && page !== "loading" && page !== "failed" ? page.recap : null;
  // The Desk can ask for today's or yesterday's story now (api/day-story.ts); older days only ever get the step's.
  const canMake = shown === today || shown === chronicleDay(now - 86_400_000);
  // The week in Ilyr (#211): the shown day's week, and on today also the week just ended (Monday).
  const weeks = shown === today ? [week, previousWeek(week)] : [week];
  const away = feed ? sinceAway(feed.recent, awaySince) : [];
  const changed = (feed?.relationships ?? []).filter((r) => r.since).sort((a, b) => Date.parse(b.since!) - Date.parse(a.since!)).slice(0, 8);
  const open = (d: string) => {
    setDay(d);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const lead =
    status === "off"
      ? "The world isn't being saved yet. Once the step runs, every hour in Ilyr is written up here."
      : !feed
        ? status === "failed"
          ? "Can't reach the Chronicle right now; trying again shortly."
          : "Opening the Chronicle…"
        : !feed.at
          ? "The Chronicle opens with the first hourly step."
          : away.length
            ? `${away.length} ${away.length === 1 ? "hour has" : "hours have"} passed in Ilyr since you were last here.`
            : `The Lattice took its last step ${formatWait(now - Date.parse(feed.at))} ago${feed.nextAt ? `, the next ${nextIn(Date.parse(feed.nextAt) - now)}` : ""}.`;
  const [y, m, d] = shown.split("-").map(Number);
  const dateLine = new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="chron wv-page wv-chron" style={{ "--tone": "var(--room-archive)" } as React.CSSProperties}>
      <header className="wv-pghead">
        <p className="wv-eyb">Chronicle, {dateLine}</p>
        <h1 className="wv-h1 desk__title">
          {shown === today ? "The day" : dayTitle(shown, now)} in <em style={{ color: "var(--rc-archive)" }}>Ilyr.</em>
        </h1>
        <p className="wv-sub">{lead} Every hour the world takes a step and the Historian writes it down. After midnight the whole day is filed as a story, read aloud.</p>
      </header>

      {days.length > 1 && (
        <nav className="wv-days" aria-label="Days">
          {days.slice(0, 14).map((x) => (
            <button key={x} type="button" aria-pressed={x === shown} onClick={() => setDay(x)}>
              {dayTitle(x, now)}
            </button>
          ))}
        </nav>
      )}

      {away.length > 0 && (
        <section className="wv-panel wv-away" data-room="archive">
          <div className="wv-sechead">
            <div>
              <p className="wv-eyb">While you were away</p>
              <h2 className="wv-h2">
                {away.length} {away.length === 1 ? "hour" : "hours"} in Ilyr
              </h2>
            </div>
          </div>
          <ol className="wv-away-l">
            {away.slice(0, AWAY_SHOWN).map((e) => (
              <li key={e.step}>
                <button type="button" onClick={() => setDay(e.day)}>
                  <time dateTime={e.at}>{dayTitle(e.day, now) === "Today" ? hourLabel(e.at) : `${dayTitle(e.day, now)}, ${hourLabel(e.at)}`}</time>
                  <span>{e.summary}</span>
                </button>
              </li>
            ))}
          </ol>
          {away.length > AWAY_SHOWN && <p className="wv-note">…and {away.length - AWAY_SHOWN} more hours below.</p>}
        </section>
      )}

      {status === "ready" || entries.length ? (
        <Tale day={shown} today={shown === today} entries={entries} canMake={canMake} />
      ) : (
        <section className="wv-tale wv-tale-off">
          <p className="wv-note">{status === "off" ? "No pages yet." : status === "failed" ? "Can't reach the Chronicle right now." : "Turning the pages…"}</p>
        </section>
      )}

      <div className="wv-chron2">
        <WeekStrip monday={week} shown={shown} days={days} pages={pages} recent={recent} weeks={weeks} onPick={setDay} />
        <Bonds entries={entries} today={shown === today} />
      </div>

      <Shelf days={shelfDays} pages={pages} recent={recent} onOpen={open} />

      <section className="wv-hours" aria-label={`The Chronicle, ${dayTitle(shown, now)}`}>
        <div className="wv-sechead">
          <div>
            <p className="wv-eyb">Hour by hour</p>
            <h2 className="wv-h2">{dayTitle(shown, now)}, as it was written</h2>
          </div>
          {feed?.nextAt && <p className="wv-note">Next entry {nextIn(Date.parse(feed.nextAt) - now)}</p>}
        </div>
        {recap && (
          <div className="wv-recap">
            <img src="/desk/agent-vellum.webp" alt="" width={40} height={40} decoding="async" />
            <p>{recap}</p>
          </div>
        )}
        {entries.length > 0 && <DayInRooms entries={newestFirst} />}
        {newestFirst.length ? (
          <ol className="chron-hours">
            {newestFirst.map((e) => (
              <Hour key={e.step} e={e} fresh={Date.parse(e.at) > awaySince} />
            ))}
          </ol>
        ) : (
          <p className="wv-note">{page === "loading" || status === "loading" ? "Turning the pages…" : status === "off" ? "No pages yet." : "No hours recorded on this day."}</p>
        )}
        {shown === today && entries.length > 0 && !recap && <p className="wv-note chron__note">The Historian files the day in Ilyr after midnight.</p>}
      </section>

      <div className="wv-chron-more">
        <details className="wv-more-d">
          <summary>How everyone stands now{changed.length ? ` (${changed.length} moved lately)` : ""}</summary>
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
        <details className="wv-more-d">
          <summary>How the Chronicle is written</summary>
          <p className="wv-note">
            Once an hour the Lattice takes a step: one Claude Haiku call writes the whole world's hour from the cast, how they stand, the last few hours and what really happened in the
            Foundry. Near the monthly budget it writes from the agents' own scripted lines instead. Once the day's recap is filed, the Historian reads the day aloud in the
            Archive: Gemini's speech, one voice, from the Chronicle's own public lines. The story's lines light up in step with the reading by their share of it. The Lattice
            plays the latest hour when you{" "}
            <a href="/lattice" onClick={link("lattice")}>
              walk in
            </a>
            .
          </p>
        </details>
      </div>
    </div>
  );
}

function Hour({ e, fresh }: { e: HistoryEntry; fresh: boolean }) {
  return (
    <li className={`chron-hour${fresh ? " chron-hour--fresh" : ""}`} id={`hour-${e.step}`}>
      <header className="chron-hour__head">
        <time dateTime={e.at}>{hourLabel(e.at)}</time>
        {fresh && <span className="chron-hour__new">New</span>}
        {e.source === "scripted" && (
          <span className="chron-hour__src" title="Written from the agents' own scripted lines (no Claude call this hour)">
            scripted
          </span>
        )}
      </header>
      <p className="chron-hour__summary">{e.summary}</p>
      {e.events.length > 0 && (
        <ul className="chron-events" aria-label="What really happened">
          {e.events.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {e.scenes.map((s, i) => (
        <section key={i} className="chron-scene" style={roomTone(s.room)} aria-label={`${ROOM_NAME[s.room]}: ${s.title}`}>
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
          {e.changes.map((c, i) => (
            <li key={i}>
              <b>
                {nameOf(c.a)} & {nameOf(c.b)}
              </b>
              {c.was && c.was !== c.kind ? `: ${KIND_WORD[c.was] ?? c.was} → ${KIND_WORD[c.kind] ?? c.kind}. ` : `: ${KIND_WORD[c.kind] ?? c.kind}. `}
              {c.note}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function nextIn(ms: number): string {
  if (ms <= 60_000) return "any minute";
  return `in ${Math.round(ms / 60_000)} min`;
}

const ROOM_ROWS: RoomId[] = ["foundry", "relay", "boiler", "archive", "breakroom", "spire", "exchange", "green", "workshop"];

/**
 * The shown day as threads (the Weave): a thread per room across the day's hours, a knot wherever the hour set a
 * scene there. Rooms the day never visited stay a faint dashed line. Tap a knot to jump to that hour below.
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
