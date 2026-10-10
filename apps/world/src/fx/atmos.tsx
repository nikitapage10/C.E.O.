import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Group,
} from "three";
import { useWorld } from "../store.ts";

/**
 * Atmosphere: haze, smoke, sparks, dust, light beams and lasers. Every effect is one draw call: a batch of
 * camera-facing quads whose motion is worked out on the GPU from the time and a per-quad seed, so nothing is
 * updated per particle on the CPU. Low quality halves the counts.
 */

type V3 = [number, number, number];

function seeds(count: number, salt: number) {
  let s = salt * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const a = new Float32Array(count * 4);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  return a;
}

function quads(count: number, salt: number) {
  const base = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("uv", base.getAttribute("uv"));
  g.setAttribute("aSeed", new InstancedBufferAttribute(seeds(count, salt), 4));
  g.instanceCount = count;
  return g;
}

const useCount = (n: number) => {
  const low = useWorld((s) => s.quality === "low");
  return Math.max(1, Math.round(low ? n / 2 : n));
};

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
`;

/** Shared fragment shader: a soft, slightly lumpy puff (or a hard dot for sparks). */
const PUFF_FS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSoft;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  ${NOISE}
  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), mix(4.0, 1.4, uSoft));
    if (uSoft > 0.5) a *= 0.55 + 0.45 * noise(p * 3.5 + vSeed * 40.0);
    a *= uOpacity * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const BILLBOARD = /* glsl */ `
  vec4 billboard(vec3 center, float size, float spin) {
    vec4 mv = modelViewMatrix * vec4(center, 1.0);
    float c = cos(spin), s = sin(spin);
    vec2 q = mat2(c, -s, s, c) * position.xy;
    mv.xy += q * size;
    return mv;
  }
`;

function puffMaterial(vertex: string, opts: { color: string; opacity: number; additive?: boolean; soft?: boolean }, uniforms: Record<string, { value: unknown }>) {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(opts.color) },
      uOpacity: { value: opts.opacity },
      uSoft: { value: opts.soft === false ? 0 : 1 },
      ...uniforms,
    },
    vertexShader: vertex,
    fragmentShader: PUFF_FS,
    transparent: true,
    depthWrite: false,
    blending: opts.additive ? AdditiveBlending : NormalBlending,
    toneMapped: false,
  });
}

/** Ticks a material's time and lets a caller push colour/opacity each frame (for lights that pulse with music). */
function useTick(mat: ShaderMaterial, live?: (t: number, color: Color) => number | void) {
  useFrame(({ clock }) => {
    mat.uniforms.uTime!.value = clock.elapsedTime;
    if (live) {
      const o = live(clock.elapsedTime, mat.uniforms.uColor!.value as Color);
      if (typeof o === "number") mat.uniforms.uOpacity!.value = o;
    }
  });
}

const HAZE_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec3 uMin;
  uniform vec3 uSize;
  uniform float uPuff;
  uniform float uDrift;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  ${BILLBOARD}
  void main() {
    float w = aSeed.w * 6.2831;
    vec3 c = uMin + aSeed.xyz * uSize;
    c.x += sin(uTime * 0.07 * uDrift + w) * 0.6 * uDrift;
    c.z += cos(uTime * 0.05 * uDrift + w * 1.3) * 0.6 * uDrift;
    c.y += sin(uTime * 0.11 + w * 2.0) * 0.15;
    float size = uPuff * (0.6 + aSeed.w * 0.9);
    vec4 mv = billboard(c, size, w + uTime * 0.03 * (aSeed.x - 0.5));
    vUv = uv;
    vSeed = aSeed.w;
    // Fade puffs that come close to the camera, so the lens never fills with fog.
    vAlpha = smoothstep(0.6, 3.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * A slow-drifting layer of haze filling a box (room-local, `min` corner + `size`). Additive haze glows with
 * its colour, which is how stage fog catches the lights; normal haze is plain mist or smoke.
 */
export function Haze({
  min,
  size,
  count = 40,
  puff = 2.2,
  color = "#9aa4b8",
  opacity = 0.08,
  additive = false,
  drift = 1,
  live,
}: {
  min: V3;
  size: V3;
  count?: number;
  puff?: number;
  color?: string;
  opacity?: number;
  additive?: boolean;
  drift?: number;
  /** Called every frame with the time and the haze colour (set it to tint); return a number to set the opacity. */
  live?: (t: number, color: Color) => number | void;
}) {
  const n = useCount(count);
  const geo = useMemo(() => quads(n, Math.round(min[0] * 13 + min[2] * 7 + n)), [n, min]);
  const mat = useMemo(
    () => puffMaterial(HAZE_VS, { color, opacity, additive }, { uMin: { value: new Vector3(...min) }, uSize: { value: new Vector3(...size) }, uPuff: { value: puff }, uDrift: { value: drift } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useTick(mat, live);
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />;
}

const PLUME_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uRate;
  uniform float uHeight;
  uniform float uSpread;
  uniform vec2 uSizes;
  uniform vec3 uWind;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  ${BILLBOARD}
  void main() {
    float life = fract(uTime * uRate * (0.75 + aSeed.w * 0.5) + aSeed.x);
    vec3 c = vec3((aSeed.y - 0.5) * uSpread * (0.3 + life), life * uHeight, (aSeed.z - 0.5) * uSpread * (0.3 + life));
    c += uWind * life * life;
    c.x += sin(life * 6.0 + aSeed.w * 20.0) * 0.08 * life;
    float size = mix(uSizes.x, uSizes.y, life) * (0.8 + aSeed.w * 0.4);
    vec4 mv = billboard(c, size, aSeed.w * 6.28 + life * (aSeed.y - 0.5) * 2.0);
    vUv = uv;
    vSeed = aSeed.w;
    vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - life) * smoothstep(0.4, 2.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

/** A rising plume (chimney smoke, steam, a smoke machine). Sits at the group origin and rises along +Y. */
export function Smoke({
  position,
  count = 24,
  rate = 0.12,
  height = 3,
  spread = 0.8,
  sizes = [0.4, 1.6],
  wind = [0.3, 0, 0],
  color = "#8d8a86",
  opacity = 0.35,
  additive = false,
  live,
}: {
  position: V3;
  count?: number;
  /** Puffs born per second, per puff slot (life = 1 / rate seconds). */
  rate?: number;
  height?: number;
  spread?: number;
  sizes?: [number, number];
  wind?: V3;
  color?: string;
  opacity?: number;
  additive?: boolean;
  live?: (t: number, color: Color) => number | void;
}) {
  const n = useCount(count);
  const geo = useMemo(() => quads(n, Math.round(position[0] * 31 + position[2] * 17 + n)), [n, position]);
  const mat = useMemo(
    () =>
      puffMaterial(PLUME_VS, { color, opacity, additive }, {
        uRate: { value: rate },
        uHeight: { value: height },
        uSpread: { value: spread },
        uSizes: { value: { x: sizes[0], y: sizes[1] } },
        uWind: { value: new Vector3(...wind) },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useTick(mat, live);
  return <mesh position={position} geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />;
}

const SPARK_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uRate;
  uniform float uSpeed;
  uniform float uSize;
  uniform vec3 uDir;
  uniform float uCone;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  ${BILLBOARD}
  void main() {
    float life = fract(uTime * uRate + aSeed.x);
    float a = aSeed.y * 6.2831;
    vec3 side = normalize(abs(uDir.y) > 0.9 ? cross(uDir, vec3(1, 0, 0)) : cross(uDir, vec3(0, 1, 0)));
    vec3 up2 = cross(uDir, side);
    vec3 v = normalize(uDir + (side * cos(a) + up2 * sin(a)) * uCone * aSeed.z) * uSpeed * (0.6 + aSeed.w * 0.8);
    float t = life * 0.9;
    vec3 c = v * t + vec3(0.0, -4.9, 0.0) * t * t;
    vec4 mv = billboard(c, uSize * (1.0 - life * 0.6), 0.0);
    vUv = uv;
    vSeed = aSeed.w;
    // Bursts: only some sparks are alive at a time, so it crackles rather than streams.
    float burst = step(0.55, fract(sin(floor(uTime * uRate + aSeed.x) * 12.9898 + aSeed.w * 78.233) * 43758.5453));
    vAlpha = (1.0 - life) * burst;
    gl_Position = projectionMatrix * mv;
  }
`;

/** Hot sparks spraying from a point, crackling in bursts and falling under gravity. */
export function Sparks({
  position,
  dir = [0, 1, 0],
  count = 40,
  rate = 1.2,
  speed = 2.4,
  cone = 0.6,
  size = 0.035,
  color = "#ffb347",
  intensity = 4,
}: {
  position: V3;
  dir?: V3;
  count?: number;
  rate?: number;
  speed?: number;
  cone?: number;
  size?: number;
  color?: string;
  intensity?: number;
}) {
  const n = useCount(count);
  const geo = useMemo(() => quads(n, Math.round(position[0] * 53 + position[2] * 29 + n)), [n, position]);
  const mat = useMemo(() => {
    const m = puffMaterial(SPARK_VS, { color, opacity: 1, additive: true, soft: false }, {
      uRate: { value: rate },
      uSpeed: { value: speed },
      uSize: { value: size },
      uDir: { value: new Vector3(...dir).normalize() },
      uCone: { value: cone },
    });
    (m.uniforms.uColor!.value as Color).multiplyScalar(intensity);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useTick(mat);
  return <mesh position={position} geometry={geo} material={mat} frustumCulled={false} renderOrder={7} />;
}

/** Dust motes hanging in the light: tiny, slow, warm. */
export function Dust({ min, size, count = 60, color = "#ffe2b0", opacity = 0.5 }: { min: V3; size: V3; count?: number; color?: string; opacity?: number }) {
  return <Haze min={min} size={size} count={count} puff={0.035} color={color} opacity={opacity} additive drift={0.25} />;
}

const BEAM_VS = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    vY = -position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const BEAM_FS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uLength;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
    float along = 1.0 - clamp(vY / uLength, 0.0, 1.0);
    float a = edge * along * along * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`;

/**
 * A volumetric light shaft: a soft additive cone from the group origin down its -Y axis. Rotate the parent to
 * aim it. `live` can retint and dim it each frame.
 */
export function Beam({ length = 5, radius = 0.9, color = "#ffffff", opacity = 0.25, live }: { length?: number; radius?: number; color?: string; opacity?: number; live?: (t: number, color: Color) => number | void }) {
  const geo = useMemo(() => {
    const g = new ConeGeometry(radius, length, 28, 1, true);
    // A cone's tip points +Y: drop it so the tip sits at the origin and the mouth opens downward.
    g.translate(0, -length / 2, 0);
    return g;
  }, [length, radius]);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: opacity }, uLength: { value: length } },
        vertexShader: BEAM_VS,
        fragmentShader: BEAM_FS,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useFrame(({ clock }) => {
    if (!live) return;
    const o = live(clock.elapsedTime, mat.uniforms.uColor!.value as Color);
    if (typeof o === "number") mat.uniforms.uOpacity!.value = o;
  });
  return <mesh geometry={geo} material={mat} renderOrder={8} raycast={() => null} />;
}

/**
 * A fan of lasers from one emitter, sweeping side to side. Beams are thin bright boxes along -Z of the group,
 * so point the group where the fan should go. `on` gates the whole fan (e.g. only during a set).
 */
export function LaserFan({
  beams = 7,
  length = 9,
  spread = 0.9,
  sweep = 0.5,
  speed = 0.7,
  color = "#3dff8a",
  intensity = 6,
  on,
}: {
  beams?: number;
  length?: number;
  spread?: number;
  sweep?: number;
  speed?: number;
  color?: string;
  intensity?: number;
  on?: () => number;
}) {
  const fan = useRef<Group>(null);
  const geo = useMemo(() => new BoxGeometry(0.012, 0.012, length).translate(0, 0, -length / 2), [length]);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(color).multiplyScalar(intensity) }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `
          varying float vZ;
          void main() { vZ = -position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vZ;
          void main() {
            float a = uOpacity * (1.0 - smoothstep(0.55, 1.0, vZ / ${length.toFixed(2)}));
            gl_FragColor = vec4(uColor, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const level = on ? on() : 1;
    mat.uniforms.uOpacity!.value = level;
    if (!fan.current) return;
    fan.current.visible = level > 0.01;
    fan.current.rotation.y = Math.sin(t * speed) * sweep;
    fan.current.children.forEach((b, i) => {
      const k = beams > 1 ? i / (beams - 1) - 0.5 : 0;
      b.rotation.y = k * spread * (1 + Math.sin(t * speed * 1.7) * 0.25);
      b.rotation.x = Math.sin(t * speed * 1.3 + i) * 0.06 - 0.05;
    });
  });
  return (
    <group ref={fan}>
      {Array.from({ length: beams }, (_, i) => (
        <mesh key={i} geometry={geo} material={mat} raycast={() => null} />
      ))}
    </group>
  );
}
