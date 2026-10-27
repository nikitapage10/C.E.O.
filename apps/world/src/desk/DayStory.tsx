import { useEffect, useRef, useState } from "react";
import { chronicleDay, formatDuration, useDayStory, type StoryState } from "../chronicle.ts";
import { DeskSignIn } from "./SignIn.tsx";
import { ensureSignedIn, useDeskAuth } from "./signin.ts";
import { SKIPPY_PORTRAIT } from "./skippy/SkippyAvatar.tsx";

/**
 * The day's story (issue #95, livelier in #102, a normal voice in #107; docs/WORLD.md): the quick "today in Ilyr"
 * update, read aloud, presented by Skippy, the Magnificent since #365 and made in editions: a fresh "so far" about
 * every five hours, then the final one after midnight. It plays the latest edition and says when it was made, and
 * looks again every few minutes while it isn't playing, so a new edition shows up by itself. A plain <audio controls>
 * (served from our own origin, api/day-story.ts) and the script as a transcript. When there is no audio it says why,
 * plainly: ElevenLabs, the only voice (#472), isn't connected, is past its cap or didn't answer, so the audio waits on
 * it (the transcript still shows), or it isn't made yet. For today and yesterday, "Make it now"
 * asks for one in the Desk's sign-in session (#132; once per edition, it doesn't spend twice), and remakes a story read
 * in an older style once in the current voice.
 */

const WHY: Record<string, string> = {
  "no-key": "Audio waiting on ElevenLabs: it isn't connected (elevenlabs in the Key Vault), so Skippy can't read the day aloud yet.",
  "over-budget": "Audio waiting on ElevenLabs: this month's ElevenLabs cap is spent. Skippy reads again when the month turns.",
  "not-yet": "Skippy reads the day so far about every five hours, and the whole day once its recap is filed, after midnight.",
  "no-recap": "The day's recap isn't filed yet.",
  "no-news": "Nothing new in the Chronicle since the last edition. Skippy will read again when there is.",
  empty: "Nothing was recorded on this day to read.",
  busy: "Skippy is already on this one. Give him a minute.",
  "speech-failed": "Audio waiting on ElevenLabs: it didn't answer with audio. Skippy tries again at the next edition, or Make it now.",
  exists: "This edition is already made.",
};

/** How often an open player looks for a newer edition. */
const REFRESH_MS = 5 * 60_000;

/** "3:05 pm": when an edition was made, in the viewer's own time. */
export function madeAt(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

/** The transcript in short paragraphs (the script is stored as one line): three sentences each. */
export function paragraphs(script: string): string[] {
  const sentences = script.match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g) ?? [script];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) out.push(sentences.slice(i, i + 3).join("").trim());
  return out.filter(Boolean);
}

/** "Make it now" for a day's story (today or yesterday): the button, the sign-in step when needed, and the note after. */
export const STORY_WHY = (reason: string): string | undefined => WHY[reason];

export function useStoryMaker(day: string): { makeControls: React.ReactNode; noteLine: React.ReactNode } {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const make = async () => {
    setBusy(true);
    // Signed in already, or one passkey tap now; otherwise the sign-in step shows here.
    if ((await ensureSignedIn()) !== "ok") {
      setBusy(false);
      setAsking(true);
      return;
    }
    setNote("Skippy is recording. Under a minute…");
    const r = await useDayStory.getState().makeStory(day);
    setBusy(false);
    if (r.error === "signed-out") {
      useDeskAuth.getState().lost();
      setNote(null);
      setAsking(true);
      return;
    }
    setAsking(false);
    setNote(r.made ? null : r.error ? (r.error === "not-set-up" ? "The story isn't set up on the server yet." : "Couldn't make it right now; try again shortly.") : (WHY[r.reason ?? ""] ?? null));
  };
  const makeControls = (
    <div className="story__make">
      {asking ? (
        <DeskSignIn compact onDone={() => void make()} onCancel={() => setAsking(false)} />
      ) : (
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void make()}>
          {busy ? "Recording…" : "Make it now"}
        </button>
      )}
    </div>
  );
  const noteLine = note && (
    <p className="quiet story__note" role="status">
      {note}
    </p>
  );
  return { makeControls, noteLine };
}

export function DayStory({ day, canMake, compact = false, label = "Hear the day in Ilyr" }: { day: string; canMake: boolean; compact?: boolean; label?: string }) {
  const state = useDayStory((s) => s.stories[day]);
  const { makeControls, noteLine } = useStoryMaker(day);
  const player = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    void useDayStory.getState().loadStory(day);
    // A newer edition may come out while the Desk is open (#365): look again now and then, never mid-play.
    const timer = window.setInterval(() => {
      if (player.current && !player.current.paused) return;
      void useDayStory.getState().loadStory(day, true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [day]);

  if (state === "loading") {
    return compact ? null : <p className="quiet story__note">Finding Skippy&apos;s reading…</p>;
  }
  if (!state || state === "off") return null;
  if (state === "failed") {
    return compact ? null : <p className="quiet story__note">Can&apos;t reach the day&apos;s story right now.</p>;
  }

  if (!state.ready) {
    if (compact) return null;
    const offerMake = canMake && state.reason === "not-yet";
    return (
      <div className="story story--none">
        <p className="quiet story__note">{WHY[state.reason]}</p>
        {offerMake && makeControls}
        {noteLine}
      </div>
    );
  }

  const made = madeAt(state.at);
  const title = `${label} · ${formatDuration(state.durationSec)}`;
  return (
    <div className={`story${compact ? " story--compact" : ""}`}>
      <div className="story__head">
        {!compact && (
          <span className="avatar avatar--sm" title="Skippy, the Magnificent">
            <img src={SKIPPY_PORTRAIT} alt="" loading="lazy" decoding="async" />
          </span>
        )}
        <span className="story__title">
          <b>{label}</b>
          <small>
            {state.audio ? formatDuration(state.durationSec) : "audio waiting on ElevenLabs"}
            {state.partial ? " · the day so far" : " · the whole day"}
            {made ? ` · made ${made}` : ""} · presented by Skippy, the Magnificent
          </small>
        </span>
      </div>
      {state.audio ? (
        <audio ref={player} className="story__audio" controls preload="none" src={state.audio} aria-label={title} />
      ) : (
        <p className="quiet story__note" role="status">
          {WHY[state.waiting ?? "speech-failed"]}
        </p>
      )}
      {!compact && (
        <details className="story__script">
          <summary>Transcript</summary>
          {paragraphs(state.script).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </details>
      )}
      {!compact && state.partial && <p className="quiet story__note">The day so far. A fresh edition comes about every five hours, and the whole day's story replaces it after midnight.</p>}
      {!compact && canMake && !state.audio && state.waiting === "speech-failed" && makeControls}
      {!compact && canMake && state.stale && state.audio && (
        <>
          <p className="quiet story__note">Read in an older voice, before Skippy took the microphone. Make it now remakes it once in his.</p>
          {makeControls}
        </>
      )}
      {!compact && noteLine}
    </div>
  );
}

type ReadyStory = Extract<StoryState, { ready: true }>;
const isReady = (s: StoryState | undefined): s is ReadyStory => typeof s === "object" && s.ready;

/**
 * The day's broadcast on Today's bridge (#385): "Today in Ilyr" as a transmission from the planet, Skippy presenting.
 * One round button plays the latest edition, a ring of light filling as it plays and the waves moving while it does;
 * the transcript folds out under it. Before today's first edition is out (just after midnight, say) it plays
 * yesterday's whole day instead, and says so; with no edition at all it says why, plainly, and when the next one is
 * due (`next`). Looks again every few minutes while it isn't playing, so a new edition comes in by itself.
 */
export function TodayBroadcast({ now, next }: { now: number; next: string | null }) {
  const today = chronicleDay(now);
  const yesterday = chronicleDay(now - 86_400_000);
  const mine = useDayStory((s) => s.stories[today]);
  const prev = useDayStory((s) => s.stories[yesterday]);
  const player = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [f, setF] = useState(0);

  useEffect(() => {
    void useDayStory.getState().loadStory(today);
    void useDayStory.getState().loadStory(yesterday);
    const timer = window.setInterval(() => {
      if (player.current && !player.current.paused) return;
      void useDayStory.getState().loadStory(today, true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [today, yesterday]);

  const story = isReady(mine) ? mine : isReady(prev) ? prev : null;
  const isToday = story === mine;
  const toggle = () => {
    const a = player.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  };

  if (!story) {
    const why =
      mine === "loading" || mine === undefined
        ? "Tuning in to Ilyr…"
        : mine === "failed"
          ? "Can't reach Skippy's broadcast right now."
          : mine === "off"
            ? "The broadcast isn't connected on this copy of the Desk."
            : typeof mine === "object" && !mine.ready
              ? (WHY[mine.reason] ?? "No edition yet today.")
              : "No edition yet today.";
    return (
      <div className="td-cast is-none">
        <span className="td-cast-btn is-off" aria-hidden="true">
          <CastWaves />
        </span>
        <p className="td-cast-t">
          <b>Today in Ilyr</b>
          <span>{why}</span>
          {next && mine !== "off" && <small>Next edition {next}</small>}
        </p>
      </div>
    );
  }

  const made = madeAt(story.at);
  const label = isToday ? "Today in Ilyr" : "Yesterday in Ilyr";
  if (!story.audio) {
    // The script is here, its audio waiting on ElevenLabs (#472): say so plainly, and show the transcript.
    return (
      <div className="td-cast is-none">
        <span className="td-cast-btn is-off" aria-hidden="true">
          <CastWaves />
        </span>
        <div className="td-cast-t">
          <b>{label}</b>
          <span>{WHY[story.waiting ?? "speech-failed"]}</span>
          <details className="td-cast-script">
            <summary>Read the transcript</summary>
            {paragraphs(story.script).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </details>
        </div>
      </div>
    );
  }
  return (
    <div className={`td-cast${playing ? " is-playing" : ""}`}>
      <button type="button" className="td-cast-btn" onClick={toggle} aria-label={`${playing ? "Pause" : "Play"} ${label}, ${formatDuration(story.durationSec)}`} style={{ "--f": f.toFixed(4) } as React.CSSProperties}>
        <svg className="td-cast-ring" viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="28" r="26" pathLength={1} />
          <circle className="is-f" cx="28" cy="28" r="26" pathLength={1} />
        </svg>
        <svg className="td-cast-ic" viewBox="0 0 20 20" aria-hidden="true">
          {playing ? <path d="M7 5v10M13 5v10" /> : <path d="M7.5 5.2v9.6L15 10z" />}
        </svg>
      </button>
      <div className="td-cast-t">
        <b>{label}</b>
        <span>
          {formatDuration(story.durationSec)} · {story.partial ? "the day so far" : "the whole day"}
          {made ? `, made ${made}` : ""} · presented by Skippy
        </span>
        {next && isToday && story.partial && <small>Next edition {next}</small>}
        <details className="td-cast-script">
          <summary>Read the transcript</summary>
          {paragraphs(story.script).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </details>
      </div>
      <CastWaves />
      <audio
        ref={player}
        src={story.audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setF(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setF(a.duration ? a.currentTime / a.duration : 0);
        }}
      />
    </div>
  );
}

/** The broadcast's waves: still lines, moving only while it plays. */
function CastWaves() {
  return (
    <span className="td-cast-w" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <i key={i} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </span>
  );
}
