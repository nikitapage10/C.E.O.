import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  Quaternion,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  DoubleSide,
} from "three";
import { comeUndone, glyphMaterial, sigilAtlas, SIGIL_GLYPHS } from "@ceo/engine/sigils/undone.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";

/**
 * Relay's mast (#933): far behind the Thread, very faint, a lattice relay tower with a dish turning slowly at its
 * head. The rooms' look kept small: a dark solid model, Relay's blue wire over it, white sigil nanites drifting up its
 * legs, and its top coming undone into wire and code toward the frame's edge (`@ceo/engine/sigils/undone.ts`).
 * Nothing runs on its own but the slow turn: a pulse climbs the mast and rings out from the dish only when the page's
 * own counts rise (a new text or mail waiting), and it never knows who or what.
 *
 * Drawn on a transparent canvas the page fades (rooms/relay/web/thread.css, `.cx-mast`), off to the right of the cards.
 * No keys (Relay's are busy); a little pointer parallax. Paused off screen and in a hidden tab; reduced motion draws
 * one still frame; phones get fewer nanites at 30 frames a second. Lazy loaded with three.js, never in first paint.
 */

export interface MastOpts {
  phone: boolean;
  reduce: boolean;
}

export interface Mast {
  /** A real arrival: a pulse up the mast, rung out from the dish. */
  pulse: () => void;
  dispose: () => void;
}

/** Relay's light (thread.css --cx-blue, --cx-hi), 0..1. */
const BLUE: [number, number, number] = [0.04, 0.49, 1];
const HI: [number, number, number] = [0.53, 0.71, 1];
const WHITE: [number, number, number] = [0.95, 0.97, 1];
/** The tower: legs from a square base to a narrow head, braced at each level; the dish's yoke above the head. */
const H = 10.5;
const BASE = 1.15;
const TOP = 0.32;
const LEVELS = 7;
const DISH_Y = H + 0.9;
const TIP = H + 3.2;
/** Where the mast stands across the frame (share of its width), on a wide screen and on a phone. */
const AT_WIDE = 0.885;
const AT_PHONE = 0.9;

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const halfAt = (y: number) => BASE + (TOP - BASE) * (y / H);

/** The tower's struts as pairs of points: four legs, a ring and a cross-brace at each level, the pole to the tip. */
function struts(): [Vector3, Vector3][] {
  const out: [Vector3, Vector3][] = [];
  const corner = (k: number, y: number) => {
    const h = halfAt(y);
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    return new Vector3(Math.cos(a) * h * Math.SQRT2, y, Math.sin(a) * h * Math.SQRT2);
  };
  for (let l = 0; l < LEVELS; l++) {
    const y0 = (l / LEVELS) * H;
    const y1 = ((l + 1) / LEVELS) * H;
    for (let k = 0; k < 4; k++) {
      out.push([corner(k, y0), corner(k, y1)]);
      out.push([corner(k, y1), corner(k + 1, y1)]);
      // One diagonal a face, alternating, so the lattice reads as a truss without crowding.
      out.push((l + k) % 2 ? [corner(k, y0), corner(k + 1, y1)] : [corner(k + 1, y0), corner(k, y1)]);
    }
  }
  out.push([new Vector3(0, H, 0), new Vector3(0, TIP, 0)]);
  return out;
}

/** The dish: a shallow paraboloid facing +z, its rim radius 1.3. */
function dishProfile(): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const r = (i / 8) * 1.3;
    pts.push(new Vector2(r, r * r * 0.24));
  }
  return pts;
}

/** The dish's wire: three rings, twelve ribs, the feed's three arms to its focus, and its yoke. */
function dishWire(): number[] {
  const w: number[] = [];
  const at = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r, r * r * 0.24] as const;
  for (const r of [0.45, 0.9, 1.3]) {
    for (let i = 0; i < 24; i++) w.push(...at(r, (i / 24) * Math.PI * 2), ...at(r, ((i + 1) / 24) * Math.PI * 2));
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (let j = 0; j < 4; j++) w.push(...at((j / 4) * 1.3, a), ...at(((j + 1) / 4) * 1.3, a));
  }
  for (let i = 0; i < 3; i++) w.push(...at(1.3, (i / 3) * Math.PI * 2 + 0.5), 0, 0, 1.1);
  // The yoke back to the pole.
  w.push(0, 0, 0, 0, 0.1, -0.42);
  return w;
}

export async function createMast(host: HTMLElement, canvas: HTMLCanvasElement, opts: MastOpts): Promise<Mast> {
  const { reduce } = opts;
  const PH = opts.phone;
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: !PH, powerPreference: "low-power", premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH ? 1 : 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.fog = new FogExp2(0x05060b, 0.018);
  const cam = new PerspectiveCamera(32, 1, 0.5, 200);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const px = { value: renderer.getPixelRatio() };
  const atlas = keep(await sigilAtlas());
  const NG = SIGIL_GLYPHS.length;
  /** The pulse: where its band is up the mast (0..1, past 1 it rings out from the dish), and how strong. */
  const pu = { y: { value: -1 }, k: { value: 0 } };

  scene.add(new HemisphereLight(0x8fb4ff, 0x05060b, 0.6));
  const rim = new DirectionalLight(0x86b6ff, 0.9);
  rim.position.set(-6, 9, -8);
  scene.add(rim);

  // ---- the solid tower: every strut one instance of a thin cylinder --------------------------------------------------
  const ss = struts();
  const strutGeo = keep(new CylinderGeometry(1, 1, 1, 5, 1, true));
  const solid = keep(new MeshLambertMaterial({ color: 0x121c33, emissive: 0x060c1a }));
  const legs = new InstancedMesh(strutGeo, solid, ss.length);
  const up = new Vector3(0, 1, 0);
  const m = new Matrix4();
  const q = new Quaternion();
  ss.forEach(([a, b], i) => {
    const d = b.clone().sub(a);
    const len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    const r = i === ss.length - 1 ? 0.035 : i % 3 === 0 ? 0.06 : 0.03;
    m.compose(a.clone().lerp(b, 0.5), q, new Vector3(r, len, r));
    legs.setMatrixAt(i, m);
  });
  scene.add(legs);

  // The wire: the same struts in Relay's blue, brightening where the pulse's band passes.
  // The tower's wire runs down the middle of its struts, so it draws over them (depth off); the dish's sits on its face.
  const wireOf = (depthTest: boolean) =>
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest,
        blending: AdditiveBlending,
        uniforms: { py: pu.y, pk: pu.k },
        vertexShader: `varying float vY; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float py, pk; varying float vY;
          void main(){ float band = pk * exp(-pow((vY / ${TIP.toFixed(1)} - py) * 9., 2.));
            vec3 c = mix(vec3(${BLUE.join(",")}), vec3(${HI.join(",")}), .35 + band * .65);
            gl_FragColor = vec4(c, .8 + band * .2) * (1. + band * .5); }`,
      }),
    );
  const wireMat = wireOf(true);
  const towerWire: number[] = [];
  for (const [a, b] of ss) towerWire.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const twGeo = keep(new BufferGeometry());
  twGeo.setAttribute("position", new BufferAttribute(new Float32Array(towerWire), 3));
  scene.add(new LineSegments(twGeo, wireOf(false)));

  // ---- the dish, on its yoke, turning slowly -------------------------------------------------------------------------
  const head = new Group();
  head.position.set(0, DISH_Y, 0);
  scene.add(head);
  const dish = new Group();
  dish.position.set(0, 0, 0.42);
  dish.rotation.x = -0.18;
  head.add(dish);
  const dishGeo = keep(new LatheGeometry(dishProfile(), 24));
  dishGeo.rotateX(Math.PI / 2);
  dish.add(new Mesh(dishGeo, keep(new MeshLambertMaterial({ color: 0x0e1628, emissive: 0x060c1a, side: DoubleSide }))));
  const dwGeo = keep(new BufferGeometry());
  dwGeo.setAttribute("position", new BufferAttribute(new Float32Array(dishWire()), 3));
  dish.add(new LineSegments(dwGeo, wireMat));
  const yoke = new Mesh(keep(new CylinderGeometry(0.05, 0.05, 0.42, 5)), solid);
  yoke.rotation.x = Math.PI / 2;
  yoke.position.z = 0.21;
  head.add(yoke);

  // The beacon at the tip, white, breathing slowly.
  const beaconMat = keep(new MeshBasicMaterial({ color: new Color(...WHITE), transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false }));
  const beacon = new Mesh(keep(new SphereGeometry(0.09, 8, 6)), beaconMat);
  beacon.position.y = TIP;
  scene.add(beacon);

  // The ring a pulse sends out from the dish.
  const ringMat = keep(new MeshBasicMaterial({ color: new Color(...HI), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
  const ring = new Mesh(keep(new RingGeometry(0.96, 1, 48)), ringMat);
  ring.position.z = 1.1;
  dish.add(ring);

  // ---- the nanites: white sigils drifting up the legs ---------------------------------------------------------------
  const NN = PH ? 22 : 54;
  const np = new Float32Array(NN * 3);
  const nt = new Float32Array(NN * 3);
  const na = new Float32Array(NN);
  const ngl = new Float32Array(NN);
  const nsz = new Float32Array(NN);
  const motes = Array.from({ length: NN }, (_, i) => ({ leg: i % 4, y: Math.random(), v: 0.012 + Math.random() * 0.02, ph: Math.random() * 6.28, out: 0.1 + Math.random() * 0.5 }));
  for (let i = 0; i < NN; i++) {
    nt.set(WHITE, i * 3);
    ngl[i] = Math.floor(Math.random() * NG);
    nsz[i] = 0.55 + Math.random() * 0.4;
  }
  const nGeo = keep(new BufferGeometry());
  nGeo.setAttribute("position", new BufferAttribute(np, 3));
  nGeo.setAttribute("tint", new BufferAttribute(nt, 3));
  nGeo.setAttribute("alpha", new BufferAttribute(na, 1));
  nGeo.setAttribute("glyph", new BufferAttribute(ngl, 1));
  nGeo.setAttribute("sz", new BufferAttribute(nsz, 1));
  const nanites = new Points(nGeo, keep(glyphMaterial(atlas, px, PH ? 80 : 66)));
  nanites.frustumCulled = false;
  scene.add(nanites);

  // ---- the head coming undone: Relay's blue wire and white code toward the frame's edge ------------------------------
  const dust = new Float32Array((PH ? 30 : 80) * 3);
  for (let i = 0; i < dust.length / 3; i++) {
    const y = H * 0.55 + Math.random() * (TIP - H * 0.55);
    const h = halfAt(Math.min(y, H)) * (1 + Math.random() * 0.8);
    const a = Math.random() * Math.PI * 2;
    dust.set([Math.cos(a) * h, y, Math.sin(a) * h], i * 3);
  }
  const undone = comeUndone({ wire: towerWire, dust, atlas, px, peel: PH ? 24 : 70, shape: [0.9, 1.25], tint: { wire: BLUE, hi: WHITE }, veil: false, keep, drift: (x, _y, z) => [x * 0.3 + (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.9, z * 0.3 + (Math.random() - 0.5) * 0.4] });
  undone.addTo(scene);

  // ---- size, pointer, the frame ---------------------------------------------------------------------------------------
  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    // The mast is drawn at the frame's middle, then the frame slides so it stands off to the right of the cards.
    const at = PH ? AT_PHONE : AT_WIDE;
    cam.setViewOffset(w, h, -(at - 0.5) * w, -h * 0.02, w, h);
    cam.updateProjectionMatrix();
  };
  fit();
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => (fit(), reduce && draw(0))) : null;
  ro?.observe(host);
  const aim = { x: 0, y: 0 };
  const look = { x: 0, y: 0 };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    aim.x = (e.clientX / window.innerWidth - 0.5) * 2;
    aim.y = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  if (!reduce && !PH) window.addEventListener("pointermove", onMove, { passive: true });

  let T = 0;
  let pulseAt = -1;
  const tmp = new Vector3();
  const draw = (dt: number) => {
    T += dt;
    look.x += (aim.x - look.x) * Math.min(1, dt * 1.5);
    look.y += (aim.y - look.y) * Math.min(1, dt * 1.5);
    // The camera: far off and a little low, so the mast stands against the sky; the pointer leans it a touch.
    cam.position.set(look.x * 1.4, 3.2 - look.y * 0.6, PH ? 52 : 34);
    cam.lookAt(0, 6.6, 0);
    head.rotation.y = reduce ? 0.7 : 0.7 + T * 0.09;
    // The pulse: up the mast over ~2.4 s, then the ring from the dish over ~2 s.
    if (pulseAt >= 0) {
      const p = (T - pulseAt) / 2.4;
      pu.y.value = p;
      pu.k.value = p < 1 ? 1 : 0;
      const r = (T - pulseAt - 2.4) / 2;
      if (r >= 0 && r < 1) {
        ring.scale.setScalar(1.3 + r * 3.4);
        ringMat.opacity = 0.5 * (1 - r) * (1 - r);
      } else ringMat.opacity = 0;
      if (r >= 1) pulseAt = -1;
    } else pu.k.value = 0;
    beaconMat.opacity = (reduce ? 0.55 : 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(T * 1.3))) + (pu.k.value && pu.y.value > 0.85 ? 0.4 : 0);
    for (let i = 0; i < NN; i++) {
      const mo = motes[i]!;
      mo.y += mo.v * dt;
      if (mo.y > 1) {
        mo.y = 0;
        mo.leg = (mo.leg + 1) % 4;
        ngl[i] = Math.floor(Math.random() * NG);
      }
      const y = mo.y * TIP;
      const h = halfAt(Math.min(y, H)) * Math.SQRT2 + mo.out * (0.4 + mo.y);
      const a = (mo.leg * Math.PI) / 2 + Math.PI / 4 + Math.sin(T * 0.3 + mo.ph) * 0.2;
      tmp.set(Math.cos(a) * h, y, Math.sin(a) * h);
      np.set([tmp.x, tmp.y, tmp.z], i * 3);
      const life = Math.min(1, mo.y * 6) * Math.min(1, (1 - mo.y) * 4);
      const near = pu.k.value * Math.exp(-Math.pow((mo.y - pu.y.value) * 6, 2));
      na[i] = life * (0.32 + 0.2 * Math.sin(T * 1.4 + mo.ph) + near * 0.6);
    }
    for (const k of ["position", "alpha", "glyph"]) nGeo.attributes[k]!.needsUpdate = true;
    undone.step(reduce ? 0 : T, renderer);
    renderer.render(scene, cam);
  };

  // ---- the loop: paused off screen and in a hidden tab; reduced motion draws once ------------------------------------
  let visible = true;
  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((en) => {
          visible = en[en.length - 1]!.isIntersecting;
        })
      : null;
  io?.observe(host);
  let last = performance.now();
  let raf = 0;
  const minStep = PH ? 1000 / 30 - 2 : 1000 / 45 - 2;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.visibilityState === "hidden") {
      last = now;
      return;
    }
    if (now - last < minStep) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    draw(dt);
  };
  await yieldNow();
  await renderer.compileAsync(scene, cam).catch(() => undefined);
  await yieldNow();
  // Seed the nanites part way up, so the first frame isn't empty.
  draw(reduce ? 0 : 0.016);
  if (!reduce) raf = requestAnimationFrame(frame);

  return {
    pulse: () => {
      if (reduce) return;
      pulseAt = T;
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      window.removeEventListener("pointermove", onMove);
      legs.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
