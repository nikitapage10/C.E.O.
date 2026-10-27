import type { RoomId } from "@ceo/core";
import type { Expression } from "./signal.ts";

/**
 * Who is on the mic is more than a colour (#490, Nikita: "the pessimist probably should kind of be like have this like
 * non-impressed face, and then like maybe the commentator be like really excited all the time ... an animation shift
 * in general"). Each voice on a call has a persona: the faces it pulls for the call's five moods, the arm pose it holds
 * while listening and while talking, and how its body moves. One table, so a persona is tuned here and nowhere else.
 * Pure data and free of three.js, so the tests (and the Desk's first load) can read it.
 */

/** The faces face.ts draws: the call's five moods, and the subminds' own. */
export type Face = Expression | "unimpressed" | "grin" | "sly" | "attentive" | "focused";
export const FACES: readonly Face[] = ["listening", "thinking", "smug", "laughing", "annoyed", "unimpressed", "grin", "sly", "attentive", "focused"];

/** The arm poses holoScene.ts knows. */
export type Pose = "rest" | "talk" | "smug" | "laugh" | "think" | "annoyed" | "slump" | "cheer" | "hands" | "ready";

export interface Persona {
  /** Who it is: "skippy" or the submind's room. */
  key: "skippy" | RoomId;
  /** How it carries itself, in a word (shown nowhere; for the tests and the lore). */
  manner: string;
  /** The face for each of the call's moods (signal.ts, expressionOf). */
  faces: Record<Expression, Face>;
  /** The arms for each mood. */
  poses: Record<Expression, Pose>;
  /** Body motion: how fast everything runs (1 is Skippy), how far it floats and bounces, and its habits. */
  motion: {
    /** Speed of the float and the talking beat. */
    tempo: number;
    /** Float height. */
    bob: number;
    /** A hop on every beat while talking (the Commentator). */
    bounce: number;
    /** How hard the hand beats with the words. */
    beat: number;
    /** The head's resting tilt [nod, turn, lean], added to the mood's own. */
    head: [number, number, number];
    /** Quick glances side to side: how far, and how often a second (the Bookie). */
    glance: number;
    glanceRate: number;
    /** A slow heavy sigh every so many seconds (the Pessimist); 0 for none. */
    sighEvery: number;
    /** Hands busy at something in front of it (the Builder): how much the forearms work. */
    busy: number;
  };
}

const still = { tempo: 1, bob: 0.012, bounce: 0, beat: 0.25, head: [0, 0, 0] as [number, number, number], glance: 0, glanceRate: 0, sighEvery: 0, busy: 0 };

/** Skippy himself: smug, as ever. */
const SKIPPY: Persona = {
  key: "skippy",
  manner: "smug",
  faces: { listening: "listening", thinking: "thinking", smug: "smug", laughing: "laughing", annoyed: "annoyed" },
  poses: { listening: "rest", thinking: "think", smug: "talk", laughing: "laugh", annoyed: "annoyed" },
  motion: still,
};

/** The subminds on air (api/_skippy/voicecrew.ts, ON_AIR), each in its own skin. */
export const PERSONAS: Partial<Record<RoomId, Persona>> = {
  // Soot: never impressed. Flat face whatever happens, slumped, slow and heavy, and a sigh every few seconds.
  boiler: {
    key: "boiler",
    manner: "unimpressed",
    faces: { listening: "unimpressed", thinking: "unimpressed", smug: "unimpressed", laughing: "unimpressed", annoyed: "annoyed" },
    poses: { listening: "slump", thinking: "slump", smug: "slump", laughing: "slump", annoyed: "annoyed" },
    motion: { ...still, tempo: 0.45, bob: 0.006, beat: 0.08, head: [0.16, 0, -0.05], sighEvery: 5.5 },
  },
  // Turf: live from the floating booth. A wide grin all the time, arms up like a broadcaster, bouncing.
  green: {
    key: "green",
    manner: "excited",
    faces: { listening: "grin", thinking: "attentive", smug: "grin", laughing: "laughing", annoyed: "grin" },
    poses: { listening: "cheer", thinking: "ready", smug: "cheer", laughing: "laugh", annoyed: "cheer" },
    motion: { ...still, tempo: 1.9, bob: 0.02, bounce: 0.022, beat: 0.5, head: [-0.08, 0, 0.06] },
  },
  // Ticker: the odds-maker. A sly, calculating look and quick shifty glances side to side.
  exchange: {
    key: "exchange",
    manner: "sly",
    faces: { listening: "sly", thinking: "sly", smug: "sly", laughing: "smug", annoyed: "annoyed" },
    poses: { listening: "smug", thinking: "think", smug: "smug", laughing: "smug", annoyed: "annoyed" },
    motion: { ...still, tempo: 1.2, bob: 0.008, beat: 0.15, head: [0.04, 0, 0], glance: 0.32, glanceRate: 0.9 },
  },
  // Static: the gossip on the line. Wide-eyed and attentive, brisk.
  relay: {
    key: "relay",
    manner: "attentive",
    faces: { listening: "attentive", thinking: "attentive", smug: "attentive", laughing: "laughing", annoyed: "annoyed" },
    poses: { listening: "ready", thinking: "think", smug: "talk", laughing: "laugh", annoyed: "annoyed" },
    motion: { ...still, tempo: 1.5, bob: 0.01, beat: 0.35, head: [-0.03, 0, 0.1], glance: 0.12, glanceRate: 0.5 },
  },
  // Ember: the foreman. Focused, eyes down on the work, hands busy at it.
  foundry: {
    key: "foundry",
    manner: "focused",
    faces: { listening: "focused", thinking: "focused", smug: "focused", laughing: "smug", annoyed: "annoyed" },
    poses: { listening: "hands", thinking: "hands", smug: "hands", laughing: "laugh", annoyed: "annoyed" },
    motion: { ...still, tempo: 1.1, bob: 0.008, beat: 0.12, head: [0.14, 0, 0], busy: 1 },
  },
};

/** The persona of whoever has the mic: a submind's own, Skippy's for him (or a submind not on air yet). */
export const personaOf = (speaker: RoomId | null): Persona => (speaker && PERSONAS[speaker]) || SKIPPY;
