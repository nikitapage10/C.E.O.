import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace, type Group } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { useFoundry, waitingTurn, type Crate, type CrateKind, type CrateState } from "../foundry.ts";
import { PBR } from "../fx/pbr.ts";

/**
 * The belt carries today's real work: one crate for each thing the crew picked up today, shipped ones included,
 * looping from the hopper to the dock until the day is out. Each crate's face shows what's inside: a page of the
 * code for fixes, builds and upkeep, a sketch for ideas, with its number, title and a state stamp.
 */

const BELT_LENGTH = 13.6;
/** Fewer than this and the list repeats, so the belt never looks idle while there is work today. */
const MIN_SLOTS = 4;
const MAX_SLOTS = 8;

const KIND: Record<CrateKind, { label: string; colour: string; ink: string }> = {
  fix: { label: "FIX", colour: "#3a1f1c", ink: "#ff8a6a" },
  build: { label: "BUILD", colour: "#1d2a3a", ink: "#7fc8ff" },
  upkeep: { label: "UPKEEP", colour: "#232b20", ink: "#a8d98a" },
  idea: { label: "IDEA", colour: "#33291a", ink: "#ffd27a" },
  chat: { label: "ASKED", colour: "#2a1f33", ink: "#d7a8ff" },
};

const STAMP: Record<CrateState, { text: string; colour: string } | null> = {
  queued: null,
  working: { text: "ON THE BENCH", colour: "#7fc8ff" },
  ready: { text: "WAITING ON YOU", colour: "#ffb347" },
  stuck: { text: "STUCK", colour: "#ff4a3a" },
  shipped: { text: "SHIPPED", colour: "#6fe08a" },
};

/** A working crate nobody has hands on yet: past the four the crew runs at once, or an idea build paused for a fix. */
type Held = "waiting" | "paused" | null;
const HELD_STAMP: Record<Exclude<Held, null>, { text: string; colour: string }> = {
  waiting: { text: "WAITING ITS TURN", colour: "#9aa3b2" },
  paused: { text: "PAUSED FOR A FIX", colour: "#ffb347" },
};

/** Syntax colours for the little page of code. */
const SYNTAX = ["#c792ea", "#82aaff", "#c3e88d", "#f78c6c", "#89ddff", "#eeffff"];

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
  if (out.length === lines && ctx.measureText(out[lines - 1]!).width > width) out[lines - 1] = out[lines - 1]!.replace(/.{3}$/, "…");
  return out;
}

/** A crate's label: kind and number, the title, then a picture of the work. Seeded by the issue number. */
function drawLabel(crate: Crate, held: Held = null): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 384;
  const ctx = c.getContext("2d")!;
  const k = KIND[crate.kind];
  ctx.fillStyle = k.colour;
  ctx.fillRect(0, 0, 512, 384);
  ctx.strokeStyle = k.ink;
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 492, 364);

  ctx.fillStyle = k.ink;
  ctx.font = "bold 34px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText(`${k.label} #${crate.number}`, 30, 56);
  ctx.fillStyle = "#f4efe6";
  ctx.font = "600 30px system-ui, sans-serif";
  wrap(ctx, crate.title, 452, 2).forEach((l, i) => ctx.fillText(l, 30, 100 + i * 36));

  let seed = crate.number * 9301 + 49297;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const top = 160;
  if (crate.kind === "idea") {
    // A sketch: a bulb, and a few scribbled notes beside it.
    ctx.strokeStyle = k.ink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(110, top + 80, 50, Math.PI * 0.8, Math.PI * 2.2);
    ctx.lineTo(130, top + 160);
    ctx.lineTo(90, top + 160);
    ctx.closePath();
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? "#e8dcc4" : k.ink;
      ctx.fillRect(200, top + 20 + i * 38, 120 + rand() * 160, 12);
    }
  } else {
    // A page of code: line numbers, indents, coloured tokens; a fix shows its patched line in green.
    const patched = crate.kind === "fix" ? 2 + Math.floor(rand() * 4) : -1;
    for (let i = 0; i < 9; i++) {
      const y = top + i * 22;
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "16px ui-monospace, monospace";
      ctx.fillText(String(i + 1).padStart(2, " "), 30, y + 12);
      if (i === patched) {
        ctx.fillStyle = "rgba(111,224,138,0.18)";
        ctx.fillRect(60, y - 4, 420, 20);
      }
      let x = 70 + Math.floor(rand() * 3) * 24;
      const tokens = 2 + Math.floor(rand() * 4);
      for (let t = 0; t < tokens && x < 470; t++) {
        const w = Math.min(470 - x, 24 + rand() * 80);
        ctx.fillStyle = i === patched ? "#6fe08a" : SYNTAX[Math.floor(rand() * SYNTAX.length)]!;
        ctx.fillRect(x, y, w, 10);
        x += w + 10;
      }
    }
  }

  const stamp = held ? HELD_STAMP[held] : STAMP[crate.state];
  if (stamp) {
    ctx.save();
    ctx.translate(380, 320);
    ctx.rotate(-0.12);
    ctx.strokeStyle = stamp.colour;
    ctx.fillStyle = stamp.colour;
    ctx.lineWidth = 5;
    ctx.font = "bold 28px system-ui, sans-serif";
    const w = ctx.measureText(stamp.text).width + 28;
    ctx.strokeRect(-w / 2, -24, w, 44);
    ctx.textAlign = "center";
    ctx.fillText(stamp.text, 0, 8);
    ctx.restore();
  }

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Today's work for the belt: everything picked up (ideas only once they're being built), newest first. */
export function beltCrates(crates: Crate[]): Crate[] {
  return crates.filter((c) => c.state !== "queued");
}

function WorkCrate({ crate, held, index, slots, y, z }: { crate: Crate; held: Held; index: number; slots: number; y: number; z: number }) {
  const ref = useRef<Group>(null);
  const geo = useMemo(() => new RoundedBoxGeometry(0.62, 0.48, 0.48, 2, 0.04), []);
  const key = `${crate.number}:${crate.state}:${crate.title}:${held}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when what the label shows changes
  const tex = useMemo(() => drawLabel(crate, held), [key]);
  const label = useMemo(() => new MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.35 }), [tex]);
  useEffect(
    () => () => {
      tex.dispose();
      label.dispose();
    },
    [tex, label],
  );
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const u = ((clock.elapsedTime * 0.07 + index / slots) % 1) * BELT_LENGTH - BELT_LENGTH / 2;
    g.position.set(u, y, z);
    g.scale.setScalar(Math.max(0.001, Math.min(1, (BELT_LENGTH / 2 - Math.abs(u)) * 1.5)));
  });
  return (
    <group ref={ref} rotation={[0, (index % 3) * 0.04, 0]}>
      <mesh geometry={geo} material={PBR.wood("oak")} castShadow receiveShadow />
      {/* The label on the side facing the floor, and again on top for the overhead view. */}
      <mesh position={[0, 0, 0.243]} material={label}>
        <planeGeometry args={[0.56, 0.42]} />
      </mesh>
      <mesh position={[0, 0.243, 0]} rotation={[-Math.PI / 2, 0, 0]} material={label}>
        <planeGeometry args={[0.56, 0.42]} />
      </mesh>
    </group>
  );
}

/** The labelled crates, or null when there is no real work today (the room keeps its plain crates then). */
export function WorkCrates({ y, z }: { y: number; z: number }) {
  const crates = useFoundry((s) => s.data.crates);
  const today = useMemo(() => beltCrates(crates).slice(0, MAX_SLOTS), [crates]);
  const waiting = useMemo(() => waitingTurn(crates), [crates]);
  if (!today.length) return null;
  const list = Array.from({ length: today.length * Math.ceil(MIN_SLOTS / today.length) }, (_, i) => today[i % today.length]!);
  return (
    <>
      {list.map((c, i) => (
        <WorkCrate key={`${c.number}-${i}`} crate={c} held={waiting.has(c.number) ? "waiting" : c.paused ? "paused" : null} index={i} slots={list.length} y={y} z={z} />
      ))}
    </>
  );
}

export function useHasWork() {
  return useFoundry((s) => s.data.crates.some((c) => c.state !== "queued"));
}
