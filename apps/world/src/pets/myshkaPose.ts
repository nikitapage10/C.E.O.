import { AnimationMixer, Euler, LoopPingPong, LoopRepeat, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Bone, type Object3D } from "three";
import type { PetMode } from "./types.ts";

/*
 * How Myshka moves. His body is a Meshy export with no clips of its own; scripts/retarget-cat.mjs bakes four
 * onto it from other cat rigs (Walk, Run, Groom and a plain Sit), and this file plays them and adds everything
 * the clips don't do:
 *
 * - The gait follows his real speed: Walk and Run are cross-faded by how fast he's travelling and run at the
 *   rate that keeps his paws planted (each clip knows its stride), so he never skates across the floor. A slow
 *   amble, a brisk walk, and a flat-out gallop for the zoomies.
 * - Idle: standing, breathing, looking about, weight shifting, ears swivelling, tail swishing.
 * - Sit: the baked sit, with his head free to look around.
 * - Nap: a loaf, built on his own skeleton, legs tucked, chin down, tail wrapped round, slow breathing.
 * - Stretch: getting up from a nap he does the long front stretch first, chest down and rump up.
 * - Groom: the baked clip, sitting and washing a paw and his face.
 * - Carriage: head up and chest in, mostly on the walk, whose source rig carries its head low (MYSHKA_CARRIAGE).
 * - On top of all of it a "life" layer: ear flicks, tail sway, looking at things, which runs through the clips too.
 *
 * Procedural turns are about the cat's own axes (+Y up, +Z forward, +X his left), applied after the mixer, so
 * they stack on whatever the clips are doing.
 */

/** His SmartRig bones by role. Sides are his own: L is his left, +X when he faces +Z. */
export const MYSHKA_BONES = {
  root: "Bone_000",
  hips: "Bone_001",
  spine1: "Bone_003",
  spine2: "Bone_002",
  chest: "Bone_026",
  chest2: "Bone_025",
  shoulders: "Bone_024",
  neck1: "Bone_028",
  neck2: "Bone_027",
  head: "Bone_036",
  face: "Bone_035",
  jaw: "Bone_069",
  /** The ruff under his chin. The export models it jutting forward; see MYSHKA_RUFF. */
  ruff: "Bone_034",
  /** The fur hanging off his chin down the front of his throat: from the side, it's what reads as his chest. */
  bib: "Bone_071",
  earL: "Bone_062",
  earR: "Bone_064",
  /** Shoulder, elbow, forearm, paw, toes, toe tips. */
  foreL: ["Bone_032", "Bone_031", "Bone_050", "Bone_049", "Bone_048", "Bone_047"],
  foreR: ["Bone_030", "Bone_029", "Bone_043", "Bone_042", "Bone_041", "Bone_040"],
  /** Thigh, shin, hock, foot, toes. */
  hindL: ["Bone_009", "Bone_008", "Bone_007", "Bone_006", "Bone_005"],
  hindR: ["Bone_015", "Bone_014", "Bone_013", "Bone_012", "Bone_011"],
  /** Base to tip. */
  tail: ["Bone_021", "Bone_020", "Bone_019", "Bone_018", "Bone_017", "Bone_016"],
} as const;

/** The ruff is pulled in: shrunk about its root and tipped back toward the chest, so it sits like fur, not a bib. */
export const MYSHKA_RUFF = { scale: 0.6, tuck: 0.45 };

/**
 * How he carries his head and chest. The baked Walk comes from a rig that walks head-low, so on his body the neck
 * runs flat out from the shoulders, the head drops to shoulder height and the bib under his chin juts out ahead of
 * his forelegs like a ship's prow. `gait` lifts the shoulders and neck back up (the forelegs turn back by the same
 * amount, so the paws land where the clip puts them), levels the head again and tucks the bib in under his chin.
 * It is full on the walk and most of the way on the run; `rest` is a lighter tuck for everything else.
 */
export const MYSHKA_CARRIAGE = {
  gait: { shoulders: -0.25, neck1: -0.25, neck2: -0.15, head: 0.4, bib: 0.35, ruff: 0 },
  rest: { shoulders: 0, neck1: -0.06, neck2: 0, head: 0.06, bib: 0.15, ruff: 0.1 },
  /** How much of `gait` the run gets. */
  run: 0.6,
};

/** Clip names as baked, and how fast each gait plays at its natural pace, in model units a second. */
export const MYSHKA_CLIPS = { walk: "Walk", run: "Run", groom: "Groom", sit: "Sit" } as const;

/** Tuning. Speeds in model units a second (he's 1.7 tall and 2.7 long at rest). */
export const MYSHKA_GAIT = {
  /** Below this he's standing; above it the walk fades in. */
  still: 0.25,
  /** Walk fades out and the gallop in across this band. */
  runFrom: 3.4,
  runTo: 5.2,
  /** How far the gaits are allowed to speed up or slow down before his feet are allowed to slide a little. */
  walkRate: [0.55, 2.2] as const,
  runRate: [0.7, 2.4] as const,
  /** Seconds a stretch takes on getting up. */
  stretch: 2.6,
};

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const bump = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x));

type Turn = [number, number, number];
interface Pose {
  turns: Map<string, Turn>;
  lift: number;
}

function add(p: Pose, name: string | undefined, x = 0, y = 0, z = 0) {
  if (!name) return;
  const t = p.turns.get(name);
  if (t) {
    t[0] += x;
    t[1] += y;
    t[2] += z;
  } else p.turns.set(name, [x, y, z]);
}

interface Ear {
  /** When the next flick starts, and how far through the current one we are. */
  next: number;
  at: number;
  yaw: number;
  pitch: number;
}

export class MyshkaRig {
  readonly model: Object3D;
  private readonly order: Bone[];
  private readonly rest: Map<Bone, Quaternion>;
  private readonly root: Bone;
  private readonly rootRest: Vector3;
  private readonly mixer: AnimationMixer;
  private readonly actions: Partial<Record<keyof typeof MYSHKA_CLIPS, AnimationAction>> = {};
  private readonly pace: Partial<Record<keyof typeof MYSHKA_CLIPS, number>> = {};
  /** Clip weights, eased. */
  private readonly w = { walk: 0, run: 0, groom: 0, sit: 0 };
  /** Procedural weights, eased. */
  private readonly pw = { idle: 1, nap: 0, stretch: 0 };
  private mode: PetMode = "idle";
  private stretchUntil = -1;
  private look = 0;
  private lookTarget = 0;
  private lookPitch = 0;
  private lookPitchTarget = 0;
  private nextLook = 0;
  private readonly ears: [Ear, Ear] = [
    { next: 1, at: 1, yaw: 0, pitch: 0 },
    { next: 2.5, at: 1, yaw: 0, pitch: 0 },
  ];
  private tailFlick = 0;
  private nextFlick = 3;
  private shift = 0;
  private shiftTarget = 0;
  private nextShift = 0;
  /** Extra turns stacked on top, for tuning poses from the harness. */
  extra: Map<string, Turn> | null = null;

  constructor(model: Object3D, clips: AnimationClip[]) {
    this.model = model;
    const bones = new Map<string, Bone>();
    this.order = [];
    model.traverse((o) => {
      const b = o as Bone;
      if (b.isBone) {
        bones.set(b.name, b);
        this.order.push(b);
      }
    });
    this.rest = new Map(this.order.map((b) => [b, b.quaternion.clone()]));
    this.root = bones.get(MYSHKA_BONES.root)!;
    bones.get(MYSHKA_BONES.ruff)?.scale.setScalar(MYSHKA_RUFF.scale);
    this.rootRest = this.root.position.clone();
    this.mixer = new AnimationMixer(model);
    for (const [key, name] of Object.entries(MYSHKA_CLIPS) as [keyof typeof MYSHKA_CLIPS, string][]) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      a.setLoop(key === "sit" ? LoopPingPong : LoopRepeat, Infinity);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.actions[key] = a;
      const stride = (clip.userData as { stride?: number }).stride;
      if (stride) this.pace[key] = stride / clip.duration;
    }
    // Slow the tiny sit loop right down: it's a breath, not a fidget.
    this.actions.sit?.setEffectiveTimeScale(0.35);
  }

  dispose() {
    this.mixer.stopAllAction();
  }

  /**
   * Pose him for `mode`. `t` is the render clock in seconds, `speed` how fast he's travelling in model units a
   * second.
   */
  update(mode: PetMode, t: number, dt: number, speed: number) {
    const g = MYSHKA_GAIT;
    if (mode !== this.mode) {
      // Up from a nap: stretch first, unless there's somewhere to be.
      if (this.mode === "nap" && (mode === "idle" || mode === "sit")) this.stretchUntil = t + g.stretch;
      this.mode = mode;
    }
    const stretching = t < this.stretchUntil && speed < g.still;
    const moving = speed > g.still;

    // --- what should be showing
    const run = smooth((speed - g.runFrom) / (g.runTo - g.runFrom));
    const gait = moving ? smooth((speed - g.still) / g.still) : 0;
    const want = {
      walk: gait * (1 - run),
      run: gait * run,
      groom: !moving && !stretching && mode === "groom" ? 1 : 0,
      sit: !moving && !stretching && mode === "sit" ? 1 : 0,
    };
    const wantP = {
      nap: !moving && !stretching && mode === "nap" ? 1 : 0,
      stretch: stretching ? 1 : 0,
      idle: 0,
    };
    wantP.idle = Math.max(0, 1 - want.walk - want.run - want.groom - want.sit - wantP.nap - wantP.stretch);

    // Gaits change quickly, poses settle.
    const easeGait = 1 - Math.exp(-dt * 8);
    const easePose = 1 - Math.exp(-dt * (mode === "nap" ? 1.6 : 3));
    for (const k of Object.keys(this.w) as (keyof typeof this.w)[]) {
      const fast = k === "walk" || k === "run";
      this.w[k] += (want[k] - this.w[k]) * (fast ? easeGait : easePose);
      if (this.w[k] < 1e-3 && want[k] === 0) this.w[k] = 0;
      this.actions[k]?.setEffectiveWeight(this.w[k]);
    }
    for (const k of Object.keys(this.pw) as (keyof typeof this.pw)[]) this.pw[k] += (wantP[k] - this.pw[k]) * easePose;

    // Play the gaits at the rate that plants the paws.
    const rate = (key: "walk" | "run", band: readonly [number, number]) => {
      const pace = this.pace[key];
      const a = this.actions[key];
      if (!a) return;
      const r = pace ? speed / pace : 1;
      // A gait fading out keeps going at its last rate, so he finishes the step he's in.
      if (this.w[key] > 0.02) a.setEffectiveTimeScale(Math.min(band[1], Math.max(band[0], r)));
    };
    rate("walk", g.walkRate);
    rate("run", g.runRate);

    // --- bones back to rest, clips on top
    for (const b of this.order) b.quaternion.copy(this.rest.get(b)!);
    this.root.position.copy(this.rootRest);
    this.mixer.update(dt);

    // --- procedural layers
    this.fidget(t, dt, mode);
    const p: Pose = { turns: new Map(), lift: 0 };
    add(p, MYSHKA_BONES.ruff, MYSHKA_RUFF.tuck);
    this.carriage(p);
    const clipW = this.w.walk + this.w.run + this.w.groom + this.w.sit;
    const life = 1 - this.w.run * 0.8 - this.w.groom;
    this.life(p, t, Math.max(0, life), mode);
    this.idlePose(p, t, this.pw.idle * (1 - clipW));
    this.napPose(p, t, this.pw.nap);
    this.stretchPose(p, t, this.pw.stretch);
    if (this.extra) for (const [name, turn] of this.extra) add(p, name, ...turn);

    for (const b of this.order) {
      const turn = p.turns.get(b.name);
      if (!turn) continue;
      // Turn the bone about the cat's own axes: local' = P⁻¹ · R · P · local.
      parentTurn(this.model, b, pq);
      rq.setFromEuler(e.set(turn[0], turn[1], turn[2]));
      q.copy(pq).invert().multiply(rq).multiply(pq);
      b.quaternion.premultiply(q);
    }
    this.root.position.y += p.lift;
  }

  /** Head up and chest in: a lot on the walk, a touch everywhere else (see MYSHKA_CARRIAGE). */
  private carriage(p: Pose) {
    const B = MYSHKA_BONES;
    const c = MYSHKA_CARRIAGE;
    const g = Math.min(1, this.w.walk + this.w.run * c.run);
    const turn = (k: keyof typeof c.gait) => c.gait[k] * g + c.rest[k] * (1 - g);
    const shoulders = turn("shoulders");
    add(p, B.shoulders, shoulders);
    add(p, B.foreL[0], -shoulders);
    add(p, B.foreR[0], -shoulders);
    add(p, B.neck1, turn("neck1"));
    add(p, B.neck2, turn("neck2"));
    add(p, B.head, turn("head"));
    add(p, B.bib, turn("bib"));
    add(p, B.ruff, turn("ruff"));
  }

  /** The slow, wandering attention, ear flicks and tail flicks, timed. */
  private fidget(t: number, dt: number, mode: PetMode) {
    if (t > this.nextLook) {
      this.lookTarget = (Math.random() - 0.5) * (mode === "nap" ? 0.3 : 1.3);
      this.lookPitchTarget = (Math.random() - 0.4) * 0.35;
      this.nextLook = t + 1.5 + Math.random() * 4;
    }
    const k = 1 - Math.exp(-dt * 3.5);
    this.look += (this.lookTarget - this.look) * k;
    this.lookPitch += (this.lookPitchTarget - this.lookPitch) * k;
    for (const ear of this.ears) {
      if (t > ear.next) {
        ear.at = 0;
        ear.yaw = (Math.random() - 0.5) * 0.9;
        ear.pitch = -0.25 - Math.random() * 0.35;
        ear.next = t + 1.5 + Math.random() * 6;
      }
      ear.at = Math.min(1, ear.at + dt / 0.32);
    }
    if (t > this.nextFlick) {
      this.tailFlick = 0;
      this.nextFlick = t + 2 + Math.random() * 6;
    }
    this.tailFlick = Math.min(1, this.tailFlick + dt / 0.6);
    if (t > this.nextShift) {
      this.shiftTarget = (Math.random() - 0.5) * 0.06;
      this.nextShift = t + 3 + Math.random() * 6;
    }
    this.shift += (this.shiftTarget - this.shift) * (1 - Math.exp(-dt * 1.2));
  }

  /** Runs through everything: breathing, ears, tail, and where he's looking. */
  private life(p: Pose, t: number, w: number, mode: PetMode) {
    if (w < 1e-3) return;
    const B = MYSHKA_BONES;
    const napping = this.pw.nap;
    const breath = Math.sin(t * (2.6 - napping * 1.4));
    add(p, B.chest, 0.012 * breath * w);
    add(p, B.spine2, -0.008 * breath * w);
    // Attention: the neck turns most of the way, the head finishes it, the ears lead it.
    const look = this.look * (1 - napping * 0.7) * w;
    const pitch = this.lookPitch * (1 - napping) * w;
    add(p, B.neck1, pitch * 0.4, look * 0.35);
    add(p, B.neck2, pitch * 0.3, look * 0.25);
    add(p, B.head, pitch * 0.3, look * 0.4, -look * 0.08);
    for (const [i, ear] of this.ears.entries()) {
      const side = i === 0 ? 1 : -1;
      const flick = bump(ear.at);
      // Ears swivel toward what he's looking at, and flick on their own.
      add(p, i === 0 ? B.earL : B.earR, (ear.pitch * flick + 0.03 * breath) * w, (ear.yaw * flick + look * 0.5) * w, side * flick * 0.2 * w);
    }
    // Tail: a slow sway that travels down to the tip, with the odd flick of the end.
    const sway = 0.6 + 0.4 * Math.sin(t * 0.13);
    const tailW = w * (1 - this.w.walk * 0.6) * (1 - napping * 0.85);
    const flick = bump(this.tailFlick);
    for (const [i, bone] of B.tail.entries()) {
      const ph = t * 1.1 * sway - i * 0.55;
      add(p, bone, 0.025 * Math.sin(ph * 0.7) * tailW, (0.06 + 0.035 * i) * Math.sin(ph) * tailW + (i >= 3 ? flick * 0.35 * (i - 2) * 0.5 * tailW : 0));
    }
    // When he sits the tail is wrapped round his feet; curl it a little further and let the tip twitch.
    if (this.w.sit > 0.01 && mode === "sit") add(p, B.tail[5], 0, flick * 0.4 * this.w.sit * w);
  }

  /** Standing: weight shifting from paw to paw, head carried easy. */
  private idlePose(p: Pose, t: number, w: number) {
    if (w < 1e-3) return;
    const B = MYSHKA_BONES;
    add(p, B.hips, 0, 0, this.shift * 0.5 * w);
    add(p, B.shoulders, 0, 0, -this.shift * 0.8 * w);
    add(p, B.neck1, -0.08 * w, 0, this.shift * 0.3 * w);
    // Now and then the head cocks.
    add(p, B.head, 0, 0, 0.18 * Math.max(0, Math.sin(t * 0.29)) ** 8 * w);
  }

  /** The loaf: legs tucked under, chin down, tail wrapped round his side. */
  private napPose(p: Pose, t: number, w: number) {
    if (w < 1e-3) return;
    const B = MYSHKA_BONES;
    const breath = Math.sin(t * 1.2);
    // Forelegs: upper arm back so the elbow meets the floor, forearm and paw flat along it, pointing forward.
    for (const leg of [B.foreL, B.foreR]) {
      add(p, leg[0], 0.95 * w);
      add(p, leg[2], -2.65 * w);
      add(p, leg[3], 0.55 * w);
    }
    // Hind legs: thigh forward and down to a knee at his side, shin back along the floor, foot forward under him.
    for (const [i, leg] of [B.hindL, B.hindR].entries()) {
      const side = i === 0 ? 1 : -1;
      add(p, leg[0], -0.8 * w, side * 0.1 * w, side * 0.22 * w);
      add(p, leg[1], 1.0 * w);
      add(p, leg[2], -1.75 * w);
    }
    // Back level and a touch rounded, chin down over the paws.
    add(p, B.spine1, -0.06 * w);
    add(p, B.chest, 0.06 * w + 0.015 * breath * w);
    add(p, B.neck1, 0.38 * w);
    add(p, B.neck2, 0.22 * w);
    add(p, B.head, 0.12 * w, 0, 0.05 * w);
    // Ears back and relaxed.
    add(p, B.earL, 0.25 * w, 0.3 * w, 0.2 * w);
    add(p, B.earR, 0.25 * w, -0.3 * w, -0.2 * w);
    // Tail down to the floor and wrapped round his left side.
    add(p, B.tail[0], 0.4 * w, 0.9 * w);
    add(p, B.tail[1], 0.2 * w, 0.7 * w);
    add(p, B.tail[2], 0.15 * w, 0.6 * w);
    add(p, B.tail[3], 0.1 * w, 0.5 * w);
    add(p, B.tail[4], 0, 0.4 * w);
    add(p, B.tail[5], 0, 0.2 * w + 0.1 * Math.sin(t * 0.9) * w);
    p.lift -= (0.42 + 0.006 * breath) * w;
  }

  /** The long front stretch on getting up: paws reach forward, chest drops, rump stays high, then he shakes it off. */
  private stretchPose(p: Pose, t: number, w: number) {
    if (w < 1e-3) return;
    const B = MYSHKA_BONES;
    const g = MYSHKA_GAIT;
    const u = 1 - (this.stretchUntil - t) / g.stretch;
    // In over the first third, hold, out over the last quarter; a little tremble at full reach.
    const s = (smooth(u / 0.35) - smooth((u - 0.75) / 0.25)) * w;
    const tremble = 0.02 * Math.sin(t * 22) * bump((u - 0.3) / 0.45) * w;
    // The whole body tips forward about the hips: chest down between the forelegs, rump up on the hind legs.
    add(p, B.hips, 0.42 * s + tremble);
    add(p, B.spine1, 0.08 * s);
    add(p, B.spine2, 0.08 * s);
    for (const leg of [B.foreL, B.foreR]) {
      add(p, leg[0], -1.45 * s);
      add(p, leg[2], 0.15 * s);
      add(p, leg[3], 0.7 * s);
      add(p, leg[4], 0.25 * s);
    }
    // The hind legs stay planted under him as the pelvis tips.
    for (const leg of [B.hindL, B.hindR]) {
      add(p, leg[0], -0.48 * s);
      add(p, leg[1], 0.08 * s);
    }
    // Head comes up to look ahead, ears forward, tail up.
    add(p, B.neck1, -0.4 * s);
    add(p, B.neck2, -0.3 * s);
    add(p, B.head, -0.15 * s);
    add(p, B.earL, -0.2 * s, -0.15 * s);
    add(p, B.earR, -0.2 * s, 0.15 * s);
    add(p, B.tail[0], 0.5 * s);
    add(p, B.tail[2], 0.25 * s);
    p.lift -= 0.03 * s;
    // Then a shake, head first, down the spine.
    const shake = bump((u - 0.72) / 0.28) * w;
    const wob = Math.sin(t * 34);
    add(p, B.head, 0, 0.3 * wob * shake, 0.12 * wob * shake);
    add(p, B.neck1, 0, 0.12 * Math.sin(t * 34 - 0.6) * shake);
    add(p, B.chest, 0, 0.06 * Math.sin(t * 34 - 1.2) * shake, 0.05 * Math.sin(t * 34 - 1.2) * shake);
    add(p, B.earL, 0, 0.4 * wob * shake);
    add(p, B.earR, 0, 0.4 * wob * shake);
  }
}

const q = new Quaternion();
const pq = new Quaternion();
const rq = new Quaternion();
const e = new Euler(0, 0, 0, "YXZ");

/** The bone's parent's turn relative to the model, as posed so far. */
function parentTurn(model: Object3D, bone: Bone, out: Quaternion) {
  out.identity();
  for (let o = bone.parent; o && o !== model; o = o.parent) out.premultiply(o.quaternion);
  return out;
}

