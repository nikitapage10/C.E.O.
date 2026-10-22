import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration, useDayStory, useWeekStory, type DayPage, type HistoryEntry, type RoomId } from "../chronicle.ts";
import { weekDaysOf } from "../../../../api/_world/weeks.ts";
import { tloomSpec, waveSpec, weekSpec, type TaleClock, type WeekCol } from "./chronicleViz.ts";
import { paragraphs, STORY_WHY, useStoryMaker } from "./DayStory.tsx";
import { PORTRAITS } from "./portraits.ts";
import { reducedMotion, useViz } from "./wvCanvas.ts";

/**
 * The Chronicle's sections in the approved Weave (desk-concepts round five): the day's story as a player, its lines
 * lighting up in time and the rooms it passes through lighting beside them; the week as strands; the bonds that moved;
 * and a shelf of past days. All from the world's own pages: the story's script and audio (api/day-story.ts), the
 * hours (api/world.ts) and their scenes, changes and builders' remarks. What isn't there yet says so.
 */

export const ROOM_NAME: Record<RoomId, string> = {
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
const LOOM_ROOMS: RoomId[] = ["foundry", "breakroom", "boiler", "relay", "archive", "spire", "exchange", "green", "workshop"];
const WORDS = ["None", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
export const KIND_WORD: Record<string, string> = { friend: "friends", "best-friend": "best friends", rival: "rivals", nemesis: "nemeses", crush: "a crush", partner: "partners", mentor: "mentor and student", sibling: "siblings", ex: "exes" };

/** Which room a line of the story is in: a room's name, or a cast member's name, the first one it mentions. */
const ROOM_WORDS: [RegExp, RoomId][] = [
  ...(Object.entries(ROOM_NAME) as [RoomId, string][]).map(([id, name]) => [new RegExp(`\\b${name}\\b`), id] as [RegExp, RoomId]),
  ...Object.values(PORTRAITS)
    .filter((p) => p.room in ROOM_NAME)
    .map((p) => [new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), p.room as RoomId] as [RegExp, RoomId]),
];
export function roomIn(text: string): RoomId | null {
  let best: { at: number; room: RoomId } | null = null;
  for (const [re, room] of ROOM_WORDS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, room };
  }
  return best?.room ?? null;
}

const sentences = (text: string) => (text.match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);

/** A short title from a text: its first clause when that's short, else nothing. */
export function clauseOf(text: string | null | undefined, words = 7): string | null {
  if (!text) return null;
  const first = sentences(text)[0] ?? "";
  const clause = first.split(/[,;:–—]/)[0]!.replace(/[.!?]+$/, "").trim();
  const n = clause.split(/\s+/).length;
  return n >= 2 && n <= words ? clause : null;
}

interface Line {
  text: string;
  room: RoomId;
  t: number;
}

/** The script's sentences, each timed by its share of the reading (the audio has no timestamps of its own). */
function fromScript(script: string, dur: number): { lines: Line[]; dur: number } {
  const ss = sentences(script);
  const total = ss.reduce((a, s) => a + s.length, 0) || 1;
  let at = 0;
  let room: RoomId = "archive";
  const lines = ss.map((text) => {
    room = roomIn(text) ?? room;
    const line = { text, room, t: (at / total) * dur };
    at += text.length;
    return line;
  });
  return { lines, dur };
}

/** No reading yet: the hours' own summaries, timed at a reading pace, so the day can still be read along. */
function fromHours(entries: HistoryEntry[]): { lines: Line[]; dur: number } {
  let t = 0;
  const lines = entries.slice(-12).map((e) => {
    const line = { text: e.summary, room: e.scenes[0]?.room ?? roomIn(e.summary) ?? "archive", t };
    t += Math.max(3, e.summary.length / 16);
    return line;
  });
  return { lines, dur: t };
}

const PlayIcon = () => (
  <svg className="is-p" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
  </svg>
);
const PauseIcon = () => (
  <svg className="is-s" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
  </svg>
);

/** The day's story as a player: play, the waveform, the lines in time, and the rooms lighting beside them. */
export function Tale({ day, today, entries, canMake }: { day: string; today: boolean; entries: HistoryEntry[]; canMake: boolean }) {
  const story = useDayStory((s) => s.stories[day]);
  useEffect(() => {
    void useDayStory.getState().loadStory(day);
  }, [day]);
  const ready = story && typeof story === "object" && story.ready ? story : null;
  const why = story && typeof story === "object" && !story.ready ? story.reason : null;
  const { lines, dur } = useMemo(() => (ready ? fromScript(ready.script, ready.durationSec) : fromHours(entries)), [ready, entries]);
  const { makeControls, noteLine } = useStoryMaker(day);

  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const [started, setStarted] = useState(false);
  const [t, setT] = useState(0);
  // The audio couldn't play (blocked or gone): the lines carry on as a quiet read-along.
  const [silent, setSilent] = useState(false);
  const clock = useRef<TaleClock>({ on: false, t: 0, dur: 1, room: null, told: new Set() });
  const idx = lines.reduce((ix, l, i) => (started && t >= l.t ? i : ix), -1);
  const room = idx >= 0 ? lines[idx]!.room : null;
  const toldKey = lines
    .slice(0, Math.max(0, idx))
    .map((l) => l.room)
    .join();
  const told = useMemo(() => new Set(toldKey ? toldKey.split(",") : []), [toldKey]);
  useEffect(() => {
    Object.assign(clock.current, { on, t, dur: dur || 1, room, told });
  }, [on, t, dur, room, told]);

  const wave = useMemo(() => waveSpec(clock), []);
  const loom = useMemo(() => tloomSpec(clock), []);
  const waveCv = useRef<HTMLCanvasElement>(null);
  const loomCv = useRef<HTMLCanvasElement>(null);
  const wv = useViz(waveCv, wave);
  const lv = useViz(loomCv, loom);
  const box = useRef<HTMLDivElement>(null);

  // A new day starts from the top.
  useEffect(() => {
    setOn(false);
    setStarted(false);
    setSilent(false);
    setT(0);
  }, [day]);

  // The clock: the audio's own time while it plays, else a quiet read-along at the lines' pace.
  useEffect(() => {
    if (!on) return;
    const a = audio.current;
    let last = performance.now();
    const id = window.setInterval(() => {
      if (a && ready && !silent) {
        setT(a.currentTime);
        if (a.ended) setOn(false);
      } else {
        const now = performance.now();
        setT((x) => {
          const nx = x + (now - last) / 1000;
          if (nx >= dur) setOn(false);
          return Math.min(nx, dur);
        });
        last = now;
      }
    }, 120);
    return () => clearInterval(id);
  }, [on, ready, dur, silent]);

  // Keep the line being read in view, inside the lines' own box (never the page), and redraw stills when motion is off.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(".is-now");
    const b = box.current;
    if (el && b && b.scrollHeight > b.clientHeight) b.scrollTo({ top: el.offsetTop - b.clientHeight / 3, behavior: reducedMotion() ? "auto" : "smooth" });
    if (reducedMotion()) {
      wv.current?.relayout();
      lv.current?.relayout();
    }
  }, [idx, wv, lv]);

  const play = () => {
    if (!lines.length) return;
    if (on) {
      audio.current?.pause();
      setOn(false);
      return;
    }
    const restart = t >= dur - 0.05;
    if (ready && audio.current && !silent) {
      if (restart) audio.current.currentTime = 0;
      else audio.current.currentTime = t;
      void audio.current.play().catch(() => setSilent(true));
    }
    if (restart) setT(0);
    setStarted(true);
    setOn(true);
  };

  const title = ready ? (clauseOf(ready.script, 9) ?? "The day in Ilyr") : lines.length ? (clauseOf(entries[entries.length - 1]?.summary) ?? "The day's hours") : "No hours written yet";
  const eyebrow = ready ? (today ? (ready.partial ? "Today's story, so far" : "Today's story") : "The day's story") : lines.length ? (today ? "Today's hours, so far" : "The day's hours") : "The day's story";
  const hours = entries.length;
  const note = ready
    ? `Read by the Historian, ${formatDuration(ready.durationSec)}. ${hours ? `${hours} ${hours === 1 ? "hour" : "hours"} written.` : ""}`
    : lines.length
      ? `${(why && STORY_WHY(why)) ?? "Not read aloud yet."} Play reads the hours along, quietly.`
      : story === "loading"
        ? "Finding the Historian's reading…"
        : "The Historian writes once the world takes its first step of the day.";

  return (
    <section className="wv-tale" aria-label="The day's story">
      <div className="wv-tale-top">
        <button className={`wv-playbig${on ? " is-on" : ""}`} type="button" aria-label={on ? "Pause" : ready ? "Play the day's story" : "Read the day along"} onClick={play} disabled={!lines.length}>
          <PlayIcon />
          <PauseIcon />
        </button>
        <div className="wv-tale-meta">
          <p className="wv-eyb" style={{ color: "var(--rc-archive)" }}>
            {eyebrow}
          </p>
          <h2 className="wv-h2">{title}</h2>
          <p className="wv-note">{note}</p>
        </div>
        <img className="wv-tale-pf" src="/desk/agent-vellum.webp" alt="The Historian" width={56} height={56} decoding="async" />
      </div>
      {ready && <audio ref={audio} preload="none" src={ready.audio} onPause={() => !silent && setOn(false)} onEnded={() => setOn(false)} onError={() => setSilent(true)} />}
      {silent && <p className="wv-note wv-tale-n">The recording wouldn't play here, so the lines are reading along quietly.</p>}
      {ready?.partial && <p className="wv-note wv-tale-n">Read before the recap was filed. The full day's story replaces it after midnight.</p>}
      {ready?.stale && canMake && (
        <div className="wv-tale-n">
          <p className="wv-note">Read in an older voice that came out deep and slow. Make it now remakes it once in a clear, natural one.</p>
          {makeControls}
        </div>
      )}
      {!ready && why === "not-yet" && canMake && <div className="wv-tale-n">{makeControls}</div>}
      {noteLine}
      <div className="wv-wave">
        <canvas ref={waveCv} className="wv-cv" aria-hidden="true" />
        <p className="wv-wave-t">
          <span>{formatDuration(t)}</span>
          <span>{formatDuration(dur)}</span>
        </p>
      </div>
      <div className="wv-tale-body">
        <div ref={box} className={`wv-lines${started ? " is-playing" : ""}`} aria-live="off">
          {lines.length ? (
            lines.map((l, i) => (
              <p key={i} data-room={l.room} className={i === idx ? "is-now" : i < idx ? "is-past" : undefined}>
                {l.text}
              </p>
            ))
          ) : (
            <p className="wv-lines-empty">Nothing in Ilyr has been written down on this day yet.</p>
          )}
        </div>
        <div className="wv-tlooms">
          <canvas ref={loomCv} className="wv-cv" aria-hidden="true" />
          <ul className="wv-tloom-l">
            {LOOM_ROOMS.map((r) => (
              <li key={r} data-room={r} className={room === r ? "is-lit" : told.has(r) ? "is-told" : undefined}>
                {ROOM_NAME[r]}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const shortDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12));
  return { wd: dt.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" }), d: String(d), month: dt.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long" }) };
};

/** A day's hours, from its page and the feed's recent hours, one per step, oldest first. */
export function hoursOf(day: string, page: DayPage | "loading" | "failed" | undefined, recent: HistoryEntry[]): HistoryEntry[] {
  const byStep = new Map<number, HistoryEntry>();
  const fromPage = page && page !== "loading" && page !== "failed" ? page.entries : [];
  for (const e of [...fromPage, ...recent.filter((x) => x.day === day)]) byStep.set(e.step, e);
  return [...byStep.values()].sort((x, y) => x.step - y.step);
}

const roomsOf = (entries: HistoryEntry[]) => {
  const rooms: Record<string, number> = {};
  for (const e of entries) for (const s of e.scenes) rooms[s.room] = (rooms[s.room] ?? 0) + 1;
  return rooms;
};
const shipsOf = (entries: HistoryEntry[]) => entries.reduce((n, e) => n + e.remarks.length, 0);

/** The week in Ilyr: a column of strands per day, a knot per change shipped, and the week's story when it's told. */
export function WeekStrip({ monday, shown, days, pages, recent, weeks, onPick }: { monday: string; shown: string; days: string[]; pages: Record<string, DayPage | "loading" | "failed">; recent: HistoryEntry[]; weeks: string[]; onPick: (day: string) => void }) {
  const week = weekDaysOf(monday);
  const cols: WeekCol[] = week.map((d) => {
    const hrs = hoursOf(d, pages[d], recent);
    return { rooms: roomsOf(hrs), ships: shipsOf(hrs), hot: d === shown };
  });
  const sig = JSON.stringify(cols);
  const spec = useMemo(() => weekSpec(cols), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);

  const all = useWeekStory((s) => s.weeks);
  const key = weeks.join(",");
  useEffect(() => {
    for (const w of key.split(",")) void useWeekStory.getState().loadWeek(w);
  }, [key]);
  const told = weeks.map((w) => all[w]).find((s) => s && s !== "loading" && s !== "failed" && s.ready);
  const story = told && told !== "loading" && told !== "failed" && told.ready ? told : null;
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (on) a.pause();
    else void a.play().then(() => setOn(true), () => setOn(false));
  };
  const scenes = cols.reduce((n, c) => n + Object.values(c.rooms).reduce((a, b) => a + b, 0), 0);

  return (
    <section className="wv-week" data-room="archive">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">The week in Ilyr</p>
          <h2 className="wv-h2">Week of {shortDay(monday).month}</h2>
        </div>
        {story?.audio && (
          <button className="wv-btn is-sm" type="button" onClick={toggle} aria-pressed={on}>
            <svg viewBox="0 0 16 16" aria-hidden="true" width="12" height="12">
              {on ? <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /> : <path d="M5 3v10l8-5z" fill="currentColor" />}
            </svg>
            {on ? "Pause" : `Play${story.week !== monday ? " last week" : ""}, ${formatDuration(story.durationSec)}`}
          </button>
        )}
      </div>
      <div className="wv-weekstrip">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <ol className="wv-week-d">
          {week.map((d) => {
            const s = shortDay(d);
            const has = days.includes(d);
            return (
              <li key={d} className={d === shown ? "is-sun" : undefined}>
                <button type="button" disabled={!has} onClick={() => onPick(d)} aria-label={`Open ${s.wd} ${s.d}`} aria-pressed={d === shown}>
                  {s.wd}
                  <span>{s.d}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {story?.audio && <audio ref={audio} preload="none" src={story.audio} onPause={() => setOn(false)} onEnded={() => setOn(false)} />}
      <p className="wv-note" style={{ marginTop: 14 }}>
        {story ? `${story.week !== monday ? "Last week, told" : "Told"} by the cast on Sunday: ${sentences(story.script)[0] ?? ""}` : scenes ? `${scenes} ${scenes === 1 ? "scene" : "scenes"} so far this week. The cast tells the week on Sunday evening.` : "Nothing written this week yet. The cast tells the week on Sunday evening."}
      </p>
      {story && (
        <details className="wv-more-d">
          <summary>{story.audio ? "Transcript" : "Not read aloud: the transcript"}</summary>
          {paragraphs(story.script).map((p, i) => (
            <p key={i} className="wv-note">
              {p}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}

const face = (id: string) => (PORTRAITS[id] ? `/desk/agent-${id}.webp` : null);
const nameOf = (id: string) => PORTRAITS[id]?.name ?? id;

/** The bonds the shown day moved, newest last change per pair. */
export function Bonds({ entries, today }: { entries: HistoryEntry[]; today: boolean }) {
  const byPair = new Map<string, HistoryEntry["changes"][number]>();
  for (const e of entries) for (const c of e.changes) byPair.set([c.a, c.b].sort().join("|"), c);
  const list = [...byPair.values()].reverse().slice(0, 4);
  return (
    <section className="wv-bonds">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Bonds that moved</p>
          <h2 className="wv-h2">
            {WORDS[list.length] ?? list.length}, {today ? "today" : "that day"}
          </h2>
        </div>
      </div>
      {list.length ? (
        list.map((c) => (
          <div key={`${c.a}|${c.b}`} className="wv-bond" data-room={PORTRAITS[c.a]?.room ?? "archive"}>
            <span className="wv-pair">
              {[c.a, c.b].map((id) => {
                const src = face(id);
                return src ? <img key={id} src={src} alt="" width={48} height={48} decoding="async" /> : <i key={id} className="wv-pair-x" />;
              })}
            </span>
            <div>
              <b>
                {nameOf(c.a)} and {nameOf(c.b)}
              </b>
              <span>
                {c.was && c.was !== c.kind ? (
                  <>
                    {KIND_WORD[c.was] ?? c.was}, now <em>{KIND_WORD[c.kind] ?? c.kind}</em>
                  </>
                ) : (
                  <em>{KIND_WORD[c.kind] ?? c.kind}</em>
                )}
              </span>
              {c.note && <p>{c.note}</p>}
            </div>
          </div>
        ))
      ) : (
        <p className="wv-note wv-bond-none">No one's bonds moved {today ? "today, yet" : "that day"}. Give them an hour or two.</p>
      )}
    </section>
  );
}

/** Past days as spines on a shelf: pull one out to read its recap, then open the whole day. */
export function Shelf({ days, pages, recent, onOpen }: { days: string[]; pages: Record<string, DayPage | "loading" | "failed">; recent: HistoryEntry[]; onOpen: (day: string) => void }) {
  const [out, setOut] = useState<string | null>(null);
  if (!days.length) {
    return (
      <section className="wv-shelf">
        <div className="wv-sechead">
          <div>
            <p className="wv-eyb">Past days</p>
            <h2 className="wv-h2">The shelf</h2>
          </div>
        </div>
        <p className="wv-note">The shelf fills one spine a day, from the first full day the world writes.</p>
      </section>
    );
  }
  const spines = days.map((d) => {
    const page = pages[d];
    const hrs = hoursOf(d, page, recent);
    const recap = page && page !== "loading" && page !== "failed" ? page.recap : null;
    const rooms = Object.entries(roomsOf(hrs)).sort((a, b) => b[1] - a[1]);
    const ships = shipsOf(hrs);
    const s = shortDay(d);
    return {
      d,
      label: `${s.wd} ${s.d}`,
      title: clauseOf(recap, 8) ?? clauseOf(hrs[hrs.length - 1]?.summary, 8) ?? (page === "loading" ? "Fetching the day" : `${s.wd}, ${s.month}`),
      foot: ships ? `${ships} ${ships === 1 ? "ship" : "ships"}` : hrs.length ? `${hrs.length} ${hrs.length === 1 ? "hour" : "hours"}` : "No hours",
      text: recap ?? hrs[hrs.length - 1]?.summary ?? (page === "loading" ? "Turning the pages…" : "Nothing was written down on this day."),
      a: `var(--rc-${rooms[0]?.[0] ?? "archive"})`,
      b: `var(--rc-${rooms[1]?.[0] ?? "relay"})`,
      h: `${Math.min(100, 80 + hrs.length)}%`,
      month: s.month,
      wd: s.wd,
    };
  });
  const open = spines.find((s) => s.d === out);
  return (
    <section className="wv-shelf">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Past days</p>
          <h2 className="wv-h2">The shelf</h2>
        </div>
        <p className="wv-note">Pull one out to read it</p>
      </div>
      <div className="wv-shelf-row">
        {spines.map((s) => (
          <button key={s.d} className={`wv-spine${out === s.d ? " is-out" : ""}`} type="button" aria-expanded={out === s.d} onClick={() => setOut(out === s.d ? null : s.d)} style={{ "--a": s.a, "--b": s.b, "--h": s.h } as React.CSSProperties}>
            <span>{s.label}</span>
            <b>{s.title}</b>
            <em>{s.foot}</em>
          </button>
        ))}
      </div>
      {open && (
        <div className="wv-shelf-read" key={open.d}>
          <p className="wv-eyb">
            {open.wd} {open.month}
          </p>
          <p className="wv-shelf-x">{open.text}</p>
          <button className="wv-link" type="button" onClick={() => onOpen(open.d)}>
            Open the whole day
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      )}
    </section>
  );
}
