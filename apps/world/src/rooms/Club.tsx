import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
  type Group,
  type Mesh,
  type PointLight,
} from "three";
import { CLUB_BPM, deck, tickDeck } from "../club/deck.ts";
import { Beam, Haze, LaserFan, Smoke } from "../fx/atmos.tsx";
import { PBR } from "../fx/pbr.ts";
import { gatheringIn, useWorld } from "../store.ts";
import { Block, FONTS } from "./primitives.tsx";
import { skylineMaterial } from "./skyline.ts";

/**
 * The Break Room's club: a stage under a window onto the city at night, a DJ booth facing the floor, a drum
 * kit and keys for live sets, a lighting truss with moving heads, lasers, a mirror ball, an LED floor, haze
 * and a holographic crowd. It idles at house-lights level and comes alive when someone takes the decks or the
 * mic (a "club-night" or "concert" gathering).
 */

export const STAGE = { x0: -3.6, x1: 3.6, z0: -6.25, z1: -3.45, h: 0.45 };
const FLOOR = { x0: -3.1, z0: -3.15, cols: 10, rows: 7, tile: 0.62 };
const BPM = CLUB_BPM;
const PALETTES = {
  dj: ["#ff3d9a", "#7a5cff", "#29c7ff", "#ffb347"],
  concert: ["#ffb347", "#ff6a3d", "#ffe2b0", "#ff3d9a"],
  // The Hallowed Veil: pumpkin, witch's purple, a sickly green.
  party: ["#ff7a1a", "#8a3dff", "#5aff6a", "#ff9e3d"],
  idle: ["#5a3d8a", "#2a4a7a", "#7a2a5a", "#3a2a6a"],
};

/** Shared show state, written once a frame by <Club> and read by every fixture. */
export const show = {
  /** 0 house lights … 1 full show. */
  level: 0.15,
  act: null as "dj" | "concert" | null,
  /** Beats since the start (fractional). */
  beat: 0,
  /** 1 on the kick, decaying. */
  kick: 0,
  palette: PALETTES.idle,
};

const col = new Color();
function paletteColor(i: number, out = col) {
  const p = show.palette;
  return out.set(p[((i % p.length) + p.length) % p.length]!);
}

function useShowDriver() {
  useFrame(({ clock }, dt) => {
    const here = gatheringIn(useWorld.getState(), "breakroom");
    // A track from the C.E.O. turns the club on by itself, whoever is (or isn't) on the decks.
    show.act =
      here?.id === "concert"
        ? "concert"
        : here?.id === "club-night" || here?.id === "costume-party" || deck.playing
          ? "dj"
          : null;
    const target = deck.playing ? 1 : here ? (here.live ? 1 : 0.55) : 0.15;
    show.level += (target - show.level) * Math.min(1, dt * 1.2);
    show.palette = here?.id === "costume-party" ? PALETTES.party : show.act ? PALETTES[show.act] : PALETTES.idle;
    show.beat = (clock.elapsedTime * BPM) / 60;
    tickDeck(dt, clock.elapsedTime, show.beat, show.act === "dj" && show.level > 0.6);
    // A build strobes the kick at double time; a drop hits everything at once.
    const strobe = deck.build > 0 ? Math.exp(-((show.beat * 2) % 1) * 8) * deck.build : 0;
    show.kick = Math.min(1, Math.max(deck.kick, strobe, deck.drop * 0.8));
  });
}

// ── The window onto the city ────────────────────────────────────────────────────────────────────

function Skyline() {
  const mat = useMemo(skylineMaterial, []);
  useFrame(({ clock }) => {
    mat.uniforms.uTime!.value = clock.elapsedTime;
    // The stage lights spill a little colour onto the glass.
    paletteColor(
      Math.floor(show.beat / 4),
      mat.uniforms.uTint!.value as Color,
    ).multiplyScalar(0.05 * show.level);
  });
  const frame = PBR.blackMetal();
  return (
    <group position={[0, 0, -6.42]}>
      <mesh position={[0, 2.75, 0]} material={mat}>
        <planeGeometry args={[13.2, 4.6]} />
      </mesh>
      {/* Mullions and transoms, like a loft's steel windows. */}
      {[-6.6, -4.4, -2.2, 0, 2.2, 4.4, 6.6].map((x) => (
        <Block
          key={x}
          size={[0.08, 4.6, 0.08]}
          position={[x, 2.75, 0.04]}
          material={frame}
          radius={0.01}
        />
      ))}
      {[0.45, 3.3, 5.05].map((y) => (
        <Block
          key={y}
          size={[13.3, 0.08, 0.08]}
          position={[0, y, 0.04]}
          material={frame}
          radius={0.01}
        />
      ))}
      <mesh position={[0, 2.75, 0.07]} material={PBR.glass("#cfe0ff", 0.06)}>
        <planeGeometry args={[13.2, 4.6]} />
      </mesh>
    </group>
  );
}

// ── Stage ───────────────────────────────────────────────────────────────────────────────────────

function Stage() {
  const edge = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#000",
        emissive: "#ff3d9a",
        emissiveIntensity: 2,
        toneMapped: false,
      }),
    [],
  );
  useFrame(() => {
    paletteColor(Math.floor(show.beat), edge.emissive);
    edge.emissiveIntensity = 0.6 + show.level * (1.4 + show.kick * 1.5);
  });
  const w = STAGE.x1 - STAGE.x0;
  const d = STAGE.z1 - STAGE.z0;
  return (
    <group>
      <Block
        size={[w, STAGE.h, d]}
        position={[
          (STAGE.x0 + STAGE.x1) / 2,
          STAGE.h / 2,
          (STAGE.z0 + STAGE.z1) / 2,
        ]}
        material={PBR.blackMetal()}
        radius={0.02}
      />
      <mesh
        position={[0, STAGE.h + 0.002, (STAGE.z0 + STAGE.z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={PBR.blackFloor([4, 2])}
        receiveShadow
      >
        <planeGeometry args={[w - 0.05, d - 0.05]} />
      </mesh>
      <mesh position={[0, STAGE.h - 0.06, STAGE.z1 + 0.005]} material={edge}>
        <boxGeometry args={[w, 0.03, 0.01]} />
      </mesh>
      {/* Steps up at both front corners. */}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * (STAGE.x1 - 0.5), 0, STAGE.z1 + 0.3]}>
          <Block
            size={[0.9, 0.15, 0.3]}
            position={[0, 0.075, 0.15]}
            material={PBR.blackMetal()}
            radius={0.01}
          />
          <Block
            size={[0.9, 0.3, 0.3]}
            position={[0, 0.15, -0.15]}
            material={PBR.blackMetal()}
            radius={0.01}
          />
        </group>
      ))}
      {/* Wedge monitors along the lip. */}
      {[-1.4, 1.4].map((x) => (
        <Block
          key={x}
          size={[0.55, 0.3, 0.4]}
          position={[x, STAGE.h + 0.15, STAGE.z1 - 0.3]}
          rotation={[0.5, 0, 0]}
          material={PBR.lacquer("#141217", 0.4)}
          radius={0.03}
        />
      ))}
      {/* A smoke machine at the lip, puffing during a set. */}
      <Block
        size={[0.45, 0.25, 0.3]}
        position={[2.9, STAGE.h + 0.13, STAGE.z1 - 0.3]}
        material={PBR.blackMetal()}
        radius={0.03}
      />
      <Smoke
        position={[2.9, STAGE.h + 0.2, STAGE.z1 - 0.1]}
        count={22}
        rate={0.18}
        height={1.4}
        spread={1.6}
        sizes={[0.5, 2.4]}
        wind={[-1.6, -0.2, 1.2]}
        color="#c9c4d8"
        opacity={0.28}
        live={() => 0.04 + show.level * 0.26}
      />
    </group>
  );
}

function DjBooth() {
  const decks = useRef<Group>(null);
  const logo = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#000",
        emissive: "#ff3d9a",
        emissiveIntensity: 2.4,
        toneMapped: false,
      }),
    [],
  );
  const ring = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#000",
        emissive: "#29c7ff",
        emissiveIntensity: 2,
        toneMapped: false,
      }),
    [],
  );
  useFrame(({ clock }) => {
    const spin = show.act === "dj" ? 3.5 : 0.4;
    decks.current?.children.forEach((p) => (p.rotation.y += spin * 0.016));
    paletteColor(Math.floor(show.beat / 2), logo.emissive);
    logo.emissiveIntensity = 1 + show.level * 2 + show.kick * show.level * 2;
    ring.emissiveIntensity = 1 + Math.sin(clock.elapsedTime * 4) * 0.3;
  });
  const top = STAGE.h + 1.0;
  return (
    // The DJ stands behind it (-z) and faces the floor (+z): the front panel is the side the crowd sees.
    <group position={[0, 0, -4.6]}>
      <Block
        size={[2.2, 1.0, 0.7]}
        position={[0, STAGE.h + 0.5, 0]}
        material={PBR.lacquer("#0d0c10", 0.25)}
        radius={0.04}
      />
      <mesh position={[0, STAGE.h + 0.55, 0.356]} material={logo}>
        <planeGeometry args={[1.6, 0.04]} />
      </mesh>
      <Text
        font={FONTS.serif}
        fontSize={0.26}
        position={[0, STAGE.h + 0.33, 0.36]}
      >
        brb
        <meshBasicMaterial color={[3, 1.1, 1.8]} toneMapped={false} />
      </Text>
      {/* Two decks and a mixer on top. */}
      <group ref={decks}>
        {[-0.65, 0.65].map((x) => (
          <group key={x} position={[x, top + 0.03, -0.02]}>
            <mesh material={PBR.blackMetal()}>
              <cylinderGeometry args={[0.2, 0.2, 0.03, 32]} />
            </mesh>
            <mesh
              position={[0, 0.018, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              material={ring}
            >
              <ringGeometry args={[0.17, 0.19, 40]} />
            </mesh>
            <mesh position={[0.08, 0.02, 0]} material={PBR.chrome()}>
              <boxGeometry args={[0.06, 0.01, 0.02]} />
            </mesh>
          </group>
        ))}
      </group>
      <Block
        size={[0.5, 0.06, 0.42]}
        position={[0, top + 0.03, -0.02]}
        material={PBR.aluminium()}
        radius={0.01}
      />
      {Array.from({ length: 12 }, (_, i) => (
        <mesh
          key={i}
          position={[
            -0.18 + (i % 4) * 0.12,
            top + 0.07,
            -0.14 + Math.floor(i / 4) * 0.1,
          ]}
          material={i % 5 ? PBR.blackMetal() : PBR.light("#29c7ff", 2)}
        >
          <cylinderGeometry args={[0.018, 0.018, 0.025, 10]} />
        </mesh>
      ))}
      {/* Headphones resting on the mixer. */}
      <mesh
        position={[0.18, top + 0.1, 0.12]}
        rotation={[Math.PI / 2, 0, 0.3]}
        material={PBR.blackMetal()}
      >
        <torusGeometry args={[0.07, 0.012, 8, 20, Math.PI]} />
      </mesh>
    </group>
  );
}

function DrumKit({ x, z }: { x: number; z: number }) {
  const shell = PBR.lacquer("#7a1f2a", 0.25);
  const head = PBR.matte("#efe6d4", 0.6);
  const cymbal = PBR.brass();
  const crash = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!crash.current) return;
    const hit = show.act === "concert" ? show.kick : 0;
    crash.current.rotation.z =
      0.15 + Math.sin(clock.elapsedTime * 20) * 0.05 * hit;
  });
  const y = STAGE.h;
  return (
    // In front of the drummer, toward the floor.
    <group position={[x, y, z + 0.65]}>
      <mesh
        position={[0, 0.28, 0.1]}
        rotation={[Math.PI / 2, 0, 0]}
        material={shell}
        castShadow
      >
        <cylinderGeometry args={[0.28, 0.28, 0.4, 28]} />
      </mesh>
      <mesh
        position={[0, 0.28, 0.31]}
        rotation={[Math.PI / 2, 0, 0]}
        material={head}
      >
        <circleGeometry args={[0.27, 28]} />
      </mesh>
      {[-0.22, 0.22].map((tx) => (
        <mesh
          key={tx}
          position={[tx, 0.68, 0]}
          rotation={[0.3, 0, 0]}
          material={shell}
          castShadow
        >
          <cylinderGeometry args={[0.12, 0.12, 0.14, 20]} />
        </mesh>
      ))}
      <mesh position={[0.42, 0.55, -0.25]} material={shell}>
        <cylinderGeometry args={[0.16, 0.16, 0.3, 20]} />
      </mesh>
      <mesh position={[-0.35, 0.6, -0.25]} material={PBR.chrome()}>
        <cylinderGeometry args={[0.14, 0.14, 0.12, 20]} />
      </mesh>
      {[
        [-0.55, 1.05, 0.05],
        [0.6, 1.1, 0.0],
      ].map(([cx, cy, cz], i) => (
        <group key={i} position={[cx!, 0, cz!]}>
          <mesh position={[0, cy! / 2, 0]} material={PBR.chrome()}>
            <cylinderGeometry args={[0.008, 0.008, cy!, 6]} />
          </mesh>
          <mesh
            ref={i ? crash : undefined}
            position={[0, cy!, 0]}
            rotation={[0, 0, 0.15]}
            material={cymbal}
            castShadow
          >
            <cylinderGeometry args={[0.22, 0.22, 0.008, 28]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Keys({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, STAGE.h, z + 0.55]}>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * 0.35, 0.4, 0]}
          rotation={[0, 0, s * 0.35]}
          material={PBR.blackMetal()}
        >
          <boxGeometry args={[0.03, 0.85, 0.03]} />
        </mesh>
      ))}
      <Block
        size={[1.1, 0.08, 0.32]}
        position={[0, 0.82, 0]}
        material={PBR.lacquer("#141217", 0.3)}
        radius={0.02}
      />
      <mesh
        position={[0, 0.865, 0.05]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={PBR.matte("#f2f2f2", 0.4)}
      >
        <planeGeometry args={[1.0, 0.14]} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh
          key={i}
          position={[-0.46 + i * 0.07 + (i % 7 > 2 ? 0.035 : 0), 0.875, 0.02]}
          material={PBR.blackMetal()}
        >
          <boxGeometry args={[0.03, 0.012, 0.08]} />
        </mesh>
      ))}
    </group>
  );
}

function MicStand({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, STAGE.h, z + 0.35]}>
      <mesh position={[0, 0.01, 0]} material={PBR.blackMetal()}>
        <cylinderGeometry args={[0.15, 0.15, 0.02, 20]} />
      </mesh>
      <mesh position={[0, 0.7, 0]} material={PBR.chrome()}>
        <cylinderGeometry args={[0.01, 0.01, 1.4, 8]} />
      </mesh>
      <mesh
        position={[0, 1.42, -0.05]}
        rotation={[0.6, 0, 0]}
        material={PBR.blackMetal()}
      >
        <capsuleGeometry args={[0.025, 0.08, 4, 10]} />
      </mesh>
    </group>
  );
}

function SpeakerStack({ x }: { x: number }) {
  return (
    <group position={[x, 0, -5.5]}>
      {[0, 1, 2].map((i) => (
        <group key={i} position={[0, 0.45 + i * 0.86, 0]}>
          <Block
            size={[1, 0.82, 0.8]}
            material={PBR.lacquer("#0d0c10", 0.5)}
            radius={0.03}
          />
          {[-0.2, 0.2].map((cy) => (
            <mesh
              key={cy}
              position={[0, cy, 0.405]}
              material={PBR.blackMetal()}
            >
              <circleGeometry args={[0.17, 24]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ── Lights: truss, moving heads, washes, lasers, mirror ball ──────────────────────────────────

const TRUSS_Y = 4.7;
const FRONT_Z = -3.5;

function Truss() {
  const bars = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const n = 2 * 26 + 8;
  useEffect(() => {
    const m = bars.current;
    if (!m) return;
    let k = 0;
    // Zigzag lacing along both spans (front and back).
    for (const z of [FRONT_Z, -6.1]) {
      for (let i = 0; i < 26; i++) {
        const x = -3.9 + (i / 25) * 7.8;
        dummy.position.set(x, TRUSS_Y, z);
        dummy.rotation.set(i % 2 ? 0.8 : -0.8, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        m.setMatrixAt(k++, dummy.matrix);
      }
    }
    // Four uprights.
    for (const x of [-4.1, 4.1])
      for (const z of [FRONT_Z, -6.1]) {
        dummy.position.set(x, TRUSS_Y / 2, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, TRUSS_Y / 0.42, 1);
        dummy.updateMatrix();
        m.setMatrixAt(k++, dummy.matrix);
        dummy.scale.set(1, 1, 1);
      }
    for (; k < n; k++) m.setMatrixAt(k, dummy.matrix);
    m.instanceMatrix.needsUpdate = true;
  }, [dummy, n]);
  const metal = PBR.aluminium();
  return (
    <group>
      <instancedMesh ref={bars} args={[undefined, metal, n]}>
        <cylinderGeometry args={[0.02, 0.02, 0.42, 6]} />
      </instancedMesh>
      {[FRONT_Z, -6.1].flatMap((z) =>
        [-0.15, 0.15].map((dy) => (
          <mesh
            key={`${z}${dy}`}
            position={[0, TRUSS_Y + dy, z]}
            rotation={[0, 0, Math.PI / 2]}
            material={metal}
          >
            <cylinderGeometry args={[0.03, 0.03, 8.4, 8]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** A moving head on the truss: a yoke and a lamp that pans and tilts, throwing a beam through the haze. */
function MovingHead({
  x,
  z,
  i,
  aim,
}: {
  x: number;
  z: number;
  i: number;
  aim: "floor" | "crowd";
}) {
  const yoke = useRef<Group>(null);
  const head = useRef<Group>(null);
  const lens = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#000",
        emissive: "#fff",
        emissiveIntensity: 3,
        toneMapped: false,
      }),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const lvl = show.level;
    const phase = i * 0.9;
    const tempo = show.act ? 0.9 : 0.25;
    if (yoke.current)
      yoke.current.rotation.y =
        Math.sin(t * tempo * 0.7 + phase) * (aim === "floor" ? 0.7 : 0.4);
    if (head.current) {
      // Tip the beam forward (+z), toward the floor or out over the crowd.
      const base = aim === "floor" ? 0.45 : 0.95;
      head.current.rotation.x = -(
        base +
        Math.sin(t * tempo + phase * 1.3) * 0.35 * (0.3 + lvl)
      );
    }
    paletteColor(i + Math.floor(show.beat / 4), lens.emissive);
    lens.emissiveIntensity = 1 + lvl * 3;
  });
  return (
    <group position={[x, TRUSS_Y - 0.25, z]}>
      <Block
        size={[0.3, 0.12, 0.25]}
        position={[0, 0.12, 0]}
        material={PBR.blackMetal()}
        radius={0.02}
      />
      <group ref={yoke}>
        <mesh position={[0, -0.05, 0]} material={PBR.blackMetal()}>
          <boxGeometry args={[0.32, 0.04, 0.08]} />
        </mesh>
        <group ref={head} position={[0, -0.18, 0]}>
          <mesh rotation={[0, 0, 0]} material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.1, 0.12, 0.26, 16]} />
          </mesh>
          <mesh
            position={[0, -0.132, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            material={lens}
          >
            <circleGeometry args={[0.09, 20]} />
          </mesh>
          <group position={[0, -0.14, 0]}>
            <Beam
              length={aim === "floor" ? 6 : 8}
              radius={aim === "floor" ? 0.75 : 1.1}
              opacity={0.3}
              live={(t2, c) => {
                paletteColor(i + Math.floor(show.beat / 4), c);
                // A strobe-ish flicker on the kick at full show.
                const flick = show.act ? 0.75 + show.kick * 0.5 : 1;
                return (
                  (0.03 + show.level * 0.32) *
                  flick *
                  (0.9 + Math.sin(t2 * 13 + i) * 0.1)
                );
              }}
            />
          </group>
        </group>
      </group>
    </group>
  );
}

function MirrorBall() {
  const ball = useRef<Mesh>(null);
  const specks = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const N = 70;
  const spots = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => ({
        a: (i / N) * Math.PI * 2 * 7.3,
        r: 1.2 + (((i * 37) % 100) / 100) * 4.2,
      })),
    [],
  );
  const mat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: "#ffe9f4",
        transparent: true,
        opacity: 0.3,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useFrame(({ clock }, dt) => {
    if (ball.current) ball.current.rotation.y += dt * 0.6;
    const m = specks.current;
    if (!m) return;
    const on = show.level > 0.4;
    m.visible = on;
    if (!on) return;
    const t = clock.elapsedTime * 0.6;
    spots.forEach((s, i) => {
      dummy.position.set(
        Math.cos(s.a + t) * s.r * 0.75,
        0.02,
        -1.2 + Math.sin(s.a + t) * s.r * 0.55,
      );
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(0.025 + (i % 3) * 0.012);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    mat.opacity = 0.15 + show.level * 0.3;
  });
  return (
    <group>
      <mesh position={[0, 5.2, -1.2]} material={PBR.chrome()}>
        <cylinderGeometry args={[0.006, 0.006, 0.6, 6]} />
      </mesh>
      <mesh
        ref={ball}
        position={[0, 4.75, -1.2]}
        material={PBR.chrome()}
        castShadow
      >
        <icosahedronGeometry args={[0.32, 2]} />
      </mesh>
      <instancedMesh
        ref={specks}
        args={[undefined, mat, N]}
        frustumCulled={false}
      >
        <circleGeometry args={[1, 10]} />
      </instancedMesh>
    </group>
  );
}

// ── The floor and the crowd ──────────────────────────────────────────────────────────────────

function LedFloor() {
  const tiles = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const mat = useMemo(
    () => new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    [],
  );
  const n = FLOOR.cols * FLOOR.rows;
  useEffect(() => {
    const m = tiles.current;
    if (!m) return;
    for (let i = 0; i < n; i++) {
      dummy.position.set(
        FLOOR.x0 + (i % FLOOR.cols) * FLOOR.tile + FLOOR.tile / 2,
        0.012,
        FLOOR.z0 + Math.floor(i / FLOOR.cols) * FLOOR.tile + FLOOR.tile / 2,
      );
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, col.set("#000"));
    }
    m.instanceMatrix.needsUpdate = true;
  }, [dummy, n]);
  useFrame(({ clock }) => {
    const m = tiles.current;
    if (!m?.instanceColor) return;
    const t = clock.elapsedTime;
    const beat = Math.floor(show.beat);
    const lvl = show.level;
    for (let i = 0; i < n; i++) {
      const cx = i % FLOOR.cols;
      const cy = Math.floor(i / FLOOR.cols);
      let v: number;
      if (show.act === "dj") {
        // Ripples out from the booth on every beat.
        const d = Math.hypot(cx - FLOOR.cols / 2, cy + 2);
        v = Math.max(0, Math.cos(d * 0.9 - show.beat * Math.PI * 2)) ** 3;
      } else if (show.act === "concert") {
        v = (cx + cy + beat) % 3 === 0 ? 1 : 0.15;
      } else {
        v = 0.5 + 0.5 * Math.sin(t * 0.6 + cx * 0.5 + cy * 0.3);
      }
      paletteColor(cx + cy + Math.floor(beat / 2), col).multiplyScalar(
        (0.05 + v * (0.15 + lvl * 1.5)) * (0.7 + show.kick * 0.3 * lvl),
      );
      m.setColorAt(i, col);
    }
    m.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={tiles} args={[undefined, mat, n]}>
        <planeGeometry args={[FLOOR.tile - 0.04, FLOOR.tile - 0.04]} />
      </instancedMesh>
      <mesh
        position={[
          FLOOR.x0 + (FLOOR.cols * FLOOR.tile) / 2,
          0.008,
          FLOOR.z0 + (FLOOR.rows * FLOOR.tile) / 2,
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={PBR.blackMetal()}
      >
        <planeGeometry
          args={[FLOOR.cols * FLOOR.tile + 0.1, FLOOR.rows * FLOOR.tile + 0.1]}
        />
      </mesh>
    </group>
  );
}

const HOLO_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uBeat;
  varying float vY;
  varying float vSeed;
  void main() {
    vSeed = aSeed.w;
    vec3 p = position;
    // Bounce on the beat, each dancer slightly off.
    float b = abs(sin((uBeat + aSeed.w) * 3.14159));
    p.y += b * 0.08;
    p.x += sin(uTime * 2.0 + aSeed.w * 20.0) * 0.05 * p.y;
    vec4 world = instanceMatrix * vec4(p, 1.0);
    vY = p.y;
    gl_Position = projectionMatrix * modelViewMatrix * world;
  }
`;
const HOLO_FS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vY;
  varying float vSeed;
  void main() {
    float scan = 0.65 + 0.35 * sin(vY * 60.0 - uTime * 6.0);
    float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + vSeed * 50.0);
    float a = uOpacity * scan * flicker;
    gl_FragColor = vec4(uColor, a);
  }
`;

/**
 * Echoes on the dance floor: translucent, scan-lined dancers that fade in when a set starts. The Lattice
 * remembers everyone who ever danced here, and lets them come back for the good songs.
 */
function HoloCrowd() {
  const N = 16;
  const bodies = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color("#7fd4ff") },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uBeat: { value: 0 },
        },
        vertexShader: HOLO_VS,
        fragmentShader: HOLO_FS,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const seedAttr = useMemo(() => {
    const a = new Float32Array(N * 4);
    for (let i = 0; i < a.length; i++) a[i] = ((i * 7919) % 101) / 101;
    return a;
  }, []);
  useEffect(() => {
    const dummy = new Object3D();
    let s = 3;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      // Spread over the floor, leaving the dance stations clear-ish.
      const x = FLOOR.x0 + 0.3 + r() * (FLOOR.cols * FLOOR.tile - 0.6);
      const z = FLOOR.z0 + 0.6 + r() * (FLOOR.rows * FLOOR.tile - 0.6);
      const h = 0.85 + r() * 0.3;
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, Math.PI + (r() - 0.5) * 0.8, 0);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      bodies.current?.setMatrixAt(i, dummy.matrix);
      heads.current?.setMatrixAt(i, dummy.matrix);
    }
    if (bodies.current) bodies.current.instanceMatrix.needsUpdate = true;
    if (heads.current) heads.current.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame(({ clock }) => {
    mat.uniforms.uTime!.value = clock.elapsedTime;
    mat.uniforms.uBeat!.value = show.beat;
    const target = show.act && show.level > 0.6 ? 0.22 : 0;
    const o = mat.uniforms.uOpacity!;
    o.value += (target - (o.value as number)) * 0.03;
    paletteColor(
      Math.floor(show.beat / 8) + 2,
      mat.uniforms.uColor!.value as Color,
    );
    const vis = (o.value as number) > 0.005;
    if (bodies.current) bodies.current.visible = vis;
    if (heads.current) heads.current.visible = vis;
  });
  return (
    <group>
      <instancedMesh
        ref={bodies}
        args={[undefined, mat, N]}
        frustumCulled={false}
      >
        <capsuleGeometry args={[0.17, 0.75, 4, 10]}>
          <instancedBufferAttribute
            attach="attributes-aSeed"
            args={[seedAttr, 4]}
          />
        </capsuleGeometry>
      </instancedMesh>
      <instancedMesh
        ref={heads}
        args={[undefined, mat, N]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.13, 12, 10]}>
          <instancedBufferAttribute
            attach="attributes-aSeed"
            args={[seedAttr, 4]}
          />
        </sphereGeometry>
      </instancedMesh>
    </group>
  );
}

/** Two real lights over the floor that take the show's colours, so the agents are lit by it too. */
function FloorLights() {
  const a = useRef<PointLight>(null);
  const b = useRef<PointLight>(null);
  useFrame(() => {
    const lvl = show.level;
    if (a.current) {
      paletteColor(Math.floor(show.beat / 2), a.current.color);
      a.current.intensity = 2 + lvl * (14 + show.kick * 10 + deck.drop * 12);
    }
    if (b.current) {
      paletteColor(Math.floor(show.beat / 2) + 2, b.current.color);
      b.current.intensity = 2 + lvl * (12 + show.kick * 8 + deck.drop * 12);
    }
  });
  return (
    <>
      <pointLight ref={a} position={[-2, 3.2, -1.4]} distance={9} decay={1.8} />
      <pointLight ref={b} position={[2.2, 3.2, -1]} distance={9} decay={1.8} />
    </>
  );
}

export function Club() {
  useShowDriver();
  const decks = getStation("breakroom", "decks");
  const drums = getStation("breakroom", "stage-l");
  const keys = getStation("breakroom", "stage-r");
  const mic = getStation("breakroom", "mic");
  return (
    <group>
      <Skyline />
      <Stage />
      <group position={[decks.x, 0, 0]}>
        <DjBooth />
      </group>
      <DrumKit x={drums.x} z={drums.z} />
      <Keys x={keys.x} z={keys.z} />
      <MicStand x={mic.x} z={mic.z} />
      <SpeakerStack x={-4.45} />
      <SpeakerStack x={4.45} />
      <Truss />
      {[-3.2, -1.9, -0.65, 0.65, 1.9, 3.2].map((x, i) => (
        <MovingHead key={x} x={x} z={FRONT_Z} i={i} aim="floor" />
      ))}
      {[-2.6, 2.6].map((x, i) => (
        <MovingHead key={x} x={x} z={-6.1} i={i + 6} aim="crowd" />
      ))}
      {/* Lasers from the back corners of the truss, fanning out over the crowd. */}
      {[-1, 1].map((s) => (
        <group
          key={s}
          position={[s * 3.8, TRUSS_Y - 0.3, -6.0]}
          rotation={[0, Math.PI - s * 0.42, 0]}
        >
          <group rotation={[-0.36, 0, 0]}>
            <LaserFan
              beams={9}
              length={9}
              spread={0.55}
              sweep={0.25}
              speed={s > 0 ? 0.6 : 0.75}
              color={s > 0 ? "#3dff8a" : "#ff3dce"}
              intensity={3}
              on={() =>
                show.act === "dj" && show.level > 0.6
                  ? Math.min(1, (show.level - 0.6) * 3) *
                    (0.7 + show.kick * 0.3 + deck.drop * 0.3)
                  : 0
              }
            />
          </group>
        </group>
      ))}
      <MirrorBall />
      <LedFloor />
      <HoloCrowd />
      <FloorLights />
      {/* Stage haze: always a little, thick during a set. It takes the colour of the lights. */}
      <Haze
        min={[-5.5, 0.3, -6.2]}
        size={[11, 4.2, 7]}
        count={46}
        puff={2.6}
        additive
        color="#7a5cff"
        opacity={0.05}
        live={(_, c) => {
          paletteColor(Math.floor(show.beat / 4), c);
          return 0.012 + show.level * 0.055;
        }}
      />
    </group>
  );
}
