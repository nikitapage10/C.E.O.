import { useEffect, useRef, useState } from "react";
import { formatDuration, useDayStory } from "../chronicle.ts";
import { DeskSignIn } from "./SignIn.tsx";
import { ensureSignedIn, useDeskAuth } from "./signin.ts";
import { SKIPPY_PORTRAIT } from "./skippy/SkippyAvatar.tsx";

/**
 * The day's story (issue #95, livelier in #102, a normal voice in #107; docs/WORLD.md): the quick "today in Ilyr"
 * update, read aloud, presented by Skippy, the Magnificent since #365 and made in editions: a fresh "so far" about
 * every five hours, then the final one after midnight. It plays the latest edition and says when it was made, and
 * looks again every few minutes while it isn't playing, so a new edition shows up by itself. A plain <audio controls>
 * (served from our own origin, api/day-story.ts) and the script as a transcript. When there is no audio it says why,
 * plainly: no voice key, the month's speech budgets spent, or not made yet. For today and yesterday, "Make it now"
 * asks for one in the Desk's sign-in session (#132; once per edition, it doesn't spend twice), and remakes a story read
 * in an older style once in the current voice.
 */

const WHY: Record<string, string> = {
  "no-key": "No audio: no voice is connected (elevenlabs or gemini-api-key in the Key Vault), so Skippy can't read the day aloud.",
  "over-budget": "No audio this month: the speech budgets are spent. Skippy reads again when the month turns.",
  "not-yet": "Skippy reads the day so far about every five hours, and the whole day once its recap is filed, after midnight.",
  "no-recap": "The day's recap isn't filed yet.",
  "no-news": "Nothing new in the Chronicle since the last edition. Skippy will read again when there is.",
  empty: "Nothing was recorded on this day to read.",
  busy: "Skippy is already on this one. Give him a minute.",
  "speech-failed": "Neither voice answered with audio. Nothing was saved; try again later.",
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
            {formatDuration(state.durationSec)}
            {state.partial ? " · the day so far" : " · the whole day"}
            {made ? ` · made ${made}` : ""} · presented by Skippy, the Magnificent
          </small>
        </span>
      </div>
      <audio ref={player} className="story__audio" controls preload="none" src={state.audio} aria-label={title} />
      {!compact && (
        <details className="story__script">
          <summary>Transcript</summary>
          {paragraphs(state.script).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </details>
      )}
      {!compact && state.partial && <p className="quiet story__note">The day so far. A fresh edition comes about every five hours, and the whole day's story replaces it after midnight.</p>}
      {!compact && canMake && state.stale && (
        <>
          <p className="quiet story__note">Read in an older voice, before Skippy took the microphone. Make it now remakes it once in his.</p>
          {makeControls}
        </>
      )}
      {!compact && noteLine}
    </div>
  );
}
