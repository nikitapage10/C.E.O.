import { CanvasTexture, Euler, Mesh, MeshStandardMaterial, Quaternion, SRGBColorSpace, type Bone, type Group, type Object3D, type SphereGeometry } from "three";
import { drawFace, FACE_H, FACE_W } from "../hologram/face.ts";
import { FACES, type Face, type Pose } from "../hologram/persona.ts";
import { ARMS, HEAD } from "../hologram/rig.ts";
import { gestureAt, MOVE_ARMS, reactionTo, senatorOf, type Reaction, type Senator } from "./senators.ts";

/**
 * One Skippy in the Senate, played from its row in senators.ts (#775): its can's arms and head, the can bobbing and
 * swaying in its pod, and a face that moves, drawn on a small canvas cast over the front of its head (the Talk
 * hologram's cap, rig.ts, fitted once and shared). Everything here is scratch state set up once; a frame allocates
 * nothing, and the face is only redrawn when it changes (a blink, a word, a new look), a few cans a frame at most.
 * Under reduced motion it holds still: no bob, no beats, no blinks, no fidgets; it still turns to a speaker's face and
 * pulls its own expression.
 */

export interface SenateRig {
  /** Each pose's arm rotations, worked out once from the bind pose. */
  poses: Map<Pose, Map<string, Quaternion>>;
  /** The face cap, fitted to the can's head (null if the model has none to fit). */
  capGeo: SphereGeometry | null;
  /** The face canvas's size: smaller on a phone. */
  faceW: number;
  faceH: number;
  reduce: boolean;
  /** Face redraws left this frame; the scene refills it each frame. */
  budget: number;
}

export interface Actor {
  id: string;
  P: Senator;
  inner: Group;
  y0: number;
  arms: (Bone | null)[];
  head: Bone | null;
  headBind: Quaternion;
  body: MeshStandardMaterial;
  cap: { ctx: CanvasRenderingContext2D; tex: CanvasTexture; mat: MeshStandardMaterial } | null;
  drawn: number;
  /** A fixed random number, so twelve watchers don't all react on the same frame. */
  seed: number;
  /** Its own clock (scaled by its tempo). */
  t: number;
  /** Seconds into the current line, and when the line ends (the scene's clock). */
  talkT: number;
  talkUntil: number;
  hx: number;
  hy: number;
  hz: number;
  nextBlink: number;
  blinkT: number;
  nextFidget: number;
  fidgetT: number;
  react: Reaction | null;
  reactT: number;
  /** The scene's inputs each frame: the head's turn toward whoever speaks (radians), and how lit it is (0 to 1). */
  look: number;
  amp: number;
}

const FACE_I = new Map<Face, number>(FACES.map((f, i) => [f, i]));
const REACT = 3.2;
const E = new Euler();
const Q = new Quaternion();
const QB = new Quaternion();
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeIO = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

/**
 * Sets a can up to act: call it on the clone before it is moved or posed (its root still at the model's own origin),
 * so the face cap lands on the head in the model's space.
 */
export function makeActor(id: string, model: Object3D, inner: Group, y0: number, body: MeshStandardMaterial, rig: SenateRig, keep: <T extends { dispose: () => void }>(x: T) => T): Actor {
  const bones = new Map<string, Bone>();
  model.traverse((o) => {
    if ((o as Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ""), o as Bone);
  });
  const head = bones.get("Head") ?? null;
  let cap: Actor["cap"] = null;
  if (rig.capGeo && head && typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = rig.faceW;
    c.height = rig.faceH;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.setTransform(rig.faceW / FACE_W, 0, 0, rig.faceH / FACE_H, 0, 0);
      const tex = keep(new CanvasTexture(c));
      tex.colorSpace = SRGBColorSpace;
      const mat = keep(new MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.35, metalness: 0, depthWrite: false }));
      const m = new Mesh(rig.capGeo, mat);
      m.renderOrder = 2;
      m.position.copy(HEAD.c);
      model.updateMatrixWorld(true);
      m.updateMatrixWorld(true);
      head.attach(m);
      cap = { ctx, tex, mat };
    }
  }
  const P = senatorOf(id);
  return {
    id,
    P,
    inner,
    y0,
    arms: ARMS.map((n) => bones.get(n) ?? null),
    head,
    headBind: head ? head.quaternion.clone() : new Quaternion(),
    body,
    cap,
    drawn: -1,
    seed: Math.random(),
    t: Math.random() * 10,
    talkT: 0,
    talkUntil: 0,
    hx: P.idle.head[0],
    hy: 0,
    hz: P.idle.head[1],
    nextBlink: 1 + Math.random() * 3,
    blinkT: -1,
    nextFidget: 1 + Math.random() * Math.max(1, P.idle.every),
    fidgetT: -1,
    react: null,
    reactT: 0,
    look: 0,
    amp: 1,
  };
}

/** Starts a line: it talks until `until` on the scene's clock. */
export function startTalk(a: Actor, now: number, until: number) {
  if (now >= a.talkUntil) a.talkT = 0;
  a.talkUntil = until;
}

/** A new speaker has the floor (or nobody, null): each other Skippy takes it its own way, a beat apart. */
export function onSpeaker(a: Actor, speaker: string | null) {
  const r = reactionTo(a.id, speaker);
  if (!r) return;
  a.react = r;
  a.reactT = -(0.12 + a.seed * 0.7);
}

/** One frame of one Skippy. `now` is the scene's clock; dt in seconds. */
export function stepActor(a: Actor, dt: number, now: number, rig: SenateRig) {
  const P = a.P;
  const I = P.idle;
  const S = P.speak;
  const reduce = rig.reduce;
  const mv = reduce ? 0 : 1;
  a.t += dt * I.tempo * mv;
  const talking = now < a.talkUntil;
  a.talkT = talking ? a.talkT + dt : 0;

  // Its reaction to whoever has the floor: in after its own beat, held, then let go.
  let re = 0;
  if (a.react) {
    a.reactT += dt;
    if (a.reactT > REACT || talking) a.react = null;
    else if (a.reactT > 0) re = Math.min(1, a.reactT / 0.35) * Math.min(1, (REACT - a.reactT) / 0.6);
  }
  const rm = a.react ? a.react.move : "none";

  // Its habit while it waits: now and then, or all the time.
  let fg = 0;
  if (!talking && mv) {
    if (I.every > 0) {
      if (a.fidgetT < 0 && now >= a.nextFidget) a.fidgetT = 0;
      if (a.fidgetT >= 0) {
        a.fidgetT += dt;
        fg = Math.sin(Math.PI * clamp01(a.fidgetT / I.dur));
        if (a.fidgetT >= I.dur) {
          a.fidgetT = -1;
          a.nextFidget = now + I.every * (0.7 + Math.random() * 0.6);
        }
      }
    } else fg = 1;
    fg *= 1 - re;
  }
  const fid = I.fidget;

  // The arms: its gestures in turn while it talks, a reaction's or a fidget's, else its resting pose.
  let pose: Pose = P.rest;
  if (talking) pose = reduce ? S.poses[0]! : gestureAt(P, a.talkT);
  else if (re > 0.3 && MOVE_ARMS[rm]) pose = MOVE_ARMS[rm]!;
  else if (fg > 0.3 && I.pose) pose = I.pose;
  const target = rig.poses.get(pose) ?? rig.poses.get(P.rest);
  const snap = reduce ? 1 : 1 - Math.exp(-dt * (talking ? S.snap : 4));
  if (target)
    for (let i = 0; i < 4; i++) {
      const b = a.arms[i];
      const tq = target.get(ARMS[i]!);
      if (!b || !tq) continue;
      Q.copy(tq);
      if (mv) {
        const fore = i === 1 || i === 3;
        const right = i >= 2;
        if (fore && talking) {
          const beat = Math.sin(a.t * S.tempo * 5.5 + (right ? 0 : 1.7)) * S.beat * (right ? 1 : 0.55);
          Q.multiply(QB.setFromEuler(E.set(beat, 0, 0)));
        } else if (fore && fid === "tinker") {
          const side = right ? Math.PI : 0;
          Q.multiply(QB.setFromEuler(E.set(Math.sin(a.t * 7 + side) * 0.22 * fg, Math.sin(a.t * 3.1 + side) * 0.12 * fg, 0)));
        } else if (fore && right && fid === "tap") {
          // The Bookie's finger, ticking off the odds.
          Q.multiply(QB.setFromEuler(E.set(Math.max(0, Math.sin(a.t * 9)) * 0.22, 0, 0)));
        } else if (fore && rm === "scribble" && re > 0) {
          Q.multiply(QB.setFromEuler(E.set(Math.sin(a.t * 11 + (right ? 0 : 2)) * 0.1 * re, 0, 0)));
        } else if (!fore && fid === "sigh" && fg > 0) {
          Q.multiply(QB.setFromEuler(E.set(0, 0, (right ? 1 : -1) * 0.1 * fg)));
        }
      }
      b.quaternion.slerp(Q, snap);
    }

  // The head: its resting tilt, a drift, a nod with the words, its habits, its reaction, and a turn toward the speaker.
  let hx = I.head[0];
  let hy = a.look;
  let hz = I.head[1];
  if (mv) {
    hx += Math.sin(a.t * 0.9) * 0.025;
    hy += Math.sin(a.t * 0.6 + a.seed * 6) * 0.05;
    if (talking) hx += Math.sin(a.t * S.tempo * 7) * S.nod;
    switch (fid) {
      case "tinker":
        hx += 0.08 * (0.5 + 0.5 * Math.sin(a.t * 0.8));
        break;
      case "preen":
        hx -= 0.12 * fg;
        hy += Math.sin(a.t * 1.2) * 0.3 * fg;
        break;
      case "tap":
      case "glance":
        hy += (Math.sin(a.t * 2.3 + a.seed * 5) > 0 ? 1 : -1) * 0.32 * fg;
        hz += 0.08 * fg;
        break;
      case "scribble":
      case "sigh":
        hx += 0.3 * fg;
        break;
      case "muse":
        hx -= 0.26 * fg;
        hz -= 0.1 * fg;
        break;
      case "frame":
      case "cue":
        hz += 0.12 * fg;
        hx += 0.04 * fg;
        break;
      case "hum":
        hz += Math.sin(a.t * 2.6) * 0.08 * fg;
        hx += Math.sin(a.t * 5.2) * 0.03 * fg;
        break;
      case "conduct":
        hx -= 0.06 * fg;
        break;
      default:
        break;
    }
    const rt = Math.max(0, a.reactT);
    switch (rm) {
      case "nod":
        hx += Math.sin(rt * 6 * Math.sqrt(I.tempo)) * 0.12 * re;
        break;
      case "shake":
        hy += Math.sin(rt * 10) * 0.2 * re;
        break;
      case "eyeroll":
        hx -= 0.16 * re;
        hz += 0.1 * re;
        break;
      case "groan":
        hx += 0.34 * re;
        break;
      case "cheer":
        hx -= 0.1 * re;
        break;
      case "lean":
        hx += 0.06 * re;
        hz += 0.08 * re;
        break;
      case "glance":
        hy += (Math.sin(rt * 5) > 0 ? 1 : -1) * 0.28 * re;
        break;
      case "smirk":
        hz += 0.12 * re;
        hx -= 0.06 * re;
        break;
      case "scribble":
        hx += 0.28 * re;
        break;
      case "frame":
        hz += 0.1 * re;
        break;
      default:
        break;
    }
  } else if (rm === "groan" && re > 0) hx += 0.2;
  const hk = reduce ? 1 : 1 - Math.exp(-dt * (talking ? 8 : 5));
  a.hx += (hx - a.hx) * hk;
  a.hy += (hy - a.hy) * hk;
  a.hz += (hz - a.hz) * hk;
  if (a.head) a.head.quaternion.copy(a.headBind).multiply(Q.setFromEuler(E.set(a.hx, a.hy, a.hz)));

  // The can in its pod: bob, sway, hop, lean, slump, and the Party's spin.
  let y = a.y0 - I.slump;
  let rx = I.lean;
  let ry = 0;
  let rz = 0;
  if (mv) {
    const amp = a.amp;
    y += Math.sin(a.t * I.bobRate) * I.bob * amp + Math.abs(Math.sin(a.t * I.bobRate * 2)) * I.hop * amp;
    if (talking) y += Math.abs(Math.sin(a.t * S.tempo * 6)) * S.hop;
    rz += Math.sin(a.t * I.bobRate * 0.7) * I.sway * amp;
    if (fid === "sigh") {
      y -= 0.05 * fg;
      rx += 0.08 * fg;
    } else if (fid === "lean") rx += 0.1 * fg;
    else if (fid === "twirl" && a.fidgetT >= 0) ry = easeIO(clamp01(a.fidgetT / I.dur)) * Math.PI * 2;
    const rt = Math.max(0, a.reactT);
    if (rm === "lean") rx += 0.1 * re;
    else if (rm === "bounce" || rm === "cheer") y += Math.abs(Math.sin(rt * 9)) * 0.05 * re;
    else if (rm === "groan") {
      y -= 0.05 * re;
      rx += 0.06 * re;
    }
  }
  a.inner.position.y = y;
  a.inner.rotation.set(rx, ry, rz);

  // The face: its own, the one it pulls at a speaker, or its talking face; a blink now and then; eyes that lead the head.
  const cap = a.cap;
  if (!cap) return;
  cap.mat.color.copy(a.body.color);
  const face: Face = talking ? P.face.speak : a.react && re > 0.15 ? a.react.face : P.face.rest;
  let oq = 0;
  if (talking) {
    if (reduce) oq = 1;
    else {
      const x = a.talkT * (0.6 + 0.4 * S.tempo);
      oq = Math.round(Math.abs(Math.sin(x * 8.1)) * (0.55 + 0.45 * Math.sin(x * 2.3 + 1)) * 3);
    }
  }
  let bq = 0;
  if (!reduce && P.face.blink > 0) {
    if (a.blinkT < 0 && now >= a.nextBlink) {
      a.blinkT = 0;
      a.nextBlink = now + P.face.blink * (0.55 + Math.random() * 0.9);
    }
    if (a.blinkT >= 0) {
      a.blinkT += dt;
      const u = a.blinkT / P.face.blinkLen;
      if (u >= 1) a.blinkT = -1;
      else bq = u < 0.25 || u > 0.75 ? 1 : 2;
    }
  }
  let lx = reduce ? 0 : Math.max(-24, Math.min(24, -a.hy * 40));
  let ly = 0;
  if (rm === "eyeroll" && re > 0) {
    const ph = clamp01(Math.max(0, a.reactT) / 1.3);
    lx = -Math.cos(ph * Math.PI) * 24 * re;
    ly = -(Math.sin(ph * Math.PI) * 26 + 8) * re;
  }
  const lxq = Math.round(lx / 6);
  const lyq = Math.round(ly / 6);
  const key = ((((FACE_I.get(face) ?? 0) * 4 + oq) * 3 + bq) * 16 + (lxq + 8)) * 16 + (lyq + 8);
  if (key === a.drawn || rig.budget <= 0) return;
  rig.budget--;
  a.drawn = key;
  drawFace(cap.ctx, face, oq / 3, bq / 2, lxq * 6, lyq * 6);
  cap.tex.needsUpdate = true;
}
