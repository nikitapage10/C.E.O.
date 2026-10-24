import { MeshReflectorMaterial } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, ShaderMaterial, type Group, type Points } from "three";
import { useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";

export const FLOOR_Y = -6;

/**
 * The floor's reflection draws the scene once more each frame, before the main pass. It reuses the matrices the
 * main pass worked out a frame earlier instead of recomputing every matrix in the scene for itself (#327): a blurred
 * reflection a frame behind looks the same, and the walk over thousands of objects goes once per frame, not twice.
 */
function useLeanReflection(on: boolean) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!on) return;
    const render = gl.render;
    gl.render = function (this: typeof gl, s, camera) {
      if (s !== scene || camera === get().camera) return render.call(this, s, camera);
      const auto = s.matrixWorldAutoUpdate;
      s.matrixWorldAutoUpdate = false;
      try {
        return render.call(this, s, camera);
      } finally {
        s.matrixWorldAutoUpdate = auto;
      }
    };
    return () => {
      gl.render = render;
    };
  }, [on, gl, scene, get]);
}

/** The black mirror the Lattice floats over. */
export function Floor() {
  const quality = useWorld((s) => s.quality);
  useLeanReflection(quality === "high");
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
      <planeGeometry args={[420, 420]} />
      {quality === "high" ? (
        <MeshReflectorMaterial
          // The reflection is blurred to a soft glow anyway, so a 256 map looks the same as 512 at a quarter of the fill.
          resolution={256}
          mirror={0.6}
          blur={[400, 120]}
          mixBlur={1.2}
          mixStrength={2.2}
          depthScale={0.6}
          minDepthThreshold={0.4}
          color={PALETTE.void}
          metalness={0.6}
          roughness={0.9}
        />
      ) : (
        <meshStandardMaterial color={PALETTE.void} metalness={0.5} roughness={0.6} />
      )}
    </mesh>
  );
}

function ringLine(radius: number, ticks: number, tickLen: number, opacity: number) {
  const pts: number[] = [];
  const seg = 256;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    pts.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius, Math.cos(a1) * radius, 0, Math.sin(a1) * radius);
  }
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(a) * (radius + tickLen), 0, Math.sin(a) * (radius + tickLen));
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pts, 3));
  const m = new LineBasicMaterial({ transparent: true, opacity, toneMapped: false, depthWrite: false });
  m.color.set(PALETTE.ice).multiplyScalar(1.2);
  return new LineSegments(g, m);
}

/** Hairline instrument rings on the mirror floor, like a map projection of the Lattice. */
export function FloorRings() {
  const rings = useMemo(
    () => [ringLine(46, 72, 0.8, 0.22), ringLine(62, 36, 1.6, 0.14), ringLine(90, 12, 4, 0.08), ringLine(14, 7, 1.2, 0.3)],
    [],
  );
  const group = useRef<Group>(null);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.004;
  });
  return (
    <group ref={group} position={[0, FLOOR_Y + 0.02, 0]}>
      {rings.map((r, i) => (
        <primitive key={i} object={r} />
      ))}
    </group>
  );
}

/** Data motes: slow particles rising through the Lattice. */
export function Motes({ count = 1400 }: { count?: number }) {
  const ref = useRef<Points>(null);
  const { geometry, material } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 6 + Math.sqrt(Math.random()) * 70;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 40 - 6;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geometry.setAttribute("aSeed", new Float32BufferAttribute(seed, 1));
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixel: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uPixel; varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod(p.y + 6.0 + uTime * (0.25 + aSeed * 0.6), 40.0) - 6.0;
          p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.0 + aSeed * 2.2) * uPixel * (30.0 / -mv.z);
          vA = (0.35 + 0.65 * aSeed) * smoothstep(-6.0, 0.0, p.y) * smoothstep(34.0, 24.0, p.y);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          gl_FragColor = vec4(vec3(0.75, 1.3, 1.6) * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return { geometry, material };
  }, [count]);
  useFrame(({ clock, viewport }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
    // Follow the canvas's pixel ratio (it drops while the frame rate is low), so motes keep their size on screen.
    material.uniforms.uPixel!.value = Math.min(viewport.dpr, 2);
  });
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}
