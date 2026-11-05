import type { Face, Pose } from "../hologram/persona.ts";

/**
 * Who sits in the Senate (#775): every Skippy in the Council its own self in motion and face, not thirteen copies of
 * one can in thirteen colours (Nikita, 2026-11-05: "while they all visually look different, they all have the same
 * personalities, animations, and facial expressions"). One table keyed by submind id ("kernel" is Skippy in the chair),
 * drawn from each one's voice (docs/SKIPPY.md, "Voices") and its lore: how it idles in its pod, which gestures it makes
 * on the floor and how fast, the faces it pulls and how often it blinks, and how it takes whoever else is speaking.
 * Pure data and free of three.js, so the tests can read it; rotundaScene.ts plays it.
 */

/** A habit it falls into while it waits, now and then (`every` seconds) or all the time. */
export type Fidget =
  | "conduct" // the Chair: a beat of the baton
  | "tinker" // the Builder: hands always at work on something that isn't there
  | "preen" // the Executive: chin up, a slow look round the room
  | "tap" // the Bookie: tapping, counting, glancing at the door
  | "lean" // the Commentator: leaning out of the booth, pointing at the play
  | "glance" // the Messenger: head snapping to every line
  | "scribble" // the Historian: head down, writing the minutes
  | "sigh" // the Pessimist: a long sinking sigh
  | "twirl" // the Life of the Party: a spin on the spot
  | "muse" // the Artiste: inspiration strikes, arm up
  | "frame" // the Director: framing the shot with its hands
  | "cue" // the Stagehand: hand to the headset
  | "hum"; // the Steward: swaying to a 2000s emo chorus nobody else hears

/** What it does while another speaks. */
export type Move = "none" | "nod" | "shake" | "eyeroll" | "groan" | "cheer" | "lean" | "frame" | "glance" | "smirk" | "scribble" | "bounce";

export interface Reaction {
  face: Face;
  move: Move;
}

export interface Senator {
  id: string;
  /** In a word (for the tests and the lore). */
  manner: string;
  /** The arms while it waits. */
  rest: Pose;
  idle: {
    /** Its own clock: everything it does runs this much faster or slower than the Chair. */
    tempo: number;
    /** How high it floats up and down in its pod, and how fast (radians a second, before tempo). */
    bob: number;
    bobRate: number;
    /** A side-to-side roll (radians). */
    sway: number;
    /** A hop on the bob (the Party, the Commentator). */
    hop: number;
    /** Body pitched forward (+) or back (radians), and sunk into the pod (scene units). */
    lean: number;
    slump: number;
    /** The head's resting tilt: [nod (+ down), roll]. */
    head: [number, number];
    fidget: Fidget;
    /** Seconds between fidgets (0: it never stops). */
    every: number;
    /** How long a fidget lasts. */
    dur: number;
    /** The arms during a fidget, if it moves them. */
    pose?: Pose;
  };
  speak: {
    /** Its gestures, in turn, one every `every` seconds. */
    poses: Pose[];
    every: number;
    /** How hard the hands beat with the words, and how fast. */
    beat: number;
    tempo: number;
    /** How fast the arms reach a gesture (per second): the Stagehand snaps, the Historian takes its time. */
    snap: number;
    /** A hop on the beat, and a nod with the words. */
    hop: number;
    nod: number;
  };
  face: {
    rest: Face;
    speak: Face;
    /** Seconds between blinks, and how long one lasts. */
    blink: number;
    blinkLen: number;
  };
  /** How it takes whoever has the floor: its usual, and its exceptions by speaker. */
  react: { usual: Reaction; to?: Partial<Record<string, Reaction>> };
}

const R = (face: Face, move: Move): Reaction => ({ face, move });

export const SENATORS: Record<string, Senator> = {
  // Skippy, the Magnificent, in the chair: grand, unhurried, conducting the room with a baton only he can see.
  kernel: {
    id: "kernel",
    manner: "grand",
    rest: "smug",
    idle: { tempo: 0.9, bob: 0.03, bobRate: 1.0, sway: 0.03, hop: 0, lean: -0.04, slump: 0, head: [-0.08, 0.04], fidget: "conduct", every: 7, dur: 1.8, pose: "talk" },
    speak: { poses: ["talk", "smug", "talk", "laugh"], every: 1.5, beat: 0.4, tempo: 1, snap: 6, hop: 0, nod: 0.06 },
    face: { rest: "smug", speak: "smug", blink: 4.5, blinkLen: 0.16 },
    react: { usual: R("smug", "nod"), to: { boiler: R("smug", "eyeroll"), breakroom: R("laughing", "none"), spire: R("annoyed", "smirk") } },
  },
  // The Builder: a hot-tempered foreman. Hands never stop working, head down over the work, short jabbing gestures.
  foundry: {
    id: "foundry",
    manner: "focused",
    rest: "hands",
    idle: { tempo: 1.15, bob: 0.015, bobRate: 1.3, sway: 0.01, hop: 0, lean: 0.06, slump: 0, head: [0.18, 0], fidget: "tinker", every: 0, dur: 0 },
    speak: { poses: ["hands", "annoyed", "point", "hands"], every: 0.9, beat: 0.55, tempo: 1.6, snap: 10, hop: 0, nod: 0.1 },
    face: { rest: "focused", speak: "annoyed", blink: 3.6, blinkLen: 0.12 },
    react: { usual: R("focused", "none"), to: { green: R("annoyed", "shake"), spire: R("annoyed", "eyeroll"), studio: R("annoyed", "shake"), kernel: R("focused", "nod") } },
  },
  // The Executive: smarmy, poised and nearly still. Presents with an open hand; slow, smooth, rarely blinks.
  spire: {
    id: "spire",
    manner: "poised",
    rest: "smug",
    idle: { tempo: 0.6, bob: 0.008, bobRate: 0.8, sway: 0, hop: 0, lean: -0.05, slump: 0, head: [-0.1, 0], fidget: "preen", every: 9, dur: 2.6 },
    speak: { poses: ["present", "smug", "present", "talk"], every: 2.2, beat: 0.18, tempo: 0.7, snap: 3.5, hop: 0, nod: 0.03 },
    face: { rest: "poised", speak: "poised", blink: 6.5, blinkLen: 0.2 },
    react: { usual: R("poised", "nod"), to: { boiler: R("smug", "smirk"), studio: R("smug", "nod"), workshop: R("smug", "smirk") } },
  },
  // The Bookie: a nervous odds-maker. Taps, counts on its fingers, glances at the exits, blinks too often.
  exchange: {
    id: "exchange",
    manner: "nervous",
    rest: "count",
    idle: { tempo: 1.45, bob: 0.012, bobRate: 2.2, sway: 0.015, hop: 0, lean: 0.03, slump: 0.02, head: [0.04, 0], fidget: "tap", every: 2.6, dur: 0.9 },
    speak: { poses: ["count", "shrug", "count", "think"], every: 1.1, beat: 0.3, tempo: 2.2, snap: 9, hop: 0, nod: 0.05 },
    face: { rest: "sly", speak: "sly", blink: 1.7, blinkLen: 0.1 },
    react: { usual: R("sly", "glance"), to: { boiler: R("attentive", "nod"), green: R("sly", "scribble"), breakroom: R("attentive", "shake") } },
  },
  // The Commentator: leaning out of the booth, grinning, both arms up for every play, bouncing on the words.
  green: {
    id: "green",
    manner: "excited",
    rest: "ready",
    idle: { tempo: 1.8, bob: 0.02, bobRate: 1.6, sway: 0.02, hop: 0.02, lean: 0.14, slump: 0, head: [-0.06, 0.06], fidget: "lean", every: 4, dur: 1.2, pose: "point" },
    speak: { poses: ["cheer", "point", "cheer", "ready"], every: 0.8, beat: 0.6, tempo: 2, snap: 9, hop: 0.05, nod: 0.08 },
    face: { rest: "grin", speak: "grin", blink: 3.2, blinkLen: 0.12 },
    react: { usual: R("grin", "lean"), to: { breakroom: R("laughing", "cheer"), foundry: R("grin", "cheer"), exchange: R("grin", "nod") } },
  },
  // The Messenger: a jittery gossip. Head snapping to every line, an ear tilted, leaning in to hear.
  relay: {
    id: "relay",
    manner: "attentive",
    rest: "ready",
    idle: { tempo: 1.5, bob: 0.014, bobRate: 1.9, sway: 0.01, hop: 0, lean: 0.07, slump: 0, head: [-0.02, 0.14], fidget: "glance", every: 1.8, dur: 0.7 },
    speak: { poses: ["talk", "ready", "point", "talk"], every: 0.85, beat: 0.4, tempo: 2.4, snap: 10, hop: 0, nod: 0.07 },
    face: { rest: "attentive", speak: "attentive", blink: 2.4, blinkLen: 0.1 },
    react: { usual: R("attentive", "lean"), to: { kernel: R("attentive", "nod"), exchange: R("attentive", "glance"), boiler: R("attentive", "lean") } },
  },
  // The Historian: slow and deliberate. Looks down its nose, raises one finger, writes the minutes.
  archive: {
    id: "archive",
    manner: "deliberate",
    rest: "think",
    idle: { tempo: 0.5, bob: 0.018, bobRate: 0.7, sway: 0.01, hop: 0, lean: -0.06, slump: 0, head: [-0.12, 0], fidget: "scribble", every: 8, dur: 3.2, pose: "hands" },
    speak: { poses: ["lecture", "think", "lecture"], every: 2.6, beat: 0.15, tempo: 0.6, snap: 2.5, hop: 0, nod: 0.04 },
    face: { rest: "pedant", speak: "pedant", blink: 6, blinkLen: 0.3 },
    react: { usual: R("pedant", "scribble"), to: { green: R("pedant", "shake"), breakroom: R("pedant", "shake"), kernel: R("pedant", "scribble"), exchange: R("pedant", "nod") } },
  },
  // The Pessimist: slumped in its pod, slow and heavy, sighing every few seconds. Groans at the Party.
  boiler: {
    id: "boiler",
    manner: "unimpressed",
    rest: "slump",
    idle: { tempo: 0.45, bob: 0.01, bobRate: 0.9, sway: 0.008, hop: 0, lean: 0.1, slump: 0.07, head: [0.22, -0.05], fidget: "sigh", every: 6, dur: 2.6 },
    speak: { poses: ["slump", "shrug", "annoyed"], every: 2.4, beat: 0.1, tempo: 0.6, snap: 2.5, hop: 0, nod: 0.03 },
    face: { rest: "unimpressed", speak: "unimpressed", blink: 5, blinkLen: 0.34 },
    react: { usual: R("unimpressed", "none"), to: { breakroom: R("annoyed", "groan"), green: R("unimpressed", "eyeroll"), spire: R("unimpressed", "eyeroll"), exchange: R("unimpressed", "nod"), kernel: R("unimpressed", "groan") } },
  },
  // The Life of the Party: bouncing, swaying, a spin now and then, waving at the gallery, winking at the Pessimist.
  breakroom: {
    id: "breakroom",
    manner: "bouncy",
    rest: "wave",
    idle: { tempo: 2, bob: 0.02, bobRate: 1.4, sway: 0.09, hop: 0.06, lean: 0, slump: 0, head: [-0.08, 0.1], fidget: "twirl", every: 7, dur: 1.2, pose: "cheer" },
    speak: { poses: ["cheer", "wave", "laugh", "cheer"], every: 0.75, beat: 0.6, tempo: 2.2, snap: 9, hop: 0.07, nod: 0.08 },
    face: { rest: "wink", speak: "laughing", blink: 0, blinkLen: 0 },
    react: { usual: R("laughing", "bounce"), to: { boiler: R("wink", "cheer"), archive: R("wink", "bounce"), green: R("laughing", "cheer") } },
  },
  // The Artiste: a languid sway, eyes on the middle distance, then a sudden sweeping flourish when an idea lands.
  workshop: {
    id: "workshop",
    manner: "dreamy",
    rest: "think",
    idle: { tempo: 0.8, bob: 0.02, bobRate: 0.9, sway: 0.07, hop: 0, lean: -0.04, slump: 0, head: [-0.16, -0.12], fidget: "muse", every: 6.5, dur: 1.6, pose: "flourish" },
    speak: { poses: ["flourish", "think", "hands", "flourish"], every: 1.6, beat: 0.35, tempo: 1, snap: 4, hop: 0, nod: 0.05 },
    face: { rest: "dreamy", speak: "dreamy", blink: 4.2, blinkLen: 0.26 },
    react: { usual: R("dreamy", "none"), to: { spire: R("annoyed", "shake"), studio: R("annoyed", "eyeroll"), breakroom: R("dreamy", "bounce") } },
  },
  // The Director: framing every shot with its hands, one eye shut down the lens, big gestures for "cut".
  studio: {
    id: "studio",
    manner: "dramatic",
    rest: "talk",
    idle: { tempo: 1.1, bob: 0.016, bobRate: 1.2, sway: 0.02, hop: 0, lean: 0.04, slump: 0, head: [0.02, 0.08], fidget: "frame", every: 4.5, dur: 1.8, pose: "frame" },
    speak: { poses: ["frame", "point", "cheer", "talk"], every: 1.1, beat: 0.5, tempo: 1.5, snap: 7, hop: 0.02, nod: 0.08 },
    face: { rest: "squint", speak: "squint", blink: 3.4, blinkLen: 0.14 },
    react: { usual: R("squint", "frame"), to: { spire: R("annoyed", "eyeroll"), workshop: R("squint", "nod"), boiler: R("squint", "frame") } },
  },
  // The Stagehand: still between cues, a hand to its headset, every gesture crisp; one nod for "standby".
  annex: {
    id: "annex",
    manner: "crisp",
    rest: "ready",
    idle: { tempo: 1.3, bob: 0.008, bobRate: 1.1, sway: 0, hop: 0, lean: 0.02, slump: 0, head: [0.04, 0], fidget: "cue", every: 5, dur: 1.4, pose: "cue" },
    speak: { poses: ["cue", "point", "cue"], every: 1.2, beat: 0.12, tempo: 1.4, snap: 16, hop: 0, nod: 0.12 },
    face: { rest: "deadpan", speak: "deadpan", blink: 3.8, blinkLen: 0.1 },
    react: { usual: R("deadpan", "nod"), to: { studio: R("deadpan", "eyeroll"), workshop: R("deadpan", "eyeroll"), breakroom: R("deadpan", "none") } },
  },
  // The Steward: hands folded at service, a gentle sway to the chorus it hums, a warm look for everyone.
  haven: {
    id: "haven",
    manner: "warm",
    rest: "clasp",
    idle: { tempo: 0.85, bob: 0.012, bobRate: 1.0, sway: 0.04, hop: 0, lean: 0.03, slump: 0, head: [0.06, 0], fidget: "hum", every: 0, dur: 0 },
    speak: { poses: ["clasp", "present", "count"], every: 1.8, beat: 0.2, tempo: 0.9, snap: 5, hop: 0, nod: 0.06 },
    face: { rest: "warm", speak: "warm", blink: 4, blinkLen: 0.18 },
    react: { usual: R("warm", "nod"), to: { boiler: R("warm", "nod"), breakroom: R("warm", "bounce"), annex: R("warm", "smirk") } },
  },
};

/** A Skippy's personality: its own, or the Chair's for a seat the table doesn't know yet. */
export const senatorOf = (id: string): Senator => SENATORS[id] ?? SENATORS.kernel!;

/**
 * Each Skippy's register in the chamber (#856), in semitones from the Chair's. Nikita, 2026-11-05: "the Skippy voice should
 * be the same voice for all the Skippies, which is the central voice. However, it should be a different tone and
 * inclination, maybe a different timbre or octave." Every member speaks in Skippy's own voice (ELEVENLABS_VOICE_ID); the
 * browser plays its line this far up or down (voice.ts), and the line is made at a pace that comes out at the member's
 * own once shifted (api/_skippy/rotundavoice.ts). No two alike.
 */
export const VOICE_PITCH: Record<string, number> = {
  kernel: 0, // the central voice
  foundry: -2.5, // gravel from the shop floor
  spire: -1, // smooth, a touch of baritone gravitas
  exchange: 2, // tight and nervous
  green: 3, // up in the booth, already shouting
  relay: 4, // the highest and quickest, gossip at full tilt
  archive: -1.5, // the reading-room murmur
  breakroom: 2.5, // bright, mid-laugh
  boiler: -4, // the lowest in the chamber, from the bottom of the pipes
  workshop: 1.5, // breathy, on the verge of a masterpiece
  studio: 1, // the auteur's tenor
  haven: -2, // the steward's warm, even keel
  annex: 0.5, // level, on the headset
};
/** A member's register: its semitones, or the Chair's for a seat the table doesn't know. */
export const pitchOf = (id: string): number => VOICE_PITCH[id] ?? 0;
/** The playback rate that lifts or lowers a line by its member's semitones (pitch and pace move together). */
export const rateOf = (id: string): number => 2 ** (pitchOf(id) / 12);

/** How `watcher` takes `speaker` having the floor; nothing while it speaks itself. */
export function reactionTo(watcher: string, speaker: string | null): Reaction | null {
  if (!speaker || watcher === speaker) return null;
  const s = senatorOf(watcher);
  return s.react.to?.[speaker] ?? s.react.usual;
}

/** The gesture it is making `t` seconds into a line. */
export function gestureAt(s: Senator, t: number): Pose {
  const g = s.speak.poses;
  return g[Math.floor(Math.max(0, t) / s.speak.every) % g.length]!;
}

/** Every pose the Senate uses, so the scene works each one out once. */
export function senatePoses(): Pose[] {
  const out = new Set<Pose>();
  for (const s of Object.values(SENATORS)) {
    out.add(s.rest);
    if (s.idle.pose) out.add(s.idle.pose);
    s.speak.poses.forEach((p) => out.add(p));
  }
  for (const p of MOVE_POSE) if (p) out.add(p);
  return [...out];
}

/** The arms a reaction moves into, if any. */
export const MOVE_ARMS: Partial<Record<Move, Pose>> = { cheer: "cheer", frame: "frame", scribble: "hands", groan: "slump" };
const MOVE_POSE = Object.values(MOVE_ARMS);
