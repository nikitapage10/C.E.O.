import { useEffect, useState } from "react";
import { formatDuration, useDayStory } from "../chronicle.ts";
import { Avatar } from "./ui.tsx";

/**
 * The day's story (issue #95, livelier in #102; docs/WORLD.md): the Historian's quick "today in Ilyr" update, read
 * aloud. A plain <audio controls> (served from our own origin, api/day-story.ts) and the script as a transcript. When
 * there is no audio it says why, plainly: no Gemini key, the month's speech budget spent, or not made yet. For today
 * and yesterday, "Make it now" asks for one with the Desk key (once per day; it doesn't spend twice), and remakes a
 * story read in the old, slow style once in the new voice.
 */

const KEY = "ceo.deskKey";
const readKey = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};
const keepKey = (key: string) => {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    /* private window: the key lasts for this visit only */
  }
};

const WHY: Record<string, string> = {
  "no-key": "No audio: Gemini's speech isn't connected (GEMINI_API_KEY in Vercel), so the Historian can't read the day aloud.",
  "over-budget": "No audio this month: Gemini's speech budget is spent. The Historian reads again when the month turns.",
  "not-yet": "The Historian reads the day's update once its recap is filed, after midnight.",
  "no-recap": "The day's recap isn't filed yet.",
  empty: "Nothing was recorded on this day to read.",
  busy: "The Historian is already on this one. Give it a minute.",
  "speech-failed": "Gemini didn't answer with audio. Nothing was saved; try again later.",
  exists: "This day's story is already made.",
};

/** The transcript in short paragraphs (the script is stored as one line): three sentences each. */
export function paragraphs(script: string): string[] {
  const sentences = script.match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g) ?? [script];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) out.push(sentences.slice(i, i + 3).join("").trim());
  return out.filter(Boolean);
}

export function DayStory({ day, canMake, compact = false, label = "Hear the day in Ilyr" }: { day: string; canMake: boolean; compact?: boolean; label?: string }) {
  const state = useDayStory((s) => s.stories[day]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState("");

  useEffect(() => {
    void useDayStory.getState().loadStory(day);
  }, [day]);

  if (state === "loading") {
    return compact ? null : <p className="quiet story__note">Finding the Historian&apos;s reading…</p>;
  }
  if (!state || state === "off") return null;
  if (state === "failed") {
    return compact ? null : <p className="quiet story__note">Can&apos;t reach the day&apos;s story right now.</p>;
  }

  const make = async () => {
    const k = key || readKey();
    if (!k) {
      setAsking(true);
      return;
    }
    setBusy(true);
    setNote("The Historian is recording. Under a minute…");
    const r = await useDayStory.getState().makeStory(day, k);
    setBusy(false);
    if (r.error === "wrong-key") {
      setNote("That Desk key didn't match.");
      setAsking(true);
      return;
    }
    if (key) keepKey(key);
    setAsking(false);
    setNote(r.made ? null : r.error ? (r.error === "not-set-up" ? "The story isn't set up on the server yet." : "Couldn't make it right now; try again shortly.") : (WHY[r.reason ?? ""] ?? null));
  };

  const makeControls = (
    <div className="story__make">
      {asking && (
        <label className="story__key">
          <span>Desk key</span>
          <input type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void make()} />
        </label>
      )}
      <button type="button" className="btn btn--sm" disabled={busy || (asking && !key)} onClick={() => void make()}>
        {busy ? "Recording…" : "Make it now"}
      </button>
    </div>
  );
  const noteLine = note && (
    <p className="quiet story__note" role="status">
      {note}
    </p>
  );

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

  const title = `${label} · ${formatDuration(state.durationSec)}`;
  return (
    <div className={`story${compact ? " story--compact" : ""}`}>
      <div className="story__head">
        {!compact && <Avatar agent="The Historian" size="sm" room="archive" />}
        <span className="story__title">
          <b>{label}</b>
          <small>
            {formatDuration(state.durationSec)}
            {state.partial ? " · the day so far" : ""} · read by the Historian
          </small>
        </span>
      </div>
      <audio className="story__audio" controls preload="none" src={state.audio} aria-label={title} />
      {!compact && (
        <details className="story__script">
          <summary>Transcript</summary>
          {paragraphs(state.script).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </details>
      )}
      {!compact && state.partial && <p className="quiet story__note">Read before the recap was filed. The full day's story replaces it after midnight.</p>}
      {!compact && canMake && state.stale && (
        <>
          <p className="quiet story__note">Read in the old, slow voice. Make it now remakes it once, as a quick update in the new one.</p>
          {makeControls}
        </>
      )}
      {!compact && noteLine}
    </div>
  );
}
