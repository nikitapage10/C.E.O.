import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, UniformsLib, UniformsUtils } from "three";
import { PALETTE, glow } from "../theme.ts";

/**
 * Hand-written shaders for the Lattice's look: fresnel glass, light threads, screens, grids and halos.
 * Every animated material exposes `uTime`; `tickMaterials` advances them all once per frame.
 */

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

const animated = new Set<ShaderMaterial>();

export function tickMaterials(time: number) {
  for (const m of animated) m.uniforms.uTime!.value = time;
}

function track<T extends ShaderMaterial>(m: T): T {
  animated.add(m);
  return m;
}

const FOG_VERT_PARS = "#include <fog_pars_vertex>";
const FOG_FRAG_PARS = "#include <fog_pars_fragment>";

/** Dark glass whose edges catch the light. The workhorse for platforms, bodies, furniture. */
export function glassMaterial(opts: { base?: string; rim?: string; rimIntensity?: number; opacity?: number; power?: number } = {}) {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uBase: { value: new Color(opts.base ?? PALETTE.panel) },
        uRim: { value: glow(opts.rim ?? PALETTE.ice, opts.rimIntensity ?? 1.6) },
        uOpacity: { value: opts.opacity ?? 0.82 },
        uPower: { value: opts.power ?? 2.2 },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      ${FOG_VERT_PARS}
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase; uniform vec3 uRim; uniform float uOpacity; uniform float uPower;
      varying vec3 vN; varying vec3 vV;
      ${FOG_FRAG_PARS}
      void main() {
        float f = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), uPower);
        vec3 col = uBase + uRim * f;
        gl_FragColor = vec4(col, clamp(uOpacity + f * 0.5, 0.0, 1.0));
        #include <fog_fragment>
      }`,
    transparent: true,
    fog: true,
  });
}

/** Long-exposure light threads flowing along a tube (uv.x runs along its length). */
export function streamMaterial(color: string = PALETTE.ice, opts: { speed?: number; dashes?: number; intensity?: number } = {}) {
  return track(
    new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: glow(color, opts.intensity ?? 2.2) },
        uSpeed: { value: opts.speed ?? 0.35 },
        uDashes: { value: opts.dashes ?? 6 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uSpeed; uniform float uDashes;
        varying vec2 vUv;
        void main() {
          float d = fract(vUv.x * uDashes - uTime * uSpeed);
          float head = smoothstep(0.0, 0.02, d) * pow(d, 10.0);
          float base = 0.3;
          float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
          gl_FragColor = vec4(uColor * (base + head * 2.5) * ends, 1.0);
        }`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
}

/** A monitor: scrolling lines of "code", gently flickering. */
export function screenMaterial(color: string = PALETTE.ice, opts: { speed?: number; density?: number; seed?: number } = {}) {
  return track(
    new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: glow(color, 1.4) },
        uSpeed: { value: opts.speed ?? 1.5 },
        uDensity: { value: opts.density ?? 14 },
        uSeed: { value: opts.seed ?? Math.random() * 100 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uSpeed; uniform float uDensity; uniform float uSeed;
        varying vec2 vUv;
        ${NOISE}
        void main() {
          float y = vUv.y * uDensity + uTime * uSpeed;
          float row = floor(y);
          float len = 0.2 + 0.7 * hash(vec2(row, uSeed));
          float indent = floor(hash(vec2(row + 3.0, uSeed)) * 4.0) * 0.06;
          float inRow = step(0.3, fract(y)) * step(fract(y), 0.75);
          float bar = inRow * step(indent + 0.06, vUv.x) * step(vUv.x, indent + 0.06 + len * 0.8);
          float frame = step(0.02, vUv.x) * step(vUv.x, 0.98) * step(0.03, vUv.y) * step(vUv.y, 0.97);
          float flicker = 0.92 + 0.08 * sin(uTime * 40.0 + uSeed);
          vec3 col = uColor * (0.10 + bar * 0.75) * frame * flicker;
          gl_FragColor = vec4(col, 1.0);
        }`,
      toneMapped: false,
    }),
  );
}

/** A soft radial glow (and, with `streak`, an anamorphic horizontal streak) for flares and underglow. */
export function haloMaterial(color: string = PALETTE.ice, opts: { intensity?: number; streak?: boolean; pulse?: number } = {}) {
  return track(
    new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: glow(color, opts.intensity ?? 1.5) },
        uStreak: { value: opts.streak ? 1 : 0 },
        uPulse: { value: opts.pulse ?? 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uStreak; uniform float uPulse;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float a = pow(max(0.0, 1.0 - r), 3.0);
          if (uStreak > 0.5) {
            float s = exp(-abs(p.y) * 60.0) * pow(max(0.0, 1.0 - abs(p.x)), 1.5);
            a = a * 0.6 + s * 0.9;
          }
          a *= 1.0 + uPulse * 0.25 * sin(uTime * 2.0);
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    }),
  );
}

/** The Kernel: unfinished Syntherion glass, a storm inside, dissolving toward the top where it isn't written yet. */
export function kernelMaterial(height: number) {
  return track(
    new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uHeight: { value: height },
          uIce: { value: glow(PALETTE.ice, 1.4) },
          uViolet: { value: glow(PALETTE.violet, 1.1) },
        },
      ]),
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        ${FOG_VERT_PARS}
        void main() {
          vP = position;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uHeight; uniform vec3 uIce; uniform vec3 uViolet;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        ${NOISE}
        ${FOG_FRAG_PARS}
        void main() {
          float h = (vP.y + uHeight * 0.5) / uHeight;
          vec2 q = vec2(vP.x * 0.6 + vP.z * 0.4, vP.y * 0.25);
          float storm = fbm(q * 2.0 + vec2(uTime * 0.05, -uTime * 0.12));
          float veins = smoothstep(0.55, 0.75, fbm(q * 5.0 - vec2(0.0, uTime * 0.2)));
          float f = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.0);
          vec3 col = mix(vec3(0.02, 0.03, 0.06), uViolet * 0.35, storm * h) + uIce * (veins * 0.6 + f * 0.9);
          // Unfinished: the glass frays into noise near the top.
          float n = fbm(vec2(vP.x * 3.0, vP.y * 2.0 + uTime * 0.3));
          float cut = smoothstep(0.86, 0.7, h + (n - 0.5) * 0.25);
          float edge = (1.0 - smoothstep(0.0, 0.04, abs(h + (n - 0.5) * 0.25 - 0.78))) * step(0.6, h);
          gl_FragColor = vec4(col + uIce * edge * 3.0, (0.55 + f * 0.45) * cut + edge);
          #include <fog_fragment>
        }`,
      transparent: true,
      fog: true,
      toneMapped: false,
    }),
  );
}

/** A window onto the Age of the Veil: slow fog over drowned silhouettes. */
export function veilMaterial() {
  return track(
    new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: glow(PALETTE.silver, 0.9) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor;
        varying vec2 vUv;
        ${NOISE}
        void main() {
          float fog = fbm(vUv * vec2(3.0, 2.0) + vec2(uTime * 0.03, 0.0));
          float ruins = step(vUv.y, 0.25 + 0.2 * step(0.5, noise(vec2(floor(vUv.x * 14.0), 2.0))) * noise(vec2(floor(vUv.x * 14.0), 7.0)));
          vec3 col = uColor * (0.05 + fog * 0.35) * (1.0 - ruins * 0.8) + uColor * 0.4 * pow(1.0 - vUv.y, 6.0);
          gl_FragColor = vec4(col, 1.0);
        }`,
      toneMapped: false,
    }),
  );
}

/** Plain emissive colour, HDR so it blooms. Cached per colour+intensity. */
const emissiveCache = new Map<string, ShaderMaterial>();
export function emissive(color: string, intensity = 2): ShaderMaterial {
  const key = `${color}@${intensity}`;
  let m = emissiveCache.get(key);
  if (!m) {
    m = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uColor: { value: glow(color, intensity) } }]),
      vertexShader: /* glsl */ `
        ${FOG_VERT_PARS}
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        ${FOG_FRAG_PARS}
        void main() {
          gl_FragColor = vec4(uColor, 1.0);
          #include <fog_fragment>
        }`,
      fog: true,
      toneMapped: false,
    });
    emissiveCache.set(key, m);
  }
  return m;
}
