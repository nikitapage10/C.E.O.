import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, LineSegments, Mesh, PlaneGeometry, Points, SRGBColorSpace, ShaderMaterial, Vector2, type Object3D, type WebGLRenderer } from "three";

/**
 * The frame's edges come undone into gold wire and code nanites: the Senate's language (#856, #878), as one helper a
 * room's 3D scene can share. The Senate (desk/rotunda/rotundaScene.ts) and the Deep Furnace (rooms/foundry) carry the
 * same layers inline; the Glasshouse (#829) was the first to take them from here, and the others can move onto it.
 *
 * Nikita, 2026-11-05: the middle of the screen stays solid, and toward the edges it turns into "a mixture of nanites and
 * wires ... kind of being turned into code", gold first. Four cheap layers, each weighted by how far a pixel sits from
 * the middle of the frame: a veil that lets the solid scene fall away toward the corners, a gold wire grid laid over the
 * scene's surfaces that breaks into dashes and flickers, sigil glyphs strewn on the same surfaces drifting up, and faint
 * sigils peeling off the wires themselves (the grid turning into nanites). No extra pass and no extra model. A scene
 * passes fewer of each on a phone, and stops the clock under reduced motion (`step(0, …)`).
 *
 * three.js only: import it from a lazily loaded scene module, never from a page's first load.
 */

/** The sigil glyphs every scene's nanites are drawn from: runes and a little code. */
export const SIGIL_GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴"];

/** The glyphs drawn once into an 8 × 8 atlas (white on clear), after the runic face has loaded where it can. */
export async function sigilAtlas(): Promise<CanvasTexture> {
  try {
    await document.fonts.load('40px "Noto Sans Runic"', "ᚠ");
  } catch {
    /* the fallback glyphs are fine */
  }
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `44px "Noto Sans Runic","Geist Mono Variable",monospace`;
    SIGIL_GLYPHS.slice(0, 64).forEach((ch, i) => g.fillText(ch, (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 34));
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The glyph points' material: each point one cell of the atlas, tinted, with its own alpha (the scene moves them). */
export function glyphMaterial(atlas: CanvasTexture, px: { value: number }, size = 24): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { atlas: { value: atlas }, px },
    vertexShader: `attribute vec3 tint; attribute float alpha, glyph, sz; uniform float px; varying vec3 vC; varying float vA; varying vec2 vCell;
      void main(){ vC = tint; vA = alpha; vCell = vec2(mod(glyph, 8.), floor(glyph / 8.)); vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = sz * ${size.toFixed(1)} * px * (6./-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D atlas; varying vec3 vC; varying float vA; varying vec2 vCell;
      void main(){ if (vA < .01) discard; vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard; gl_FragColor = vec4(vC, m*vA); }`,
  });
}

export interface UndoneOpts {
  /** The wire grid as line segments (x0, y0, z0, x1, y1, z1, …), laid a little inside the surfaces it traces. */
  wire: number[];
  /** Where the code nanites sit (x, y, z, …): strewn on the same surfaces. */
  dust: Float32Array;
  atlas: CanvasTexture;
  /** The renderer's pixel ratio, shared with the scene's other points. */
  px: { value: number };
  /** Peeling sigils off the wires (fewer on a phone). */
  peel: number;
  /** Which way a point peels off: given where it was born, the drift over its life (default: in toward the middle, and up off the floor). */
  drift?: (x: number, y: number, z: number) => [number, number, number];
  /** How wide the solid middle is: the frame's x against its y, and the radius the corners sit at (the Senate: .84, 1.31). */
  shape?: [number, number];
  /** The wire's colour and the nanites' bright colour, 0..1 (default the Senate's gold); Relay's mast is blue and white. */
  tint?: { wire: [number, number, number]; hi: [number, number, number] };
  /** The darkening veil toward the corners (default on); off for a scene drawn faint over a page, behind its cards. */
  veil?: boolean;
  /** Kept for disposal. */
  keep: <T extends { dispose: () => void }>(x: T) => T;
}

export interface Undone {
  /** Adds the four layers (veil, wires, code dust, peel) to a scene. */
  addTo: (scene: Object3D) => void;
  /** Each frame: the clock (hold it still under reduced motion) and the drawing buffer's size. */
  step: (t: number, renderer: WebGLRenderer) => void;
}

const vec3 = (c: [number, number, number]) => `vec3(${c.map((v) => v.toFixed(3)).join(", ")})`;

export function comeUndone(o: UndoneOpts): Undone {
  const { keep } = o;
  const GOLD = vec3(o.tint?.wire ?? [0.79, 0.66, 0.36]);
  const GOLD_HI = vec3(o.tint?.hi ?? [0.89, 0.79, 0.55]);
  const NG = SIGIL_GLYPHS.length;
  const [sx, sr] = o.shape ?? [0.84, 1.31];
  const u = { t: { value: 0 }, res: { value: new Vector2(1, 1) }, atlas: { value: o.atlas }, px: o.px };
  // 0 in the middle of the frame, 1 at the corners (a touch wider than tall, so the sides go before the top).
  const EDGE = `uniform vec2 res; float edgeOf(){ vec2 q = gl_FragCoord.xy / res * 2. - 1.; return length(q * vec2(${sx.toFixed(3)}, 1.)) / ${sr.toFixed(3)}; }
    float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`;

  const veil = new Mesh(
    keep(new PlaneGeometry(2, 2)),
    keep(
      new ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: `void main(){ gl_Position = vec4(position.xy, 0., 1.); }`,
        fragmentShader: `uniform float t; ${EDGE}
          void main(){ float e = smoothstep(.5, .98, edgeOf()); if (e < .01) discard;
            float g = hash(vec3(floor(gl_FragCoord.xy / 3.), floor(t * 6.)));
            float scan = .5 + .5 * sin(gl_FragCoord.y * .9 + t * 2.);
            vec3 c = vec3(.03, .026, .02) + ${GOLD} * e * .05 * scan;
            gl_FragColor = vec4(c, e * (.62 + .14 * g)); }`,
      }),
    ),
  );
  veil.frustumCulled = false;
  veil.renderOrder = 20;

  const wireGeo = keep(new BufferGeometry());
  wireGeo.setAttribute("position", new BufferAttribute(new Float32Array(o.wire), 3));
  const wires = new LineSegments(
    wireGeo,
    keep(
      new ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float t; varying vec3 vW; ${EDGE}
          void main(){ float e = smoothstep(.42, .95, edgeOf()); if (e < .01) discard;
            vec3 cell = floor(vW * 2.2); float h = hash(cell + floor(t * .7 + hash(cell) * 4.));
            if (h < .35 - e * .2) discard;
            float fl = .75 + .25 * sin(t * 3. + h * 40.);
            gl_FragColor = vec4(${GOLD} * fl, e * .7); }`,
      }),
    ),
  );
  wires.frustumCulled = false;
  wires.renderOrder = 21;

  const ND = o.dust.length / 3;
  const eg = new Float32Array(ND);
  const er = new Float32Array(ND);
  for (let i = 0; i < ND; i++) {
    eg[i] = Math.floor(Math.random() * NG);
    er[i] = Math.random();
  }
  const eGeo = keep(new BufferGeometry());
  eGeo.setAttribute("position", new BufferAttribute(o.dust, 3));
  eGeo.setAttribute("glyph", new BufferAttribute(eg, 1));
  eGeo.setAttribute("rnd", new BufferAttribute(er, 1));
  const dust = new Points(
    eGeo,
    keep(
      new ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `attribute float glyph, rnd; uniform float t, px; varying vec2 vCell; varying float vR;
          void main(){ vR = rnd; float g = mod(glyph + floor(t * .8 + rnd * 9.), ${NG.toFixed(1)}); vCell = vec2(mod(g, 8.), floor(g / 8.));
            vec3 p = position; p.y += fract(t * .03 + rnd) * 1.2;
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.6 + rnd * .6) * 24. * px * (6. / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; uniform float t; varying vec2 vCell; varying float vR; ${EDGE}
          void main(){ float e = smoothstep(.45, .95, edgeOf()); if (e < .01) discard;
            vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            float wink = .45 + .55 * sin(t * 1.7 + vR * 50.);
            gl_FragColor = vec4(mix(${GOLD}, ${GOLD_HI}, vR), m * e * wink * .8); }`,
      }),
    ),
  );
  dust.frustumCulled = false;
  dust.renderOrder = 22;

  // The grid turning into nanites: each faint sigil is born on a point of a real segment, peels away and fades.
  const NP = o.peel;
  const pp = new Float32Array(NP * 3);
  const pd = new Float32Array(NP * 3);
  const pg = new Float32Array(NP);
  const pr = new Float32Array(NP);
  const segs = Math.max(1, o.wire.length / 6);
  const w = o.wire;
  const driftOf =
    o.drift ??
    ((x: number, y: number, z: number): [number, number, number] => {
      const r = Math.hypot(x, z) || 1;
      const floor = y < 0.1;
      const out = floor ? 0.15 : -(0.5 + Math.random() * 0.9);
      return [(x / r) * out + (Math.random() - 0.5) * 0.3, floor ? 0.6 + Math.random() * 0.8 : 0.25 + Math.random() * 0.6, (z / r) * out + (Math.random() - 0.5) * 0.3];
    });
  for (let i = 0; i < NP && w.length >= 6; i++) {
    const k = Math.floor(Math.random() * segs) * 6;
    const f = Math.random();
    const x = w[k]! + (w[k + 3]! - w[k]!) * f;
    const y = w[k + 1]! + (w[k + 4]! - w[k + 1]!) * f;
    const z = w[k + 2]! + (w[k + 5]! - w[k + 2]!) * f;
    pp.set([x, y, z], i * 3);
    pd.set(driftOf(x, y, z), i * 3);
    pg[i] = Math.floor(Math.random() * NG);
    pr[i] = Math.random();
  }
  const pGeo = keep(new BufferGeometry());
  pGeo.setAttribute("position", new BufferAttribute(pp, 3));
  pGeo.setAttribute("drift", new BufferAttribute(pd, 3));
  pGeo.setAttribute("glyph", new BufferAttribute(pg, 1));
  pGeo.setAttribute("rnd", new BufferAttribute(pr, 1));
  const peel = new Points(
    pGeo,
    keep(
      new ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `attribute float glyph, rnd; attribute vec3 drift; uniform float t, px; varying vec2 vCell; varying float vL;
          void main(){ float ph = fract(t * (.035 + rnd * .03) + rnd * 7.31); vL = ph;
            float g = mod(glyph + floor(ph * 3. + rnd * 5.), ${NG.toFixed(1)}); vCell = vec2(mod(g, 8.), floor(g / 8.));
            vec3 p = position + drift * ph * (1. + ph * .6);
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.45 + rnd * .35) * 22. * px * (6. / -mv.z) * (1. - ph * .35);
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; varying vec2 vCell; varying float vL; ${EDGE}
          void main(){ float e = smoothstep(.42, .95, edgeOf()); if (e < .01) discard;
            vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            float life = smoothstep(0., .12, vL) * (1. - smoothstep(.45, 1., vL));
            vec3 c = mix(${GOLD_HI}, ${GOLD}, smoothstep(0., .5, vL));
            gl_FragColor = vec4(c, m * e * life * .32); }`,
      }),
    ),
  );
  peel.frustumCulled = false;
  peel.renderOrder = 22;

  return {
    addTo: (scene) => (o.veil === false ? scene.add(wires, dust, peel) : scene.add(veil, wires, dust, peel)),
    step: (t, renderer) => {
      u.t.value = t;
      renderer.getDrawingBufferSize(u.res.value);
    },
  };
}
