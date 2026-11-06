import { create } from "zustand";
import { duckable } from "@ceo/engine/web/siteSound.ts";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { holdHint } from "../holdToTalk.ts";
import { askRoom, listen, micSupported, recall, remember, setOwnVoice, silentWav, type Listener, type RoomAnswer } from "../roomvoice/roomVoice.ts";
import { readMs, SUBMIND_TITLE } from "./rite.ts";
import { announceWrote, readWrote } from "../skippy/wrote.ts";
import { fetchFloor, type FloorTopic, type Joined } from "./liveTalk.ts";
import { fetchLine } from "./voice.ts";

/**
 * Nikita has the floor (#905). Nikita, 2026-11-05: "At any point while the skippies are talking in the Senate, I should be
 * able to hold space to engage them directly and then they can respond to me in turn."
 *
 * Holding Space in the Senate (holdToTalk.ts, the Senate's handler above the page's) holds the session where it is: the
 * speaker stops mid-line and the clock waits (rotundaScene.ts `hold`). His words show as the floor's caption.
 *
 * Since #926, on the release his words go to Skippy's one brain first, with the argument on the floor as the page
 * (liveTalk.ts `fetchFloor`, one call). Skippy judges them himself, with every room's tools (Nikita, 2026-11-06: hold
 * Space goes to Skippy, who works out from the context whether it's about this page, another room, or the debate; no
 * word lists): an ask or a question ("can you dispense one portion of dry food?") is his, done and answered as the chair
 * in his own voice. Only a remark on the debate goes on to the members:
 *
 * - With an argument on the floor (#925), his words join it (Nikita: "those two would be the ones to respond, and then
 *   maybe somebody else chimes in"): the members who were speaking answer him, perhaps one more, and the rest of the
 *   argument follows with his point in it. The chamber takes them at the next line's turn (rotundaScene.ts `join`): the
 *   line he cut into finishes, they answer him from where they stand while his line stays up as his, and the argument
 *   carries on to a new ruling.
 * - With none on (#910), one or two members answer him in kind, each in Skippy's voice bent its way.
 *
 * When nothing comes back (or the words are a clip, without the words in hand), the chair answers through Skippy's own
 * route (POST /api/skippy-room as Today). Then the session picks up the line it was on.
 *
 * Nothing is kept: the turns live in roomVoice.ts's memory for a follow-on, and are forgotten on reload.
 */

/** The chair hands the floor over, in a word. */
export const floorChair = (ids: readonly string[]): string => {
  if (ids.length === 1 && ids[0] === "kernel") return "The chair will take that one himself.";
  const names = ids.map((id) => (SUBMIND_TITLE[id] ?? id).replace(/^The /, "the "));
  return `The chair recognizes ${names.join(", then ")}.`;
};

/* ── The floor's state, for the chamber's caption ── */

export interface FloorTurn {
  by: string;
  say: string;
  failed: boolean;
}
export interface FloorState {
  /** "joined": his words are in the argument on the floor and the members are answering them in the chamber (#925). */
  phase: "idle" | "listening" | "asking" | "answering" | "joined";
  /** What Nikita said (or is saying). */
  question: string;
  /** The chair's word, who it goes to. */
  chair: string;
  /** The answer being heard now. */
  turn: FloorTurn | null;
}
export const useFloor = create<FloorState>(() => ({ phase: "idle", question: "", chair: "", turn: null }));
const set = (p: Partial<FloorState>) => useFloor.setState(p);

/** What the floor needs from the chamber. */
export interface FloorScene {
  hold: (on: boolean) => void;
  talk: (by: string, seconds: number) => void;
  /** The members seated now, by id. */
  seated: () => string[];
  /** Lights the member who has the floor (null: none). */
  light: (id: string | null) => void;
  /** The argument on the floor now (#910), if one is. */
  topic?: () => FloorTopic | null;
  /** His words joined to that argument (#925): resolves once the members have answered him; null when none is on. */
  join?: (said: string, j: Joined) => Promise<void> | null;
}

/** A beat between turns, and how long the last answer stays once it is said. */
const TURN_GAP_MS = 700;
const AFTER_MS = 1_600;

let listener: Listener | null = null;
let player: HTMLAudioElement | null = null;
let run = 0;
let scene: FloorScene | null = null;

const wait = (ms: number, n: number) => new Promise<boolean>((res) => setTimeout(() => res(run === n), ms));

function hush(): void {
  if (player && !player.paused) player.pause();
  player?.dispatchEvent(new Event("ended"));
}

/** Gives the floor back: the caption goes, the session picks up its line. */
function release(): void {
  letGo();
  set({ phase: "idle", question: "", chair: "", turn: null });
}

/** The session picks up its line; the floor's caption is left to the caller. */
function letGo(): void {
  listener?.cancel();
  listener = null;
  hush();
  scene?.light(null);
  scene?.hold(false);
  setOwnVoice(null);
}

/** Plays an answer's audio to its end (false when it couldn't play), or holds for its reading time. */
function hear(by: string, a: Pick<RoomAnswer, "say" | "audio">, n: number, url?: string | null): Promise<boolean> {
  const p = player;
  if ((!a.audio && !url) || !p) {
    scene?.talk(by, Math.min(5, readMs(a.say) / 1000));
    return wait(readMs(a.say), n);
  }
  return new Promise<boolean>((res) => {
    const done = () => {
      p.onended = p.onerror = null;
      scene?.talk(by, 0);
      res(run === n);
    };
    p.onended = p.onerror = done;
    p.src = url ?? `data:audio/mpeg;base64,${a.audio}`;
    scene?.talk(by, 30);
    p.play().catch(() => {
      // Blocked: read instead.
      p.onended = p.onerror = null;
      scene?.talk(by, Math.min(5, readMs(a.say) / 1000));
      void wait(readMs(a.say), n).then(res);
    });
  });
}

/** Why the floor can't be had here, or null when it can. */
export function floorBlocked(auth: string, supported: boolean): string | null {
  if (auth !== "in") return auth === "out" ? "Sign in on the Desk to talk to the Senate." : "Checking your sign-in…";
  if (!supported) return "This browser can't hear you here.";
  return null;
}

/** Space held in the Senate: the session holds and he is heard. */
export function floorStart(): void {
  const why = floorBlocked(useDeskAuth.getState().auth.status, micSupported());
  if (why) return holdHint(why);
  const n = ++run;
  hush();
  listener?.cancel();
  // Inside the key press, so the answers may play later without a tap.
  player ??= duckable(new Audio());
  player.src = silentWav();
  player.play().catch(() => undefined);
  scene?.hold(true);
  scene?.light(null);
  // Hands-free steps aside while the floor is his, so only one thing listens and Skippy never hears himself.
  setOwnVoice({ space: true, listening: true });
  set({ phase: "listening", question: "", chair: "", turn: null });
  listener = listen((words) => {
    if (run !== n) return;
    set({ question: words });
  });
}

/** Space let go: what he said goes to the floor, and the members answer in turn. */
export async function floorEnd(doFetch: typeof fetch = fetch): Promise<void> {
  const l = listener;
  listener = null;
  if (!l) return;
  const n = run;
  const got = await l.finish();
  if (run !== n) return;
  if ("error" in got || "none" in got) {
    release();
    return holdHint("error" in got ? got.error : "I didn't catch anything. Try again.");
  }
  const text = "text" in got ? got.text : "";
  if (text) {
    // Skippy's one brain hears the words first (#926), with the argument on the floor as their context, and judges.
    const topic = scene?.topic?.() ?? null;
    set({ phase: "asking", question: text, chair: "" });
    scene?.talk("kernel", 1.6);
    const heard = await fetchFloor(text, scene?.seated() ?? [], topic, !!scene?.join, doFetch);
    if (run !== n) return;
    // His own answer: the tool ran (or the question was answered), said as the chair.
    if (heard && "chair" in heard) {
      announceWrote(readWrote(heard.chair));
      remember("today", text, heard.chair.say, "skippy");
      set({ chair: floorChair(["kernel"]), phase: "answering", turn: { by: "kernel", say: heard.chair.say, failed: false } });
      if (!(await hear("kernel", heard.chair, n))) return;
      if (!(await wait(AFTER_MS, n))) return;
      return release();
    }
    // A remark joined to the argument (#925): the members who were speaking answer him in the chamber, and on it goes.
    const joined = heard && "join" in heard ? (scene?.join?.(text, heard.join) ?? null) : null;
    if (joined) {
      set({ phase: "joined", chair: "", turn: null });
      letGo();
      await joined;
      if (run === n) set({ phase: "idle", question: "", chair: "", turn: null });
      return;
    }
    // A remark with no argument on (#910): the members answer him live, in kind.
    if (heard && "lines" in heard) {
      const members = heard.lines.map((l) => l.by).filter((b) => b !== "kernel");
      set({ chair: floorChair(members.length ? [...new Set(members)] : ["kernel"]) });
      for (const l of heard.lines) {
        const voiced = await fetchLine(l.by, l.text, doFetch);
        if (run !== n) return;
        set({ phase: "answering", turn: { by: l.by, say: l.text, failed: false } });
        scene?.light(l.by === "kernel" ? null : l.by);
        const ok = await hear(l.by, { say: l.text }, n, voiced.url);
        if (voiced.url) URL.revokeObjectURL(voiced.url);
        if (!ok) return;
        if (!(await wait(TURN_GAP_MS, n))) return;
      }
      if (!(await wait(AFTER_MS, n))) return;
      return release();
    }
  }
  // Nothing came back, or a clip without the words in hand (Firefox): the chair answers through Skippy's own route,
  // where the function writes the words.
  set({ phase: "asking", question: text || useFloor.getState().question, chair: floorChair(["kernel"]) });
  scene?.talk("kernel", 1.6);
  const { turns, last } = recall("today");
  const a = "text" in got ? await askRoom("today", { text }, turns, last, doFetch) : await askRoom("today", { clip: got.clip }, turns, last, doFetch);
  if (run !== n) return;
  if (a.ok && text) remember("today", text, a.say, a.kind);
  set({ phase: "answering", turn: { by: "kernel", say: a.say, failed: !a.ok } });
  scene?.light(null);
  if (!(await hear("kernel", a, n))) return;
  if (!(await wait(AFTER_MS, n))) return;
  release();
}

/** Escape, or the window lost focus mid-hold: nothing is sent, the session picks up. */
export function floorCancel(): void {
  run++;
  release();
}

/** The chamber that holds and talks (the Rotunda's scene); null when it goes. Leaving gives the floor back. */
export function setFloorScene(s: FloorScene | null): void {
  if (!s && scene) floorCancel();
  scene = s;
}
