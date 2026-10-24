import { POST_HEIGHT, getStation, type RoomId } from "@ceo/core";
import { submindOf } from "@ceo/simulator";
import { Text } from "../fx/Text.tsx";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, CanvasTexture, DoubleSide, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { glowMap } from "./HoverGlow.tsx";
import { podiumSway } from "./podiumFloat.ts";
import { FONTS } from "./primitives.tsx";

/**
 * The floating platform, measured down from the seat: a hex slab (wide at the top, a face to the front) over a
 * tapering keel that ends in the drive's glowing tip. Radii are the hexagon's corner radii.
 */
const SLAB_TOP = -0.1;
const SLAB_BOT = -0.44;
const R_TOP = 0.44;
const R_BOT = 0.3;
const KEEL_TIP = -0.78;
/** The slab's glowing grooves, at these heights. */
const GROOVES = [-0.17, -0.37] as const;
/** How far the thruster wash reaches down from the keel (it fades out long before the floor). */
const WASH = 1.15;

/** Radius of the tapered hex slab at height y (from the seat). */
const radiusAt = (y: number) => R_BOT + ((R_TOP - R_BOT) * (y - SLAB_BOT)) / (SLAB_TOP - SLAB_BOT);
/** Distance from the centre to the middle of a hex face, for a hex of corner radius r. */
const apothem = (r: number) => r * Math.cos(Math.PI / 6);

/** A vertical fade for the thruster wash: bright at the top (v = 1), gone at the bottom. Shared by every podium. */
let washTex: CanvasTexture | null = null;
function washMap() {
  if (washTex) return washTex;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  return (washTex = new CanvasTexture(c));
}

/** The little holo-display over the platform: the submind's title and where it is, in its colour. */
function holoTexture(colour: string, title: string, status: string, sub: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.strokeStyle = colour;
  g.fillStyle = colour;
  g.globalAlpha = 0.9;
  g.lineWidth = 3;
  g.strokeRect(6, 6, 244, 148);
  g.font = "bold 22px monospace";
  g.textAlign = "center";
  g.fillText(title.toUpperCase(), 128, 40);
  g.globalAlpha = 0.55;
  g.fillRect(24, 52, 208, 2);
  g.globalAlpha = 1;
  g.font = "bold 26px monospace";
  g.fillText(status, 128, 92);
  g.globalAlpha = 0.75;
  g.font = "15px monospace";
  g.fillText(sub, 128, 124);
  // Scanlines, so it reads as projected light.
  g.globalAlpha = 0.18;
  g.fillStyle = "#000";
  for (let y = 0; y < 160; y += 4) g.fillRect(0, y, 256, 1);
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/**
 * The holo-display: flickers a little, says whether the admiral is on deck or out giving orders, and whether it is
 * active with its own thread or still simulated (`active` on SUBMINDS, docs/SKIPPY.md).
 */
function Holo({ colour, title, active, out, phase }: { colour: string; title: string; active: boolean; out: boolean; phase: number }) {
  const ref = useRef<Mesh>(null);
  const [home, away] = useMemo(
    () => [holoTexture(colour, title, "ON DECK", active ? "active · own thread" : "simulated for now"), holoTexture(colour, title, "GIVING ORDERS", "back in a moment")],
    [colour, title, active],
  );
  useEffect(
    () => () => {
      home.dispose();
      away.dispose();
    },
    [home, away],
  );
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime + phase;
    const flicker = Math.sin(t * 23) > 0.96 ? 0.45 : 1;
    (m.material as MeshBasicMaterial).opacity = (0.62 + Math.sin(t * 1.7) * 0.08) * flicker;
    m.position.y = 0.36 + Math.sin(t * 1.3) * 0.012;
  });
  return (
    <mesh ref={ref} position={[0, 0.36, 0]}>
      <planeGeometry args={[0.4, 0.25]} />
      <meshBasicMaterial map={out ? away : home} color={colour} transparent opacity={0.65} depthWrite={false} side={DoubleSide} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/**
 * The command podium: where the room's Skippy submind sits when it isn't out giving an order (docs/SKIPPY.md),
 * floating high in the room's back-right corner, over everyone's heads. A hexagonal relic of the First Lattice, dug
 * out of the foundations and found to hover, with glowing grooves in the submind's colour and a drive under its keel
 * that breathes a soft wash of light down at the corner. On top, a can-sized throne in velvet and brass with a
 * coaster for a seat, a holo-display that says whether the admiral is on deck, and a plaque, because somebody had
 * to. It bobs and drifts a little (podiumFloat.ts; the submind rides along). Turned to face the room; local -z is its
 * front. It touches nothing, so the corner under it is free to walk through.
 */
export function Podium({ room }: { room: RoomId }) {
  const st = getStation(room, "post");
  const m = submindOf(room);
  const out = useWorld((s) => {
    const p = s.lattice.agents[m.id]?.place;
    return !!p && (p.room !== room || p.station !== "post");
  });
  const glow = PBR.light(m.colour, 2.2);
  const raft = useRef<Group>(null);
  const wash = useRef<Mesh>(null);
  const pool = useRef<Mesh>(null);
  const phase = st.x + st.z;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = podiumSway(room, t);
    const g = raft.current;
    if (g) {
      // The sway is in room axes; the podium's group is turned to face the room, so turn it back.
      const c = Math.cos(st.facing);
      const n = Math.sin(st.facing);
      g.position.set(s.x * c - s.z * n, POST_HEIGHT + s.y, s.x * n + s.z * c);
      g.rotation.set(s.pitch, 0, s.roll);
    }
    // The drive breathes; the light it throws on the floor swells and fades with it (and with the height).
    const breath = 0.5 + Math.sin(t * 2.1 + phase) * 0.12 + Math.sin(t * 7.3 + phase) * 0.04;
    if (wash.current) (wash.current.material as MeshBasicMaterial).opacity = breath * 0.55;
    if (pool.current) {
      (pool.current.material as MeshBasicMaterial).opacity = (breath - s.y * 2) * 0.55;
      pool.current.scale.setScalar(1 + s.y * 0.8);
    }
  });

  return (
    <group position={[st.x, 0, st.z]} rotation={[0, st.facing, 0]}>
      {/* The light it throws on the floor of the corner, so you can see where it hangs. */}
      <mesh ref={pool} position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.2, 2.2]} />
        <meshBasicMaterial color={m.colour} map={glowMap()} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* Everything that floats, at the seat's height: bobbing, drifting and rocking a little. */}
      <group ref={raft} position={[0, POST_HEIGHT, 0]}>
        {/* The slab: a brass rim, a tapered hex body (a face to the front), glowing grooves. */}
        <mesh position={[0, -0.06, 0]} rotation={[0, Math.PI / 6, 0]} material={PBR.brass()} castShadow receiveShadow>
          <cylinderGeometry args={[R_TOP + 0.03, R_TOP + 0.01, 0.08, 6]} />
        </mesh>
        <mesh position={[0, (SLAB_TOP + SLAB_BOT) / 2, 0]} rotation={[0, Math.PI / 6, 0]} material={PBR.steel()} castShadow receiveShadow>
          <cylinderGeometry args={[R_TOP, R_BOT, SLAB_TOP - SLAB_BOT, 6]} />
        </mesh>
        {GROOVES.map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[0, Math.PI / 6, 0]} material={glow}>
            <cylinderGeometry args={[radiusAt(y + 0.012) + 0.008, radiusAt(y - 0.012) + 0.008, 0.024, 6, 1, true]} />
          </mesh>
        ))}
        {/* Glyph slits on the faces either side of the front. */}
        {[Math.PI * (2 / 3), Math.PI * (4 / 3), Math.PI / 3, -Math.PI / 3].map((a) => (
          <group key={a} rotation={[0, a, 0]}>
            {[-0.07, 0, 0.07].map((dx, i) => (
              <mesh key={dx} position={[dx, -0.27, apothem(radiusAt(-0.27)) + 0.006]} material={glow}>
                <boxGeometry args={[0.018, i === 1 ? 0.12 : 0.07, 0.006]} />
              </mesh>
            ))}
          </group>
        ))}
        {/* The keel: a dark hex cone under the slab, ringed where the drive sits, with a glowing tip. */}
        <mesh position={[0, (SLAB_BOT + KEEL_TIP) / 2, 0]} rotation={[0, Math.PI / 6, 0]} material={PBR.blackMetal()} castShadow>
          <cylinderGeometry args={[R_BOT, 0.06, SLAB_BOT - KEEL_TIP, 6]} />
        </mesh>
        <mesh position={[0, SLAB_BOT - 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} material={glow}>
          <torusGeometry args={[R_BOT * 0.82, 0.014, 6, 36]} />
        </mesh>
        <mesh position={[0, KEEL_TIP, 0]} material={glow}>
          <sphereGeometry args={[0.06, 16, 10]} />
        </mesh>
        {/* The drive's wash: a soft cone of light in the submind's colour, falling away under the keel. */}
        <mesh ref={wash} position={[0, KEEL_TIP - WASH / 2 + 0.05, 0]}>
          <cylinderGeometry args={[0.08, 0.55, WASH, 24, 1, true]} />
          <meshBasicMaterial color={m.colour} map={washMap()} transparent opacity={0.3} depthWrite={false} side={DoubleSide} blending={AdditiveBlending} toneMapped={false} />
        </mesh>

        {/* The coaster: the admiral's seat, cork with a ring of light in its colour. */}
        <mesh position={[0, -0.01, 0]} material={PBR.matte("#a8794c", 0.9)} receiveShadow>
          <cylinderGeometry args={[0.27, 0.27, 0.025, 32]} />
        </mesh>
        <mesh position={[0, 0.004, 0]} rotation={[Math.PI / 2, 0, 0]} material={glow}>
          <torusGeometry args={[0.27, 0.01, 6, 40]} />
        </mesh>

        {/* The throne's back, behind the coaster: brass frame, velvet in the submind's colour, an admiral's star on top. */}
        <group position={[0, 0, 0.27]}>
          <mesh position={[0, 0.3, 0]} material={PBR.brass()} castShadow>
            <boxGeometry args={[0.5, 0.6, 0.05]} />
          </mesh>
          <mesh position={[0, 0.6, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.brass()} castShadow>
            <cylinderGeometry args={[0.25, 0.25, 0.05, 24, 1, false, -Math.PI / 2, Math.PI]} />
          </mesh>
          <mesh position={[0, 0.32, -0.028]} material={PBR.fabric(m.colour)}>
            <boxGeometry args={[0.4, 0.5, 0.012]} />
          </mesh>
          <mesh position={[0, 0.6, -0.028]} rotation={[Math.PI / 2, 0, 0]} material={PBR.fabric(m.colour)}>
            <cylinderGeometry args={[0.2, 0.2, 0.012, 24, 1, false, -Math.PI / 2, Math.PI]} />
          </mesh>
          <mesh position={[0, 0.9, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.brass()} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 0.03, 5]} />
          </mesh>
          <mesh position={[0, 0.9, -0.018]} rotation={[Math.PI / 2, 0, 0]} material={glow}>
            <cylinderGeometry args={[0.045, 0.045, 0.01, 5]} />
          </mesh>
        </group>
        {/* Armrests: two brass posts with knobs, either side of the coaster. */}
        {[-0.3, 0.3].map((x) => (
          <group key={x} position={[x, 0, 0.05]}>
            <mesh position={[0, 0.11, 0]} material={PBR.brass()} castShadow>
              <cylinderGeometry args={[0.018, 0.024, 0.22, 8]} />
            </mesh>
            <mesh position={[0, 0.23, 0]} material={PBR.brass()}>
              <sphereGeometry args={[0.035, 12, 8]} />
            </mesh>
          </group>
        ))}

        {/* The holo-display on a little projector at the front-right corner, angled to the room. */}
        <group position={[0.33, -0.02, -0.2]} rotation={[0, Math.PI - 0.55, 0]}>
          <mesh position={[0, 0.03, 0]} material={PBR.blackMetal()} castShadow>
            <cylinderGeometry args={[0.04, 0.05, 0.06, 12]} />
          </mesh>
          <mesh position={[0, 0.065, 0]} material={glow}>
            <cylinderGeometry args={[0.025, 0.025, 0.01, 12]} />
          </mesh>
          <Holo colour={m.colour} title={m.name} active={m.active} out={out} phase={phase} />
        </group>

        {/* The plaque on the slab's front face, tipped down to whoever reads it from the floor. */}
        <group rotation={[0, Math.PI, 0]}>
          <group position={[0, -0.27, apothem(radiusAt(-0.27)) + 0.012]} rotation={[Math.atan2(R_TOP - R_BOT, SLAB_TOP - SLAB_BOT), 0, 0]}>
            <mesh material={PBR.brass()}>
              <boxGeometry args={[0.36, 0.16, 0.012]} />
            </mesh>
            <Text font={FONTS.mono} fontSize={0.022} maxWidth={0.33} textAlign="center" anchorX="center" anchorY="middle" position={[0, 0, 0.008]} color="#2a2114" lineHeight={1.25}>
              {"ADMIRAL'S SEAT\nNO MONKEYS ON THE COASTER\nMIND THE DROP"}
            </Text>
          </group>
        </group>
      </group>
    </group>
  );
}
