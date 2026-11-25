import type { Approval, Episode, Idea, Note, Social, Stage, StageState, Status } from "../../../api/_studio/desk.ts";
import type { Step } from "../web/line.ts";

/**
 * The Studio desk's data on the page (#1227): what GET /api/studio-desk answers a passkey session, the four stages an
 * episode goes through (Nikita's stage gates, 2026-11-25), and the one thing the room mic needs to know, which episode
 * and stage is on screen, so a note said with Space held lands on it. Pure but for the two fetches.
 */

export type { Episode, Idea, Note, Social, Stage, StageState, Status };

export interface DeskView {
  ideas: Idea[];
  episodes: Episode[];
  notes: Note[];
  approvals: Approval[];
  social: Social | null;
}

export type DeskLoad = { state: "ready"; view: DeskView } | { state: "out" } | { state: "down" };

/** The four gates, in order: what each is and what Nikita does there. */
export const STAGE_LINE: readonly { id: Stage; t: string; s: string; you: string }[] = [
  { id: "pitch", t: "Pitch", s: "The lesson, how it ties to the end of the world, and where the hero and his horde are in the story.", you: "Read it, then approve or ask for changes." },
  { id: "mix", t: "Script, voice and mix", s: "The script, Skippy's read, the music under it and the effects, mixed so the voice always wins.", you: "Listen, then approve or ask for changes." },
  { id: "render", t: "Render", s: "The tall 9:16 cut with captions burned in, stills to skim, and caption options.", you: "Watch it while the Director runs its own review, then approve." },
  { id: "post", t: "Post", s: "A Zernio draft for Instagram and TikTok. Publish sends it a minute out.", you: "Tap Publish when it's ready." },
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
  const i = STAGE_LINE.findIndex((s) => !isDone(ep.stages[s.id]));
  return i < 0 ? STAGE_LINE.length - 1 : i;
}

/** Whether the episode is out: its post stage approved or done. */
export const isPosted = (ep: Episode) => isDone(ep.stages.post);

/** The episode the desk opens on: the newest one still on the line, else the newest. */
export function openOn(episodes: readonly Episode[]): number {
  if (episodes.length === 0) return -1;
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

let focus: { episode?: string; stage?: Stage } = {};
const heard = new Set<() => void>();
export const setFocus = (f: { episode?: string; stage?: Stage }) => void (focus = f);
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
  | { action: "note"; text: string; episode?: string; stage?: Stage; via?: "said" | "typed" }
  | { action: "approve"; episode: string; stage: Stage }
  | { action: "publish"; episode: string };

const ERRORS: Record<string, string> = {
  "not-ready": "That isn't ready yet.",
  "not-set-up": "Zernio isn't set up on the server yet.",
  "not-ours": "That draft wasn't made by the Studio, so it won't publish it.",
  "not-a-draft": "That post already went out.",
};

/** One desk action; null when it was kept, else a line saying why not. */
export async function act(body: DeskAction): Promise<string | null> {
  try {
    const res = await fetch("/api/studio-desk", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) });
    if (res.ok) {
      if (body.action === "note" && body.via === "said") heard.forEach((fn) => fn());
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
