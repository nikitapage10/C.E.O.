import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration, useDayStory, useWeekStory, type DayPage, type DayStoryView, type HistoryEntry, type RoomId } from "../chronicle.ts";
import type { BookLive } from "./chronicleViz.ts";
import { madeAt, paragraphs, STORY_WHY, useStoryMaker } from "./DayStory.tsx";
import { PORTRAITS } from "./portraits.ts";
import { SKIPPY_PORTRAIT } from "./skippy/SkippyAvatar.tsx";
import { reducedMotion } from "./wvCanvas.ts";

/**
 * The Archive's pieces (#366, a redesign of the Weave's Chronicle): Today in Ilyr as a broadsheet edition, Skippy's
 * latest reading up front with the day's editions as a rail, and the read-along one click deeper; the week in Ilyr as
 * a tapestry of seven folios, the cast's Sunday story under it; the bonds that moved; and a shelf of past days. All
 * from the world's own pages: the story's script and audio (api/day-story.ts), the hours (api/world.ts) and their
 * scenes, changes and builders' remarks. What isn't there yet says so.
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
  studio: "Studio",
};
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

export const sentences = (text: string) => (text.match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);

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
export const Chevron = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
);
const Arrow = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

/** True once the element has come into view (at once where there's no IntersectionObserver). */
export function useInView<T extends Element>(ref: React.RefObject<T | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

/**
 * Kinetic type: a line that sets itself word by word as it comes into view, each word settling from loose tracking.
 * The words are ordinary text (a screen reader reads the line as it is); without motion they're simply there.
 */
export function Kin({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref);
  let k = 0;
  return (
    <span ref={ref} className={`ax-kin${seen ? " is-in" : ""}${className ? ` ${className}` : ""}`}>
      {text.split(/(\s+)/).map((w, i) =>
        /^\s*$/.test(w) ? (
          w
        ) : (
          <span key={i} className="ax-w" style={{ "--w": k++ } as React.CSSProperties}>
            {w}
          </span>
        ),
      )}
    </span>
  );
}

/** The illuminated initial: the letter inked as an outline in violet, then filled, inside a hairline square. */
function Initial({ ch }: { ch: string }) {
  return (
    <span className="ax-initial" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <rect x="1" y="1" width="98" height="98" pathLength={1} />
        <text x="50" y="76" className="ax-initial-o">
          {ch}
        </text>
        <text x="50" y="76" className="ax-initial-f">
          {ch}
        </text>
      </svg>
    </span>
  );
}

/** The big play button, its ring filling as the reading goes. */
function PlayRing({ on, pr, label, onClick, disabled }: { on: boolean; pr: number; label: string; onClick: () => void; disabled?: boolean }) {
  const C = 2 * Math.PI * 35;
  return (
    <button className={`ax-play${on ? " is-on" : ""}`} type="button" aria-label={label} onClick={onClick} disabled={disabled}>
      <svg className="ax-play-ring" viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="38" cy="38" r="35" className="ax-play-bg" />
        <circle cx="38" cy="38" r="35" className="ax-play-fg" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - pr) }} />
      </svg>
      <PlayIcon />
      <PauseIcon />
    </button>
  );
}

const ROMAN = ["", "I", "II", "III", "IV"];
/** The day's editions (#365): a "so far" after each five-hour mark, then the whole day after midnight. */
const SLOTS = [
  { at: "5 am", ed: 1 },
  { at: "10 am", ed: 2 },
  { at: "3 pm", ed: 3 },
  { at: "8 pm", ed: 4 },
  { at: "After midnight", ed: null },
] as const;

type Ready = Extract<DayStoryView, { ready: true }>;

/** Which slot an edition fills: its five-hour mark, or the last for the whole day. */
function slotOf(s: Ready): number {
  if (!s.partial) return SLOTS.length - 1;
  const e = s.edition ?? 0;
  return e >= 1 && e <= 4 ? e - 1 : e >= 5 ? 3 : -1;
}
function editionName(s: Ready): string {
  if (!s.partial) return "The whole day";
  const e = s.edition ?? 0;
  return e >= 1 && e <= 4 ? `Edition ${ROMAN[e]}` : e >= 5 ? "A late edition" : "An early edition";
}

/** How often the edition looks for a newer one while it isn't playing (#365). */
const REFRESH_MS = 5 * 60_000;

/**
 * Today in Ilyr, the latest edition: a headline, the lede with an illuminated initial, Skippy's reading behind the
 * play ring and the day's editions as a rail. Read along opens the lines lighting up in time, and the rooms with them.
 * Falls back to yesterday's whole day while today has no edition yet, and to the hours read quietly when neither does.
 */
export function Edition({ today, yesterday, entries, hourNow, live }: { today: string; yesterday: string; entries: HistoryEntry[]; hourNow: number; live: { current: BookLive } }) {
  const mine = useDayStory((s) => s.stories[today]);
  const prev = useDayStory((s) => s.stories[yesterday]);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    void useDayStory.getState().loadStory(today);
    void useDayStory.getState().loadStory(yesterday);
    const timer = window.setInterval(() => {
      if (audio.current && !audio.current.paused) return;
      void useDayStory.getState().loadStory(today, true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [today, yesterday]);
  const ready: Ready | null = mine && typeof mine === "object" && mine.ready ? mine : prev && typeof prev === "object" && prev.ready ? prev : null;
  const isToday = ready?.day !== yesterday;
  const why = mine && typeof mine === "object" && !mine.ready ? mine.reason : null;
  const { lines, dur } = useMemo(() => (ready ? fromScript(ready.script, ready.durationSec) : fromHours(entries)), [ready, entries]);
  const { makeControls, noteLine } = useStoryMaker(today);

  const [on, setOn] = useState(false);
  const [started, setStarted] = useState(false);
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(0);
  // The audio couldn't play (blocked or gone): the lines carry on as a quiet read-along.
  const [silent, setSilent] = useState(false);
  const idx = lines.reduce((ix, l, i) => (started && t >= l.t ? i : ix), -1);
  // The Book of Hours lights today's hours as the reading goes (read each frame, no re-render).
  useEffect(() => {
    live.current.on = on || (started && t > 0 && t < dur);
    live.current.pr = dur ? Math.min(1, t / dur) : 0;
  }, [on, started, t, dur, live]);
  useEffect(
    () => () => {
      live.current.on = false;
    },
    [live],
  );
  const box = useRef<HTMLDivElement>(null);

  // A new edition starts from the top.
  const key = ready ? `${ready.day}|${ready.at}` : "hours";
  useEffect(() => {
    setOn(false);
    setStarted(false);
    setSilent(false);
    setT(0);
  }, [key]);

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
        const n = performance.now();
        setT((x) => {
          const nx = x + (n - last) / 1000;
          if (nx >= dur) setOn(false);
          return Math.min(nx, dur);
        });
        last = n;
      }
    }, 120);
    return () => clearInterval(id);
  }, [on, ready, dur, silent]);

  // Keep the line being read in view, inside the lines' own box (never the page), and redraw stills when motion is off.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(".is-now");
    const b = box.current;
    if (el && b && b.scrollHeight > b.clientHeight) b.scrollTo({ top: el.offsetTop - b.clientHeight / 3, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [idx, open]);

  const play = () => {
    if (!lines.length) return;
    if (on) {
      audio.current?.pause();
      setOn(false);
      return;
    }
    const restart = t >= dur - 0.05;
    if (ready && audio.current && !silent) {
      audio.current.currentTime = restart ? 0 : t;
      void audio.current.play().catch(() => setSilent(true));
    }
    if (restart) setT(0);
    setStarted(true);
    setOpen(true);
    setOn(true);
  };

  const source = ready ? ready.script : entries.map((e) => e.summary).join(" ");
  const ss = sentences(source);
  const headline = ready ? (clauseOf(ready.script, 9) ?? "The day in Ilyr") : lines.length ? (clauseOf(entries[entries.length - 1]?.summary, 9) ?? "Today's hours, so far") : "No hours written yet";
  // The lede skips the first sentence when the headline is all of it.
  const first = (ss[0] ?? "").replace(/[.!?]+$/, "").trim();
  const lede = (ready && first === headline ? ss.slice(1, 3) : ss.slice(0, 2)).join(" ");
  const pr = dur ? Math.min(1, t / dur) : 0;
  const slot = ready ? slotOf(ready) : -1;
  const nextSlot = ready && isToday && ready.partial ? SLOTS[slot + 1] : null;
  const made = ready ? madeAt(ready.at) : "";

  return (
    <section className={`ax-ed${on ? " is-playing" : ""}`} aria-label="Today in Ilyr" data-room="archive">
      <div className="ax-spread">
        <article className="ax-verso">
          <header className="ax-run">
            <span>Today in Ilyr</span>
            <span className="ax-run-m">{ready ? (isToday ? editionName(ready) : "Yesterday, the whole day") : lines.length ? "No edition yet" : "Waiting on the first hour"}</span>
          </header>
          <h2 className="ax-ed-h">
            <Kin text={headline} />
          </h2>
          {lede ? (
            <p className="ax-ed-lede">
              <Initial ch={lede[0]!} />
              <span className="wv-sr">{lede[0]}</span>
              {lede.slice(1)}
            </p>
          ) : (
            <p className="ax-ed-lede is-empty">Nothing in Ilyr has been written down today yet. The Historian writes once the world takes its first step of the day.</p>
          )}
        </article>
        <div className="ax-recto">
          <header className="ax-run ax-run-r">
            <span>{ready ? `${made ? `Made ${made}` : "Read aloud"} · ${formatDuration(ready.durationSec)}` : lines.length ? "The hours so far" : "Nothing to read yet"}</span>
          </header>
          <div className="ax-ed-ctl">
            <PlayRing on={on} pr={pr} onClick={play} disabled={!lines.length} label={on ? "Pause" : ready ? "Play Today in Ilyr" : "Read the hours along"} />
            <div className="ax-ed-by">
              <img src={SKIPPY_PORTRAIT} alt="" width={40} height={40} decoding="async" />
              <span>
                <b>{ready ? "Read by Skippy, the Magnificent" : "Not read aloud yet"}</b>
                <small>{ready ? `${formatDuration(t)} of ${formatDuration(dur)}` : lines.length ? "Play reads the hours along, quietly" : "Nothing to read yet"}</small>
              </span>
            </div>
          </div>
          <ol className="ax-rail" aria-label="Today's editions">
            {SLOTS.map((s, i) => {
              const state = ready && isToday ? (i < slot ? "past" : i === slot ? "now" : "next") : ready && i === slot ? "now" : !ready && s.ed && hourNow >= s.ed * 5 ? "past" : "next";
              return (
                <li key={s.at} className={`is-${state}`} aria-current={state === "now" ? "true" : undefined}>
                  <b>{s.ed ? ROMAN[s.ed] : "Day"}</b>
                  <span>{s.ed ? `after ${s.at}` : s.at}</span>
                  <em>{state === "now" ? "playing here" : state === "past" ? "filed" : "to come"}</em>
                </li>
              );
            })}
          </ol>
          <p className="ax-ed-note">
            {ready
              ? isToday
                ? nextSlot
                  ? `Skippy reads the day so far about every five hours. The next edition comes ${nextSlot.ed ? `after ${nextSlot.at}` : "after midnight: the whole day"}.`
                  : "The whole day, filed after midnight."
                : `Today has no edition yet. Yesterday's whole day plays until it does.`
              : (why && STORY_WHY(why)) || (mine === "loading" ? "Finding Skippy's reading…" : "Skippy reads the day so far about every five hours, and the whole day after midnight.")}
          </p>
        </div>
      </div>
      {ready && <audio ref={audio} preload="none" src={ready.audio} onPause={() => !silent && setOn(false)} onEnded={() => setOn(false)} onError={() => setSilent(true)} />}
      {ready?.stale && isToday && (
        <div className="ax-ed-make">
          <p className="wv-note">Read in an older voice. Make it now remakes it once in Skippy's.</p>
          {makeControls}
        </div>
      )}
      {!ready && why === "not-yet" && <div className="ax-ed-make">{makeControls}</div>}
      {noteLine}
      {silent && <p className="wv-note ax-ed-make">The recording wouldn't play here, so the lines are reading along quietly.</p>}

      {lines.length > 0 && (
        <button className="ax-more ax-ed-open" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close the read-along" : `Read along, ${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
          <Chevron />
        </button>
      )}
      {open && (
        <div className="ax-read">
          <div ref={box} className={`wv-lines ax-lines${started ? " is-playing" : ""}`} aria-live="off">
            {lines.map((l, i) => (
              <p key={i} data-room={l.room} className={i === idx ? "is-now" : i < idx ? "is-past" : undefined}>
                {l.text}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export const shortDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12));
  return {
    wd: dt.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" }),
    long: dt.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long" }),
    d: String(d),
    month: dt.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long" }),
  };
};

/** A day's hours, from its page and the feed's recent hours, one per step, oldest first. */
export function hoursOf(day: string, page: DayPage | "loading" | "failed" | undefined, recent: HistoryEntry[]): HistoryEntry[] {
  const byStep = new Map<number, HistoryEntry>();
  const fromPage = page && page !== "loading" && page !== "failed" ? page.entries : [];
  for (const e of [...fromPage, ...recent.filter((x) => x.day === day)]) byStep.set(e.step, e);
  return [...byStep.values()].sort((x, y) => x.step - y.step);
}

export const roomsOf = (entries: HistoryEntry[]) => {
  const rooms: Record<string, number> = {};
  for (const e of entries) for (const s of e.scenes) rooms[s.room] = (rooms[s.room] ?? 0) + 1;
  return rooms;
};
const shipsOf = (entries: HistoryEntry[]) => entries.reduce((n, e) => n + e.remarks.length, 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The week, told by the cast (#211): their Sunday story as a pull quote across the page, its reading behind a play
 * ring and its transcript a click away. Until Sunday it says when it comes.
 */
export function WeekTold({ weeks, monday, written }: { weeks: string[]; monday: string; written: boolean }) {
  const all = useWeekStory((s) => s.weeks);
  const key = weeks.join(",");
  useEffect(() => {
    for (const w of key.split(",")) void useWeekStory.getState().loadWeek(w);
  }, [key]);
  const told = weeks.map((w) => all[w]).find((s) => s && s !== "loading" && s !== "failed" && s.ready);
  const story = told && told !== "loading" && told !== "failed" && told.ready ? told : null;
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const [t, setT] = useState(0);
  const [read, setRead] = useState(false);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (on) a.pause();
    else void a.play().then(() => setOn(true), () => setOn(false));
  };
  const quote = story ? sentences(story.script).slice(0, 2).join(" ") : null;
  const lastWeek = Boolean(story && story.week !== monday);
  return (
    <section className="ax-told" aria-label="The week, told by the cast">
      {story?.audio && <audio ref={audio} preload="none" src={story.audio} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onPause={() => setOn(false)} onEnded={() => setOn(false)} />}
      {quote ? (
        <figure className="ax-quote">
          <blockquote>
            <Kin text={quote} />
          </blockquote>
          <figcaption>
            {story?.audio && <PlayRing on={on} pr={story.durationSec ? Math.min(1, t / story.durationSec) : 0} onClick={toggle} label={on ? "Pause the week" : "Play the week in Ilyr"} />}
            <span>
              <b>{lastWeek ? "Last week, told by the cast" : "The week, told by the cast"}</b>
              <small>Sunday evening{story?.audio ? ` · ${formatDuration(story.durationSec)}` : " · not read aloud"}</small>
            </span>
            {story && (
              <button className="ax-more" type="button" aria-expanded={read} onClick={() => setRead(!read)}>
                {read ? "Close the week's story" : "Read the whole week"}
                <Chevron />
              </button>
            )}
          </figcaption>
        </figure>
      ) : (
        <p className="ax-told-wait">{written ? "The cast tells the week on Sunday evening. Until then, the ink gathers." : "Nothing written this week yet. The cast tells the week on Sunday evening."}</p>
      )}
      {story && read && (
        <div className="ax-week-read">
          {paragraphs(story.script).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
    </section>
  );
}

const face = (id: string) => (PORTRAITS[id] ? `/desk/agent-${id}.webp` : null);
const nameOf = (id: string) => PORTRAITS[id]?.name ?? id;

/** The bonds the shown day moved, newest last change per pair: two faces joined by a thread. */
export function Bonds({ entries, today, children }: { entries: HistoryEntry[]; today: boolean; children?: React.ReactNode }) {
  const byPair = new Map<string, HistoryEntry["changes"][number]>();
  for (const e of entries) for (const c of e.changes) byPair.set([c.a, c.b].sort().join("|"), c);
  const list = [...byPair.values()].reverse().slice(0, 4);
  return (
    <section className="ax-bonds" aria-label="Bonds that moved">
      <p className="ax-k">Bonds that moved</p>
      <h2 className="ax-h3">
        {WORDS[list.length] ?? list.length}, {today ? "today" : "that day"}
      </h2>
      {list.length ? (
        <ul className="ax-bond-l">
          {list.map((c, i) => (
            <li key={`${c.a}|${c.b}`} className="ax-bond" data-room={PORTRAITS[c.a]?.room ?? "archive"} style={{ "--i": i } as React.CSSProperties}>
              <span className="ax-pair">
                {[c.a, c.b].map((id) => {
                  const src = face(id);
                  return src ? <img key={id} src={src} alt="" width={44} height={44} decoding="async" /> : <i key={id} className="ax-pair-x" />;
                })}
              </span>
              <div>
                <b>
                  {nameOf(c.a)} and {nameOf(c.b)}
                </b>
                <span>
                  {c.was && c.was !== c.kind ? (
                    <>
                      {KIND_WORD[c.was] ?? c.was} <Arrow /> <em>{KIND_WORD[c.kind] ?? c.kind}</em>
                    </>
                  ) : (
                    <em>{KIND_WORD[c.kind] ?? c.kind}</em>
                  )}
                </span>
                {c.note && <p>{c.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wv-note">No one's bonds moved {today ? "today, yet" : "that day"}. Give them an hour or two.</p>
      )}
      {children}
    </section>
  );
}

/**
 * Past days in the case: each day a drawer with its date, its line and its tally, the rooms it visited as a strip of
 * their colours. Pull one out to read its recap, then open the whole day.
 */
export function Shelf({ days, pages, recent, onOpen }: { days: string[]; pages: Record<string, DayPage | "loading" | "failed">; recent: HistoryEntry[]; onOpen: (day: string) => void }) {
  const [out, setOut] = useState<string | null>(null);
  if (!days.length) {
    return (
      <section className="ax-shelf" aria-label="Past days">
        <p className="ax-k">Past days</p>
        <h2 className="ax-h3">In the case</h2>
        <p className="wv-note">The case fills one drawer a day, from the first full day the world writes.</p>
      </section>
    );
  }
  const drawers = days.map((d) => {
    const page = pages[d];
    const hrs = hoursOf(d, page, recent);
    const recap = page && page !== "loading" && page !== "failed" ? page.recap : null;
    const rooms = Object.entries(roomsOf(hrs)).sort((a, b) => b[1] - a[1]);
    const total = rooms.reduce((n, [, k]) => n + k, 0) || 1;
    const ships = shipsOf(hrs);
    const s = shortDay(d);
    return {
      d,
      s,
      title: clauseOf(recap, 8) ?? clauseOf(hrs[hrs.length - 1]?.summary, 8) ?? (page === "loading" ? "Fetching the day" : `${s.long}, ${s.month}`),
      foot: [ships ? plural(ships, "ship") : null, hrs.length ? plural(hrs.length, "hour") : "No hours"].filter(Boolean).join(" · "),
      text: recap ?? hrs[hrs.length - 1]?.summary ?? (page === "loading" ? "Turning the pages…" : "Nothing was written down on this day."),
      rooms: rooms.map(([r, k]) => ({ r, w: k / total })),
    };
  });
  return (
    <section className="ax-shelf" aria-label="Past days">
      <p className="ax-k">Past days</p>
      <h2 className="ax-h3">In the case</h2>
      <ol className="ax-case">
        {drawers.map((x, i) => {
          const isOut = out === x.d;
          return (
            <li key={x.d} className={isOut ? "is-out" : undefined} style={{ "--i": i } as React.CSSProperties}>
              <button type="button" aria-expanded={isOut} onClick={() => setOut(isOut ? null : x.d)}>
                <span className="ax-case-d">
                  <b>{x.s.d}</b>
                  <small>{x.s.wd}</small>
                </span>
                <span className="ax-case-t">
                  <b>{x.title}</b>
                  <small>{x.foot}</small>
                </span>
                <span className="ax-case-r" aria-hidden="true">
                  {x.rooms.map(({ r, w }) => (
                    <i key={r} data-room={r} style={{ flexGrow: w }} />
                  ))}
                </span>
                <Chevron />
              </button>
              {isOut && (
                <div className="ax-case-x">
                  <p>{x.text}</p>
                  <button className="ax-link" type="button" onClick={() => onOpen(x.d)}>
                    Open {x.s.long} {x.s.month}
                    <Arrow />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
