import { create } from "zustand";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { holdHint } from "../holdToTalk.ts";
import { askRoom, listen, micSupported, recall, remember, setOwnVoice, silentWav, type Listener, type RoomAnswer } from "../roomvoice/roomVoice.ts";
import { readMs, SUBMIND_TITLE } from "./rite.ts";
import { fetchFloorReply, fetchJoin, type FloorTopic, type Joined } from "./liveTalk.ts";
import { fetchLine } from "./voice.ts";

/**
 * Nikita has the floor (#905). Nikita, 2026-11-05: "At any point while the skippies are talking in the Senate, I should be
 * able to hold space to engage them directly and then they can respond to me in turn."
 *
 * Holding Space in the Senate (holdToTalk.ts, the Senate's handler above the page's) holds the session where it is: the
 * speaker stops mid-line and the clock waits (rotundaScene.ts `hold`). His words show as the floor's caption. On the
 * release the presiding Skippy routes them: the members whose rooms they are about (`routeFloor`, at most two, words
 * only, no model call) answer in turn, each through its room's own voice (POST /api/skippy-room as that room: the same
 * chat, caps, pace and privacy check as the room mic, the answer read in that submind's voice); words about nothing in
 * particular go to Skippy himself. Then the session picks up the line it was on.
 *
 * Since #910, words about nothing in particular get the members' live answer instead (liveTalk.ts, `fetchFloorReply`:
 * Claude Haiku under the Senate's $10, after the privacy check): one or two of them answer him in kind, in the context of
 * the argument on the floor, each in Skippy's voice bent its way (the Rotunda's share; past it, read). When that can't
 * come, the chair answers as before.
 *
 * Since #925, with an argument on the floor his words join it rather than start a side conversation (Nikita, 2026-11-06:
 * "those two would be the ones to respond, and then maybe somebody else chimes in"): one live call (liveTalk.ts,
 * `fetchJoin`) brings the answers of the members who were speaking, perhaps one more, and the rest of the argument with
 * his point in it. The chamber takes them at the next line's turn (rotundaScene.ts `join`): the line he cut into
 * finishes, they answer him from where they stand in the chamber's own captions and voices while his line stays up as
 * his, and the argument carries on to a new ruling. When that can't come, the floor answers him as before.
 *
 * Nothing is kept: the turns live in roomVoice.ts's memory for a follow-on, and are forgotten on reload.
 */

/** Rooms that answer on the floor (each has a voice on POST /api/skippy-room) and the words that bring them in. */
export const FLOOR_WORDS: Readonly<Record<string, readonly string[]>> = {
  foundry: ["foundry", "builder", "build", "building", "code", "coding", "ship", "shipped", "shipping", "deploy", "pr", "pull request", "issue", "issues", "bug", "bugs", "feature"],
  spire: ["spire", "executive", "calendar", "meeting", "meetings", "schedule", "strategy"],
  exchange: ["exchange", "bookie", "market", "markets", "bet", "bets", "odds", "polymarket", "stock", "stocks", "trade", "trades"],
  green: ["green", "commentator", "fantasy", "football", "lineup", "waiver", "waivers", "player", "players", "league", "matchup", "nfl"],
  relay: ["relay", "messenger", "email", "emails", "inbox", "mail", "text", "texts", "message", "messages", "reply"],
  archive: ["archive", "historian", "history", "chronicle", "lore"],
  boiler: ["boiler", "pessimist", "server", "servers", "security", "checks", "error", "errors", "outage", "pipes", "settings"],
  workshop: ["workshop", "artiste", "design", "art", "picture", "pictures", "image", "images"],
  studio: ["studio", "director", "video", "film", "movie"],
  annex: ["annex", "stagehand", "election", "elections", "vote", "voting", "ballot"],
  haven: ["haven", "steward", "home", "house", "lights", "vacuum", "litter", "cat", "cats", "pet", "pets", "feeder", "kitchen", "shopping", "groceries", "grocery", "gym", "chores"],
};

/** The most members brought in on one question. */
export const FLOOR_MAX = 2;

/**
 * Who answers: the seated members whose rooms the words are about, most-mentioned first, at most `max`; Skippy
 * himself ("kernel") when they are about none of them.
 */
export function routeFloor(text: string, seated: readonly string[], max = FLOOR_MAX): string[] {
  const words = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const scored = seated
    .filter((id) => Object.hasOwn(FLOOR_WORDS, id))
    .map((id, i) => ({ id, i, n: FLOOR_WORDS[id]!.filter((w) => words.includes(` ${w} `)).length }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i);
  return scored.length ? scored.slice(0, max).map((r) => r.id) : ["kernel"];
}

/** The chair hands the floor over, in a word. */
export const floorChair = (ids: readonly string[]): string => {
  if (ids.length === 1 && ids[0] === "kernel") return "The chair will take that one himself.";
  const names = ids.map((id) => (SUBMIND_TITLE[id] ?? id).replace(/^The /, "the "));
  return `The chair recognizes ${names.join(", then ")}.`;
};

/** The room the answer is asked as: the member's own, or Today (Skippy himself) for the chair. */
export const floorRoom = (id: string) => (id === "kernel" ? "today" : id);

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

/** Who was speaking when he cut in: the last two members heard in the argument (not the chair, not him), newest first. */
export function speakersOf(topic: FloorTopic | null): string[] {
  const out: string[] = [];
  for (const l of [...(topic?.lines ?? [])].reverse()) if (l.by !== "kernel" && l.by !== "floor" && !out.includes(l.by) && out.length < 2) out.push(l.by);
  return out;
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
  player ??= new Audio();
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
  // An argument on the floor: his words join it (#925). The members who were speaking answer him in the chamber and it
  // goes on from there; his line stays up as his until they have.
  const topic = text ? (scene?.topic?.() ?? null) : null;
  if (text && topic && scene?.join) {
    const speaking = speakersOf(topic);
    set({ phase: "asking", question: text, chair: floorChair(speaking.length ? speaking : ["kernel"]) });
    const j = await fetchJoin(text, scene.seated(), topic, doFetch);
    if (run !== n) return;
    const heard = j ? (scene?.join?.(text, j) ?? null) : null;
    if (heard) {
      set({ phase: "joined", chair: "", turn: null });
      letGo();
      await heard;
      if (run === n) set({ phase: "idle", question: "", chair: "", turn: null });
      return;
    }
  }
  const tried = !!topic;
  // Without the words in hand (a clip, Firefox), the chair takes it: the function writes the words and Skippy answers.
  const ids = text ? routeFloor(text, scene?.seated() ?? []) : ["kernel"];
  set({ phase: "asking", question: text || useFloor.getState().question, chair: floorChair(ids) });
  scene?.talk("kernel", 1.6);
  // About nothing in particular: the members answer him live, in kind (#910); the chair's own answer when they can't.
  if (text && !tried && ids.length === 1 && ids[0] === "kernel") {
    const lines = await fetchFloorReply(text, scene?.seated() ?? [], scene?.topic?.() ?? null, doFetch);
    if (run !== n) return;
    if (lines) {
      const members = lines.map((l) => l.by).filter((b) => b !== "kernel");
      set({ chair: floorChair(members.length ? [...new Set(members)] : ["kernel"]) });
      for (const l of lines) {
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
  for (const id of ids) {
    const room = floorRoom(id);
    const { turns, last } = recall(room);
    const a = "text" in got ? await askRoom(room, { text }, turns, last, doFetch) : await askRoom(room, { clip: got.clip }, turns, last, doFetch);
    if (run !== n) return;
    if (a.ok && text) remember(room, text, a.say, a.kind);
    set({ phase: "answering", turn: { by: id, say: a.say, failed: !a.ok } });
    scene?.light(id === "kernel" ? null : id);
    if (!(await hear(id, a, n))) return;
    // A failure (signed out, the cap, the pace) is said once; nobody else is asked.
    if (!a.ok) break;
    if (!(await wait(TURN_GAP_MS, n))) return;
  }
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
