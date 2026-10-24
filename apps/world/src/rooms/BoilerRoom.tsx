import { getStation, pendingApprovals } from "@ceo/core";
import { Text } from "../fx/Text.tsx";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Group,
  type Mesh,
  type PointLight,
} from "three";
import { Dust, Haze, Smoke, Sparks } from "../fx/atmos.tsx";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { daysSinceIncident, useSystems, type Link, type LinkState } from "../systems.ts";
import { startWorldClock } from "../worldClock.ts";
import { Block, FONTS, Plinth, ahead } from "./primitives.tsx";

/**
 * The Boiler Room: a cramped, steaming maintenance closet where every brass pipe is one of the C.E.O.'s real
 * links (an agent, the hub, a service) and the boiler is the MacBook. It is played for laughs, but every gag is a
 * real status: steam means healthy, a coughing, rattling pipe means slow, a burst pipe and the spinning lamp mean
 * down, a cold pipe means not connected yet. The kettle whistles when a real approval is waiting. The last pipe is
 * the world clock: it runs hot while the living Lattice takes its hourly step, coughs once an hour is overdue, and
 * bursts when the clock has stopped (worldClock.ts).
 */

const LAMP: Record<LinkState, string> = { off: "#3a3d42", ok: "#9fe3c9", slow: "#ffd08f", down: "#ff5a6e" };
const STATES: readonly LinkState[] = ["off", "ok", "slow", "down"];
const PIPE_Z = -5.55;
/**
 * The pipes share the wall from x = -7.2 to 5, a metre apart until more links than that arrive (Polymarket made 13).
 * The wall right of 5 belongs to the Pessimist's podium, and the boiler stands out in the front-right corner, so
 * nothing stands between the default camera and a pipe's status.
 */
const PIPE_X0 = -7.2;
const PIPE_SPAN = 12.2;
const pipeX = (i: number, n: number) => PIPE_X0 + i * Math.min(1, PIPE_SPAN / Math.max(1, n - 1));
/** Each state's plate: what the pipe is doing, then what that means. */
const WORDS: Record<LinkState, readonly [string, string]> = {
  off: ["COLD", "NOT CONNECTED"],
  ok: ["HOT", "WORKING"],
  slow: ["COUGHING", "SLOW"],
  down: ["BURST", "DOWN"],
};
/** The world clock's pipe speaks in hours: on time, overdue (amber, over 70 min), stopped (over 3 h, or no answer). */
const CLOCK_WORDS: Record<LinkState, readonly [string, string]> = {
  off: ["COLD", "NOT RUNNING"],
  ok: ["HOT", "ON TIME"],
  slow: ["COUGHING", "OVERDUE"],
  down: ["BURST", "STOPPED"],
};
/** The status plate's face, and the biggest the state word gets on it (shrunk to fit longer words). */
const PLATE_W = 0.7;
const PLATE_H = 0.32;
const WORD_MAX = 0.13;
const wordSize = (word: string) => Math.min(WORD_MAX, (PLATE_W - 0.1) / (word.length * 0.62 * 1.06));
/** Red work lights that wash the wall behind a burst pipe: pooled and always mounted, so a burst never recompiles shaders. */
const WASH_LIGHTS = 2;

/** A pipe's live state, read every frame without re-rendering the room. */
const stateOf = (id: string): LinkState => useSystems.getState().links.find((l) => l.id === id)?.state ?? "off";
const loadOf = (id: string): number => useSystems.getState().links.find((l) => l.id === id)?.load ?? 0;

/**
 * Everything that shows a pipe's state is shared by state: one collar, plate and wall-glow material for every pipe
 * that is working, one for every slow pipe, and so on, animated once a frame by StatusDriver. The geometries are
 * shared too, so sixteen pipes cost what one does.
 */
interface StatusLook {
  collar: MeshStandardMaterial;
  plate: MeshBasicMaterial;
  plateBase: Color;
  glow: MeshBasicMaterial;
}
let looks: Record<LinkState, StatusLook> | null = null;
function statusLooks(): Record<LinkState, StatusLook> {
  if (looks) return looks;
  const tex = glowTexture();
  const make = (s: LinkState): StatusLook => {
    const plateBase = new Color(s === "off" ? "#25282e" : LAMP[s]);
    return {
      collar: new MeshStandardMaterial({ color: "#14161a", metalness: 0.6, roughness: 0.4, emissive: LAMP[s], emissiveIntensity: s === "off" ? 0 : 1.3, toneMapped: false }),
      plate: new MeshBasicMaterial({ color: plateBase.clone(), toneMapped: false }),
      plateBase,
      glow: new MeshBasicMaterial({ color: LAMP[s], map: tex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    };
  };
  looks = { off: make("off"), ok: make("ok"), slow: make("slow"), down: make("down") };
  return looks;
}

/** A soft round glow, white in the middle and gone at the edge, tinted per state. */
function glowTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const GEO = {
  pipe: new CylinderGeometry(0.11, 0.11, 5.8, 20),
  ring: new CylinderGeometry(0.15, 0.15, 0.08, 20),
  collar: new CylinderGeometry(0.19, 0.19, 0.46, 28),
  collarRim: new CylinderGeometry(0.21, 0.21, 0.05, 28),
  plateBack: new BoxGeometry(PLATE_W + 0.06, PLATE_H + 0.06, 0.03),
  plateFace: new BoxGeometry(PLATE_W, PLATE_H, 0.02),
  glow: new PlaneGeometry(1.1, 1.9),
  split: new PlaneGeometry(0.035, 0.22),
};

/** How hard each state's light is right now, 0..1: ok steady, slow a slow amber pulse, down a fast red blink. */
function beat(s: LinkState, t: number): number {
  if (s === "ok") return 1;
  if (s === "slow") return 0.5 + 0.5 * Math.sin(t * 3.2);
  if (s === "down") return t * 4 - Math.floor(t * 4) < 0.55 ? 1 : 0.12;
  return 0;
}

/** Drives the shared status materials and the pooled burst lights, once a frame for the whole wall. */
function StatusDriver() {
  const lights = useRef<(PointLight | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const L = statusLooks();
    for (const s of STATES) {
      if (s === "off") continue;
      const k = beat(s, t);
      const look = L[s];
      // Bright enough to bloom, not so bright the colour burns out to white.
      look.collar.emissiveIntensity = s === "ok" ? 1.3 : s === "slow" ? 0.55 + 0.95 * k : 0.25 + 1.75 * k;
      // The plate stays under the bloom threshold so its letters stay sharp, and never goes dark enough to lose them.
      look.plate.color.copy(look.plateBase).multiplyScalar(s === "ok" ? 0.95 : s === "slow" ? 0.6 + 0.35 * k : 0.45 + 0.5 * k);
      look.glow.opacity = s === "ok" ? 0.5 : s === "slow" ? 0.25 + 0.4 * k : 0.15 + 0.8 * k;
    }
    // The first bursts on the wall get the red work lights; the rest still blink and spray.
    const links = useSystems.getState().links;
    let used = 0;
    for (let i = 0; i < links.length && used < WASH_LIGHTS; i++) {
      if (links[i]!.state !== "down") continue;
      const l = lights.current[used++];
      if (!l) continue;
      l.position.set(pipeX(i, links.length), 2.6, PIPE_Z + 0.45);
      l.intensity = 2 + 7 * beat("down", t);
    }
    for (let j = used; j < WASH_LIGHTS; j++) {
      const l = lights.current[j];
      if (l) l.intensity = 0;
    }
  });
  return (
    <>
      {Array.from({ length: WASH_LIGHTS }, (_, j) => (
        <pointLight
          key={j}
          ref={(l) => {
            lights.current[j] = l;
          }}
          color="#ff3b4f"
          intensity={0}
          distance={3.4}
          decay={1.6}
        />
      ))}
    </>
  );
}

const SPRAY_AT: [number, number, number] = [0, 2.98, 0.12];
const SPRAY_DIR: [number, number, number] = [0.35, 0.25, 1];
const STEAM_AT: [number, number, number] = [0, 2.98, 0.15];
const VENT_AT: [number, number, number] = [0.22, 2.9, 0];

function Pipe({ link, x }: { link: Link; x: number }) {
  const shake = useRef<Group>(null);
  const needle = useRef<Group>(null);
  const state = link.state;
  const look = statusLooks()[state];
  const [flavour, word] = (link.id === "world" ? CLOCK_WORDS : WORDS)[state];
  const lit = state !== "off";
  const ink = lit ? "#0b0f14" : "#8a8a93";
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = stateOf(link.id);
    if (shake.current) {
      // A slow pipe rattles hard in fits, coughing with each one; a burst one shudders.
      const fit = s === "slow" ? Math.max(0, Math.sin(t * 2.3)) : 0;
      const amp = s === "slow" ? 0.06 * fit : s === "down" ? 0.015 : 0;
      shake.current.position.x = Math.sin(t * 47 + x) * amp;
      shake.current.rotation.z = s === "slow" ? Math.sin(t * 31 + x) * 0.012 * fit : 0;
    }
    if (needle.current) {
      const target = s === "off" || s === "down" ? 0 : loadOf(link.id) + (s === "slow" ? Math.sin(t * 9) * 0.05 : Math.sin(t * 1.3 + x) * 0.02);
      const angle = Math.PI * 0.75 - Math.min(1, Math.max(0, target)) * Math.PI * 1.5;
      needle.current.rotation.z += (angle - needle.current.rotation.z) * 0.08;
    }
  });
  return (
    <group position={[x, 0, PIPE_Z]}>
      {/* The pipe's state, washed onto the bricks behind it so it reads from across the room. */}
      {lit && <mesh geometry={GEO.glow} position={[0, 2.3, -0.68]} material={look.glow} />}
      <group ref={shake}>
        <mesh geometry={GEO.pipe} position={[0, 2.9, 0]} material={lit ? PBR.copper() : PBR.steel()} castShadow />
        {[0.35, 3.4, 5.2].map((y) => (
          <mesh key={y} geometry={GEO.ring} position={[0, y, 0]} material={PBR.brass()} />
        ))}
        {/* The status collar: the loudest thing on the pipe. Mint and steady, amber and pulsing, red and blinking, or dark. */}
        <mesh geometry={GEO.collar} position={[0, 2.35, 0]} material={look.collar} />
        {[2.1, 2.6].map((y) => (
          <mesh key={y} geometry={GEO.collarRim} position={[0, y, 0]} material={PBR.brass()} />
        ))}
        {/* The valve wheel nobody is allowed to touch. */}
        <group position={[0, 0.62, 0.16]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={PBR.lacquer("#8c2f2f", 0.4)}>
            <torusGeometry args={[0.13, 0.02, 8, 24]} />
          </mesh>
          <mesh material={PBR.lacquer("#8c2f2f", 0.4)}>
            <boxGeometry args={[0.24, 0.02, 0.02]} />
          </mesh>
        </group>
        {/* The gauge. */}
        <group position={[0, 1.75, 0.15]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={PBR.brass()}>
            <cylinderGeometry args={[0.19, 0.19, 0.05, 28]} />
          </mesh>
          <mesh position={[0, 0, 0.027]} material={PBR.matte("#efe6d2", 0.7)}>
            <circleGeometry args={[0.16, 28]} />
          </mesh>
          <mesh position={[0.07, -0.07, 0.029]} rotation={[0, 0, Math.PI / 4]} material={PBR.matte("#c0392b", 0.6)}>
            <planeGeometry args={[0.06, 0.012]} />
          </mesh>
          <group ref={needle} position={[0, 0, 0.032]} rotation={[0, 0, Math.PI * 0.75]}>
            <mesh position={[0.06, 0, 0]} material={PBR.matte("#14100c", 0.6)}>
              <planeGeometry args={[0.13, 0.012]} />
            </mesh>
          </group>
        </group>
        {/* A little vent on the side, where healthy steam escapes. */}
        <mesh position={[0.16, 2.9, 0]} rotation={[0, 0, Math.PI / 2]} material={PBR.brass()}>
          <cylinderGeometry args={[0.035, 0.035, 0.12, 12]} />
        </mesh>
      </group>
      <Text font={FONTS.mono} fontSize={0.075} position={[0, 1.31, 0.16]} letterSpacing={0.1} color="#e8c27a" anchorX="center" anchorY="bottom" maxWidth={PLATE_W + 0.02} textAlign="center" lineHeight={1.05}>
        {link.label.toUpperCase()}
      </Text>
      {/* The status plate, lit from behind in the pipe's colour: what it's doing, and what that means, big. */}
      <group position={[0, 1.1, 0.15]}>
        <mesh geometry={GEO.plateBack} material={PBR.blackMetal()} />
        <mesh geometry={GEO.plateFace} position={[0, 0, 0.015]} material={look.plate} />
        <Text font={FONTS.mono} fontSize={0.055} position={[0, 0.085, 0.03]} letterSpacing={0.24} color={ink} anchorX="center" anchorY="middle">
          {flavour}
        </Text>
        <Text font={FONTS.mono} fontSize={wordSize(word)} position={[0, -0.035, 0.03]} letterSpacing={0.06} color={ink} anchorX="center" anchorY="middle">
          {word}
        </Text>
      </group>
      {/* The world clock's brass tag: when the last hour ran, and who wrote it (worldClock.ts). */}
      {link.id === "world" && link.note && (
        <group position={[0, 0.86, 0.26]}>
          {/* Its bracket, off the pipe. */}
          <mesh position={[0, 0, -0.07]} material={PBR.brass()}>
            <boxGeometry args={[0.03, 0.03, 0.14]} />
          </mesh>
          <Block size={[0.78, 0.09, 0.02]} material={PBR.brass()} radius={0.008} />
          <Text font={FONTS.mono} fontSize={0.042} position={[0, 0, 0.015]} letterSpacing={0.08} color="#2a1c10" anchorX="center" anchorY="middle">
            {link.note}
          </Text>
        </group>
      )}
      {(state === "ok" || state === "slow") && (
        <Smoke
          position={VENT_AT}
          count={state === "slow" ? 24 : 10}
          rate={state === "slow" ? 0.6 : 0.3}
          height={state === "slow" ? 1.9 : 1}
          spread={state === "slow" ? 0.35 : 0.25}
          sizes={state === "slow" ? [0.2, 0.95] : [0.08, 0.4]}
          wind={[0.4, 0, 0.1]}
          color="#e9eef2"
          opacity={state === "slow" ? 0.62 : 0.22}
          // Coughs: a puff with every rattle, and nothing in between.
          live={(t) => (stateOf(link.id) === "slow" ? 0.15 + 0.5 * Math.max(0, Math.sin(t * 2.3)) : undefined)}
        />
      )}
      {state === "down" && (
        <>
          {/* Burst: a white jet of water from a split in the pipe, and a cloud of steam. */}
          <Sparks position={SPRAY_AT} dir={SPRAY_DIR} count={64} rate={3.2} speed={3.2} cone={0.4} size={0.04} color="#ffffff" intensity={2.4} />
          <Smoke position={STEAM_AT} count={22} rate={0.7} height={2.2} spread={0.6} sizes={[0.25, 1.1]} wind={[0, 0, 0.6]} color="#f2f4f6" opacity={0.55} />
          <mesh geometry={GEO.split} position={[0, 2.98, 0.11]} rotation={[0, 0, 0.5]} material={PBR.light("#ff5a6e", 2)} />
        </>
      )}
    </group>
  );
}

/** The boiler: the MacBook. Its fire burns while the Mac is up, and goes out when it sleeps. */
function Boiler({ position, yaw }: { position: [number, number]; yaw: number }) {
  const fire = useRef<Mesh>(null);
  const glow = useRef<PointLight>(null);
  const flame = useMemo(() => new MeshStandardMaterial({ color: "#000000", emissive: "#ff7a2a", emissiveIntensity: 0, toneMapped: false }), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = stateOf("mac");
    const lit = s === "ok" || s === "slow";
    const flicker = lit ? (s === "slow" ? 1.2 : 2.6) + Math.sin(t * 13) * 0.4 + Math.sin(t * 5.7) * 0.5 : 0.05;
    flame.emissiveIntensity = flicker;
    if (glow.current) glow.current.intensity = lit ? 3 + flicker * 2 : 0;
    if (fire.current) fire.current.scale.y = lit ? 0.85 + Math.sin(t * 9) * 0.15 : 0.3;
  });
  const [x, z] = position;
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 1.7, 0]} material={PBR.steel()} castShadow receiveShadow>
        <cylinderGeometry args={[1.15, 1.2, 3.2, 40]} />
      </mesh>
      <mesh position={[0, 3.3, 0]} material={PBR.steel()} castShadow>
        <sphereGeometry args={[1.15, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {[0.35, 1.2, 2.2, 3.1].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.brass()}>
          <torusGeometry args={[1.19, 0.035, 8, 48]} />
        </mesh>
      ))}
      {/* Chimney up into the dark. */}
      <mesh position={[0.4, 5.4, -0.2]} material={PBR.copper()} castShadow>
        <cylinderGeometry args={[0.18, 0.18, 3.6, 20]} />
      </mesh>
      {/* Firebox door, facing the room. */}
      <group position={[0, 0.8, 1.17]}>
        <Block size={[0.9, 0.7, 0.08]} material={PBR.blackMetal()} radius={0.03} />
        <mesh ref={fire} position={[0, -0.05, 0.05]} material={flame}>
          <planeGeometry args={[0.6, 0.35]} />
        </mesh>
        {[-0.2, -0.1, 0, 0.1, 0.2].map((dx) => (
          <mesh key={dx} position={[dx, -0.05, 0.06]} material={PBR.blackMetal()}>
            <boxGeometry args={[0.025, 0.38, 0.02]} />
          </mesh>
        ))}
      </group>
      <pointLight ref={glow} position={[0, 0.9, 1.8]} color="#ff8a3a" intensity={0} distance={6} decay={1.8} />
      {/* The big gauge, and a brass plate so nobody forgets what the boiler is. */}
      <group position={[0.55, 2.2, 1.08]} rotation={[0, 0.45, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={PBR.brass()}>
          <cylinderGeometry args={[0.3, 0.3, 0.06, 32]} />
        </mesh>
        <mesh position={[0, 0, 0.032]} material={PBR.matte("#efe6d2", 0.7)}>
          <circleGeometry args={[0.26, 32]} />
        </mesh>
      </group>
      <group position={[-0.35, 2.3, 1.12]} rotation={[0, -0.3, 0]}>
        <Block size={[0.8, 0.22, 0.03]} material={PBR.brass()} radius={0.01} />
        <Text font={FONTS.mono} fontSize={0.08} position={[0, 0, 0.02]} letterSpacing={0.18} color="#2a1c10" anchorX="center">
          MACBOOK
        </Text>
      </group>
    </group>
  );
}

/** How high the drip's pipe runs, and the left wall it runs in from. */
const DRIP_Y = 5.6;
const DRIP_WALL_X = -8;

/** The bucket, under the drip that has always been there. */
function Drip({ position }: { position: [number, number] }) {
  const drop = useRef<Mesh>(null);
  const ripple = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const u = (clock.elapsedTime * 0.7) % 1;
    if (drop.current) drop.current.position.y = DRIP_Y - 0.1 - u * u * (DRIP_Y - 0.5);
    if (ripple.current) {
      const r = ((clock.elapsedTime * 0.7 + 0.02) % 1) * 3;
      ripple.current.scale.setScalar(0.2 + r * 0.6);
      (ripple.current.material as MeshStandardMaterial).opacity = Math.max(0, 0.5 - r * 0.4);
    }
  });
  const [x, z] = position;
  return (
    <group position={[x, 0, z]}>
      {/* The overhead pipe, with its one bad joint. It runs in high from the left wall: hung any lower, the default
          camera saw it cut straight across the pipe wall's status collars. */}
      <mesh position={[(DRIP_WALL_X - x) / 2, DRIP_Y, 0]} rotation={[0, 0, Math.PI / 2]} material={PBR.copper()} castShadow>
        <cylinderGeometry args={[0.08, 0.08, x - DRIP_WALL_X + 0.3, 16]} />
      </mesh>
      <mesh position={[0, DRIP_Y, 0]} rotation={[0, 0, Math.PI / 2]} material={PBR.brass()}>
        <cylinderGeometry args={[0.11, 0.11, 0.12, 16]} />
      </mesh>
      <mesh ref={drop} position={[0, DRIP_Y - 0.15, 0]} material={PBR.glass("#bfe3ff", 0.7)}>
        <sphereGeometry args={[0.03, 10, 8]} />
      </mesh>
      {/* Bucket: a slightly dented galvanised pail. */}
      <mesh position={[0, 0.2, 0]} material={PBR.aluminium()} castShadow receiveShadow>
        <cylinderGeometry args={[0.22, 0.18, 0.4, 28, 1, true]} />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.glass("#6f8ea6", 0.75)}>
        <circleGeometry args={[0.2, 28]} />
      </mesh>
      <mesh ref={ripple} position={[0, 0.305, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.05, 0.06, 24]} />
        <meshStandardMaterial color="#dff1ff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.4, 0]} rotation={[0, 0, Math.PI / 2]} material={PBR.steel()}>
        <torusGeometry args={[0.22, 0.008, 6, 24, Math.PI]} />
      </mesh>
      {/* The mop, leaning on the wall of the pail. */}
      <group position={[0.45, 0, 0.1]} rotation={[0, 0, 0.22]}>
        <mesh position={[0, 0.8, 0]} material={PBR.wood("oak")} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 1.5, 8]} />
        </mesh>
        <Block size={[0.24, 0.1, 0.12]} position={[0, 0.06, 0]} material={PBR.fabric("#b9b2a2")} radius={0.04} />
      </group>
      <Text font={FONTS.mono} fontSize={0.06} position={[0, 0.06, 0.35]} rotation={[-Math.PI / 2, 0, 0]} color="#8a8a93" letterSpacing={0.1} anchorX="center">
        DO NOT MOVE THE BUCKET
      </Text>
    </group>
  );
}

/** DAYS SINCE LAST INCIDENT, hand-painted, with a number Gary has to keep resetting. */
function IncidentSign({ position, yaw }: { position: [number, number]; yaw: number }) {
  const days = useSystems((s) => daysSinceIncident(s.lastIncident));
  return (
    <group position={[position[0], 1.7, position[1]]} rotation={[0, yaw, 0]}>
      <Block size={[1.6, 1.1, 0.06]} material={PBR.matte("#e9dfc6", 0.9)} radius={0.02} />
      <Block size={[1.66, 0.12, 0.08]} position={[0, 0.58, 0]} material={PBR.lacquer("#1f5a3a", 0.5)} radius={0.02} />
      <Text font={FONTS.mono} fontSize={0.075} position={[0, 0.35, 0.04]} color="#1f5a3a" letterSpacing={0.14} anchorX="center" maxWidth={1.4} textAlign="center">
        DAYS SINCE LAST INCIDENT
      </Text>
      <Text font={FONTS.serifUpright} fontSize={0.62} position={[0, -0.12, 0.04]} color="#8c2f2f" anchorX="center">
        {String(days)}
      </Text>
      <Text font={FONTS.mono} fontSize={0.04} position={[0, -0.47, 0.04]} color="#5a4636" anchorX="center">
        (AS PER TRADITION)
      </Text>
    </group>
  );
}

/** Tool bench: tape, a toolbox, Rusty's manual under one leg, and the kettle that whistles when you're needed. */
function Bench({ position, yaw }: { position: [number, number]; yaw: number }) {
  const kettle = useRef<Group>(null);
  const whistling = useWorld((s) => pendingApprovals(s.lattice, true).length > 0);
  useFrame(({ clock }) => {
    if (!kettle.current) return;
    const t = clock.elapsedTime;
    kettle.current.rotation.z = whistling ? Math.sin(t * 30) * 0.05 : 0;
    kettle.current.position.y = 0.92 + (whistling ? Math.abs(Math.sin(t * 15)) * 0.02 : 0);
  });
  return (
    <group position={[position[0], 0, position[1]]} rotation={[0, yaw, 0]}>
      <Block size={[2.4, 0.08, 0.8]} position={[0, 0.84, 0]} material={PBR.wood("walnut")} radius={0.02} />
      {[-1.1, 1.1].map((x) => (
        <Block key={x} size={[0.08, 0.8, 0.7]} position={[x, 0.4, 0]} material={PBR.steel()} radius={0.01} />
      ))}
      {/* The 71-page boiler manual, levelling the bench. */}
      <Block size={[0.3, 0.05, 0.22]} position={[1.1, 0.025, 0.2]} material={PBR.matte("#e7dfd3", 0.9)} radius={0.005} />
      <Block size={[0.6, 0.3, 0.3]} position={[-0.6, 1.03, 0]} material={PBR.lacquer("#8c2f2f", 0.4)} radius={0.03} />
      {[-0.05, 0.2, 0.45].map((x, i) => (
        <mesh key={x} position={[x, 0.93, 0.15]} rotation={[Math.PI / 2, 0, 0]} material={PBR.matte(i === 1 ? "#c9a25c" : "#9aa3ad", 0.5)}>
          <torusGeometry args={[0.07, 0.035, 10, 20]} />
        </mesh>
      ))}
      <group ref={kettle} position={[0.8, 0.92, -0.1]}>
        <mesh position={[0, 0.12, 0]} material={PBR.chrome()} castShadow>
          <sphereGeometry args={[0.15, 24, 16]} />
        </mesh>
        <mesh position={[0.17, 0.16, 0]} rotation={[0, 0, -0.9]} material={PBR.chrome()}>
          <cylinderGeometry args={[0.02, 0.035, 0.16, 10]} />
        </mesh>
        {whistling && <Smoke position={[0.24, 0.24, 0]} count={14} rate={0.9} height={0.9} spread={0.12} sizes={[0.05, 0.35]} wind={[0.3, 0, 0]} color="#ffffff" opacity={0.5} />}
      </group>
    </group>
  );
}

/** The alarm lamp over the door: spins red whenever any real link is down. */
function AlarmLamp() {
  const head = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  const anyDown = useSystems((s) => s.links.some((l) => l.state === "down"));
  useFrame(({ clock }) => {
    if (head.current) head.current.rotation.y = anyDown ? clock.elapsedTime * 6 : 0;
    if (light.current) light.current.intensity = anyDown ? 18 : 0;
  });
  return (
    <group position={[0, 5.4, -5.9]}>
      <mesh material={PBR.light(anyDown ? "#ff3b4f" : "#3a1a1e", anyDown ? 4 : 0.6)}>
        <sphereGeometry args={[0.2, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <Block size={[0.5, 0.1, 0.5]} position={[0, -0.05, 0]} material={PBR.blackMetal()} radius={0.02} />
      <group ref={head}>
        <pointLight ref={light} position={[0.6, 0.1, 0.8]} color="#ff3b4f" intensity={0} distance={11} decay={1.5} />
      </group>
    </group>
  );
}

/** One bare bulb on a wire, flickering a little. Of course it does. */
function Bulb() {
  const light = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (light.current) light.current.intensity = 22 + (Math.sin(t * 23) > 0.97 ? -14 : 0) + Math.sin(t * 3.1) * 1.5;
  });
  return (
    <group position={[-1.5, 4.6, 0.5]}>
      <mesh position={[0, 0.7, 0]} material={PBR.blackMetal()}>
        <cylinderGeometry args={[0.006, 0.006, 1.4, 6]} />
      </mesh>
      <mesh material={PBR.light("#ffcf8a", 4)}>
        <sphereGeometry args={[0.07, 16, 12]} />
      </mesh>
      <pointLight ref={light} color="#ffc27a" intensity={22} distance={15} decay={1.6} />
    </group>
  );
}

export function BoilerRoom() {
  const links = useSystems((s) => s.links);
  // The world clock's pipe reads the hourly step live, as the Desk does.
  useEffect(() => startWorldClock(), []);
  // The boiler stands in the front-right corner, its firebox turned to the keeper, clear of the pipe wall.
  const boiler = ahead(getStation("boiler", "boiler"), 1.6);
  const bucket = ahead(getStation("boiler", "bucket"), 0.6);
  const sign = ahead(getStation("boiler", "sign"), 0.95);
  const bench = ahead(getStation("boiler", "bench"), 0.8);
  const brick = PBR.matte("#2a1c16", 0.95);
  return (
    <group>
      <Plinth floor={PBR.gratingFloor([7, 6])} edge={PBR.blackMetal()} accent="#ff9a4a" />
      {/* Sooty back and left walls. */}
      <Block size={[16.4, 5.8, 0.3]} position={[0, 2.9, -6.4]} material={brick} radius={0.04} />
      <Block size={[0.3, 5.8, 9]} position={[-8.15, 2.9, -1.8]} material={brick} radius={0.04} />
      <Text font={FONTS.serifUpright} fontSize={0.42} position={[3.4, 5.0, -6.2]} letterSpacing={0.28} color="#ff9a4a">
        THE BOILER ROOM
      </Text>
      <Text font={FONTS.mono} fontSize={0.1} position={[3.4, 4.62, -6.2]} letterSpacing={0.22} color="#a9a9b1">
        MAINTENANCE · AUTHORISED HONKERS ONLY
      </Text>
      {links.map((l, i) => (
        <Pipe key={l.id} link={l} x={pipeX(i, links.length)} />
      ))}
      <StatusDriver />
      {/* A header pipe that ties the wall together. */}
      <mesh position={[PIPE_X0 + PIPE_SPAN / 2, 4.8, PIPE_Z - 0.25]} rotation={[0, 0, Math.PI / 2]} material={PBR.copper()} castShadow>
        <cylinderGeometry args={[0.16, 0.16, PIPE_SPAN + 1.2, 20]} />
      </mesh>
      <Boiler position={boiler.pos} yaw={boiler.yaw} />
      <Drip position={bucket.pos} />
      <IncidentSign position={sign.pos} yaw={sign.yaw} />
      <Bench position={bench.pos} yaw={bench.yaw} />
      <AlarmLamp />
      <Bulb />
      <pointLight position={[3, 3.5, 2]} color="#ff9a4a" intensity={8} distance={14} decay={1.7} />
      <Haze min={[-7.5, 0.3, -6]} size={[15, 3.5, 11]} count={22} puff={0.09} color="#d8dde2" opacity={0.6} drift={0.4} />
      <Dust min={[-7, 0.5, -5.5]} size={[14, 4, 11]} count={50} color="#ffcf9a" opacity={0.4} />
    </group>
  );
}
