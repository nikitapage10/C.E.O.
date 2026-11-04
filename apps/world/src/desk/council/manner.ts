import type { RoomId } from "../../chronicle.ts";
import type { Face } from "../hologram/persona.ts";

/**
 * How each member of the Council carries itself on Today (#666, Nikita 2026-11-04: "It should be 1 model shown 11
 * times for sure. The thing is, each one should be in a different animated state based on who they are, right? Like
 * pessimist looks pessimistic, the green looks animated"). One admiral can (Skippy.glb), eleven times: Skippy in the
 * middle and the ten subminds around him, each with its own face, arms and way of moving, from its personality in
 * docs/SKIPPY.md. Pure data, free of three.js, so the tests and the Desk's first load can read it; councilScene.ts
 * plays it. A submind that isn't active holds `still` instead: dim, arms down, no motion.
 */

/** The arm poses the Council uses: the hologram's (holoScene.ts POSES) and the Council's own. */
export type CouncilPose =
  | "rest"
  | "talk"
  | "smug"
  | "laugh"
  | "think"
  | "annoyed"
  | "slump"
  | "cheer"
  | "hands"
  | "ready"
  | "dance"
  | "danceB"
  | "frame"
  | "frameB"
  | "flourish"
  | "flourishB"
  | "behind"
  | "tap"
  | "hammerUp"
  | "hammerDown"
  | "point";

export interface Manner {
  /** Its personality in a word (for the tests and the lore; never shown). */
  word: string;
  face: Face;
  /** The pose it holds, and a second it moves to and from (`swing` says how). */
  pose: CouncilPose;
  poseB?: CouncilPose;
  /** How it swings between the two: a smooth sine, a sharp strike (the hammer), or a held beat that snaps (the bet). */
  swing?: "sine" | "strike" | "snap";
  /** One of the model's own clips, upper body only, in place of the poses (the legs are dropped: he floats). */
  clip?: "Walking" | "Running";
  clipSpeed?: number;
  /** Everything runs at this pace (1 is Skippy's). */
  tempo: number;
  /** Float height, as a share of its own height. */
  bob: number;
  /** A hop on the beat (abs sine), as a share of its height. */
  bounce: number;
  /** A full turn every so many seconds (the party); 0 for none. */
  spinEvery: number;
  /** Side to side turn (radians) and how often a second. */
  sway: number;
  swayRate: number;
  /** Lean side to side (radians). */
  roll: number;
  /** Head's resting tilt [nod, turn, lean] (radians); positive nod looks down. */
  head: [number, number, number];
  /** Quick glances side to side (radians) and how often a second (the Bookie). */
  glance: number;
  glanceRate: number;
  /** A slow heavy sigh every so many seconds (the Pessimist): shoulders and head drop, then back; 0 for none. */
  sighEvery: number;
  /** Squash and stretch on the beat, as a share of its height. */
  squash: number;
  /** Little darts about its seat, as a share of its height (the Messenger). */
  dart: number;
  /** Forward lean (radians; positive leans in). */
  lean: number;
}

const BASE: Manner = { word: "", face: "listening", pose: "rest", tempo: 1, bob: 0.03, bounce: 0, spinEvery: 0, sway: 0.08, swayRate: 0.12, roll: 0, head: [0, 0, 0], glance: 0, glanceRate: 0, sighEvery: 0, squash: 0, dart: 0, lean: 0 };

/** Skippy, the Magnificent, presiding: smug, conducting with the admiral's baton beat, taking his time. */
export const SKIPPY_MANNER: Manner = { ...BASE, word: "presiding", face: "smug", pose: "talk", poseB: "smug", swing: "sine", tempo: 0.7, bob: 0.025, sway: 0.18, swayRate: 0.06, head: [-0.06, 0, 0.04] };

/** The ten subminds, each in its own skin (docs/SKIPPY.md, "Voices"). */
export const MANNERS: Record<RoomId, Manner> = {
  // The Builder: the foreman at the anvil, eyes down, right arm hammering, a dip on every strike.
  foundry: { ...BASE, word: "hammering", face: "focused", pose: "hammerUp", poseB: "hammerDown", swing: "strike", tempo: 1.3, bob: 0.012, squash: 0.03, head: [0.2, 0, 0], lean: 0.1, sway: 0.03 },
  // The Messenger: the jittery gossip, arms pumping (the model's own run), darting about its seat, glancing.
  relay: { ...BASE, word: "darting", face: "attentive", pose: "ready", clip: "Running", clipSpeed: 1.5, tempo: 1.8, bob: 0.02, dart: 0.09, glance: 0.3, glanceRate: 1.4, lean: 0.12, head: [-0.04, 0, 0.1] },
  // The Pessimist: slumped and slow, a droopy bob, and every few seconds a long sigh.
  boiler: { ...BASE, word: "slumped", face: "unimpressed", pose: "slump", tempo: 0.4, bob: 0.012, sway: 0.03, swayRate: 0.05, head: [0.3, 0, -0.1], sighEvery: 6, squash: 0.015, lean: 0.14, roll: 0.05 },
  // The Historian: a slow scholarly tilt, hand at the chin, weighing the footnotes.
  archive: { ...BASE, word: "pondering", face: "thinking", pose: "think", poseB: "rest", swing: "snap", tempo: 0.5, bob: 0.02, sway: 0.22, swayRate: 0.07, roll: 0.12, head: [0.06, 0.25, 0.2] },
  // The Life of the Party: dancing, arms swapping up and down, spinning on the spot, never still.
  breakroom: { ...BASE, word: "dancing", face: "laughing", pose: "dance", poseB: "danceB", swing: "sine", tempo: 2.1, bob: 0.02, bounce: 0.07, spinEvery: 3.2, roll: 0.16, squash: 0.06, head: [-0.12, 0, 0.12] },
  // The Executive: upright and proud, hands behind his back, chin up, a slow turn to survey the room.
  spire: { ...BASE, word: "surveying", face: "smug", pose: "behind", clip: undefined, tempo: 0.45, bob: 0.018, sway: 0.55, swayRate: 0.05, head: [-0.16, 0, 0], lean: -0.08 },
  // The Bookie: shifty, a hand tapping at the chest, quick glances side to side, a nervous hop now and then.
  exchange: { ...BASE, word: "shifty", face: "sly", pose: "tap", poseB: "think", swing: "snap", tempo: 1.6, bob: 0.01, bounce: 0.012, glance: 0.42, glanceRate: 0.8, head: [0.06, 0, 0], sway: 0.05, swayRate: 0.6 },
  // The Commentator: calling the play, both arms up then pointing, bouncing on every word.
  green: { ...BASE, word: "calling it", face: "grin", pose: "cheer", poseB: "point", swing: "sine", tempo: 2, bob: 0.02, bounce: 0.09, squash: 0.05, sway: 0.25, swayRate: 0.5, head: [-0.1, 0, 0.08], lean: 0.06 },
  // The Artiste: a swaying flourish, one arm sweeping, lost in the idea.
  workshop: { ...BASE, word: "flourishing", face: "listening", pose: "flourish", poseB: "flourishB", swing: "sine", tempo: 0.8, bob: 0.03, sway: 0.4, swayRate: 0.16, roll: 0.2, head: [-0.14, -0.2, 0.18] },
  // The Director: framing the shot with both hands, leaning in to look through it, then pulling back.
  studio: { ...BASE, word: "framing", face: "annoyed", pose: "frame", poseB: "frameB", swing: "snap", tempo: 0.9, bob: 0.015, sway: 0.3, swayRate: 0.2, head: [0.04, 0.12, 0.06], lean: 0.12 },
};

/**
 * The Desk's own subminds (DESK_SUBMINDS, #717), seated with the ten: the rooms that live only on the Desk.
 * The Steward keeps the house (the Haven): calm and attentive, hands folded, a slow nod as he checks each device.
 * The Stagehand runs the pop-ups (the Annex): quick and keen, pointing where the next set goes, a small hop on cue.
 */
export const DESK_MANNERS: Record<"haven" | "annex", Manner> = {
  haven: { ...BASE, word: "keeping house", face: "attentive", pose: "hands", poseB: "rest", swing: "sine", tempo: 0.55, bob: 0.02, sway: 0.12, swayRate: 0.08, head: [0.1, 0, 0.05], lean: 0.04 },
  annex: { ...BASE, word: "setting the stage", face: "grin", pose: "point", poseB: "ready", swing: "snap", tempo: 1.4, bob: 0.015, bounce: 0.04, glance: 0.2, glanceRate: 0.5, sway: 0.15, swayRate: 0.3, head: [-0.06, 0.1, 0], lean: 0.08 },
};

/** Any member's manner: the ten rooms', then the Desk's own. */
export const mannerOf = (id: string): Manner => (MANNERS as Record<string, Manner>)[id] ?? (DESK_MANNERS as Record<string, Manner>)[id] ?? STILL_MANNER;

/** A submind that isn't active yet (docs/SKIPPY.md): dim, arms at its sides, no motion. */
export const STILL_MANNER: Manner = { ...BASE, word: "waiting", face: "listening", pose: "rest", tempo: 0, bob: 0, sway: 0, head: [0.12, 0, 0] };

/** The motion signature, for telling two manners apart in the tests. */
export const signature = (m: Manner) => [m.face, m.pose, m.poseB ?? "", m.clip ?? "", m.tempo, m.bounce, m.spinEvery, m.sighEvery, m.dart, m.glance].join("|");
