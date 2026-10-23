import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, DoubleSide, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Mesh } from "three";
import { Dust } from "../fx/atmos.tsx";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { ROOM_ACCENTS } from "../theme.ts";
import { Block, FONTS, LightBar, Plinth, ahead } from "./primitives.tsx";

/**
 * The Studio (#311): a small sound stage for a series of short, tall videos that teach how the internet works through
 * apps everyone uses. A green cyc curves out of the back left wall into the floor, with the host's mark on it under a
 * ring light and a softbox; the camera stands on its tripod facing it, a red tally lamp on top and another over the
 * cyc that light while the camera rolls. Along the back right, the storyboard wall: one card per shot, each in the
 * phone's tall 9:16 frame. At the front, Folio's writing desk on the left, the edit desk with its timeline and tall
 * preview on the right, and the render rack by the right edge. Built in code only, no library models, so the room adds
 * nothing to the Lattice's downloads. The room is simulated for now (not in LIVE_ROOMS): nothing here is a real episode.
 */

type V3 = [number, number, number];

const GREEN = "#3faa5c";
const TALLY = "#ff3b3b";
const WARM = "#ffe9c8";
/** The cyc: from the left wall to the middle of the back, its cove curving into the floor. */
const CYC = { x: -3.6, w: 7.8, h: 4.1, r: 1.1, wall: -6.28, floorTo: -2.6 };

/** Whether the camera is rolling: Dot on its mark and at work. */
function useRolling() {
  return useWorld((s) => {
    const dot = s.lattice.agents.dot;
    return !!dot && dot.place.room === "studio" && dot.place.station === "set" && !dot.motion && (dot.activity === "working" || dot.activity === "typing");
  });
}

/** A canvas drawn once into a texture (the storyboard, the timeline, the preview). */
function useCanvas(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const tex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d");
    if (c) draw(c, w, h);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
    // Drawn once: the drawing never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/** A plane bent into a quarter circle: the cove where the green wall meets the green floor. */
function coveGeometry(width: number, r: number) {
  const g = new PlaneGeometry(width, 1, 1, 10);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) + 0.5;
    const a = ((1 - t) * Math.PI) / 2;
    pos.setXYZ(i, pos.getX(i), r - r * Math.sin(a), r - r * Math.cos(a));
  }
  g.computeVertexNormals();
  return g;
}

/** The green screen: wall, cove and floor in one colour, the host's taped mark, and the tally lamp over it. */
function Cyc({ rolling }: { rolling: boolean }) {
  const green = useMemo(() => new MeshStandardMaterial({ color: GREEN, roughness: 0.95, side: DoubleSide }), []);
  const cove = useMemo(() => coveGeometry(CYC.w, CYC.r), []);
  useEffect(() => () => cove.dispose(), [cove]);
  const set = getStation("studio", "set");
  const floorD = CYC.floorTo - (CYC.wall + CYC.r);
  return (
    <group>
      <mesh position={[CYC.x, CYC.r + (CYC.h - CYC.r) / 2, CYC.wall]} material={green} receiveShadow>
        <planeGeometry args={[CYC.w, CYC.h - CYC.r]} />
      </mesh>
      <mesh geometry={cove} position={[CYC.x, 0.004, CYC.wall]} material={green} receiveShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CYC.x, 0.006, CYC.wall + CYC.r + floorD / 2]} material={green} receiveShadow>
        <planeGeometry args={[CYC.w, floorD]} />
      </mesh>
      {/* The host's mark: a cross of gaffer tape, worn into a dot in the middle. */}
      {[0.6, -0.6].map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, r]} position={[set.x, 0.01, set.z]} material={PBR.matte("#f2d64b", 0.8)}>
          <planeGeometry args={[0.5, 0.06]} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[set.x, 0.012, set.z]} material={PBR.matte("#2a6e3c", 0.9)}>
        <circleGeometry args={[0.07, 16]} />
      </mesh>
      {/* The tally lamp over the cyc: dark until the camera rolls. */}
      <TallyLamp position={[CYC.x, CYC.h + 0.45, CYC.wall + 0.05]} rolling={rolling} big />
    </group>
  );
}

/** A red tally lamp; the big one carries a word. */
function TallyLamp({ position, rolling, big = false }: { position: V3; rolling: boolean; big?: boolean }) {
  const lamp = useMemo(() => new MeshStandardMaterial({ color: "#2a0d0d", emissive: TALLY, emissiveIntensity: 0.1, toneMapped: false }), []);
  useFrame(({ clock }) => {
    const on = rolling ? 3.2 + Math.sin(clock.elapsedTime * 3) * 0.3 : 0.12;
    lamp.emissiveIntensity += (on - lamp.emissiveIntensity) * 0.15;
  });
  if (!big) {
    return (
      <mesh position={position} material={lamp}>
        <sphereGeometry args={[0.045, 12, 8]} />
      </mesh>
    );
  }
  return (
    <group position={position}>
      <Block size={[1.5, 0.42, 0.14]} material={PBR.blackMetal()} radius={0.04} />
      <mesh position={[0, 0, 0.075]} material={lamp}>
        <planeGeometry args={[1.36, 0.3]} />
      </mesh>
      <Text font={FONTS.mono} fontSize={0.16} letterSpacing={0.25} position={[0, -0.005, 0.085]} color={rolling ? "#fff3f0" : "#5a2a2a"} anchorX="center" anchorY="middle">
        ROLLING
      </Text>
    </group>
  );
}

/** A light on a stand, turned to the mark: the ring light, or a softbox. */
function StageLight({ position, kind }: { position: V3; kind: "ring" | "softbox" }) {
  const set = getStation("studio", "set");
  const yaw = Math.atan2(set.x - position[0], set.z - position[2]);
  const head = kind === "ring" ? 1.55 : 1.85;
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.sin((i * Math.PI * 2) / 3) * 0.2, 0.18, Math.cos((i * Math.PI * 2) / 3) * 0.2]} rotation={[Math.cos((i * Math.PI * 2) / 3) * 0.9, 0, -Math.sin((i * Math.PI * 2) / 3) * 0.9]} material={PBR.blackMetal()} castShadow>
          <cylinderGeometry args={[0.014, 0.014, 0.46, 6]} />
        </mesh>
      ))}
      <mesh position={[0, head / 2, 0]} material={PBR.aluminium()} castShadow>
        <cylinderGeometry args={[0.022, 0.022, head, 8]} />
      </mesh>
      {kind === "ring" ? (
        <group position={[0, head, 0]}>
          <mesh material={PBR.light(WARM, 3.2)}>
            <torusGeometry args={[0.34, 0.035, 10, 40]} />
          </mesh>
          <mesh position={[0, 0, -0.03]} material={PBR.blackMetal()}>
            <torusGeometry args={[0.34, 0.05, 6, 40]} />
          </mesh>
          {/* A phone clamped in the middle, the way every short is checked. */}
          <Block size={[0.09, 0.16, 0.012]} position={[0, 0, 0.01]} material={PBR.blackMetal()} radius={0.01} />
        </group>
      ) : (
        <group position={[0, head, 0]} rotation={[0.15, 0, 0]}>
          <Block size={[0.75, 0.55, 0.32]} position={[0, 0, -0.14]} material={PBR.matte("#16181d", 0.7)} radius={0.03} />
          <mesh position={[0, 0, 0.025]} material={PBR.light("#fff6ea", 1.6)}>
            <planeGeometry args={[0.68, 0.48]} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** The camera on its tripod, facing the mark: a lens, a viewfinder showing the frame, a tally lamp on top. */
function Camera({ position, rolling }: { position: V3; rolling: boolean }) {
  const set = getStation("studio", "set");
  const yaw = Math.atan2(set.x - position[0], set.z - position[2]);
  const view = useCanvas(90, 160, (c, w, h) => {
    c.fillStyle = GREEN;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#efe8dc";
    c.beginPath();
    c.arc(w / 2, h * 0.45, w * 0.22, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,.6)";
    c.lineWidth = 2;
    c.strokeRect(6, 6, w - 12, h - 12);
  });
  const viewMat = useMemo(() => new MeshStandardMaterial({ map: view, emissive: "#ffffff", emissiveMap: view, emissiveIntensity: 0.8, toneMapped: false }), [view]);
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {[0, 1, 2].map((i) => {
        const a = (i * Math.PI * 2) / 3;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.22, 0.55, Math.cos(a) * 0.22]} rotation={[Math.cos(a) * 0.38, 0, -Math.sin(a) * 0.38]} material={PBR.blackMetal()} castShadow>
            <cylinderGeometry args={[0.018, 0.014, 1.15, 6]} />
          </mesh>
        );
      })}
      <mesh position={[0, 1.12, 0]} material={PBR.steel()}>
        <cylinderGeometry args={[0.06, 0.08, 0.1, 10]} />
      </mesh>
      <group position={[0, 1.32, 0]}>
        <Block size={[0.26, 0.26, 0.46]} material={PBR.matte("#1b1d22", 0.55)} radius={0.03} />
        {/* The lens, at the front (+z in this frame), points at the mark. */}
        <mesh position={[0, 0, 0.34]} rotation={[Math.PI / 2, 0, 0]} material={PBR.blackMetal()}>
          <cylinderGeometry args={[0.085, 0.1, 0.24, 16]} />
        </mesh>
        <mesh position={[0, 0, 0.462]} material={PBR.glass("#6fa8ff", 0.5)}>
          <circleGeometry args={[0.075, 16]} />
        </mesh>
        {/* The viewfinder, on the back, tall like the phone it's for. */}
        <mesh position={[0, 0.02, -0.235]} rotation={[0, Math.PI, 0]} material={viewMat}>
          <planeGeometry args={[0.11, 0.195]} />
        </mesh>
        <Block size={[0.04, 0.05, 0.3]} position={[0, 0.16, 0]} material={PBR.blackMetal()} radius={0.01} />
        <TallyLamp position={[0, 0.21, 0.12]} rolling={rolling} />
      </group>
    </group>
  );
}

const SHOTS = ["#f2b84b", "#7fe0ff", "#ff8fb1", "#9fe3c9", "#c9b6ff", "#ffd08f"];

/** The storyboard: one card per shot, each a tall 9:16 frame with a quick sketch, pinned in rows on cork. */
function drawStoryboard(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#8a6a4a";
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(${i % 2 ? "60,40,25" : "180,150,110"},.18)`;
    c.fillRect((i * 97) % w, (i * 53) % h, 3, 2);
  }
  const cols = 8;
  const rows = 3;
  const cw = 78;
  const ch = (cw * 16) / 9;
  const gx = (w - cols * cw) / (cols + 1);
  const gy = (h - rows * ch) / (rows + 1);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = gx + k * (cw + gx);
      const y = gy + r * (ch + gy);
      const n = r * cols + k;
      c.save();
      c.translate(x + cw / 2, y + ch / 2);
      c.rotate((((n * 37) % 9) - 4) / 120);
      c.fillStyle = "#f6f1e6";
      c.fillRect(-cw / 2, -ch / 2, cw, ch);
      // A sketch per shot: the host's round head, a phone, an arrow, a box: the analogy in pencil.
      c.strokeStyle = "#3a3d44";
      c.lineWidth = 2;
      const kind = n % 4;
      if (kind === 0) {
        c.beginPath();
        c.arc(0, -10, 18, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.arc(0, -6, 7, 0.2, Math.PI - 0.2);
        c.stroke();
      } else if (kind === 1) {
        c.strokeRect(-14, -34, 28, 50);
        c.fillStyle = SHOTS[n % SHOTS.length]!;
        c.fillRect(-10, -28, 20, 14);
      } else if (kind === 2) {
        c.strokeRect(-26, -20, 18, 18);
        c.strokeRect(8, -20, 18, 18);
        c.beginPath();
        c.moveTo(-6, -11);
        c.lineTo(6, -11);
        c.lineTo(1, -15);
        c.stroke();
      } else {
        c.beginPath();
        c.moveTo(-24, 6);
        c.lineTo(0, -26);
        c.lineTo(24, 6);
        c.closePath();
        c.stroke();
        c.fillStyle = SHOTS[(n + 2) % SHOTS.length]!;
        c.fillRect(-8, -6, 16, 12);
      }
      // A caption bar and the shot number.
      c.fillStyle = "rgba(20,22,28,.75)";
      c.fillRect(-cw / 2 + 8, ch / 2 - 30, cw - 16, 8);
      c.fillStyle = "#6b6f78";
      c.font = "bold 13px monospace";
      c.fillText(String(n + 1), -cw / 2 + 6, -ch / 2 + 16);
      c.restore();
      c.fillStyle = TALLY;
      c.beginPath();
      c.arc(x + cw / 2, y + 4, 5, 0, Math.PI * 2);
      c.fill();
    }
  }
}

function StoryboardWall() {
  const st = getStation("studio", "storyboard");
  const tex = useCanvas(1024, 520, drawStoryboard);
  const mat = useMemo(() => new MeshStandardMaterial({ map: tex, roughness: 0.92 }), [tex]);
  return (
    <group position={[st.x, 0, -6.28]}>
      <Block size={[4.9, 2.5, 0.06]} position={[0, 1.95, 0]} material={PBR.wood("walnut")} radius={0.02} />
      <mesh position={[0, 1.95, 0.035]} material={mat}>
        <planeGeometry args={[4.75, 2.38]} />
      </mesh>
      <LightBar length={4.6} position={[0, 3.32, 0.18]} color={WARM} intensity={1.6} thickness={0.04} />
    </group>
  );
}

/** The timeline on the edit desk's wide screen: a video track of takes, the captions, the voice and the music. */
function drawTimeline(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#11141a";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#1b2029";
  c.fillRect(0, 0, w, 26);
  c.fillStyle = "#6b7380";
  for (let x = 40; x < w; x += 48) c.fillRect(x, 16, 1, 10);
  const tracks: { y: number; colour: string; clips: [number, number][] }[] = [
    { y: 40, colour: "#5fa8ff", clips: [[30, 140], [146, 260], [266, 330], [336, 470]] },
    { y: 86, colour: "#f2c94c", clips: [[30, 110], [120, 210], [222, 300], [312, 400], [410, 470]] },
    { y: 120, colour: "#9fe3c9", clips: [[30, 470]] },
    { y: 160, colour: "#c9b6ff", clips: [[30, 470]] },
  ];
  for (const t of tracks) {
    for (const [a, b] of t.clips) {
      c.fillStyle = t.colour;
      c.globalAlpha = 0.85;
      c.fillRect(a, t.y, b - a - 2, t.y > 110 ? 26 : 34);
      c.globalAlpha = 1;
    }
  }
  // A waveform on the voice and music tracks.
  c.strokeStyle = "rgba(16,20,26,.7)";
  c.lineWidth = 1;
  for (const y of [133, 173]) {
    c.beginPath();
    for (let x = 32; x < 468; x += 3) {
      const a = Math.abs(Math.sin(x * 0.13) * Math.sin(x * 0.031 + y)) * 10;
      c.moveTo(x, y - a);
      c.lineTo(x, y + a);
    }
    c.stroke();
  }
  c.fillStyle = "#8a93a2";
  c.font = "11px monospace";
  ["V1", "CC", "VO", "MX"].forEach((l, i) => c.fillText(l, 4, [62, 108, 138, 178][i]!));
  c.fillText("0:45", w - 40, 14);
}

/** The tall preview: the host keyed off the green onto the episode's backdrop, with a caption. */
function drawPreview(c: CanvasRenderingContext2D, w: number, h: number) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#2b3d7a");
  g.addColorStop(1, "#7a2e5a");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(255,255,255,.12)";
  for (let i = 0; i < 6; i++) c.fillRect(10 + i * 18, 30 + (i % 2) * 20, 12, 40 + i * 6);
  c.fillStyle = "#efe8dc";
  c.beginPath();
  c.arc(w / 2, h * 0.5, w * 0.22, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#10161f";
  c.beginPath();
  c.ellipse(w / 2, h * 0.5, w * 0.15, w * 0.11, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#7fe0ff";
  c.fillRect(w / 2 - 9, h * 0.48, 5, 9);
  c.fillRect(w / 2 + 4, h * 0.48, 5, 9);
  c.fillStyle = "rgba(0,0,0,.55)";
  c.fillRect(10, h * 0.76, w - 20, 22);
  c.fillStyle = "#ffffff";
  c.fillRect(18, h * 0.76 + 8, w - 60, 6);
}

/** The edit desk: a long desk, the wide timeline screen, the tall preview, speakers, and a playhead that moves when Arc cuts. */
function EditDesk({ position, yaw }: { position: V3; yaw: number }) {
  const timeline = useCanvas(512, 200, drawTimeline);
  const preview = useCanvas(144, 256, drawPreview);
  const tlMat = useMemo(() => new MeshStandardMaterial({ map: timeline, emissive: "#ffffff", emissiveMap: timeline, emissiveIntensity: 0.75, toneMapped: false }), [timeline]);
  const pvMat = useMemo(() => new MeshStandardMaterial({ map: preview, emissive: "#ffffff", emissiveMap: preview, emissiveIntensity: 0.8, toneMapped: false }), [preview]);
  const head = useRef<Mesh>(null);
  const cutting = useWorld((s) => {
    const a = s.lattice.agents.arc;
    return !!a && a.place.station === "edit" && !a.motion && (a.activity === "typing" || a.activity === "working");
  });
  useFrame(({ clock }) => {
    if (!head.current) return;
    const t = cutting ? (clock.elapsedTime * 0.08) % 1 : 0.32;
    head.current.position.x = -0.62 + t * 1.2;
  });
  const walnut = PBR.wood("walnut");
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <Block size={[2.6, 0.06, 0.85]} position={[0, 0.76, 0]} material={walnut} radius={0.02} />
      {[-1.2, 1.2].map((x) => (
        <Block key={x} size={[0.08, 0.74, 0.75]} position={[x, 0.37, 0]} material={PBR.blackMetal()} radius={0.01} />
      ))}
      {/* The wide timeline screen and the tall preview, facing whoever stands at the desk. */}
      <group position={[-0.25, 1.22, -0.22]}>
        <Block size={[1.4, 0.6, 0.04]} position={[0, 0, -0.025]} material={PBR.blackMetal()} radius={0.012} />
        <mesh material={tlMat}>
          <planeGeometry args={[1.34, 0.54]} />
        </mesh>
        <mesh ref={head} position={[-0.25, 0, 0.004]} material={PBR.light(TALLY, 2)}>
          <planeGeometry args={[0.008, 0.52]} />
        </mesh>
        <Block size={[0.06, 0.4, 0.06]} position={[0, -0.42, -0.04]} material={PBR.aluminium()} radius={0.01} />
      </group>
      <group position={[0.82, 1.18, -0.2]}>
        <Block size={[0.32, 0.54, 0.04]} position={[0, 0, -0.025]} material={PBR.blackMetal()} radius={0.012} />
        <mesh material={pvMat}>
          <planeGeometry args={[0.28, 0.5]} />
        </mesh>
        <Block size={[0.05, 0.36, 0.05]} position={[0, -0.4, -0.04]} material={PBR.aluminium()} radius={0.01} />
      </group>
      {[-1.08, 1.1].map((x) => (
        <group key={x} position={[x, 0.97, -0.25]}>
          <Block size={[0.18, 0.36, 0.2]} material={PBR.matte("#1b1d22", 0.6)} radius={0.02} />
          <mesh position={[0, -0.05, 0.101]} material={PBR.steel()}>
            <circleGeometry args={[0.06, 14]} />
          </mesh>
        </group>
      ))}
      <Block size={[0.5, 0.025, 0.16]} position={[-0.25, 0.8, 0.18]} material={PBR.matte("#2a2d33", 0.6)} radius={0.008} />
      {/* A jog wheel. */}
      <mesh position={[0.4, 0.8, 0.2]} material={PBR.steel()}>
        <cylinderGeometry args={[0.07, 0.07, 0.03, 18]} />
      </mesh>
    </group>
  );
}

/** The render rack: a tall cabinet of machines, rows of lights, and a bar that fills while a short renders. */
function RenderRack({ position, yaw }: { position: V3; yaw: number }) {
  const bar = useRef<Mesh>(null);
  const leds = useMemo(() => new MeshStandardMaterial({ color: "#000", emissive: "#7fe0ff", emissiveIntensity: 1.4, toneMapped: false }), []);
  const rendering = useWorld((s) => {
    const a = s.lattice.agents.arc;
    return !!a && a.place.station === "render" && !a.motion && a.activity === "working";
  });
  const fill = useRef(0);
  useFrame(({ clock }, dt) => {
    fill.current = rendering ? Math.min(1, fill.current + dt * 0.18) : Math.max(0, fill.current - dt * 0.5);
    if (bar.current) {
      bar.current.scale.x = Math.max(0.001, fill.current);
      bar.current.position.x = -0.3 + fill.current * 0.3;
    }
    leds.emissiveIntensity = rendering ? 1.6 + Math.sin(clock.elapsedTime * 12) * 0.8 : 1.1;
  });
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <Block size={[1.5, 2.1, 0.75]} position={[0, 1.05, -0.05]} material={PBR.matte("#15171c", 0.55)} radius={0.03} />
      {Array.from({ length: 6 }, (_, i) => (
        <group key={i} position={[0, 0.35 + i * 0.27, 0.33]}>
          <Block size={[1.34, 0.22, 0.04]} material={PBR.blackMetal()} radius={0.01} />
          {Array.from({ length: 8 }, (_, k) => (
            <mesh key={k} position={[-0.56 + k * 0.05, 0.04, 0.022]} material={k % 3 === 0 ? PBR.light(ROOM_ACCENTS.studio, 2) : leds}>
              <planeGeometry args={[0.022, 0.022]} />
            </mesh>
          ))}
          <Block size={[0.5, 0.05, 0.01]} position={[0.35, -0.03, 0.022]} material={PBR.matte("#2a2d33", 0.5)} radius={0.004} />
        </group>
      ))}
      {/* The render bar, across the top: empty until a short is rendering. */}
      <group position={[0, 2.0, 0.335]}>
        <mesh material={PBR.matte("#23262b", 0.6)}>
          <planeGeometry args={[0.64, 0.08]} />
        </mesh>
        <mesh ref={bar} position={[-0.3, 0, 0.003]} material={PBR.light("#9fe3c9", 2.2)}>
          <planeGeometry args={[0.6, 0.05]} />
        </mesh>
      </group>
      <Text font={FONTS.mono} fontSize={0.06} letterSpacing={0.2} position={[0, 2.12, 0.34]} color="#cfd6df" anchorX="center">
        RENDER 9:16
      </Text>
    </group>
  );
}

/** Folio's writing desk: a typewriter, the drafts in a pile, crumpled pages, a lamp, and the lute against it. */
function WritingDesk({ position, yaw }: { position: V3; yaw: number }) {
  const walnut = PBR.wood("walnut");
  const paper = PBR.matte("#f4efe2", 0.9);
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <Block size={[2.0, 0.06, 0.9]} position={[0, 0.76, 0]} material={walnut} radius={0.02} />
      {[-0.92, 0.92].map((x) => (
        <Block key={x} size={[0.1, 0.74, 0.8]} position={[x, 0.37, 0]} material={walnut} radius={0.02} />
      ))}
      {/* The typewriter, a sheet in it. */}
      <group position={[0, 0.79, 0.05]}>
        <Block size={[0.5, 0.12, 0.36]} position={[0, 0.06, 0]} material={PBR.lacquer("#2b3a3a", 0.4)} radius={0.03} />
        <Block size={[0.56, 0.06, 0.08]} position={[0, 0.16, -0.12]} material={PBR.blackMetal()} radius={0.02} />
        <mesh position={[0, 0.3, -0.13]} rotation={[-0.2, 0, 0]} material={paper}>
          <planeGeometry args={[0.32, 0.3]} />
        </mesh>
      </group>
      {/* The pile of drafts, each thinner than the last. */}
      {[0.06, 0.045, 0.03].map((hgt, i) => (
        <Block key={i} size={[0.3, hgt, 0.4]} position={[-0.62, 0.79 + hgt / 2 + i * 0.002, 0.05 + i * 0.01]} rotation={[0, i * 0.15, 0]} material={paper} radius={0.004} />
      ))}
      {[
        [0.55, 0.83, 0.2],
        [0.7, 0.83, -0.1],
        [0.3, 0.04, 0.6],
        [-0.2, 0.04, 0.7],
      ].map(([x, y, z], i) => (
        <mesh key={i} position={[x!, y!, z!]} material={paper} castShadow>
          <icosahedronGeometry args={[0.05, 0]} />
        </mesh>
      ))}
      {/* A brass desk lamp. */}
      <group position={[0.75, 0.79, -0.28]}>
        <mesh material={PBR.brass()}>
          <cylinderGeometry args={[0.08, 0.1, 0.03, 14]} />
        </mesh>
        <mesh position={[0, 0.2, 0]} rotation={[0, 0, 0.3]} material={PBR.brass()}>
          <cylinderGeometry args={[0.012, 0.012, 0.4, 6]} />
        </mesh>
        <mesh position={[-0.08, 0.38, 0]} rotation={[0, 0, -0.9]} material={PBR.lacquer("#2b5a3a", 0.4)}>
          <coneGeometry args={[0.09, 0.14, 14, 1, true]} />
        </mesh>
        <pointLight position={[-0.1, 0.3, 0]} color="#ffd39a" intensity={2} distance={2.5} decay={2} />
      </group>
    </group>
  );
}

/** The director's chair, turned to the set, its back to you: red canvas, the word on it. The Director floats over it. */
function DirectorsChair({ position }: { position: V3 }) {
  const set = getStation("studio", "set");
  const yaw = Math.atan2(set.x - position[0], set.z - position[2]) + Math.PI;
  const canvas = PBR.fabric(TALLY);
  const wood = PBR.wood("oak");
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {[-1, 1].map((s) => (
        <group key={s}>
          <Block size={[0.04, 0.9, 0.04]} position={[s * 0.25, 0.45, 0.18]} rotation={[0.35, 0, 0]} material={wood} radius={0.01} />
          <Block size={[0.04, 0.9, 0.04]} position={[s * 0.25, 0.45, -0.18]} rotation={[-0.35, 0, 0]} material={wood} radius={0.01} />
          <Block size={[0.04, 0.95, 0.04]} position={[s * 0.25, 0.95, 0.2]} material={wood} radius={0.01} />
        </group>
      ))}
      <Block size={[0.5, 0.03, 0.42]} position={[0, 0.66, 0]} material={canvas} radius={0.01} />
      <Block size={[0.54, 0.24, 0.02]} position={[0, 1.24, 0.2]} material={canvas} radius={0.01} />
      <Text font={FONTS.mono} fontSize={0.065} letterSpacing={0.18} position={[0, 1.24, 0.215]} color="#fff3f0" anchorX="center" anchorY="middle">
        DIRECTOR
      </Text>
      {/* The clapperboard, left on the seat. */}
      <group position={[0.05, 0.69, 0]} rotation={[-Math.PI / 2, 0, 0.3]}>
        <Block size={[0.26, 0.2, 0.015]} material={PBR.matte("#1b1d22", 0.6)} radius={0.004} />
        {[-0.08, 0, 0.08].map((x) => (
          <Block key={x} size={[0.04, 0.035, 0.018]} position={[x, 0.08, 0.001]} rotation={[0, 0, 0.5]} material={PBR.matte("#f2f2f2", 0.6)} radius={0.002} shadows={false} />
        ))}
      </group>
    </group>
  );
}

/** The back wall: dark acoustic panels behind the cyc and the storyboard, and a lighting truss across the room. */
function Shell() {
  const panel = PBR.matte("#23252c", 0.95);
  return (
    <group>
      <Block size={[16.4, 5.2, 0.24]} position={[0, 2.6, -6.5]} material={PBR.matte("#1a1b20", 0.95)} radius={0.04} />
      {Array.from({ length: 4 }, (_, i) => (
        <Block key={i} size={[1.05, 2.4, 0.08]} position={[1.15 + i * 1.2 + 0.05, 4.05, -6.34]} material={panel} radius={0.03} shadows={false} />
      ))}
      {/* The truss, on two posts, with three spots hung on it. */}
      {[-7.9, 7.9].map((x) => (
        <Block key={x} size={[0.18, 4.8, 0.18]} position={[x, 2.4, -1.4]} material={PBR.blackMetal()} radius={0.02} />
      ))}
      {[4.75, 4.45].map((y) => (
        <Block key={y} size={[15.9, 0.06, 0.06]} position={[0, y, -1.4]} material={PBR.aluminium()} radius={0.01} shadows={false} />
      ))}
      {[-5.2, -2.6, 3.4].map((x, i) => (
        <group key={x} position={[x, 4.3, -1.4]} rotation={[i < 2 ? -0.7 : -0.3, 0, 0]}>
          <mesh material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.13, 0.1, 0.32, 12]} />
          </mesh>
          <mesh position={[0, -0.165, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.light(WARM, 2.4)}>
            <circleGeometry args={[0.1, 14]} />
          </mesh>
        </group>
      ))}
      {/* Cable runs across the floor, taped down. */}
      {[
        [-3.6, 0.9, 1.6, 0],
        [-1.0, -0.7, 3.2, 0.9],
      ].map(([x, z, len, r], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, r!]} position={[x!, 0.008, z!]} material={PBR.matte("#0c0d10", 0.8)}>
          <planeGeometry args={[len!, 0.04]} />
        </mesh>
      ))}
    </group>
  );
}

/** The Studio. */
export function Studio() {
  const rolling = useRolling();
  const camera = getStation("studio", "camera");
  const edit = ahead(getStation("studio", "edit"), 0.95);
  const render = ahead(getStation("studio", "render"), 1.05);
  const script = ahead(getStation("studio", "script"), 1.1);
  return (
    <group>
      <Plinth floor={PBR.blackFloor([6, 6])} edge={PBR.blackMetal()} accent={ROOM_ACCENTS.studio} />
      <Shell />
      <Cyc rolling={rolling} />
      <StoryboardWall />
      <StageLight position={[-1.5, 0, -2.1]} kind="ring" />
      <StageLight position={[-5.8, 0, -2.1]} kind="softbox" />
      <Camera position={[camera.x, 0, 0.2]} rolling={rolling} />
      <DirectorsChair position={[-1.0, 0, 1.7]} />
      <EditDesk position={[edit.pos[0], 0, edit.pos[1]]} yaw={edit.yaw} />
      <RenderRack position={[render.pos[0] + 0.05, 0, render.pos[1]]} yaw={render.yaw} />
      <WritingDesk position={[script.pos[0] + 0.15, 0, script.pos[1]]} yaw={script.yaw} />

      <pointLight position={[-3.6, 2.6, -2.4]} color={WARM} intensity={rolling ? 16 : 9} distance={9} decay={1.6} />
      <pointLight position={[2.6, 3.8, 2.0]} color="#cfd8ff" intensity={20} distance={15} decay={1.6} />
      <Dust min={[-7.4, 0.4, -5.6]} size={[14.8, 3.8, 10]} count={30} color="#fff0e0" opacity={0.3} />
    </group>
  );
}
