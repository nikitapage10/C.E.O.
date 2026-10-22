import { useEffect, useState } from "react";
import { chronicleDay, dayTitle, hourLabel, sinceAway, useChronicle, useWorldFeed, type HistoryEntry, type RoomId } from "../chronicle.ts";
import { previousWeek, weekStartOf } from "../../../../api/_world/weeks.ts";
import { DayStory } from "./DayStory.tsx";
import { WeekStory } from "./WeekStory.tsx";
import { formatWait } from "./deskData.ts";
import { link } from "./nav.ts";
import { PORTRAITS } from "./portraits.ts";
import { RoomBanner } from "./RoomBanner.tsx";
import { useWidth } from "./motion.tsx";
import { Avatar, Panel } from "./ui.tsx";

/**
 * The Chronicle: the Lattice, hour by hour, while you were away (docs/WORLD.md). Every hour the world takes a step and
 * the Historian writes it up: what happened, who said what to whom, how relationships moved, and what the builders
 * thought of the work that shipped. The first step after midnight files the day in Ilyr. Pages by day.
 */

const ROOM_NAME: Record<RoomId, string> = {
  foundry: "Foundry",
  spire: "Spire",
  exchange: "Exchange",
  green: "Green",
  relay: "Relay",
  archive: "Archive",
  breakroom: "Break Room",
  boiler: "Boiler Room",
  workshop: "Workshop",
};
const KIND_WORD: Record<string, string> = { friend: "friends", "best-friend": "best friends", rival: "rivals", nemesis: "nemeses", crush: "a crush", partner: "partners", mentor: "mentor and student", sibling: "siblings", ex: "exes" };

const nameOf = (id: string) => PORTRAITS[id]?.name ?? id;
const roomTone = (room: RoomId) => ({ "--tone": `var(--room-${room})` }) as React.CSSProperties;
/** How many of the hours since you were away the top panel lists before "more". */
const AWAY_SHOWN = 6;

export function Chronicle({ now, awaySince }: { now: number; awaySince: number }) {
  const { status, feed } = useWorldFeed();
  const pages = useChronicle((s) => s.pages);
  const today = chronicleDay(now);
  const days = feed?.days.length ? feed.days : [today];
  const [day, setDay] = useState<string | null>(null);
  const shown = day ?? days[0]!;

  useEffect(() => {
    if (status === "ready") void useChronicle.getState().loadDay(shown);
  }, [status, shown]);

  const page = pages[shown];
  // Today's hours are in the feed already; the page fills in anything older than its last day's worth.
  const fromFeed = (feed?.recent ?? []).filter((e) => e.day === shown);
  const fromPage = page && page !== "loading" && page !== "failed" ? page.entries : [];
  const entries = mergeEntries(fromPage, fromFeed).reverse();
  const recap = page && page !== "loading" && page !== "failed" ? page.recap : null;
  // The Desk can ask for today's or yesterday's story now (api/day-story.ts); older days only ever get the step's.
  const recent = shown === today || shown === chronicleDay(now - 86_400_000);
  // The week in Ilyr (#211) under the daily story: the shown day's week, and on today also the week just ended (Monday).
  const week = weekStartOf(shown);
  const weeks = shown === today ? [week, previousWeek(week)] : [week];
  const away = feed ? sinceAway(feed.recent, awaySince) : [];
  const changed = (feed?.relationships ?? []).filter((r) => r.since).sort((a, b) => Date.parse(b.since!) - Date.parse(a.since!)).slice(0, 8);

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
            : `The Lattice took its last step ${formatWait(now - Date.parse(feed.at))} ago. Nothing new since you were last here.`;

  return (
    <div className="chron" style={{ "--tone": "var(--room-archive)" } as React.CSSProperties}>
      <RoomBanner
        page="chronicle"
        lead={lead}
        aside={
          <div className="page-head__crew">
            <Avatar agent="The Historian" room="archive" />
            <span className="chron__keeper">
              Kept by the Historian
              {feed?.nextAt && <small>Next entry {nextIn(Date.parse(feed.nextAt) - now)}</small>}
            </span>
          </div>
        }
      />

      {away.length > 0 && (
        <Panel eyebrow="While you were away" aside={<span className="badge badge--hot">{away.length}</span>} className="chron-away">
          <ol className="chron-away__list">
            {away.slice(0, AWAY_SHOWN).map((e) => (
              <li key={e.step}>
                <button type="button" className="chron-away__item" onClick={() => setDay(e.day)}>
                  <time dateTime={e.at}>{dayTitle(e.day, now) === "Today" ? hourLabel(e.at) : `${dayTitle(e.day, now)}, ${hourLabel(e.at)}`}</time>
                  <span>{e.summary}</span>
                </button>
              </li>
            ))}
          </ol>
          {away.length > AWAY_SHOWN && <p className="quiet chron-away__more">…and {away.length - AWAY_SHOWN} more hours below.</p>}
        </Panel>
      )}

      <div className="chron__grid">
        <section className="chron__main" aria-label={`The Chronicle, ${dayTitle(shown, now)}`}>
          <nav className="fy-tabs chron__days" aria-label="Days">
            {days.slice(0, 14).map((d) => (
              <button key={d} type="button" className="fy-tabs__tab" aria-pressed={d === shown} onClick={() => setDay(d)}>
                {dayTitle(d, now)}
              </button>
            ))}
          </nav>

          {entries.length > 0 && <DayInRooms entries={entries} />}

          {recap ? (
            <Panel eyebrow={`The day in Ilyr · ${dayTitle(shown, now)}`} className="chron-recap">
              <div className="chron-recap__body">
                <Avatar agent="The Historian" size="sm" room="archive" />
                <p>{recap}</p>
              </div>
              {status === "ready" && <DayStory key={shown} day={shown} canMake={recent} />}
              {status === "ready" && <WeekStory key={weeks.join(",")} weeks={weeks} />}
            </Panel>
          ) : (
            status === "ready" &&
            entries.length > 0 && (
              <Panel eyebrow={`The day in Ilyr, aloud · ${dayTitle(shown, now)}`} className="chron-recap">
                <DayStory key={shown} day={shown} canMake={recent} label={shown === today ? "Hear the day so far" : "Hear the day in Ilyr"} />
                <WeekStory key={weeks.join(",")} weeks={weeks} />
              </Panel>
            )
          )}

          {entries.length ? (
            <ol className="chron-hours">
              {entries.map((e) => (
                <Hour key={e.step} e={e} fresh={Date.parse(e.at) > awaySince} />
              ))}
            </ol>
          ) : (
            <Panel eyebrow={dayTitle(shown, now)}>
              <p className="quiet">{page === "loading" || status === "loading" ? "Turning the pages…" : status === "off" ? "No pages yet." : "No hours recorded on this day."}</p>
            </Panel>
          )}
          {shown === today && entries.length > 0 && !recap && <p className="quiet chron__note">The Historian files the day in Ilyr after midnight.</p>}
        </section>

        <aside className="chron__side">
          <Panel eyebrow="How they stand now" aside={<span className="badge">{changed.length}</span>}>
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
              <p className="quiet">No one's relationships have moved yet. Give them an hour or two.</p>
            )}
          </Panel>
          <Panel eyebrow="How it works">
            <p className="quiet chron__how">
              Once an hour the Lattice takes a step: one Claude Haiku call writes the whole world's hour from the cast, how they stand, the last few hours and what really happened in
              the Foundry. Near the monthly budget it writes from the agents' own scripted lines instead. Once the day's recap is filed, the Historian reads the day aloud
              in the Archive: Gemini's speech, one voice, from the Chronicle's own public lines. The Lattice plays the latest hour when you{" "}
              <a href="/lattice" onClick={link("lattice")}>
                walk in
              </a>
              .
            </p>
          </Panel>
        </aside>
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

/** A day's hours from its page and from the feed, one per step, oldest first. */
function mergeEntries(a: HistoryEntry[], b: HistoryEntry[]): HistoryEntry[] {
  const byStep = new Map<number, HistoryEntry>();
  for (const e of [...a, ...b]) byStep.set(e.step, e);
  return [...byStep.values()].sort((x, y) => x.step - y.step);
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
