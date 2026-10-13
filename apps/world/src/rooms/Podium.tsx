import { POST_HEIGHT, getStation, type RoomId } from "@ceo/core";
import { submindOf } from "@ceo/simulator";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, CanvasTexture, DoubleSide, type Mesh, type MeshBasicMaterial } from "three";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { FONTS } from "./primitives.tsx";

/** The relic's foot and its top, as hexagon radii (the plinth tapers between them). */
const FOOT = 0.48;
const TOP = 0.38;
const BODY_H = 0.62;
/** The plinth's glowing grooves, at these heights. */
const GROOVES = [0.2, 0.5] as const;

/** Radius of the tapered hex body at height y (from the floor). */
const radiusAt = (y: number) => FOOT - ((FOOT - TOP) * (y - 0.06)) / BODY_H;
/** Distance from the centre to the middle of a hex face, for a hex of corner radius r. */
const apothem = (r: number) => r * Math.cos(Math.PI / 6);

/** The little holo-display over the dais: the submind's title and where it is, in its colour. */
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

/** The holo-display: flickers a little, and says whether the admiral is on deck or out giving orders. */
function Holo({ colour, title, out, phase }: { colour: string; title: string; out: boolean; phase: number }) {
  const ref = useRef<Mesh>(null);
  const [home, away] = useMemo(
    () => [holoTexture(colour, title, "ON DECK", "the room is watched"), holoTexture(colour, title, "GIVING ORDERS", "back in a moment")],
    [colour, title],
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
 * The command podium: where the room's Skippy submind sits when it isn't out giving an order (docs/SKIPPY.md), in
 * the room's back-right corner. A squat hexagonal relic of the First Lattice, dug out of the foundations, with
 * glowing grooves in the submind's colour; on top, a can-sized throne in velvet and brass with a coaster for a seat,
 * a holo-display that says whether the admiral is on deck, and a plaque, because somebody had to. Turned to face
 * the room; local -z is its front. Its footprint is in core/obstacles.ts, so nobody walks through it.
 */
export function Podium({ room }: { room: RoomId }) {
  const st = getStation(room, "post");
  const m = submindOf(room);
  const out = useWorld((s) => {
    const p = s.lattice.agents[m.id]?.place;
    return !!p && (p.room !== room || p.station !== "post");
  });
  const glow = PBR.light(m.colour, 2.2);
  const seat = POST_HEIGHT;
  return (
    <group position={[st.x, 0, st.z]} rotation={[0, st.facing, 0]}>
      {/* The relic: a hex foot, a tapered hex body (a face to the front) and a brass cap. */}
      <mesh position={[0, 0.03, 0]} rotation={[0, Math.PI / 6, 0]} material={PBR.blackMetal()} castShadow receiveShadow>
        <cylinderGeometry args={[FOOT + 0.04, FOOT + 0.05, 0.06, 6]} />
      </mesh>
      <mesh position={[0, 0.06 + BODY_H / 2, 0]} rotation={[0, Math.PI / 6, 0]} material={PBR.steel()} castShadow receiveShadow>
        <cylinderGeometry args={[TOP, FOOT, BODY_H, 6]} />
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
            <mesh key={dx} position={[dx, 0.35, apothem(radiusAt(0.35)) + 0.006]} material={glow}>
              <boxGeometry args={[0.018, i === 1 ? 0.16 : 0.09, 0.006]} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, seat - 0.06, 0]} rotation={[0, Math.PI / 6, 0]} material={PBR.brass()} castShadow receiveShadow>
        <cylinderGeometry args={[TOP + 0.03, TOP, 0.08, 6]} />
      </mesh>
      {/* The coaster: the admiral's seat, cork with a ring of light in its colour. */}
      <mesh position={[0, seat - 0.01, 0]} material={PBR.matte("#a8794c", 0.9)} receiveShadow>
        <cylinderGeometry args={[0.27, 0.27, 0.025, 32]} />
      </mesh>
      <mesh position={[0, seat + 0.004, 0]} rotation={[Math.PI / 2, 0, 0]} material={glow}>
        <torusGeometry args={[0.27, 0.01, 6, 40]} />
      </mesh>

      {/* The throne's back, behind the coaster: brass frame, velvet in the submind's colour, an admiral's star on top. */}
      <group position={[0, seat, 0.27]}>
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
        <group key={x} position={[x, seat, 0.05]}>
          <mesh position={[0, 0.11, 0]} material={PBR.brass()} castShadow>
            <cylinderGeometry args={[0.018, 0.024, 0.22, 8]} />
          </mesh>
          <mesh position={[0, 0.23, 0]} material={PBR.brass()}>
            <sphereGeometry args={[0.035, 12, 8]} />
          </mesh>
        </group>
      ))}

      {/* The holo-display on a little projector at the front-right corner, angled to the room. */}
      <group position={[0.33, seat - 0.02, -0.2]} rotation={[0, Math.PI - 0.55, 0]}>
        <mesh position={[0, 0.03, 0]} material={PBR.blackMetal()} castShadow>
          <cylinderGeometry args={[0.04, 0.05, 0.06, 12]} />
        </mesh>
        <mesh position={[0, 0.065, 0]} material={glow}>
          <cylinderGeometry args={[0.025, 0.025, 0.01, 12]} />
        </mesh>
        <Holo colour={m.colour} title={m.name} out={out} phase={st.x + st.z} />
      </group>

      {/* The plaque on the front face. */}
      <group rotation={[0, Math.PI, 0]}>
        <group position={[0, 0.34, apothem(radiusAt(0.34)) + 0.012]} rotation={[-Math.atan2(FOOT - TOP, BODY_H), 0, 0]}>
          <mesh material={PBR.brass()}>
            <boxGeometry args={[0.34, 0.15, 0.012]} />
          </mesh>
          <Text font={FONTS.mono} fontSize={0.024} maxWidth={0.31} textAlign="center" anchorX="center" anchorY="middle" position={[0, 0, 0.008]} color="#2a2114" lineHeight={1.25}>
            {"ADMIRAL'S SEAT\nNO MONKEYS ON THE COASTER"}
          </Text>
        </group>
      </group>
    </group>
  );
}
