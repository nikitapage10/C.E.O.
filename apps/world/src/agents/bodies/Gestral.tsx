import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CanvasTexture, LatheGeometry, MeshPhysicalMaterial, SRGBColorSpace, Vector2, Vector3, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { SEGMENT, smooth, span } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

/** Brush strokes over a base coat, like something painted by hand and left to dry in the sun. */
const paintCache = new Map<string, CanvasTexture>();
function paint(base: string, a: string, b: string) {
  const key = `${base}|${a}|${b}`;
  let tex = paintCache.get(key);
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    g.strokeStyle = i % 3 === 0 ? b : a;
    g.globalAlpha = 0.55 + rnd() * 0.4;
    g.lineWidth = 6 + rnd() * 22;
    g.lineCap = "round";
    g.beginPath();
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    g.moveTo(x, y);
    g.bezierCurveTo(x + rnd() * 120 - 60, y + rnd() * 60 - 30, x + rnd() * 160 - 80, y + rnd() * 80 - 40, x + rnd() * 200 - 100, y + rnd() * 40 - 20);
    g.stroke();
  }
  // Dry-brush speckle.
  g.globalAlpha = 0.25;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() > 0.5 ? "#ffffff" : "#000000";
    g.fillRect(rnd() * c.width, rnd() * c.height, 2, 2);
  }
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  paintCache.set(key, tex);
  return tex;
}

/** The head: a tall rounded cone, like a brush-tip or a gourd. */
const HEAD = new LatheGeometry(
  [
    [0, -0.02], [0.14, 0.0], [0.22, 0.07], [0.25, 0.18], [0.23, 0.3], [0.18, 0.42], [0.11, 0.53], [0.05, 0.62], [0.0, 0.66],
  ].map(([x, y]) => new Vector2(x, y)),
  40,
);
HEAD.computeVertexNormals();
const BODY = new LatheGeometry(
  [
    [0, 0], [0.15, 0.02], [0.2, 0.12], [0.2, 0.26], [0.16, 0.38], [0.08, 0.44], [0, 0.45],
  ].map(([x, y]) => new Vector2(x, y)),
  32,
);
BODY.computeVertexNormals();

const sh = [new Vector3(), new Vector3()];
const hd = [new Vector3(), new Vector3()];
const hp = [new Vector3(), new Vector3()];
const ft = [new Vector3(), new Vector3()];

/**
 * The Painted Little Gremlin: knee-high (well, hip-high), hand-painted, with a tall head and a long nose,
 * and an unshakeable belief that every disagreement is best settled by a friendly duel.
 */
export function Gestral({ look, drive, phase }: BodyProps) {
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const arms = useRef<(Mesh | null)[]>([]);
  const fists = useRef<(Mesh | null)[]>([]);
  const legs = useRef<(Mesh | null)[]>([]);
  const lie = useRef(0);
  const painted = useMemo(
    () => new MeshPhysicalMaterial({ map: paint(look.shell, look.accent, look.trim), roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    [look.shell, look.accent, look.trim],
  );
  const limb = useMemo(() => new MeshPhysicalMaterial({ color: look.trim, roughness: 0.6 }), [look.trim]);
  const ink = PBR.lacquer("#141414", 0.25);

  useFrame(() => {
    const d = drive.current;
    if (!d || !body.current || !head.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    const s = t * 10 + phase;
    lie.current = smooth(lie.current, mode === "napping" ? 1 : 0, 0.08);
    const hop = walking ? Math.abs(Math.sin(s)) * 0.08 : mode === "celebrating" ? Math.abs(Math.sin(t * 7)) * 0.3 : 0;
    body.current.position.y = 0.36 + hop - lie.current * 0.2;
    body.current.rotation.x = -lie.current * 1.4 + (mode === "slumped" ? 0.35 : walking ? 0.12 : 0);
    head.current.rotation.z = Math.sin(t * 1.2 + phase) * 0.1;
    head.current.rotation.x = d.speaking ? Math.sin(t * 10) * 0.06 : mode === "slumped" ? 0.4 : 0;

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      sh[i]!.set(side * 0.17, 0.32, 0.02);
      const swing = Math.sin(s + i * Math.PI);
      if (mode === "celebrating") hd[i]!.set(side * 0.25, 0.75, 0.05);
      else if (mode === "working" || mode === "typing" || mode === "waiting") {
        // Guard up, jabbing. Every task is a duel.
        const jab = Math.max(0, Math.sin(t * (mode === "waiting" ? 3 : 8) + i * Math.PI + phase));
        hd[i]!.set(side * 0.1, 0.38, 0.18 + jab * 0.18);
      } else if (walking) hd[i]!.set(side * 0.24, 0.05, swing * 0.12);
      else hd[i]!.set(side * 0.24, 0.02, 0.04);
      span(arms.current[i]!, sh[i]!, hd[i]!, 0.035);
      fists.current[i]?.position.copy(hd[i]!);
      hp[i]!.set(side * 0.09, 0.36 + hop - lie.current * 0.2, 0);
      ft[i]!.set(side * 0.1, walking ? Math.max(0, swing) * 0.08 : 0, walking ? swing * 0.12 : 0);
      span(legs.current[i]!, hp[i]!, ft[i]!, 0.04);
    }
  });

  return (
    <group>
      {[0, 1].map((i) => (
        <mesh key={i} ref={(m) => void (legs.current[i] = m)} geometry={SEGMENT} material={limb} castShadow />
      ))}
      <group ref={body} position={[0, 0.36, 0]}>
        <mesh geometry={BODY} material={painted} castShadow receiveShadow />
        <group ref={head} position={[0, 0.44, 0]}>
          <mesh geometry={HEAD} material={painted} castShadow />
          {/* The long nose. */}
          <mesh position={[0, 0.2, 0.26]} rotation={[Math.PI / 2 - 0.2, 0, 0]} material={painted} castShadow>
            <coneGeometry args={[0.045, 0.26, 16]} />
          </mesh>
          {[-1, 1].map((x) => (
            <mesh key={x} position={[x * 0.09, 0.27, 0.205]} material={ink}>
              <sphereGeometry args={[0.026, 14, 10]} />
            </mesh>
          ))}
          {/* A tuft of bristles on top, freshly dipped. */}
          <mesh position={[0, 0.7, 0]} material={PBR.light(look.accent, 0.6)}>
            <coneGeometry args={[0.035, 0.12, 10]} />
          </mesh>
        </group>
        {[0, 1].map((i) => (
          <group key={i}>
            <mesh ref={(m) => void (arms.current[i] = m)} geometry={SEGMENT} material={limb} castShadow />
            <mesh ref={(m) => void (fists.current[i] = m)} material={painted} castShadow>
              <sphereGeometry args={[0.05, 14, 10]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
