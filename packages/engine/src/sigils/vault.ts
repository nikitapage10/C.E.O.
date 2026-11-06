import { BackSide, BufferAttribute, BufferGeometry, Group, Mesh, Points, ShaderMaterial, SphereGeometry, AdditiveBlending, type Camera, type CanvasTexture } from "three";
import { SIGIL_GLYPHS } from "./undone.ts";

/**
 * The gold vault behind a scene (#932): what the Senate's chamber has around it, as one helper, so a room's 3D no
 * longer floats on flat black. Nikita, 2026-11-06 01:50Z, on the Deep Furnace: "a skybox behind the Furnace scene,
 * like the Senate: a gold grid with sigil nanites drifting, fading into the depth".
 *
 * Two cheap layers, no extra pass:
 * - the sky: a sphere drawn from the inside that rides with the camera (so it reads as infinitely far), a dark warm
 *   gradient with a gold latitude-longitude grid on it, brightest round the horizon and fading toward the poles, its
 *   lines breaking into dashes and flickering where they fade, the way the frame's edges come undone (undone.ts);
 * - the depth: sigil nanites in a wide shell round the scene's middle, drifting up and turning over, dimmer the further
 *   they are, so the eye reads distance; they stay put while the camera swivels, which gives the vault its depth.
 *
 * Fewer nanites on a phone; under reduced motion the scene steps it with a still clock. three.js only: import it from a
 * lazily loaded scene module, never from a page's first load.
 */

export interface VaultOpts {
  /** The glyph atlas (undone.ts sigilAtlas) and the renderer's pixel ratio, shared with the scene's other points. */
  atlas: CanvasTexture;
  px: { value: number };
  /** Kept for disposal. */
  keep: <T extends { dispose: () => void }>(x: T) => T;
  /** The sky sphere's radius: inside the camera's far plane. */
  radius: number;
  /** The middle the nanite shell sits round, and its inner and outer radius. */
  center?: [number, number, number];
  shell?: [number, number];
  /** How many nanites (fewer on a phone). */
  count: number;
  /** The grid's lines round the horizon and from pole to pole. */
  lines?: [number, number];
  /** The gold, and the sky's base colour, 0..1. */
  gold?: [number, number, number];
  base?: [number, number, number];
  /** Where the horizon sits, as a share of the way from the bottom pole to the top (0.5 is level). */
  horizon?: number;
}

export interface Vault {
  group: Group;
  /** Each frame: the clock (still under reduced motion), and the camera the sky rides with. */
  step: (t: number, cam: Camera) => void;
}

const v3 = (c: [number, number, number]) => `vec3(${c.map((x) => x.toFixed(3)).join(", ")})`;

export function goldVault(o: VaultOpts): Vault {
  const { keep } = o;
  const gold = o.gold ?? [0.79, 0.66, 0.36];
  const GOLD = v3(gold);
  const HI = v3([Math.min(1, gold[0] * 1.15), Math.min(1, gold[1] * 1.2), Math.min(1, gold[2] * 1.5)]);
  const BASE = v3(o.base ?? [0.024, 0.022, 0.026]);
  const [lon, lat] = o.lines ?? [48, 18];
  const hz = ((o.horizon ?? 0.5) - 0.5) * 2;
  const u = { t: { value: 0 }, atlas: { value: o.atlas }, px: o.px };
  const group = new Group();

  const skyMat = keep(
    new ShaderMaterial({
      uniforms: u,
      side: BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform float t; varying vec3 vD;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vD);
          float y = d.y - ${hz.toFixed(3)};
          float a = atan(d.z, d.x) / 6.28318 + .5;
          float b = asin(clamp(d.y, -1., 1.)) / 3.14159 + .5;
          vec2 g = vec2(a * ${lon.toFixed(1)}, b * ${lat.toFixed(1)});
          vec2 f = abs(fract(g) - .5);
          vec2 w = fwidth(g) * 1.2;
          float lx = smoothstep(.5 - w.x * 1.5, .5, f.x);
          float ly = smoothstep(.5 - w.y * 1.5, .5, f.y);
          float line = max(lx, ly);
          // Brightest round the horizon, gone toward the poles: the grid falls away into the depth.
          float band = exp(-y * y * 9.);
          // Toward the poles the lines break into dashes that flicker, the way the frame's edges come undone.
          vec2 cell = floor(g * vec2(1., 1.) + vec2(0., floor(g.x * 3.)));
          float h = hash(cell + floor(t * .5 + hash(cell) * 5.));
          float keepIt = step(.55 - band * .55, h);
          float dash = step(.35, fract((lx > ly ? g.y : g.x) * 4. - t * .15));
          float on = line * mix(keepIt * dash, 1., band) * (.82 + .18 * sin(t * 1.7 + h * 30.));
          vec3 c = ${BASE} + ${GOLD} * (.05 * band + .02);
          c += mix(${GOLD}, ${HI}, band) * on * (.1 + .32 * band);
          // A faint glow along the horizon itself.
          c += ${GOLD} * exp(-y * y * 140.) * .07;
          gl_FragColor = vec4(c, 1.);
        }`,
    }),
  );
  const sky = new Mesh(keep(new SphereGeometry(o.radius, 64, 32)), skyMat);
  sky.renderOrder = -20;
  sky.frustumCulled = false;
  group.add(sky);

  // The nanites: a shell of glyphs round the scene's middle, drifting up and turning over, dimmer with distance.
  const N = o.count;
  const [r0, r1] = o.shell ?? [o.radius * 0.3, o.radius * 0.85];
  const [cx, cy, cz] = o.center ?? [0, 0, 0];
  const pos = new Float32Array(N * 3);
  const glyph = new Float32Array(N);
  const rnd = new Float32Array(N);
  const NG = SIGIL_GLYPHS.length;
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2;
    const r = r0 + Math.pow(Math.random(), 0.7) * (r1 - r0);
    const y = (Math.random() * 2 - 1) * r * 0.55;
    const rr = Math.sqrt(Math.max(0, r * r - y * y));
    pos.set([cx + Math.cos(th) * rr, cy + y, cz + Math.sin(th) * rr], i * 3);
    glyph[i] = Math.floor(Math.random() * NG);
    rnd[i] = Math.random();
  }
  const geo = keep(new BufferGeometry());
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("glyph", new BufferAttribute(glyph, 1));
  geo.setAttribute("rnd", new BufferAttribute(rnd, 1));
  const span = (r1 * 0.55 * 2).toFixed(2);
  const nanites = new Points(
    geo,
    keep(
      new ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `attribute float glyph, rnd; uniform float t, px; varying vec2 vCell; varying float vA;
          void main(){
            float g = mod(glyph + floor(t * (.3 + rnd * .5) + rnd * 9.), ${NG.toFixed(1)}); vCell = vec2(mod(g, 8.), floor(g / 8.));
            vec3 p = position;
            float rise = t * (.25 + rnd * .45);
            float yy = p.y - ${cy.toFixed(2)} + ${span} * .5 + rise;
            yy = mod(yy, ${span});
            float edge = smoothstep(0., .18, yy / ${span}) * (1. - smoothstep(.8, 1., yy / ${span}));
            p.y = yy - ${span} * .5 + ${cy.toFixed(2)};
            p.x += sin(t * .2 + rnd * 20.) * .6;
            vec4 mv = modelViewMatrix * vec4(p, 1.);
            float dist = -mv.z;
            vA = edge * clamp(1.4 - dist / ${(r1 * 1.1).toFixed(2)}, 0., 1.) * (.35 + .65 * rnd);
            gl_PointSize = (.7 + rnd * .9) * 26. * px * (6. / max(dist, 1.));
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; uniform float t; varying vec2 vCell; varying float vA;
          void main(){ if (vA < .01) discard; vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            gl_FragColor = vec4(mix(${GOLD}, ${HI}, vA), m * vA * .75); }`,
      }),
    ),
  );
  nanites.frustumCulled = false;
  nanites.renderOrder = -5;
  group.add(nanites);

  return {
    group,
    step: (t, cam) => {
      u.t.value = t;
      sky.position.copy(cam.position);
    },
  };
}
