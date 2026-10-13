import type { Body as BodyKind, Look, RoomId } from "@ceo/core";
import { SAMPLE_AGENTS, defaultCast } from "@ceo/simulator";
import { Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, AdditiveBlending, Box3, CanvasTexture, Vector3, type Group, type Mesh, type PerspectiveCamera } from "three";
import { Figure, poseClassic, type Limbs } from "../agents/Agent.tsx";
import { Body } from "../agents/bodies/Body.tsx";
import type { Drive } from "../agents/bodies/types.ts";
import { tickMaterials } from "../fx/materials.ts";
import { ROOM_ACCENTS } from "../theme.ts";
import { FRAMING, type Framing } from "./framing.ts";
import "./studio.css";

/**
 * The portrait studio, at /studio?agent=<id>: one agent's own model, alone, in a three-quarter turn under a key,
 * a rim and a fill, over its room's colours. scripts/portraits.mjs photographs it for the Desk. Without `agent`
 * it lists the cast, which is how the script finds everyone (subminds included) without a list of its own.
 *
 * Built for software GL in a headless browser: no post-processing, no shadows, one environment bake, and it says
 * when it has settled (window.__studio.ready) so the script waits for the render, not for the network.
 */

interface StudioApi {
  roster: { id: string; name: string; room: RoomId; body: BodyKind }[];
  ready: boolean;
  frames: number;
}
const api: StudioApi = { roster: [], ready: false, frames: 0 };
(window as unknown as { __studio: StudioApi }).__studio = api;

const cast = defaultCast();
api.roster = SAMPLE_AGENTS.map((a) => ({ id: a.id, name: a.name, room: a.home.room, body: cast.profiles[a.id]?.look.body ?? "classic" }));

/** Turned this far from the camera (radians): the three-quarter view, the face towards the key light. */
const TURN = -0.6;
/** A long-ish lens: flattering, no big-nose wide angle. */
const FOV = 24;
const UP = new Vector3(0, 1, 0);

function framingOf(body: BodyKind): Framing {
  return { ...FRAMING.default, ...FRAMING[body] };
}

/** A soft round falloff: bright in the middle, gone at the edge. */
function haloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** The classic figure, standing at rest: Agent poses it every frame in the Lattice, so the studio does too. */
function ClassicSitter({ look, lineage, phase }: { look: Look; lineage: Parameters<typeof Figure>[0]["lineage"]; phase: number }) {
  const figure = useRef<Group>(null);
  const head = useRef<Group>(null);
  const handL = useRef<Mesh>(null);
  const handR = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);
  const caret = useRef<Mesh>(null);
  const extraHands = useRef<Group>(null);
  const limbs: Limbs = { armL: useRef<Mesh>(null), armR: useRef<Mesh>(null), legL: useRef<Group>(null), legR: useRef<Group>(null) };
  useFrame(({ clock }) => {
    poseClassic({ figure, head, handL, handR, core, caret, extraHands, limbs }, look, "idle", clock.elapsedTime, clock.elapsedTime, phase);
  });
  return (
    <group ref={figure}>
      <Figure look={look} lineage={lineage} headRef={head} handL={handL} handR={handR} core={core} caret={caret} extraHands={extraHands} limbs={limbs} />
    </group>
  );
}

/** The sitter: the agent's body at rest, turned three-quarters, its animation clock running. */
function Sitter({ id, onBox }: { id: string; onBox: (box: Box3) => void }) {
  const profile = cast.profiles[id]!;
  const look = profile.look;
  const drive = useRef<Drive>({ mode: "idle", moving: false, t: 0, speaking: false });
  const root = useRef<Group>(null);
  const framed = useRef(false);
  const settle = useRef(0);
  useFrame(({ clock }) => {
    drive.current.t = clock.elapsedTime;
    tickMaterials(clock.elapsedTime);
    api.frames++;
    // Frame once the model has streamed in and stood up (a few frames of its idle), measuring what's really there.
    if (!framed.current && root.current) {
      settle.current++;
      if (settle.current < 6) return;
      const box = new Box3().setFromObject(root.current, true);
      if (box.isEmpty() || box.max.y - box.min.y < 0.1) return;
      framed.current = true;
      onBox(box);
    }
  });
  return (
    <group ref={root} rotation-y={TURN}>
      {look.body === "classic" ? <ClassicSitter look={look} lineage={profile.lineage} phase={0.6} /> : <Body look={look} lineage={profile.lineage} drive={drive} phase={0.6} />}
    </group>
  );
}

/** Puts the camera where the framing says once the sitter has been measured, then lets a few frames settle. */
function Photographer({ body, box }: { body: BodyKind; box: Box3 | null }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const after = useRef(-1);
  useLayoutEffect(() => {
    if (!box) return;
    const f = framingOf(body);
    const h = box.max.y - box.min.y;
    const top = box.min.y + h * f.top;
    const bottom = box.min.y + h * f.bottom;
    const span = (top - bottom) * (1 + f.margin);
    const centre = new Vector3((box.min.x + box.max.x) / 2, (top + bottom) / 2 - span * f.lift, (box.min.z + box.max.z) / 2);
    const dist = span / 2 / Math.tan((FOV * Math.PI) / 360);
    // From slightly above, looking a touch down: the flattering side of eye level.
    const dir = new Vector3(0, Math.sin(f.tilt), Math.cos(f.tilt)).normalize();
    camera.position.copy(centre).addScaledVector(dir, dist);
    camera.up.copy(UP);
    camera.lookAt(centre);
    camera.near = Math.max(0.05, dist - 6);
    camera.far = dist + 12;
    camera.updateProjectionMatrix();
    after.current = 0;
  }, [box, body, camera]);
  useFrame(() => {
    if (after.current < 0) return;
    after.current++;
    // A few frames at the final framing (the environment bake and every shader compiled), then say cheese.
    if (after.current === 4) api.ready = true;
  });
  return null;
}

/** The studio's lights: a warm key from camera left and above, a rim in the room's colour from behind, a cool fill. */
function Lights({ accent }: { accent: string }) {
  return (
    <>
      <Environment resolution={128} frames={1} background={false}>
        <Lightformer form="rect" intensity={2.4} color="#fff3e6" scale={[6, 6, 1]} position={[-6, 6, 7]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={1.2} color="#dfe9ff" scale={[10, 3, 1]} position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <Lightformer form="rect" intensity={3} color={accent} scale={[2, 10, 1]} position={[6, 3, -6]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={2} color={accent} scale={[2, 10, 1]} position={[-6, 3, -6]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={0.5} color="#8fa6d6" scale={[30, 30, 1]} position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      </Environment>
      <hemisphereLight args={["#cfdcff", "#0a1020", 0.55]} />
      {/* Key */}
      <directionalLight position={[-3.2, 4.2, 4.5]} intensity={2.6} color="#fff1e2" />
      {/* Fill, from the other side, soft and cool */}
      <directionalLight position={[4, 1.6, 3.5]} intensity={0.6} color="#a9c4ff" />
      {/* Rims in the room's colour, from behind on both sides */}
      <directionalLight position={[3, 3.4, -4.5]} intensity={5} color={accent} />
      <directionalLight position={[-3.5, 2.6, -4]} intensity={3.5} color={accent} />
    </>
  );
}

/** The Lattice's glow under the sitter: a ring of light in the room's colour, and a soft pool inside it. */
function FloorGlow({ accent }: { accent: string }) {
  const halo = useMemo(haloTexture, []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
        <planeGeometry args={[2.4, 2.4]} />
        <meshBasicMaterial color={accent} map={halo} transparent opacity={0.45} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <ringGeometry args={[0.62, 0.66, 96]} />
        <meshBasicMaterial color={accent} transparent opacity={0.85} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Portrait({ id }: { id: string }) {
  const entry = api.roster.find((a) => a.id === id)!;
  const accent = ROOM_ACCENTS[entry.room];
  const [box, setBox] = useState<Box3 | null>(null);
  return (
    <div className="studio-frame" style={{ "--tone": accent } as React.CSSProperties} data-agent={id}>
      <div className="studio-frame__lattice" aria-hidden="true" />
      <Canvas
        dpr={window.devicePixelRatio}
        camera={{ position: [0, 1.4, 6], fov: FOV, near: 0.1, far: 40 }}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      >
        <Lights accent={accent} />
        <Suspense fallback={null}>
          <Sitter id={id} onBox={setBox} />
          <FloorGlow accent={accent} />
        </Suspense>
        <Photographer body={entry.body} box={box} />
      </Canvas>
    </div>
  );
}

/** The cast, for a person who opens /studio by hand: every portrait, as the Desk will show it. */
function Roster() {
  return (
    <div className="studio-roster">
      <h1>Portrait studio</h1>
      <p>Each agent alone, in a three-quarter turn, over its room&apos;s colours. Open one to see it posed.</p>
      <ul>
        {api.roster.map((a) => (
          <li key={a.id}>
            <a href={`/studio?agent=${a.id}`}>
              <img src={`/desk/agent-${a.id}.webp`} alt="" />
              <span>{a.name}</span>
              <small>{a.room}</small>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Studio() {
  const id = new URLSearchParams(window.location.search).get("agent");
  if (id && cast.profiles[id]) return <Portrait id={id} />;
  api.ready = true;
  return <Roster />;
}
