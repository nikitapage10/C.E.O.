import { Html, Sparkles, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ComponentType } from "react";
import { CanvasTexture, CatmullRomCurve3, NearestFilter, TubeGeometry, Vector3, type Group, type Mesh } from "three";
import { agentPositions } from "../clock.ts";
import { Flare } from "../fx/Flare.tsx";
import { emissive, haloMaterial } from "../fx/materials.ts";
import { FONTS } from "../rooms/primitives.tsx";
import { useWorld, type ActiveGlitch } from "../store.ts";
import { PALETTE } from "../theme.ts";
import { CLIP_OFFERS } from "./lines.ts";

/**
 * The 3D intrusions. Each one is self-contained, plays around its anchor (0,0,0) and reads its own progress.
 * All original designs. Any resemblance to a famous mascot is a coincidence our lawyer would like noted.
 */
export interface IntrusionProps {
  g: ActiveGlitch;
}

export function progressOf(g: ActiveGlitch) {
  return Math.min(1, Math.max(0, (performance.now() - g.startedAt) / g.durationMs));
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function AbsintheFairy({ g }: IntrusionProps) {
  const ref = useRef<Group>(null);
  const wings = useRef<Group>(null);
  const wingMat = useMemo(() => haloMaterial(PALETTE.absinthe, { intensity: 1.8 }), []);
  useFrame(({ clock }) => {
    const p = progressOf(g);
    const t = clock.elapsedTime;
    if (ref.current) ref.current.position.set(-6 + p * 12, 0.6 + Math.sin(p * 14) * 0.7, Math.sin(p * 8) * 1.6);
    if (wings.current) wings.current.children.forEach((w, i) => (w.rotation.y = (i % 2 ? 1 : -1) * (0.4 + Math.sin(t * 30) * 0.6)));
  });
  return (
    <group ref={ref}>
      <mesh material={emissive(PALETTE.absinthe, 3)}>
        <capsuleGeometry args={[0.06, 0.14, 4, 8]} />
      </mesh>
      <mesh position={[0, 0.16, 0]} material={emissive(PALETTE.absinthe, 3.5)}>
        <sphereGeometry args={[0.06, 10, 10]} />
      </mesh>
      <group ref={wings}>
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[s * 0.2, 0.08, -0.02]} material={wingMat}>
              <planeGeometry args={[0.4, 0.5]} />
            </mesh>
          </group>
        ))}
      </group>
      <Flare size={1.4} color={PALETTE.absinthe} intensity={1.2} />
      <Sparkles count={40} scale={[1.6, 1.2, 1.6]} size={3} speed={1.2} color={PALETTE.absinthe} />
    </group>
  );
}

function CheesePuff({ g }: IntrusionProps) {
  const ref = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const p = progressOf(g);
    if (ref.current) {
      ref.current.position.set(-5 + p * 10, -1.15 + ease(p * 6) * 0.2, -2.6);
      ref.current.rotation.set(0, Math.sin(clock.elapsedTime * 0.8) * 0.2, -1.15);
    }
    if (body.current) body.current.scale.set(1, 1 + Math.sin(clock.elapsedTime * 2) * 0.03, 1);
  });
  return (
    <group ref={ref}>
      <mesh ref={body}>
        <capsuleGeometry args={[0.32, 0.9, 5, 10]} />
        <meshStandardMaterial color="#ff9a3c" emissive="#ff7a1a" emissiveIntensity={0.6} roughness={0.95} flatShading />
      </mesh>
      {/* Extremely cool sunglasses */}
      <group position={[0, 0.5, 0.27]}>
        {[-0.13, 0.13].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <boxGeometry args={[0.2, 0.1, 0.04]} />
            <meshBasicMaterial color="#020203" />
          </mesh>
        ))}
        <mesh>
          <boxGeometry args={[0.46, 0.025, 0.03]} />
          <meshBasicMaterial color="#020203" />
        </mesh>
        <mesh position={[-0.16, 0.03, 0.03]} material={emissive(PALETTE.silver, 3)}>
          <boxGeometry args={[0.05, 0.015, 0.01]} />
        </mesh>
      </group>
      {/* One arm, behind the head. Relaxed. */}
      <mesh position={[0.3, 0.55, -0.1]} rotation={[0, 0, 0.9]}>
        <capsuleGeometry args={[0.07, 0.4, 4, 6]} />
        <meshStandardMaterial color="#ff9a3c" emissive="#ff7a1a" emissiveIntensity={0.5} roughness={1} />
      </mesh>
    </group>
  );
}

function clipGeometry() {
  // A wire bent into the shape of a famous office supply. Just the office supply.
  const pts = [
    [0.18, -0.55], [0.18, 0.45], [0, 0.62], [-0.18, 0.45], [-0.18, -0.65], [0, -0.82], [0.28, -0.65],
    [0.28, 0.55], [0, 0.82], [-0.08, 0.7],
  ].map(([x, y]) => new Vector3(x!, y!, 0));
  return new TubeGeometry(new CatmullRomCurve3(pts, false, "catmullrom", 0.3), 120, 0.025, 6, false);
}

function Paperclip({ g }: IntrusionProps) {
  const ref = useRef<Group>(null);
  const pupils = useRef<Group>(null);
  const geo = useMemo(clipGeometry, []);
  const dismiss = () => useWorld.getState().endGlitch();
  useFrame(({ clock }) => {
    const p = progressOf(g);
    const t = clock.elapsedTime;
    if (ref.current) {
      const pop = ease(p * 5);
      ref.current.scale.setScalar(pop * 1.6);
      ref.current.position.set(2.4, 0.4 + Math.abs(Math.sin(t * 3)) * 0.12, 1.5);
      ref.current.rotation.z = Math.sin(t * 2) * 0.08;
    }
    pupils.current?.children.forEach((c, i) => c.position.set(Math.sin(t * 4 + i) * 0.015, Math.cos(t * 5 + i) * 0.015, 0.03));
  });
  return (
    <group ref={ref}>
      <mesh geometry={geo} material={emissive(PALETTE.silver, 1.6)} />
      {[-0.1, 0.1].map((x, i) => (
        <group key={i} position={[x, 0.25, 0.06]}>
          <mesh>
            <sphereGeometry args={[0.075, 14, 14]} />
            <meshBasicMaterial color={[1.6, 1.6, 1.6]} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <group ref={pupils} position={[0, 0.25, 0.1]}>
        {[-0.1, 0.1].map((x) => (
          <group key={x}>
            <mesh position={[x, 0, 0]}>
              <sphereGeometry args={[0.032, 10, 10]} />
              <meshBasicMaterial color="#000" />
            </mesh>
          </group>
        ))}
      </group>
      <Html position={[-0.45, 1.05, 0]} center zIndexRange={[60, 0]}>
        <div className="retro-balloon">
          <p>{CLIP_OFFERS[g.room ?? "foundry"]}</p>
          <div className="retro-balloon__actions">
            <button onClick={dismiss}>Yes</button>
            <button onClick={dismiss}>Absolutely not</button>
          </div>
        </div>
      </Html>
    </group>
  );
}

function DialUp({ g }: IntrusionProps) {
  const fill = useRef<Mesh>(null);
  useFrame(() => {
    const p = progressOf(g);
    // Crawls, stalls at 99%, then gives up. Authentic.
    const shown = p < 0.8 ? Math.min(0.99, p * 1.4) : 0.99;
    if (fill.current) {
      fill.current.scale.x = Math.max(0.001, shown);
      fill.current.position.x = -2.4 + 2.4 * shown;
    }
  });
  return (
    <group position={[0, 3, 0]}>
      <mesh>
        <boxGeometry args={[5, 0.5, 0.04]} />
        <meshBasicMaterial color="#0a0f18" transparent opacity={0.85} />
      </mesh>
      <mesh ref={fill} position={[-2.4, 0, 0.03]} material={emissive("#2f6bff", 2.4)}>
        <boxGeometry args={[4.8, 0.36, 0.02]} />
      </mesh>
      <Text font={FONTS.mono} fontSize={0.2} position={[0, 0.55, 0]} letterSpacing={0.15}>
        CONNECTING AT 56K… PLEASE DO NOT PICK UP THE PHONE
        <meshBasicMaterial color={[1.6, 1.8, 2]} toneMapped={false} />
      </Text>
    </group>
  );
}

function DancingBaby({ g }: IntrusionProps) {
  const ref = useRef<Group>(null);
  const armL = useRef<Mesh>(null);
  const armR = useRef<Mesh>(null);
  const legs = useRef<Group>(null);
  const skin = useMemo(() => emissive("#d9dfe8", 0.9), []);
  useFrame(({ clock }) => {
    const p = progressOf(g);
    const t = clock.elapsedTime;
    if (ref.current) {
      ref.current.scale.setScalar(ease(p * 6) * (1 - ease((p - 0.9) * 10)) + 0.0001);
      ref.current.rotation.y = Math.floor(t * 4) * 0.6; // jerky, as was the style at the time
      ref.current.position.set(Math.sin(t * 8) * 0.1, Math.abs(Math.sin(t * 8)) * 0.12, 0.5);
    }
    if (armL.current) armL.current.rotation.z = 0.8 + Math.sin(t * 8) * 0.8;
    if (armR.current) armR.current.rotation.z = -0.8 - Math.sin(t * 8 + 1) * 0.8;
    if (legs.current) legs.current.rotation.z = Math.sin(t * 8) * 0.35;
  });
  return (
    <group ref={ref} scale={1.6}>
      <mesh position={[0, 0.95, 0]} material={skin}>
        <icosahedronGeometry args={[0.28, 1]} />
      </mesh>
      <mesh position={[0, 0.55, 0]} material={skin}>
        <icosahedronGeometry args={[0.22, 1]} />
      </mesh>
      <mesh ref={armL} position={[-0.2, 0.62, 0]} material={skin}>
        <capsuleGeometry args={[0.05, 0.25, 4, 6]} />
      </mesh>
      <mesh ref={armR} position={[0.2, 0.62, 0]} material={skin}>
        <capsuleGeometry args={[0.05, 0.25, 4, 6]} />
      </mesh>
      <group ref={legs} position={[0, 0.35, 0]}>
        {[-0.1, 0.1].map((x) => (
          <mesh key={x} position={[x, -0.15, 0]} material={skin}>
            <capsuleGeometry args={[0.06, 0.2, 4, 6]} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.42, 0.01]} material={emissive(PALETTE.silver, 1.4)}>
        <torusGeometry args={[0.2, 0.03, 6, 20]} />
      </mesh>
    </group>
  );
}

function petTexture() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 24;
  const tex = new CanvasTexture(c);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  return { c, tex };
}

const PET_FRAMES = [
  ["....XXXX....", "...X....X...", "..X.X..X.X..", "..X......X..", "..X.XXXX.X..", "...X....X...", "....XXXX....", "...X....X..."],
  ["....XXXX....", "...X....X...", "..X......X..", "..X.X..X.X..", "..X......X..", "...X.XX.X...", "....XXXX....", "....X..X...."],
];

function Tamagotchi({ g }: IntrusionProps) {
  const ref = useRef<Group>(null);
  const { c, tex } = useMemo(petTexture, []);
  const frame = useRef(-1);
  useFrame(({ clock }) => {
    const p = progressOf(g);
    const pos = g.agentId ? agentPositions.get(g.agentId) : undefined;
    if (ref.current) {
      if (pos) ref.current.position.set(pos.x, pos.y + 1.35 + ease(p * 5) * 0.5, pos.z);
      ref.current.scale.setScalar(ease(p * 5) * (1 - ease((p - 0.88) * 10)) + 0.0001);
      ref.current.rotation.y = Math.sin(clock.elapsedTime * 2) * 0.4;
    }
    const f = Math.floor(clock.elapsedTime * 2) % 2;
    if (f !== frame.current) {
      frame.current = f;
      const g2 = c.getContext("2d")!;
      g2.fillStyle = "#9fb8a0";
      g2.fillRect(0, 0, 32, 24);
      g2.fillStyle = "#1d2a1e";
      PET_FRAMES[f]!.forEach((row, y) => [...row].forEach((ch, x) => ch === "X" && g2.fillRect(10 + x, 8 + y, 1, 1)));
      g2.fillRect(2, 2, 6, 1);
      tex.needsUpdate = true;
    }
  });
  return (
    <group ref={ref}>
      <mesh scale={[1, 1.2, 0.45]}>
        <sphereGeometry args={[0.28, 20, 16]} />
        <meshStandardMaterial color="#b9a6ff" emissive="#6a4bd8" emissiveIntensity={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.03, 0.13]}>
        <planeGeometry args={[0.26, 0.2]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {[-0.08, 0, 0.08].map((x) => (
        <mesh key={x} position={[x, -0.17, 0.12]} material={emissive(PALETTE.silver, 1.5)}>
          <sphereGeometry args={[0.025, 8, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function envelopeTexture() {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 11;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f3e9c6";
  g.fillRect(0, 0, 16, 11);
  g.fillStyle = "#6b5a2e";
  for (let x = 0; x < 8; x++) {
    g.fillRect(x, Math.floor(x * 0.7), 1, 1);
    g.fillRect(15 - x, Math.floor(x * 0.7), 1, 1);
  }
  g.strokeStyle = "#6b5a2e";
  g.strokeRect(0.5, 0.5, 15, 10);
  const tex = new CanvasTexture(c);
  tex.magFilter = NearestFilter;
  return tex;
}

function YouveGotMail({ g }: IntrusionProps) {
  const ref = useRef<Group>(null);
  const tex = useMemo(envelopeTexture, []);
  useFrame(({ clock }) => {
    const p = progressOf(g);
    if (ref.current) {
      ref.current.position.set(-6 + p * 12, 1.2 + Math.sin(p * Math.PI) * 2, 1);
      ref.current.rotation.z = Math.sin(clock.elapsedTime * 6) * 0.15;
    }
  });
  return (
    <group ref={ref}>
      <mesh>
        <planeGeometry args={[1.2, 0.82]} />
        <meshBasicMaterial map={tex} toneMapped={false} transparent />
      </mesh>
      <Html position={[0, 0.8, 0]} center zIndexRange={[60, 0]}>
        <div className="retro-toast">You've got mail!</div>
      </Html>
    </group>
  );
}

function Toaster({ offset }: { offset: number }) {
  const wings = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 10 + offset;
    wings.current?.children.forEach((w, i) => (w.rotation.x = (i ? 1 : -1) * (0.3 + Math.sin(t) * 0.7)));
  });
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.6, 0.42, 0.34]} />
        <meshStandardMaterial color="#c9d4e2" metalness={0.9} roughness={0.25} emissive="#2a3446" />
      </mesh>
      {[-0.08, 0.08].map((z) => (
        <mesh key={z} position={[0, 0.215, z]}>
          <boxGeometry args={[0.4, 0.01, 0.04]} />
          <meshBasicMaterial color="#020203" />
        </mesh>
      ))}
      <group ref={wings}>
        {[-1, 1].map((s) => (
          <group key={s} position={[0, 0.1, s * 0.18]}>
            <mesh position={[0, 0, s * 0.25]} material={emissive(PALETTE.silver, 1.3)}>
              <boxGeometry args={[0.36, 0.02, 0.5]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function FlyingToasters({ g }: IntrusionProps) {
  const ref = useRef<Group>(null);
  const flock = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ x: (i % 3) * 1.6 + (i % 2) * 0.5, y: Math.floor(i / 3) * 1.1, o: i * 0.9 })), []);
  useFrame(() => {
    const p = progressOf(g);
    if (ref.current) ref.current.position.set(8 - p * 18, 4 - p * 3.5, -1);
  });
  return (
    <group ref={ref}>
      {flock.map((b, i) => (
        <group key={i} position={[b.x, b.y, 0]} rotation={[0, -Math.PI / 2 + 0.3, 0.15]}>
          <Toaster offset={b.o} />
        </group>
      ))}
    </group>
  );
}

function LegalDrone({ g }: IntrusionProps) {
  const ref = useRef<Group>(null);
  const rotors = useRef<Group>(null);
  const cone = useMemo(() => haloMaterial(PALETTE.amber, { intensity: 0.35 }), []);
  useFrame(({ clock }) => {
    const p = progressOf(g);
    const t = clock.elapsedTime;
    if (ref.current) ref.current.position.set(-7 + p * 14, 3.4 + Math.sin(t * 2) * 0.15, Math.sin(p * 6) * 1.2);
    rotors.current?.children.forEach((r) => (r.rotation.y = t * 30));
  });
  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[0.8, 0.22, 0.5]} />
        <meshStandardMaterial color="#10141d" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.05, 0.26]} material={emissive(PALETTE.danger, 4)}>
        <sphereGeometry args={[0.06, 10, 10]} />
      </mesh>
      <group ref={rotors}>
        {[[-0.5, -0.35], [0.5, -0.35], [-0.5, 0.35], [0.5, 0.35]].map(([x, z], i) => (
          <mesh key={i} position={[x!, 0.15, z!]} material={emissive(PALETTE.silver, 1.2)}>
            <boxGeometry args={[0.5, 0.01, 0.04]} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, -1.7, 0]} material={cone}>
        <coneGeometry args={[1.2, 3.2, 24, 1, true]} />
      </mesh>
      <Text font={FONTS.mono} fontSize={0.12} position={[0, 0.4, 0]} letterSpacing={0.2}>
        LEGAL · COMPLIANCE SCAN
        <meshBasicMaterial color={[2.4, 1.8, 1]} toneMapped={false} />
      </Text>
    </group>
  );
}

export const INTRUSIONS: Record<string, ComponentType<IntrusionProps>> = {
  "absinthe-fairy": AbsintheFairy,
  "cheese-puff": CheesePuff,
  paperclip: Paperclip,
  "dial-up": DialUp,
  "dancing-baby": DancingBaby,
  tamagotchi: Tamagotchi,
  "youve-got-mail": YouveGotMail,
  "flying-toasters": FlyingToasters,
  "legal-sweep": LegalDrone,
};

/** Intrusions that position themselves in world space rather than around the room anchor. */
export const WORLD_SPACE = new Set(["tamagotchi"]);
