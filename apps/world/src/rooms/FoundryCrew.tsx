import { FOUNDRY_FLOOR, detour, lookFromPreset, type Look } from "@ceo/core";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, Color, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type Group, type Material, type Mesh } from "three";
import { Body, topOf } from "../agents/bodies/Body.tsx";
import { Plate } from "../agents/Nameplate.tsx";
import { crateCard } from "../agents/taskCard.ts";
import { onTask } from "../agents/taskLine.ts";
import type { Drive } from "../agents/bodies/types.ts";
import { useCast } from "../cast/castStore.ts";
import { clock } from "../clock.ts";
import { Beam } from "../fx/atmos.tsx";
import { PBR } from "../fx/pbr.ts";
import { CREW, DOCK_CREW, MODEL, blueprintCrate, dockJobs, sparesAwake, useFoundry, type ChecksState, type Crate, type CrewId } from "../foundry.ts";
import { useWorld } from "../store.ts";
import { Block } from "./primitives.tsx";

/**
 * The Foundry crew's own corners, so the room shows what each of them is really doing even when it's quiet:
 * - Rusty's dock against the left wall, where his dock crew (Dusty, Gusty, Musty) sleep. One wakes for each job really
 *   running past his own, rolls out to the assembly line and works it alongside him, then rolls home and powers
 *   down when it's done (`sparesAwake`).
 * - Rocky's drafting table, with the plan of the biggest open or upcoming idea on it (`blueprintCrate`).
 * - Rivet's alarm post, with a lamp that shows the real state of the checks on main.
 * - A work light on every bench in the model of whoever is working there: Haiku, Sonnet or Opus.
 */

/** Asked every frame: whose model a work light should show, or null for dark. */
type Reader = (() => CrewId | null) | null;

/* ------------------------------------------------------------------ work lights */

const tagCache = new Map<string, CanvasTexture>();

/** The little lit plate on a work light's base: the model's name in its colour. */
function tagTexture(who: CrewId | null): CanvasTexture {
  const key = who ?? "none";
  const had = tagCache.get(key);
  if (had) return had;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 72;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, 256, 72);
  const colour = who ? MODEL[who].colour : "#59606b";
  ctx.strokeStyle = colour;
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 248, 64);
  ctx.fillStyle = colour;
  ctx.font = "bold 40px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(who ? MODEL[who].name.toUpperCase() : "OFF", 128, 38);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tagCache.set(key, tex);
  return tex;
}

const OFF = new Color("#1a1c20");

/**
 * A bench work light: a jointed arm lamp whose bulb and name plate show the model of whoever is working at the
 * bench (Haiku, Sonnet, Opus), and go dark when nobody is. `read` is asked every frame.
 */
function WorkLight({ position, rotation = 0, read }: { position: [number, number, number]; rotation?: number; read: Reader }) {
  const bulb = useMemo(() => new MeshStandardMaterial({ color: "#111", emissive: "#000", emissiveIntensity: 3, toneMapped: false }), []);
  const glow = useMemo(() => new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), []);
  const tag = useMemo(() => new MeshBasicMaterial({ map: tagTexture(null), toneMapped: false }), []);
  const shown = useRef<CrewId | null | undefined>(undefined);
  const level = useRef(0);
  useEffect(
    () => () => {
      bulb.dispose();
      glow.dispose();
      tag.dispose();
    },
    [bulb, glow, tag],
  );
  useFrame((_, dt) => {
    const who = read ? read() : null;
    level.current += ((who ? 1 : 0) - level.current) * Math.min(1, dt * 4);
    if (who !== shown.current && (who || level.current < 0.05)) {
      shown.current = who;
      tag.map = tagTexture(who ?? null);
      if (who) {
        bulb.emissive.set(MODEL[who].colour);
        glow.color.set(MODEL[who].colour);
      }
    }
    bulb.emissiveIntensity = 0.05 + level.current * 3.2;
    if (level.current < 0.02) bulb.emissive.copy(OFF);
    glow.opacity = level.current * 0.12;
    tag.color.setScalar(0.25 + level.current * 0.75);
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Block size={[0.3, 0.04, 0.16]} position={[0, 0.02, 0]} material={PBR.blackMetal()} radius={0.01} />
      {/* The name plate, facing the hall. */}
      <mesh position={[0, 0.075, 0.082]} rotation={[-0.3, 0, 0]} material={tag}>
        <planeGeometry args={[0.28, 0.08]} />
      </mesh>
      {/* Jointed arm: up and a little back, then forward over the bench, the shade tipped down at the worker (-z). */}
      <group position={[0, 0.04, 0]} rotation={[0.25, 0, 0]}>
        <mesh position={[0, 0.17, 0]} material={PBR.steel()}>
          <cylinderGeometry args={[0.012, 0.012, 0.34, 8]} />
        </mesh>
        <group position={[0, 0.34, 0]} rotation={[-1.35, 0, 0]}>
          <mesh position={[0, 0.12, 0]} material={PBR.steel()}>
            <cylinderGeometry args={[0.01, 0.01, 0.24, 8]} />
          </mesh>
          <group position={[0, 0.24, 0]} rotation={[1.7, 0, 0]}>
            <mesh material={PBR.lacquer("#2a2f36", 0.4)} castShadow>
              <coneGeometry args={[0.08, 0.11, 20, 1, true]} />
            </mesh>
            <mesh position={[0, -0.03, 0]} material={bulb}>
              <sphereGeometry args={[0.035, 12, 12]} />
            </mesh>
            <LightCone material={glow} />
          </group>
        </group>
      </group>
    </group>
  );
}

/** A soft cone of light under a lamp's shade, faded with the lamp. */
function LightCone({ material }: { material: MeshBasicMaterial }) {
  return (
    <mesh position={[0, -0.32, 0]} material={material}>
      <coneGeometry args={[0.2, 0.55, 20, 1, true]} />
    </mesh>
  );
}

/** Whoever of the crew is working at a station right now (there, not walking, and at it rather than idling or asleep). */
export function crewAt(station: string): CrewId | null {
  const { lattice } = useWorld.getState();
  for (const who of Object.keys(CREW) as CrewId[]) {
    const rt = lattice.agents[who];
    if (!rt || rt.place.room !== "foundry" || rt.place.station !== station) continue;
    if (rt.motion && clock.sim < rt.motion.startTs + rt.motion.duration) continue;
    if (rt.activity !== "working" && rt.activity !== "typing") continue;
    return who;
  }
  return null;
}

/** The light on one of the crew's own benches (A and B), on the desk beside the monitors. */
export function BenchLight({ station, position }: { station: string; position: [number, number, number] }) {
  const read = useMemo(() => () => crewAt(station), [station]);
  return <WorkLight position={position} read={read} />;
}

/* ------------------------------------------------------------------ the dock and the dock crew */

type Phase = "docked" | "waking" | "out" | "working" | "back" | "parking";
type Waypoint = { x: number; z: number; reverse?: boolean };

/** How the dock crew move: a careful roll, slower than a walk. */
const ROLL_SPEED = 1.1;
const WAKE_S = 1.6;
const SLEEP_S = 1.8;
/** How far out of its bay (into the hall, +x) one of the dock crew rolls before it turns for the line. */
const BAY_APRON = 1.05;
/** Parked in the bay, facing into the hall (+x). */
const BAY_YAW = Math.PI / 2;
/** At the line, facing the belt (-z). */
const LINE_YAW = Math.PI;

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

interface UnitState {
  phase: Phase;
  x: number;
  z: number;
  yaw: number;
  power: number;
  path: Waypoint[];
}

/** Captured materials of one of the dock crew's bodies, so it can be painted and dimmed without touching Rusty himself. */
type Dimmable = { mat: MeshStandardMaterial; color: Color; intensity: number; env: number };

/**
 * Its own paint: the rust frame's texture greyed down and washed in the crew member's colour, so Dusty, Gusty and
 * Musty read as three different salvage robots and none of them as Rusty.
 */
function paint(mat: MeshStandardMaterial, colour: string): void {
  const tint = { value: new Color(colour) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaint = tint;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uPaint;")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\n{ float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * l * 2.3, 0.9); }",
      );
  };
  mat.customProgramCacheKey = () => "dock-crew-paint";
  mat.needsUpdate = true;
}

/**
 * A dock crew member's name plate while it's out on the line: its name, the job it's on ("#43 · Speeding up the
 * Lattice") and the card with the detail on hover, the same as the crew's own plates.
 */
function DockPlate({ index, job, look }: { index: number; job: Crate; look: Look }) {
  const inRoom = useWorld((s) => s.focus === "foundry");
  const { name, colour } = DOCK_CREW[index]!;
  const text = onTask({ title: `#${job.number} ${job.title}`, status: "running", number: job.number, short: job.short });
  if (!inRoom || !text) return null;
  return <Plate y={topOf(look, 0) + 0.32} name={name} accent={colour} line={{ icon: "work", text }} card={crateCard(job, "tessellate", { hands: name })} />;
}

function SpareUnit({ index, active, look, state, job }: { index: number; active: boolean; look: Look; state: UnitState; job: Crate | null }) {
  const [bx, bz] = FOUNDRY_FLOOR.bays[index]!;
  const [sx, sz] = FOUNDRY_FLOOR.lineSpots[index]!;
  const colour = DOCK_CREW[index]!.colour;
  const root = useRef<Group>(null);
  const drive = useRef<Drive>({ mode: "napping", moving: false, t: 0, speaking: false });
  const dims = useRef<{ list: Dimmable[]; seen: WeakSet<Mesh>; checked: number }>({ list: [], seen: new WeakSet(), checked: -1 });
  const pad = useMemo(() => new MeshStandardMaterial({ color: "#111", emissive: "#ff5a4a", emissiveIntensity: 0.5, toneMapped: false }), []);
  /** The body's own clock, held still while it sleeps on the dock. */
  const bodyT = useRef(0);
  const phase = index * 2.3 + 0.7;
  useEffect(() => () => pad.dispose(), [pad]);

  const apron: [number, number] = [bx + BAY_APRON, bz];
  const outPath = (fx: number, fz: number): Waypoint[] => {
    // From the bay, roll straight out into the hall first, then find the way to the line.
    const start: [number, number] = fx < apron[0] - 0.05 && Math.abs(fz - bz) < 0.3 ? apron : [fx, fz];
    const lead: Waypoint[] = start[0] === fx && start[1] === fz ? [] : [{ x: start[0], z: start[1] }];
    return [...lead, ...detour("foundry", start, [sx, sz]).map(([x, z]) => ({ x, z })), { x: sx, z: sz }];
  };
  const backPath = (fx: number, fz: number): Waypoint[] => [
    ...detour("foundry", [fx, fz], apron).map(([x, z]) => ({ x, z })),
    { x: apron[0], z: apron[1] },
    // Backs into the bay, facing the hall, the way a careful robot parks.
    { x: bx, z: bz, reverse: true },
  ];

  useFrame(({ clock: three }, dt) => {
    const s = state;
    const step = Math.min(dt, 1);
    // What it wants: out and working the line, or home and asleep.
    if (active) {
      if (s.phase === "docked" || s.phase === "parking") s.phase = "waking";
      else if (s.phase === "back") {
        s.path = outPath(s.x, s.z);
        s.phase = "out";
      }
    } else if (s.phase === "waking") s.phase = "parking";
    else if (s.phase === "out" || s.phase === "working") {
      s.path = backPath(s.x, s.z);
      s.phase = "back";
    }

    let mode: Drive["mode"] = "napping";
    let moving = false;
    let wantYaw = s.yaw;
    switch (s.phase) {
      case "docked":
        s.power = 0;
        wantYaw = BAY_YAW;
        break;
      case "waking":
        s.power = Math.min(1, s.power + step / WAKE_S);
        mode = s.power > 0.6 ? "waiting" : "napping";
        wantYaw = BAY_YAW;
        if (s.power >= 1) {
          s.path = outPath(s.x, s.z);
          s.phase = "out";
        }
        break;
      case "parking":
        s.power = Math.max(0, s.power - step / SLEEP_S);
        mode = s.power > 0.5 ? "idle" : "napping";
        wantYaw = BAY_YAW;
        if (s.power <= 0) s.phase = "docked";
        break;
      case "working":
        mode = "working";
        wantYaw = LINE_YAW;
        break;
      case "out":
      case "back": {
        const next = s.path[0];
        if (!next) {
          s.phase = s.phase === "out" ? "working" : "parking";
          break;
        }
        const dx = next.x - s.x;
        const dz = next.z - s.z;
        const d = Math.hypot(dx, dz);
        wantYaw = next.reverse ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
        // Turn on the spot first, then roll.
        const turned = Math.abs(Math.atan2(Math.sin(wantYaw - s.yaw), Math.cos(wantYaw - s.yaw))) < 0.35;
        if (d < 0.02) s.path.shift();
        else if (turned) {
          const move = Math.min(d, ROLL_SPEED * step);
          s.x += (dx / d) * move;
          s.z += (dz / d) * move;
        }
        mode = "walking";
        moving = true;
        break;
      }
    }
    s.yaw = lerpAngle(s.yaw, wantYaw, 1 - Math.exp(-step * 5));

    const g = root.current;
    if (g) {
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.yaw;
    }
    // Dark and still on the dock: its clock only runs while it has power.
    if (s.phase !== "docked") bodyT.current += step;
    drive.current = { mode, moving, t: bodyT.current, speaking: false, rate: 1 };

    // The bay's charging pad: dim red with a sleeper on it, amber while it wakes, its own colour while it's out.
    const out = s.phase === "out" || s.phase === "working" || s.phase === "back";
    if (out) pad.emissive.set(colour);
    else if (s.phase === "docked") pad.emissive.set("#ff5a4a");
    else pad.emissive.set("#ffb347");
    pad.emissiveIntensity = out ? 1.6 : s.phase === "docked" ? 0.35 + Math.sin(three.elapsedTime * 1.2 + phase) * 0.15 : 1.4 + Math.sin(three.elapsedTime * 8) * 0.6;

    // Its own paint, and powered down on the dock: the paint goes dull and the lights go out.
    const dim = dims.current;
    const tick = Math.floor(three.elapsedTime * 4);
    if (g && tick !== dim.checked) {
      dim.checked = tick;
      g.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || dim.seen.has(mesh)) return;
        dim.seen.add(mesh);
        const src = mesh.material as Material | Material[];
        if (Array.isArray(src) || !(src as MeshStandardMaterial).isMeshStandardMaterial) return;
        const mat = (src as MeshStandardMaterial).clone();
        paint(mat, colour);
        mesh.material = mat;
        dim.list.push({ mat, color: mat.color.clone(), intensity: mat.emissiveIntensity, env: mat.envMapIntensity });
      });
    }
    const k = 0.14 + 0.86 * s.power;
    for (const d of dim.list) {
      d.mat.color.copy(d.color).multiplyScalar(k);
      d.mat.emissiveIntensity = d.intensity * s.power;
      d.mat.envMapIntensity = d.env * k;
    }
  });

  return (
    <>
      {/* The bay's charging pad, under where it parks. */}
      <mesh position={[bx, 0.045, bz]} rotation={[-Math.PI / 2, 0, 0]} material={pad}>
        <ringGeometry args={[0.36, 0.42, 32]} />
      </mesh>
      <group ref={root} position={[state.x, 0, state.z]} rotation={[0, state.yaw, 0]}>
        <Body look={look} lineage="claudari" drive={drive} phase={phase} />
        {active && job && <DockPlate index={index} job={job} look={look} />}
      </group>
    </>
  );
}

const plaqueCache = new Map<string, CanvasTexture>();

/** The name plate over a bay, stencilled in its crew member's colour (Rusty labels everything). */
function plaqueTexture(name: string, colour: string): CanvasTexture {
  const had = plaqueCache.get(name);
  if (had) return had;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 80;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#14161a";
  ctx.fillRect(0, 0, 256, 80);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 256, 10);
  ctx.fillRect(0, 70, 256, 10);
  ctx.font = "bold 42px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.toUpperCase(), 128, 42);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  plaqueCache.set(name, tex);
  return tex;
}

/**
 * Rusty's dock, against the left wall and side-on to the hall: three bays under a parts shelf, each with one of his
 * dock crew (Dusty, Gusty, Musty) parked in it, powered down. One wakes for each job really running past Rusty's
 * own, rolls out to the assembly line and works it alongside him, then rolls home and powers down when it's done.
 */
export function SpareDock() {
  const awake = useFoundry((s) => sparesAwake(s.data.crates));
  const crates = useFoundry((s) => s.data.crates);
  const jobs = useMemo(() => dockJobs(crates), [crates]);
  const look = useCast((s) => s.cast.profiles.tessellate?.look) ?? DEFAULT_LOOK;
  const states = useMemo<UnitState[]>(() => FOUNDRY_FLOOR.bays.map(([x, z]) => ({ phase: "docked", x, z, yaw: BAY_YAW, power: 0, path: [] })), []);
  const { dock } = FOUNDRY_FLOOR;
  const frame = PBR.steel();
  const panel = PBR.matte("#23272e", 0.75);
  // The dock is drawn in its own frame, turned to face into the hall (+x): along it is local x (world -z), and
  // local +z is out of the bays.
  const len = dock.hd * 2;
  const depth = dock.hw * 2;
  const back = -depth / 2 + 0.06;
  const along = (bz: number) => dock.z - bz;
  return (
    <group>
      <group position={[dock.x, 0, dock.z]} rotation={[0, Math.PI / 2, 0]}>
        {/* A base plate, a back wall, bay dividers, and a shelf of spare parts on top. */}
        <Block size={[len, 0.08, depth]} position={[0, 0.04, 0]} material={PBR.gratingFloor([3, 1])} radius={0.01} />
        <Block size={[len, 1.8, 0.1]} position={[0, 0.9, back]} material={panel} radius={0.02} />
        {/* Open bays, so the hall can see who's asleep in them: low plates between the bays, and a narrow shelf on
            brackets along the wall. */}
        {[-1.5, -0.5, 0.5, 1.5].map((u) => (
          <group key={u}>
            <Block size={[0.05, 0.32, depth - 0.2]} position={[u * (len / 3), 0.2, back + (depth - 0.2) / 2]} material={frame} radius={0.01} />
            <Block size={[0.05, 0.3, 0.42]} position={[u * (len / 3), 1.7, back + 0.24]} material={frame} radius={0.01} />
          </group>
        ))}
        <Block size={[len + 0.1, 0.06, 0.5]} position={[0, 1.86, back + 0.25]} material={frame} radius={0.01} />
        {/* Stock on the shelf: treads, a claw, cans of oil, a labelled box. */}
        <Block size={[0.5, 0.16, 0.3]} position={[-1.0, 1.97, back + 0.3]} material={PBR.blackMetal()} radius={0.05} />
        <Block size={[0.34, 0.24, 0.28]} position={[-0.2, 2.01, back + 0.32]} material={PBR.wood("oak")} radius={0.02} />
        <Block size={[0.3, 0.2, 0.3]} position={[0.25, 1.99, back + 0.3]} material={PBR.lacquer("#c9962e", 0.6)} radius={0.03} />
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0.8 + i * 0.16, 2.0, back + 0.35]} material={PBR.lacquer(DOCK_CREW[i]!.colour, 0.4)}>
            <cylinderGeometry args={[0.06, 0.06, 0.22, 14]} />
          </mesh>
        ))}
        {FOUNDRY_FLOOR.bays.map(([, bz], i) => (
          <group key={i}>
            {/* A cable to each bay from the back wall. */}
            <mesh position={[along(bz) + 0.3, 0.65, back + 0.08]} material={PBR.blackMetal()}>
              <cylinderGeometry args={[0.02, 0.02, 1.2, 6]} />
            </mesh>
            {/* Its name over the bay, and a stripe of its colour on the wall. */}
            <mesh position={[along(bz), 1.5, back + 0.06]}>
              <planeGeometry args={[0.62, 0.19]} />
              <meshBasicMaterial map={plaqueTexture(DOCK_CREW[i]!.name, DOCK_CREW[i]!.colour)} toneMapped={false} />
            </mesh>
          </group>
        ))}
        {/* Hazard stripe across the front of the bays. */}
        <mesh position={[0, 0.085, depth / 2 - 0.06]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.matte("#c9a227", 0.7)}>
          <planeGeometry args={[len, 0.08]} />
        </mesh>
      </group>
      {states.map((st, i) => (
        <SpareUnit key={i} index={i} active={i < awake} look={look} state={st} job={jobs[i] ?? null} />
      ))}
    </group>
  );
}

const DEFAULT_LOOK = lookFromPreset("compactor");

/* ------------------------------------------------------------------ Rocky's drafting table */

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
      if (out.length === lines) break;
    } else line = next;
  }
  if (out.length < lines && line) out.push(line);
  return out.slice(0, lines);
}

/** The plan on the drafting table: blueprint paper with the idea's number, size, title and pitch, and a schematic. */
function drawBlueprint(crate: Crate | null): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1c4a86";
  ctx.fillRect(0, 0, 768, 512);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= 768; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  for (let y = 0; y <= 512; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(768, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#e8f1ff";
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, 740, 484);

  ctx.fillStyle = "#e8f1ff";
  ctx.font = "bold 30px ui-monospace, Menlo, Consolas, monospace";
  const kind = crate ? (crate.kind === "build" ? "BUILD" : "IDEA") : "PLAN";
  const size = crate?.size ? ` · ${crate.size.toUpperCase()}` : "";
  ctx.fillText(crate ? `${kind} #${crate.number}${size}` : "THE NEXT BIG ONE", 36, 58);
  ctx.font = "600 34px system-ui, sans-serif";
  const title = crate ? crate.title : "Waiting on the morning's ideas";
  wrap(ctx, title, 690, 2).forEach((l, i) => ctx.fillText(l, 36, 108 + i * 40));
  ctx.font = "22px system-ui, sans-serif";
  ctx.fillStyle = "rgba(232,241,255,0.8)";
  if (crate?.pitch) wrap(ctx, crate.pitch, 400, 5).forEach((l, i) => ctx.fillText(l, 36, 200 + i * 28));

  // A schematic, seeded by the number: frames, wheels and dimension lines.
  let seed = (crate?.number ?? 7) * 7919 + 17;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  ctx.strokeStyle = "#e8f1ff";
  ctx.lineWidth = 3;
  const ox = crate?.pitch ? 470 : 120;
  const oy = 200;
  const w = crate?.pitch ? 260 : 520;
  for (let i = 0; i < 4; i++) {
    const rw = 50 + rand() * (w / 2);
    const rh = 30 + rand() * 90;
    ctx.strokeRect(ox + rand() * (w - rw), oy + rand() * (220 - rh), rw, rh);
  }
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(ox + 30 + rand() * (w - 60), oy + 40 + rand() * 160, 12 + rand() * 30, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox, oy + 236);
  ctx.lineTo(ox + w, oy + 236);
  ctx.stroke();
  ctx.setLineDash([]);
  // The title block, bottom right, signed in chords.
  ctx.strokeRect(560, 440, 180, 46);
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.fillStyle = "#e8f1ff";
  ctx.fillText("DRAWN: ROCKY", 572, 470);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Rocky's drafting table, tilted to the hall, with the plan of the biggest open or upcoming idea pinned to it. */
export function DraftingTable() {
  const plan = useFoundry((s) => blueprintCrate(s.data.crates));
  const key = plan ? `${plan.number}:${plan.title}:${plan.size}:${plan.pitch}:${plan.kind}` : "none";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when what the plan shows changes
  const tex = useMemo(() => drawBlueprint(plan), [key]);
  const paper = useMemo(() => new MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.28 }), [tex]);
  useEffect(
    () => () => {
      tex.dispose();
      paper.dispose();
    },
    [tex, paper],
  );
  const { x, z } = FOUNDRY_FLOOR.drafting;
  const tilt = -0.95;
  return (
    <group position={[x, 0, z]}>
      {[-0.55, 0.55].map((dx) => (
        <group key={dx}>
          <Block size={[0.06, 0.95, 0.06]} position={[dx, 0.47, -0.25]} material={PBR.steel()} radius={0.01} />
          <Block size={[0.06, 0.7, 0.06]} position={[dx, 0.35, 0.25]} material={PBR.steel()} radius={0.01} />
          <Block size={[0.06, 0.04, 0.6]} position={[dx, 0.12, 0]} material={PBR.steel()} radius={0.01} />
        </group>
      ))}
      <group position={[0, 0.88, 0]} rotation={[tilt, 0, 0]}>
        <Block size={[1.34, 0.95, 0.05]} material={PBR.wood("walnut")} radius={0.015} />
        <mesh position={[0, 0, 0.028]} material={paper}>
          <planeGeometry args={[1.22, 0.82]} />
        </mesh>
        {/* A straightedge along the bottom of the board, and brass pins at the corners. */}
        <Block size={[1.3, 0.04, 0.03]} position={[0, -0.47, 0.04]} material={PBR.aluminium()} radius={0.008} />
        {[-1, 1].map((sx) =>
          [-1, 1].map((sy) => (
            <mesh key={`${sx}${sy}`} position={[sx * 0.58, sy * 0.38, 0.035]} material={PBR.brass()}>
              <sphereGeometry args={[0.018, 8, 8]} />
            </mesh>
          )),
        )}
      </group>
      {/* A lamp clamped to the back corner, hanging over the plan. */}
      <mesh position={[0.6, 1.25, -0.42]} material={PBR.blackMetal()}>
        <cylinderGeometry args={[0.012, 0.012, 0.6, 6]} />
      </mesh>
      <group position={[0.45, 1.52, -0.25]} rotation={[0.7, 0, 0.4]}>
        <mesh material={PBR.lacquer("#2a2f36", 0.4)}>
          <coneGeometry args={[0.1, 0.13, 20, 1, true]} />
        </mesh>
        <mesh position={[0, -0.03, 0]} material={PBR.light("#ffd9a8", 2.5)}>
          <sphereGeometry args={[0.04, 12, 12]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ Rivet's alarm post */

const CHECKS_LAMP: Record<ChecksState, { colour: string; label: string }> = {
  pass: { colour: "#3ee08a", label: "PASS" },
  fail: { colour: "#ff3b2f", label: "FAIL" },
  running: { colour: "#ffb347", label: "RUNNING" },
  unknown: { colour: "#6b7380", label: "NO WORD" },
};

const plateCache = new Map<ChecksState, CanvasTexture>();

function plateTexture(state: ChecksState): CanvasTexture {
  const had = plateCache.get(state);
  if (had) return had;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#c9a227";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#14161a";
  ctx.fillRect(10, 10, 236, 108);
  ctx.textAlign = "center";
  ctx.fillStyle = "#e8e2d4";
  ctx.font = "bold 30px ui-monospace, Menlo, monospace";
  ctx.fillText("CHECKS", 128, 50);
  ctx.fillStyle = CHECKS_LAMP[state].colour;
  ctx.font = "bold 34px ui-monospace, Menlo, monospace";
  ctx.fillText(CHECKS_LAMP[state].label, 128, 96);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  plateCache.set(state, tex);
  return tex;
}

/**
 * Rivet's alarm post: a pole with a caged lamp that shows the real checks on main. Steady green for a pass, a red
 * flash for a fail, a turning amber while they run, slate grey when there's no word.
 */
export function AlarmPost() {
  const state = useFoundry((s) => s.data.checks.state);
  const lamp = useMemo(() => new MeshStandardMaterial({ color: "#111", emissive: CHECKS_LAMP.unknown.colour, emissiveIntensity: 1, toneMapped: false }), []);
  const plate = useMemo(() => new MeshBasicMaterial({ map: plateTexture("unknown"), toneMapped: false }), []);
  const head = useRef<Group>(null);
  useEffect(() => {
    lamp.emissive.set(CHECKS_LAMP[state].colour);
    plate.map = plateTexture(state);
    plate.needsUpdate = true;
  }, [state, lamp, plate]);
  useEffect(
    () => () => {
      lamp.dispose();
      plate.dispose();
    },
    [lamp, plate],
  );
  useFrame(({ clock: three }, dt) => {
    const t = three.elapsedTime;
    lamp.emissiveIntensity =
      state === "fail" ? (Math.sin(t * 7) > 0 ? 5 : 0.4) : state === "running" ? 2.6 + Math.sin(t * 4) * 1.2 : state === "pass" ? 2.4 : 0.6;
    if (head.current) {
      head.current.visible = state === "running";
      head.current.rotation.y += dt * 3;
    }
  });
  const { x, z } = FOUNDRY_FLOOR.alarmPost;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.03, 0]} material={PBR.blackMetal()}>
        <cylinderGeometry args={[0.2, 0.22, 0.06, 20]} />
      </mesh>
      <mesh position={[0, 1.05, 0]} material={PBR.lacquer("#c9a227", 0.45)} castShadow>
        <cylinderGeometry args={[0.04, 0.045, 2.1, 12]} />
      </mesh>
      {/* The lamp in its cage. */}
      <group position={[0, 2.2, 0]}>
        <mesh material={lamp}>
          <sphereGeometry args={[0.17, 20, 16]} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.19, 0, Math.sin((i * Math.PI) / 2) * 0.19]} material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.008, 0.008, 0.38, 6]} />
          </mesh>
        ))}
        <mesh position={[0, 0.2, 0]} material={PBR.blackMetal()}>
          <cylinderGeometry args={[0.08, 0.21, 0.05, 16]} />
        </mesh>
        <group ref={head} visible={false}>
          <group rotation={[0, 0, -Math.PI / 2]}>
            <Beam length={2.2} radius={0.45} color="#ffb347" opacity={0.12} />
          </group>
        </group>
      </group>
      {/* The plate, turned to the hall: what the lamp means. */}
      <mesh position={[0, 1.55, 0.06]} material={plate}>
        <planeGeometry args={[0.36, 0.18]} />
      </mesh>
      {/* Rivet's thermos lives on a little shelf on the post. */}
      <Block size={[0.2, 0.03, 0.14]} position={[-0.12, 1.15, 0.05]} material={PBR.steel()} radius={0.005} />
      <mesh position={[-0.14, 1.25, 0.06]} material={PBR.lacquer("#2f5a3a", 0.5)}>
        <cylinderGeometry args={[0.04, 0.04, 0.18, 12]} />
      </mesh>
    </group>
  );
}
