import { create } from "zustand";
import { duckable } from "@ceo/engine/web/siteSound.ts";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { holdHint } from "../holdToTalk.ts";
import { askRoom, listen, micSupported, recall, remember, setOwnVoice, silentWav, type Listener, type RoomAnswer } from "../roomvoice/roomVoice.ts";
import { readMs, SUBMIND_TITLE } from "./rite.ts";
import { announceWrote, readWrote } from "../skippy/wrote.ts";
import { fetchFloor, type FloorTopic, type Joined } from "./liveTalk.ts";
import { fetchLine } from "./voice.ts";
import { FLOOR_WAIT_MS, steerLines } from "./floorSteer.ts";

/**
 * Nikita has the floor (#905). Nikita, 2026-11-05: "At any point while the skippies are talking in the Senate, I should be
 * able to hold space to engage them directly and then they can respond to me in turn."
 *
 * Holding Space in the Senate (holdToTalk.ts, the Senate's handler above the page's) interrupts the session where it is:
 * the speaker stops mid-line and the clock waits (rotundaScene.ts `hold`). His words show as the floor's caption while he
 * holds Space.
 *
 * Since #926, on the release his words go to Skippy's one brain first, with the argument on the floor as the page
 * (liveTalk.ts `fetchFloor`, one call). Skippy judges them himself, with every room's tools: an ask or a question ("what's
 * the temperature in my apartment?") is his, answered as the chair; a question only ever reads a device, never runs one
 * (#953). A remark on the debate goes on to the members: joined to the argument on the floor (#925), or with none on,
 * answered in kind (#910). When nothing comes back, the chair answers through Skippy's own route.
 *
 * Since #948 (Nikita, 2026-11-06) the answer is the chamber's, not a box on screen: on the release his caption goes; the
 * one who answers (the addressed member, or Skippy the Magnificent for a tool answer) rises on his podium and says it
 * aloud, his line captioned over him as any line in the Senate is. He waits about nine seconds for a reply (holding Space
 * again carries the exchange on); with none, he steps back down, Skippy (perhaps after a member's aside) steers the
 * chamber back to what it was on, "before we were interrupted…", and the session picks up where it left off. Nothing is
 * said twice, and the gallery's murmurs are only paused while he speaks, never cut off.
 *
 * Nothing is kept: the turns live in roomVoice.ts's memory for a follow-on, and are forgotten on reload.
 */

/** The chair hands the floor over, in a word. */
export const floorChair = (ids: readonly string[]): string => {
  if (ids.length === 1 && ids[0] === "kernel") return "The chair will take that one himself.";
  const names = ids.map((id) => (SUBMIND_TITLE[id] ?? id).replace(/^The /, "the "));
  return `The chair recognizes ${names.join(", then ")}.`;
};

/* ── The floor's state, for the chamber's captions ── */

export interface FloorTurn {
  by: string;
  say: string;
  failed: boolean;
}
export interface FloorState {
  /**
   * "listening": he holds Space and his words show; "asking": let go, Skippy is judging them (nothing on screen);
   * "answering": a member or the chair says the answer from his podium; "waiting": he waits for a reply;
   * "steering": the chamber is brought back to what it was on.
   */
  phase: "idle" | "listening" | "asking" | "answering" | "waiting" | "steering";
  /** What Nikita said (or is saying). */
  question: string;
  /** The line being heard now, captioned over whoever says it. */
  turn: FloorTurn | null;
}
export const useFloor = create<FloorState>(() => ({ phase: "idle", question: "", turn: null }));
const set = (p: Partial<FloorState>) => useFloor.setState(p);

/** What the floor needs from the chamber. */
export interface FloorScene {
  hold: (on: boolean) => void;
  talk: (by: string, seconds: number) => void;
  /** The members seated now, by id. */
  seated: () => string[];
  /** Lights the member who has the floor (null: none). */
  light: (id: string | null) => void;
  /** Raises that member (or "kernel", the chair) on his podium to answer him; null steps whoever is up back down (#948). */
  rise?: (id: string | null) => void;
  /** What the chamber was on when he took the floor, as the chair's clause (floorSteer.ts `whereClause`); null: nothing. */
  where?: () => string | null;
  /** The argument on the floor now (#910), if one is. */
  topic?: () => FloorTopic | null;
  /**
   * His words and the members' answers joined to that argument (#925): the rest of it follows, his point in it, once the
   * session picks up. False when no argument is on.
   */
  join?: (said: string, j: Joined) => boolean;
}

/** A beat between turns. */
const TURN_GAP_MS = 700;

let listener: Listener | null = null;
let player: HTMLAudioElement | null = null;
let run = 0;
let scene: FloorScene | null = null;

const wait = (ms: number, n: number) => new Promise<boolean>((res) => setTimeout(() => res(run === n), ms));

function hush(): void {
  if (player && !player.paused) player.pause();
  player?.dispatchEvent(new Event("ended"));
}

/** Gives the floor back: whoever is up steps down, and the session picks up its line. */
function release(): void {
  listener?.cancel();
  listener = null;
  hush();
  scene?.light(null);
  scene?.rise?.(null);
  scene?.hold(false);
  setOwnVoice(null);
  set({ phase: "idle", question: "", turn: null });
}

/** Plays an answer's audio to its end (false when the floor moved on), or holds for its reading time. */
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

interface FloorLine {
  by: string;
  say: string;
  audio?: string;
  failed?: boolean;
}

/**
 * One line of the floor said aloud by `by` (#948), captioned over him: from his podium, risen, when he answers Nikita;
 * from where he is when he steers the chamber back. The chair's own answer may come with its audio; any other line is
 * voiced as the chamber's lines are (voice.ts `fetchLine`), and read when it can't be.
 */
async function sayLine(l: FloorLine, n: number, doFetch: typeof fetch, rise: boolean): Promise<boolean> {
  const voiced = l.audio ? { url: null } : await fetchLine(l.by, l.say, doFetch);
  if (run !== n) {
    if (voiced.url) URL.revokeObjectURL(voiced.url);
    return false;
  }
  if (rise) scene?.rise?.(l.by);
  set({ turn: { by: l.by, say: l.say, failed: !!l.failed } });
  const ok = await hear(l.by, l, n, voiced.url);
  if (voiced.url) URL.revokeObjectURL(voiced.url);
  return ok;
}

/** Each answer in turn, each from his own podium; then the wait for a reply, and the steer back. */
async function answer(lines: FloorLine[], n: number, doFetch: typeof fetch): Promise<void> {
  set({ phase: "answering" });
  for (let i = 0; i < lines.length; i++) {
    if (!(await sayLine(lines[i]!, n, doFetch, true))) return;
    if (i < lines.length - 1 && !(await wait(TURN_GAP_MS, n))) return;
  }
  // He waits for a reply. Holding Space again meanwhile is the reply: a new turn takes the floor from here.
  set({ phase: "waiting" });
  if (!(await wait(FLOOR_WAIT_MS, n))) return;
  scene?.rise?.(null);
  set({ phase: "steering", turn: null });
  if (!(await wait(TURN_GAP_MS, n))) return;
  const steer = steerLines({
    answered: lines.map((l) => l.by),
    where: scene?.where?.() ?? null,
    seated: scene?.seated() ?? [],
    pick: (k) => Math.floor(Math.random() * k),
  });
  for (const l of steer) {
    if (!(await sayLine({ by: l.by, say: l.text }, n, doFetch, false))) return;
    if (!(await wait(TURN_GAP_MS, n))) return;
  }
  release();
}

/** Why the floor can't be had here, or null when it can. */
export function floorBlocked(auth: string, supported: boolean): string | null {
  if (auth !== "in") return auth === "out" ? "Sign in on the Desk to talk to the Senate." : "Checking your sign-in…";
  if (!supported) return "This browser can't hear you here.";
  return null;
}

/** Space held in the Senate: the session holds and he is heard. Whoever answered him last stays up, listening. */
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
  set({ phase: "listening", question: "", turn: null });
  listener = listen((words) => {
    if (run !== n) return;
    set({ question: words });
  });
}

/** Space let go: his caption goes, and the one he addressed answers him aloud from his podium. */
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
  // The box goes with the release (#948): from here the chamber answers, captioned as its own lines are.
  set({ phase: "asking", question: text, turn: null });
  scene?.talk("kernel", 1.6);
  if (text) {
    // Skippy's one brain hears the words first (#926), with the argument on the floor as their context, and judges.
    const topic = scene?.topic?.() ?? null;
    const heard = await fetchFloor(text, scene?.seated() ?? [], topic, !!scene?.join, doFetch);
    if (run !== n) return;
    // His own answer: the tool ran (or the question was answered), said aloud by Skippy the Magnificent.
    if (heard && "chair" in heard) {
      announceWrote(readWrote(heard.chair));
      remember("today", text, heard.chair.say, "skippy");
      return answer([{ by: "kernel", say: heard.chair.say, ...(heard.chair.audio && { audio: heard.chair.audio }) }], n, doFetch);
    }
    // A remark on the argument (#925): the members who were speaking answer him, and the argument takes his point on.
    if (heard && "join" in heard && scene?.join?.(text, heard.join))
      return answer(
        heard.join.answers.map((a) => ({ by: a.by, say: a.text })),
        n,
        doFetch,
      );
    // A remark with no argument on (#910): the members answer him live, in kind.
    if (heard && "lines" in heard)
      return answer(
        heard.lines.map((x) => ({ by: x.by, say: x.text })),
        n,
        doFetch,
      );
  }
  // Nothing came back, or a clip without the words in hand (Firefox): the chair answers through Skippy's own route,
  // where the function writes the words.
  const { turns, last } = recall("today");
  const a = "text" in got ? await askRoom("today", { text }, turns, last, doFetch) : await askRoom("today", { clip: got.clip }, turns, last, doFetch);
  if (run !== n) return;
  if (a.ok && text) remember("today", text, a.say, a.kind);
  return answer([{ by: "kernel", say: a.say, ...(a.audio && { audio: a.audio }), failed: !a.ok }], n, doFetch);
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
