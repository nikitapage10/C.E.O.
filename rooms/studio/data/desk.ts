import type { Approval, Carousel, Episode, Idea, Note, NoteState, Social, Stage, StageState, Status, Version, YoutubePost } from "../../../api/_studio/desk.ts";
import type { Step } from "../web/line.ts";

/**
 * The Studio desk's data on the page (#1227): what GET /api/studio-desk answers a passkey session, the four stages an
 * episode goes through (Nikita's stage gates, 2026-11-25), and the one thing the room mic needs to know, which episode
 * and stage is on screen, so a note said with Space held lands on it. Pure but for the two fetches.
 */

export type { Carousel, Episode, Idea, Note, NoteState, Social, Stage, StageState, Status, Version, YoutubePost };

export interface DeskView {
  ideas: Idea[];
  episodes: Episode[];
  notes: Note[];
  approvals: Approval[];
  /** Each episode's trip to YouTube (#1261); absent from an older server. */
  youtube?: YoutubePost[];
  /** Image carousels between chapters (#1265); absent from an older server. */
  carousels?: Carousel[];
  social: Social | null;
}

export type DeskLoad = { state: "ready"; view: DeskView } | { state: "out" } | { state: "down" };

/** The four gates, in order: what each is and what Nikita does there. */
export const STAGE_LINE: readonly { id: Stage; t: string; s: string; you: string }[] = [
  { id: "pitch", t: "Pitch and script", s: "The lesson, how it ties to the end of the world, and the script Skippy reads.", you: "Read it, then approve or ask for changes." },
  { id: "mix", t: "Voice and mix", s: "Skippy's read, the music under it and the effects, mixed so the voice always wins. Scrub the waveform.", you: "Listen, then approve or ask for changes." },
  { id: "render", t: "Render", s: "The tall 9:16 cut with captions burned in. Drag along the thumbnails to find a moment.", you: "Watch it while the Director runs its own review, then approve." },
  { id: "post", t: "Post", s: "The cover, the caption and the draft for Instagram and TikTok. Publish sends it a minute out.", you: "Tap Publish when it's ready." },
];

export const STATUS_TEXT: Record<Status, string> = {
  waiting: "Waiting",
  working: "In the works",
  ready: "Ready for you",
  changes: "Changes asked",
  approved: "Approved",
  done: "Done",
};

const DONE: readonly Status[] = ["approved", "done"];
export const isDone = (s?: StageState) => !!s && DONE.includes(s.status);

/** The stage an episode is on: the first one not approved yet (the last when all are). */
export function stageOn(ep: Episode): number {
  // The newest work first: the furthest stage that's in the works or waiting on him, so an episode whose mix was never
  // approved but already has a render opens on the render, not on the mix's still picture (Nikita, 2026-11-25).
  for (let i = STAGE_LINE.length - 1; i >= 0; i--) {
    const st = ep.stages[STAGE_LINE[i]!.id]?.status;
    if (st === "ready" || st === "working" || st === "changes") return i;
  }
  const i = STAGE_LINE.findIndex((s) => !isDone(ep.stages[s.id]));
  return i < 0 ? STAGE_LINE.length - 1 : i;
}

/** Whether it's an ad rather than an episode: ads sit in their own folder on the desk (Nikita, 2026-11-26). */
export const isAd = (ep: Episode) => ep.id.startsWith("ad-") || /^ad\b/i.test(ep.title);

/** Whether the episode is out: its post stage approved or done. */
export const isPosted = (ep: Episode) => isDone(ep.stages.post);

/** The episode the desk opens on: the newest one still on the line, else the newest. */
export function openOn(episodes: readonly Episode[]): number {
  if (episodes.length === 0) return -1;
  // An episode first; the ads only when no episode is still on the line.
  for (let i = episodes.length - 1; i >= 0; i--) if (!isPosted(episodes[i]!) && !isAd(episodes[i]!)) return i;
  for (let i = episodes.length - 1; i >= 0; i--) if (!isPosted(episodes[i]!)) return i;
  return episodes.length - 1;
}

/** The episode's stages as the stage's monitors draw them (soundstage.ts). */
export function stepsOf(ep: Episode | undefined): Step[] {
  return STAGE_LINE.map((s, i) => ({ k: String(i + 1).padStart(2, "0"), t: s.t, s: s.s, w: ep ? STATUS_TEXT[ep.stages[s.id]?.status ?? "waiting"] : "No episode yet" }));
}

/** Whether something said is a question for the Director (it answers) rather than a note (it's kept). */
export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.endsWith("?") || /^(what|why|how|when|where|who|which|is|are|was|were|can|could|do|does|did|will|would|should|have|has)\b/.test(t);
}

/* ── What's on screen, for the room mic ── */

let focus: { episode?: string; stage?: Stage; at?: () => { version?: number; t?: number } } = {};
const heard = new Set<() => void>();
/** What's on screen; `at` gives the version and moment under the playhead, so a said note lands on it (#1229). */
export const setFocus = (f: typeof focus) => void (focus = f);
export const focusNow = () => focus;
/** The page reloads the desk when a note is kept from the mic. */
export function onNoteKept(fn: () => void): () => void {
  heard.add(fn);
  return () => void heard.delete(fn);
}

/* ── The fetches ── */

export async function loadDesk(): Promise<DeskLoad> {
  try {
    const res = await fetch("/api/studio-desk", { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    if (res.status === 401 || res.status === 403) return { state: "out" };
    if (!res.ok) return { state: "down" };
    return { state: "ready", view: (await res.json()) as DeskView };
  } catch {
    return { state: "down" };
  }
}

export type DeskAction =
  | { action: "pitch"; text: string }
  | { action: "note"; text: string; episode?: string; stage?: Stage; via?: "said" | "typed"; version?: number; t?: number; t2?: number }
  | { action: "unnote"; id: string }
  | { action: "send"; episode?: string; stage?: Stage; hold?: boolean }
  | { action: "title"; episode: string; title: string }
  | { action: "approve"; episode: string; stage: Stage }
  | { action: "publish"; episode: string }
  | { action: "youtube"; episode: string }
  | { action: "carousel-publish"; id: string };

const ERRORS: Record<string, string> = {
  "not-ready": "That isn't ready yet.",
  "not-set-up": "Zernio isn't set up on the server yet.",
  "not-ours": "That draft wasn't made by the Studio, so it won't publish it.",
  "not-a-draft": "That post already went out.",
  "no-drafts": "There are no draft notes to send.",
  "youtube-not-set-up": "YouTube isn't connected yet. Connect it in Boiler Room > Controls > Connections.",
  "carousel-already": "That carousel is already scheduled.",
  "bad-time": "That slot is too far out to schedule.",
  "youtube-already": "That episode is already on YouTube, or going up now.",
};

/** The episode's latest trip to YouTube, or undefined. */
export function youtubeOf(view: Pick<DeskView, "youtube">, episode: string): YoutubePost | undefined {
  return [...(view.youtube ?? [])].reverse().find((y) => y.episode === episode);
}

/** A line on where the episode stands on YouTube, or "" before it goes. */
export function youtubeLine(y: YoutubePost | undefined): string {
  if (!y) return "";
  if (y.state === "uploading") return "Going up to YouTube…";
  if (y.state === "failed") return y.error === "refused" || y.error === "not-connected" ? "YouTube upload failed: reconnect YouTube in Boiler Room > Controls." : y.error === "quota" ? "YouTube's daily upload quota ran out. Try again tomorrow." : `The YouTube upload failed${y.detail ? ` (${y.detail})` : ""}. Try again.`;
  if (y.channel) return "On YouTube, but on a different channel than the show's. Check it in YouTube Studio.";
  return y.privacy === "public" ? "Live on YouTube Shorts." : "On YouTube as private: Google keeps uploads private until the API audit passes.";
}

/** When a time falls, in Mountain Time (the schedule's clock): "Fri 8:00 PM". */
export function slotText(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString("en-US", { timeZone: "America/Denver", weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** One desk action; null when it was kept, else a line saying why not. */
export async function act(body: DeskAction): Promise<string | null> {
  try {
    const res = await fetch("/api/studio-desk", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) });
    if (res.ok) {
      if (body.action === "note" && body.via === "said") heard.forEach((fn) => fn());
      if (body.action === "unnote" || body.action === "send") heard.forEach((fn) => fn());
      return null;
    }
    if (res.status === 401) return "Sign in again to do that.";
    const got = (await res.json().catch(() => ({}))) as { error?: unknown };
    return (typeof got.error === "string" && ERRORS[got.error]) || "The desk didn't take that. Try again in a moment.";
  } catch {
    return "The desk is out of reach right now.";
  }
}

/** A count for the page: 8,122 → "8.1K". */
export function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** The versions a stage has: its list, or its one cut as v1 when the thread sent no list. */
export function versionsOf(st?: StageState): Version[] {
  if (st?.versions?.length) return st.versions;
  return st?.media ? [{ v: 1, media: st.media }] : [];
}

/** 93.4 → "1:33". */
export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const NOTE_STATE_TEXT: Record<NoteState, string> = { draft: "Draft", held: "Held for the next version", sent: "Sent", fixed: "Fixed", open: "Still open", wontfix: "Won't fix" };
