import * as THREE from "three";
import { SIGILS } from "../relay/sigils.ts";
import { centreOf, roomAt, type HavenPlan, type Lit, type PlanRoom, type Seg, type Spot } from "./data.ts";
import { Sky } from "./sky.ts";
import { FLOOR_PAINT, KIND_STYLE, LIGHT } from "./style.ts";

/**
 * The Haven's house in 3D (#616): a generic renderer for whatever floor plan the private store holds. Nikita's round-6
 * pick, a blend of two concepts: the night interior (grey wood, white and black furniture, lamp pools, green LEDs,
 * night windows) seen through frosted-glass walls, where only the rooms with something going on are lit and the quiet
 * ones stay dim. Sigil nanites (the code-and-rune glyphs Ilyr is built from, relay/sigils.ts) hang in the glass of the
 * lit rooms, drift up in their light, rise off the devices that are working and swarm the ones that need Nikita.
 *
 * Starts on a three-quarter view fitted to the plan (#658: about 37° up, turned so the plan's far end runs up and to the
 * right), under a Denver night sky drawn on its own canvas (sky.ts) that turns with it; drag to orbit, pinch or scroll
 * to zoom, tap a room to fly in (300 ms), and `resetView` comes back to the fitted view. Reduced motion: every move is
 * instant and the frame is still (drawn only when something changes). Loaded lazily, with three from the Lattice's own
 * chunk, and only for a passkey session with a plan.
 */

export interface HouseOpts {
  reduce: boolean;
  onPick: (room: string | null) => void;
  onHover?: (room: string | null) => void;
  /** The sky's canvas, under the house (#658). */
  sky?: HTMLCanvasElement;
  /** The camera has left the default view (a drag or a zoom), or come back to it. */
  onAway?: (away: boolean) => void;
  /** Pixels at the top of the house's box to keep clear on a narrow screen (the page's heading sits there). */
  clearTop?: () => number;
}

export interface RoomFacts {
  /** The room's short line under its name: "vacuum running", "3 to get". */
  fact?: string;
}

const U = 100; // plan units per world unit
const WH = 0.9; // wall height
const T = 0.06; // wall thickness
const FLY_MS = 300;
const GLYPHS = SIGILS.slice(0, 64);

type Cam = { tx: number; tz: number; th: number; ph: number; r: number };

/** The default view (#658): turned about 43° and tilted about 37° above the floor. */
export const HOME_TH = 0.75;
export const HOME_PH = 0.93;
const FOV = 30;
type V3 = [number, number, number];

/**
 * Fit a box (the plan's rooms, floor to wall tops, in world units round the orbit target) into a W×H frame at a given
 * orbit angle: the camera distance that makes its projection fill the inner box (the frame less its margins, in px),
 * and the view offset (px) that centres the projection there. Perspective makes the near end bigger, so the box's
 * picture is off-centre round the target; the offset puts it back without moving the orbit's pivot.
 */
export function fitView(box: { x0: number; x1: number; z0: number; z1: number; h: number }, th: number, ph: number, W: number, H: number, m: { l: number; r: number; t: number; b: number }) {
  const tan = Math.tan((FOV * Math.PI) / 360);
  const d: V3 = [Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)];
  const f: V3 = [-d[0], -d[1], -d[2]];
  // right = f × (0,1,0), up = right × f
  const rl = Math.hypot(f[2], f[0]) || 1;
  const rt: V3 = [-f[2] / rl, 0, f[0] / rl];
  const up: V3 = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pts: V3[] = [];
  for (const x of [box.x0, box.x1]) for (const z of [box.z0, box.z1]) for (const y of [0, box.h]) pts.push([x, y, z]);
  const project = (r: number) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const q: V3 = [p[0] - d[0] * r, p[1] - d[1] * r, p[2] - d[2] * r];
      const k = (H / 2) / (dot(q, f) * tan);
      const X = dot(q, rt) * k, Y = dot(q, up) * k;
      x0 = Math.min(x0, X);
      x1 = Math.max(x1, X);
      y0 = Math.min(y0, Y);
      y1 = Math.max(y1, Y);
    }
    return { x0, x1, y0, y1 };
  };
  const aw = Math.max(40, W - m.l - m.r), ah = Math.max(40, H - m.t - m.b);
  const reach = Math.hypot(box.x1 - box.x0, box.z1 - box.z0, box.h);
  let lo = reach * 0.55, hi = reach * 40;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2, b = project(mid);
    if (b.x1 - b.x0 <= aw && b.y1 - b.y0 <= ah) hi = mid;
    else lo = mid;
  }
  const b = project(hi);
  const icx = m.l + aw / 2, icy = m.t + ah / 2;
  return { r: hi, pan: [W / 2 + (b.x0 + b.x1) / 2 - icx, H / 2 - (b.y0 + b.y1) / 2 - icy] as [number, number] };
}

/** The walls: every room part's edges, merged where they run together, with the doors cut out. Generic. */
export function wallsOf(plan: HavenPlan): Seg[] {
  const H = new Map<number, [number, number][]>(), V = new Map<number, [number, number][]>();
  const add = (m: Map<number, [number, number][]>, k: number, a: number, b: number) => {
    const l = m.get(k) ?? [];
    l.push([Math.min(a, b), Math.max(a, b)]);
    m.set(k, l);
  };
  for (const r of plan.rooms)
    for (const [x, y, w, h] of r.parts) {
      add(H, y, x, x + w);
      add(H, y + h, x, x + w);
      add(V, x, y, y + h);
      add(V, x + w, y, y + h);
    }
  const merge = (l: [number, number][]) => {
    l.sort((a, b) => a[0] - b[0]);
    const o: [number, number][] = [];
    for (const s of l) {
      const last = o[o.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
      else o.push([s[0], s[1]]);
    }
    return o;
  };
  const cut = (l: [number, number][], d: [number, number]) => {
    const o: [number, number][] = [];
    for (const s of l) {
      if (d[1] <= s[0] || d[0] >= s[1]) o.push(s);
      else {
        if (d[0] > s[0]) o.push([s[0], d[0]]);
        if (d[1] < s[1]) o.push([d[1], s[1]]);
      }
    }
    return o;
  };
  const out: Seg[] = [];
  for (const [y, l0] of H) {
    let l = merge(l0);
    for (const d of plan.doors) if (d[1] === y && d[3] === y) l = cut(l, [Math.min(d[0], d[2]), Math.max(d[0], d[2])]);
    for (const s of l) if (s[1] - s[0] > 1) out.push([s[0], y, s[1], y]);
  }
  for (const [x, l0] of V) {
    let l = merge(l0);
    for (const d of plan.doors) if (d[0] === x && d[2] === x) l = cut(l, [Math.min(d[1], d[3]), Math.max(d[1], d[3])]);
    for (const s of l) if (s[1] - s[0] > 1) out.push([x, s[0], x, s[1]]);
  }
  return out;
}

/** The glyph atlas: each sigil drawn once, white, into an 8 x 8 grid. Redrawn when the arcane fonts arrive. */
function drawAtlas(c: HTMLCanvasElement) {
  const x = c.getContext("2d");
  if (!x) return;
  const cs = c.width / 8;
  x.clearRect(0, 0, c.width, c.height);
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillStyle = "#fff";
  GLYPHS.forEach((g, i) => {
    const cx = (i % 8) * cs + cs / 2, cy = Math.floor(i / 8) * cs + cs / 2;
    const code = /[\x20-\x7e]/.test(g) || g === "λ" || g === "∴";
    x.font = code ? `600 ${g.length > 1 ? cs * 0.44 : cs * 0.58}px "Geist Mono Variable", ui-monospace, monospace` : `400 ${cs * 0.64}px "Noto Sans Symbols", "Noto Sans Symbols 2", "Noto Sans Runic", serif`;
    x.shadowColor = "rgba(255,255,255,.55)";
    x.shadowBlur = cs * 0.08;
    x.fillText(g, cx, cy + 2);
    x.shadowBlur = 0;
    x.fillText(g, cx, cy + 2);
  });
}

const NV = `attribute float aSize; attribute float aGlyph; attribute vec4 aCol; uniform float uScale; varying float vG; varying vec4 vC;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(.1, -mv.z); vG = aGlyph; vC = aCol; }`;
const NF = `uniform sampler2D uAtlas; varying float vG; varying vec4 vC;
void main(){ vec2 pc = gl_PointCoord; float g = floor(vG + .5); vec2 cell = vec2(mod(g, 8.), floor(g / 8.));
 vec2 uv = vec2((cell.x + pc.x) / 8., 1. - (cell.y + pc.y) / 8.); float a = texture2D(uAtlas, uv).a;
 float d = length(pc - .5); a = max(a, .22 * smoothstep(.5, .0, d)); if (a * vC.a < .004) discard; gl_FragColor = vec4(vC.rgb, a * vC.a); }`;

/** A particle's job this frame: dust in a lit room's light, a mote in its glass, a stream off a working device, a swarm round one that needs Nikita, a trickle along the path, or the faint field over the whole house. */
type Role = { k: "dust"; room: PlanRoom; level: number } | { k: "wall"; seg: Seg; needs: boolean } | { k: "rise"; x: number; y: number; lift: number } | { k: "swarm"; x: number; y: number } | { k: "path" } | { k: "field" };

const fract = (v: number) => v - Math.floor(v);
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

export class House {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);
  private scene = new THREE.Scene();
  private world = new THREE.Group();
  private cam: Cam = { tx: 0, tz: 0, th: 0, ph: 0.3, r: 12 };
  private home: Cam = { tx: 0, tz: 0, th: 0, ph: 0.3, r: 12 };
  private fitR = 12;
  private pan: [number, number] = [0, 0];
  private away = false;
  private sky: Sky | null = null;
  private tween: { from: Cam; to: Cam; t0: number; ms: number } | null = null;
  private W = 1;
  private H = 1;
  private raf = 0;
  private dirty = true;
  private visible = true;
  private backdrop = false;
  private focusId: string | null = null;
  private hover: string | null = null;
  private lastUser = -1e9;
  private t0 = performance.now();
  private last = performance.now();
  private disposers: (() => void)[] = [];
  private lights: THREE.PointLight[] = [];
  private pools: THREE.Mesh[] = [];
  private poolMat: THREE.MeshBasicMaterial[] = [];
  private lit: Record<string, Lit> = {};
  private litNow = new Map<string, number>();
  private labels: { el: HTMLElement; p: THREE.Vector3; room?: string; spot?: Spot }[] = [];
  private atlasCanvas = document.createElement("canvas");
  private atlas: THREE.CanvasTexture;
  private pts!: THREE.Points;
  private nMat!: THREE.ShaderMaterial;
  private N: number;
  private roles: Role[] = [];
  private seeds: Float32Array;
  private pos!: Float32Array;
  private col!: Float32Array;
  private glyph!: Float32Array;
  private size!: Float32Array;
  private pathLen = 0;
  private walls: Seg[];

  constructor(
    private host: HTMLElement,
    private labelHost: HTMLElement,
    private plan: HavenPlan,
    private opts: HouseOpts,
  ) {
    const phone = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.N = phone ? 700 : 1400;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(phone ? 1.75 : 2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = "hv-gl";
    host.appendChild(this.renderer.domElement);
    this.scene.add(this.world);
    this.atlasCanvas.width = this.atlasCanvas.height = 1024;
    drawAtlas(this.atlasCanvas);
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.anisotropy = 4;
    // The arcane fonts come with the sigils kit; draw the atlas again once they are in.
    if (document.fonts?.load) {
      void Promise.all(['400 64px "Noto Sans Runic"', '400 64px "Noto Sans Symbols"', '400 64px "Noto Sans Symbols 2"', '600 60px "Geist Mono Variable"'].map((f) => document.fonts.load(f, "ᚠ☿🜁⊕{").catch(() => [])))
        .then(() => {
          drawAtlas(this.atlasCanvas);
          this.atlas.needsUpdate = true;
          this.dirty = true;
        })
        .catch(() => undefined);
    }
    this.seeds = new Float32Array(this.N * 6);
    let s = 7;
    for (let i = 0; i < this.seeds.length; i++) {
      s = (s * 16807) % 2147483647;
      this.seeds[i] = s / 2147483647;
    }
    this.walls = wallsOf(plan);
    if (opts.sky) this.sky = new Sky(opts.sky, opts.reduce);
    this.build();
    this.bind();
    this.resize();
    this.cam = { ...this.home };
    this.apply();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
    const io = new IntersectionObserver((es) => {
      this.visible = es.some((e) => e.isIntersecting);
    });
    io.observe(host);
    this.disposers.push(() => io.disconnect());
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ── plan to world ── */
  private wx = (x: number) => (x - this.plan.w / 2) / U;
  private wz = (y: number) => (y - this.plan.h / 2) / U;

  private build() {
    // Night: a dim cool sky and a low moon, so quiet rooms stay legible but dark.
    this.scene.add(new THREE.HemisphereLight(0x8890b0, 0x0a0a0c, 0.55));
    const moon = new THREE.DirectionalLight(0x9fb2ff, 0.35);
    moon.position.set(-4, 9, 3);
    this.scene.add(moon);
    // A few lamps, moved to whichever rooms are lit (a fixed count, so no shader rebuilds).
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(LIGHT.lamp, 0, 4.2, 1.6);
      l.position.set(0, WH * 0.95, 0);
      this.scene.add(l);
      this.lights.push(l);
    }
    this.world.add(this.floor());
    // Frosted glass walls with bright top edges.
    const boxes = (segs: Seg[], h: number, t: number, y0: number) =>
      segs.map((s) => {
        const hz = s[1] === s[3];
        const L = (hz ? Math.abs(s[2] - s[0]) : Math.abs(s[3] - s[1])) / U + t;
        return { x: this.wx((s[0] + s[2]) / 2), y: y0 + h / 2, z: this.wz((s[1] + s[3]) / 2), sx: hz ? L : t, sy: h, sz: hz ? t : L };
      });
    const glass = new THREE.MeshStandardMaterial({ color: 0xe6ecf5, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, emissive: 0x1a2030, emissiveIntensity: 0.4 });
    this.world.add(this.instanced(new THREE.BoxGeometry(1, 1, 1), glass, boxes(this.walls, WH, T, 0), 5));
    const cap = new THREE.MeshBasicMaterial({ color: 0xf4f1ea, transparent: true, opacity: 0.7, depthWrite: false });
    this.world.add(this.instanced(new THREE.BoxGeometry(1, 1, 1), cap, boxes(this.walls, 0.012, T + 0.006, WH), 6));
    this.windows();
    this.furniture();
    this.devices();
    this.lightPools();
    this.nanites();
    this.buildLabels();
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[], order = 0) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const o = new THREE.Object3D();
    list.forEach((b, i) => {
      o.position.set(b.x, b.y, b.z);
      o.scale.set(b.sx, b.sy, b.sz);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.count = list.length;
    m.renderOrder = order;
    this.disposers.push(() => geo.dispose());
    return m;
  }

  private floor(): THREE.Mesh {
    const P = this.plan;
    const S = Math.min(2, 2048 / Math.max(P.w, P.h));
    const cv = document.createElement("canvas");
    cv.width = Math.round(P.w * S);
    cv.height = Math.round(P.h * S);
    const c = cv.getContext("2d")!;
    c.scale(S, S);
    // The walk to a detached block.
    if (P.path.length > 1) {
      c.strokeStyle = "#26282d";
      c.lineWidth = 14;
      c.lineJoin = "round";
      c.beginPath();
      P.path.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
    }
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
    for (const r of P.rooms) {
      const paint = FLOOR_PAINT[r.floor];
      for (const [x, y, w, h] of r.parts) {
        c.save();
        c.beginPath();
        c.rect(x, y, w, h);
        c.clip();
        c.fillStyle = paint.base;
        c.fillRect(x, y, w, h);
        if (paint.grain === "planks") {
          for (let yy = y; yy < y + h; yy += 10) {
            const off = rnd() * 80;
            for (let xx = x - off; xx < x + w; xx += 70 + rnd() * 50) {
              c.fillStyle = `hsl(${28 + rnd() * 8},${4 + rnd() * 6}%,${40 + rnd() * 12}%)`;
              c.fillRect(xx, yy, 118, 9.2);
            }
          }
        } else if (paint.grain === "tiles") {
          c.strokeStyle = "rgba(0,0,0,.18)";
          c.lineWidth = 0.8;
          for (let xx = x; xx < x + w; xx += 30) c.strokeRect(xx, y, 30, h);
          for (let yy = y; yy < y + h; yy += 15) c.strokeRect(x, yy, w, 15);
        } else if (paint.grain === "weave") {
          for (let k = 0; k < (w * h) / 60; k++) {
            c.fillStyle = `rgba(255,255,255,${rnd() * 0.04})`;
            c.fillRect(x + rnd() * w, y + rnd() * h, 2, 2);
          }
        }
        c.restore();
      }
    }
    // Rugs and mats are paint, not furniture.
    for (const it of P.items) {
      const st = KIND_STYLE[it.k];
      if (st.height > 2) continue;
      c.fillStyle = `#${st.colour.toString(16).padStart(6, "0")}`;
      if (it.round) {
        c.beginPath();
        c.arc(it.x, it.y, it.w / 2, 0, 7);
        c.fill();
      } else c.fillRect(it.x, it.y, it.w, it.h);
    }
    // Contact shadows under the furniture and along the walls, blurred.
    const sh = document.createElement("canvas");
    sh.width = cv.width;
    sh.height = cv.height;
    const s = sh.getContext("2d")!;
    s.scale(S, S);
    s.fillStyle = "rgba(0,0,0,.55)";
    for (const it of P.items) {
      const st = KIND_STYLE[it.k];
      if (st.height <= 2 || st.lift > 20) continue;
      if (it.round) {
        s.beginPath();
        s.arc(it.x + 2, it.y + 3, it.w / 2 + 2, 0, 7);
        s.fill();
      } else s.fillRect(it.x - 1, it.y + 1, it.w + 3, it.h + 4);
    }
    s.strokeStyle = "rgba(0,0,0,.45)";
    s.lineWidth = 10;
    for (const w of this.walls) {
      s.beginPath();
      s.moveTo(w[0], w[1]);
      s.lineTo(w[2], w[3]);
      s.stroke();
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.filter = `blur(${6 * S}px)`;
    c.globalCompositeOperation = "source-atop";
    c.drawImage(sh, 0, 0);
    c.restore();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(P.w / U, P.h / U);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0, alphaTest: 0.5, transparent: false });
    this.disposers.push(() => (geo.dispose(), mat.dispose(), tex.dispose()));
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    return floor;
  }

  private windows() {
    const wc = document.createElement("canvas");
    wc.width = wc.height = 128;
    const x = wc.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "#2a3b5c");
    g.addColorStop(1, "#16203a");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 24; i++) {
      x.fillStyle = `rgba(255,${190 + ((i * 37) % 50)},140,${0.15 + ((i * 13) % 35) / 100})`;
      x.beginPath();
      x.arc((i * 53) % 128, 60 + ((i * 29) % 66), 1 + (i % 3) * 0.8, 0, 7);
      x.fill();
    }
    x.strokeStyle = "#050505";
    x.lineWidth = 8;
    x.strokeRect(0, 0, 128, 128);
    x.beginPath();
    x.moveTo(0, 36);
    x.lineTo(128, 36);
    x.moveTo(64, 36);
    x.lineTo(64, 128);
    x.stroke();
    const tex = new THREE.CanvasTexture(wc);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xb8c4dd, transparent: true, opacity: 0.85 });
    const list: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    for (const w of this.plan.windows) {
      const hz = w[1] === w[3];
      const L = (hz ? Math.abs(w[2] - w[0]) : Math.abs(w[3] - w[1])) / U;
      const n = Math.max(1, Math.round(L / 0.5)), seg = L / n;
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        list.push({ x: this.wx(w[0] + (w[2] - w[0]) * f), y: WH * 0.5, z: this.wz(w[1] + (w[3] - w[1]) * f), sx: hz ? seg - 0.02 : T + 0.012, sy: WH * 0.8, sz: hz ? T + 0.012 : seg - 0.02 });
      }
    }
    this.disposers.push(() => (mat.dispose(), tex.dispose()));
    if (list.length) this.world.add(this.instanced(new THREE.BoxGeometry(1, 1, 1), mat, list, 2));
  }

  private furniture() {
    const groups = new Map<string, { x: number; y: number; z: number; sx: number; sy: number; sz: number }[]>();
    for (const it of this.plan.items) {
      const st = KIND_STYLE[it.k];
      if (st.height <= 2) continue;
      const h = st.height / U;
      const key = `${it.k}:${it.round ? "c" : "b"}`;
      const list = groups.get(key) ?? [];
      list.push(
        it.round
          ? { x: this.wx(it.x), y: st.lift / U + h / 2, z: this.wz(it.y), sx: it.w / U, sy: h, sz: it.w / U }
          : { x: this.wx(it.x + it.w / 2), y: st.lift / U + h / 2, z: this.wz(it.y + it.h / 2), sx: it.w / U, sy: h, sz: it.h / U },
      );
      groups.set(key, list);
    }
    for (const [key, list] of groups) {
      const [k, shape] = key.split(":") as [keyof typeof KIND_STYLE, string];
      const st = KIND_STYLE[k];
      const mat = new THREE.MeshStandardMaterial({ color: st.colour, roughness: st.rough, metalness: st.metal ?? 0 });
      if (st.glow) {
        mat.emissive = new THREE.Color(st.glow[0]);
        mat.emissiveIntensity = st.glow[1] * 1.6;
      }
      this.disposers.push(() => mat.dispose());
      const geo = shape === "c" ? new THREE.CylinderGeometry(0.5, 0.5, 1, 20) : new THREE.BoxGeometry(1, 1, 1);
      this.world.add(this.instanced(geo, mat, list, 1));
    }
  }

  private devices() {
    const body = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.4, emissive: 0x4fd6ff, emissiveIntensity: 0.25 });
    this.disposers.push(() => (body.dispose(), dark.dispose()));
    const s = 1 / U;
    for (const d of this.plan.devices) {
      let geo: THREE.BufferGeometry;
      if (d.kind === "vacuum") geo = new THREE.BoxGeometry(26 * s, 30 * s, 22 * s);
      else if (d.kind === "dry-feeder" || d.kind === "wet-feeder") geo = new THREE.CylinderGeometry(11 * s, 13 * s, 28 * s, 24);
      else if (d.kind === "fountain") geo = new THREE.CylinderGeometry(13 * s, 13 * s, 16 * s, 24);
      else if (d.kind === "litter") geo = new THREE.SphereGeometry(18 * s, 24, 16);
      else geo = new THREE.CylinderGeometry(5 * s, 5 * s, 2 * s, 24);
      const mesh = new THREE.Mesh(geo, d.kind === "thermostat" || d.kind === "vacuum" ? dark : body);
      const h = d.kind === "litter" ? 22 * s : ((geo as THREE.CylinderGeometry).parameters?.height ?? 30 * s) / 2;
      mesh.position.set(this.wx(d.x), d.lift / U + h, this.wz(d.y));
      if (d.kind === "thermostat") mesh.rotation.x = Math.PI / 2;
      if (d.kind === "litter") mesh.scale.y = 1.25;
      this.disposers.push(() => geo.dispose());
      this.world.add(mesh);
    }
  }

  private lightPools() {
    // A soft lamp pool on each room's floor, faded in when the room is lit: the light reads from straight above too.
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,.4)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.disposers.push(() => tex.dispose());
    for (const r of this.plan.rooms) {
      const [cx, cy] = centreOf(r);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [px, py, pw, ph] of r.parts) {
        x0 = Math.min(x0, px);
        y0 = Math.min(y0, py);
        x1 = Math.max(x1, px + pw);
        y1 = Math.max(y1, py + ph);
      }
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: LIGHT.lamp, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const geo = new THREE.PlaneGeometry(((x1 - x0) / U) * 1.15, ((y1 - y0) / U) * 1.15);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(this.wx(cx), 0.01, this.wz(cy));
      m.userData.room = r.id;
      m.renderOrder = 3;
      this.disposers.push(() => (geo.dispose(), mat.dispose()));
      this.world.add(m);
      this.pools.push(m);
      this.poolMat.push(mat);
    }
  }

  private nanites() {
    const n = this.N;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.glyph = new Float32Array(n);
    this.size = new Float32Array(n);
    for (let i = 0; i < n; i++) this.glyph[i] = Math.floor(this.seeds[i * 6 + 3]! * GLYPHS.length);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aCol", new THREE.BufferAttribute(this.col, 4));
    g.setAttribute("aGlyph", new THREE.BufferAttribute(this.glyph, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.nMat = new THREE.ShaderMaterial({ uniforms: { uAtlas: { value: this.atlas }, uScale: { value: 400 } }, vertexShader: NV, fragmentShader: NF, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.pts = new THREE.Points(g, this.nMat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 10;
    this.disposers.push(() => (g.dispose(), this.nMat.dispose(), this.atlas.dispose()));
    this.world.add(this.pts);
    for (let i = 1; i < this.plan.path.length; i++) {
      const [a, b] = [this.plan.path[i - 1]!, this.plan.path[i]!];
      this.pathLen += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    this.assign();
  }

  /** Shares the particles out among the jobs the readings call for; whatever is left is the faint field. */
  private assign() {
    const P = this.plan;
    const jobs: { role: () => Role; weight: number }[] = [];
    for (const [id, l] of Object.entries(this.lit)) {
      const room = P.rooms.find((r) => r.id === id);
      if (!room) continue;
      jobs.push({ role: () => ({ k: "dust", room, level: l.level }), weight: 90 * Math.max(0.4, l.level) });
      const segs = this.walls.filter((w) => room.parts.some(([x, y, ww, hh]) => w[0] >= x - 1 && w[2] <= x + ww + 1 && w[1] >= y - 1 && w[3] <= y + hh + 1));
      segs.forEach((seg) => jobs.push({ role: () => ({ k: "wall", seg, needs: l.needs }), weight: (l.needs ? 26 : 12) * Math.max(0.5, (Math.abs(seg[2] - seg[0]) + Math.abs(seg[3] - seg[1])) / 200) }));
    }
    for (const d of P.devices) {
      const room = d.lights ?? roomAt(P, d.x, d.y)?.id;
      const l = room ? this.lit[room] : undefined;
      if (!l || d.kind === "thermostat") continue;
      jobs.push({ role: () => ({ k: "rise", x: d.x, y: d.y, lift: d.lift }), weight: 40 });
      if (l.needs) jobs.push({ role: () => ({ k: "swarm", x: d.x, y: d.y }), weight: 46 });
    }
    if (this.pathLen > 0) jobs.push({ role: () => ({ k: "path" }), weight: 60 });
    const budget = Math.round(this.N * 0.82);
    const total = jobs.reduce((a, j) => a + j.weight, 0);
    const scale = total > budget ? budget / total : 1;
    this.roles = [];
    for (const j of jobs) for (let k = 0; k < Math.round(j.weight * scale); k++) this.roles.push(j.role());
    while (this.roles.length < this.N) this.roles.push({ k: "field" });
    this.roles.length = this.N;
    this.dirty = true;
  }

  private step(t: number) {
    const P = this.plan, sd = this.seeds, pos = this.pos, col = this.col, size = this.size;
    for (let i = 0; i < this.N; i++) {
      const r = this.roles[i]!, a = sd[i * 6]!, b = sd[i * 6 + 1]!, c = sd[i * 6 + 2]!, sp = 0.6 + sd[i * 6 + 4]! * 0.8;
      let x: number, y: number, z: number, al: number, cr = 1, cg = 0.86, cb = 0.66, sz = 0.085;
      if (r.k === "dust") {
        const part = r.room.parts[Math.floor(a * r.room.parts.length)]!;
        const f = fract(t * 0.05 * sp + c);
        x = this.wx(part[0] + b * part[2]) + Math.sin(t * 0.3 + a * 6) * 0.05;
        z = this.wz(part[1] + fract(a * 7.3) * part[3]) + Math.cos(t * 0.27 + b * 6) * 0.05;
        y = 0.04 + f * WH * 1.15;
        al = Math.sin(Math.PI * f) * (0.35 + 0.5 * r.level);
      } else if (r.k === "wall") {
        const s = r.seg, u = a;
        x = this.wx(s[0] + (s[2] - s[0]) * u);
        z = this.wz(s[1] + (s[3] - s[1]) * u);
        y = 0.05 + b * (WH - 0.08) + Math.sin(t * 0.4 * sp + c * 6) * 0.02;
        al = 0.35 + 0.35 * Math.sin(t * 1.3 * sp + a * 20);
        if (r.needs) [cr, cg, cb] = [1, 0.58, 0.42];
        else [cr, cg, cb] = [0.86, 0.92, 1];
        sz = 0.07;
      } else if (r.k === "rise") {
        const f = fract(t * 0.22 * sp + a);
        const ang = b * 6.283 + t * 1.4 * sp;
        const rad = 0.04 + f * 0.14;
        x = this.wx(r.x) + Math.cos(ang) * rad;
        z = this.wz(r.y) + Math.sin(ang) * rad;
        y = r.lift / U + 0.15 + f * 1.5;
        al = (1 - f) * 0.9;
        [cr, cg, cb] = [0.62, 1, 0.78];
        sz = 0.075;
      } else if (r.k === "swarm") {
        const ang = a * 6.283 + t * (0.8 + c) * (b > 0.5 ? 1 : -1);
        const rad = 0.16 + b * 0.14;
        x = this.wx(r.x) + Math.cos(ang) * rad;
        z = this.wz(r.y) + Math.sin(ang) * rad;
        y = 0.08 + c * 0.45 + Math.sin(t * 2 + a * 9) * 0.03;
        al = 0.75;
        [cr, cg, cb] = [1, 0.6, 0.42];
        sz = 0.08;
      } else if (r.k === "path") {
        let d = fract(t * 0.025 * sp + a) * this.pathLen;
        let px = P.path[0]![0], py = P.path[0]![1];
        for (let k = 1; k < P.path.length; k++) {
          const [p0, p1] = [P.path[k - 1]!, P.path[k]!];
          const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          if (d <= L) {
            px = p0[0] + ((p1[0] - p0[0]) * d) / L;
            py = p0[1] + ((p1[1] - p0[1]) * d) / L;
            break;
          }
          d -= L;
          px = p1[0];
          py = p1[1];
        }
        x = this.wx(px) + (b - 0.5) * 0.08;
        z = this.wz(py) + (c - 0.5) * 0.08;
        y = 0.03 + b * 0.06;
        al = 0.22;
        [cr, cg, cb] = [0.7, 0.78, 1];
        sz = 0.06;
      } else {
        x = this.wx(a * P.w) + Math.sin(t * 0.07 + b * 9) * 0.3;
        z = this.wz(b * P.h) + Math.cos(t * 0.05 + c * 9) * 0.3;
        y = 0.2 + c * 1.6 + Math.sin(t * 0.1 + a * 7) * 0.1;
        al = 0.09 + 0.06 * Math.sin(t * 0.6 + a * 30);
        [cr, cg, cb] = [0.75, 0.82, 1];
        sz = 0.06;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      col[i * 4] = cr;
      col[i * 4 + 1] = cg;
      col[i * 4 + 2] = cb;
      col[i * 4 + 3] = Math.max(0, al);
      size[i] = sz;
      // Every so often a glyph rewrites itself.
      if (sd[i * 6 + 5]! > 0.7 && fract(t * 0.5 * sd[i * 6 + 5]! + a) < 0.02) this.glyph[i] = Math.floor(fract(a * 13 + t * 0.1) * GLYPHS.length);
    }
    const g = this.pts.geometry;
    (["position", "aCol", "aSize", "aGlyph"] as const).forEach((k) => (g.attributes[k]!.needsUpdate = true));
  }

  /* ── labels: HTML over the canvas, placed every frame ── */
  private buildLabels() {
    this.labelHost.replaceChildren();
    this.labels = [];
    for (const r of this.plan.rooms) {
      const el = document.createElement("div");
      el.className = "hv-lab";
      const b = document.createElement("b");
      b.textContent = r.name;
      const em = document.createElement("em");
      el.append(b, em);
      this.labelHost.appendChild(el);
      const [cx, cy] = centreOf(r);
      this.labels.push({ el, p: new THREE.Vector3(this.wx(cx), WH + 0.04, this.wz(cy)), room: r.id });
    }
    for (const d of this.plan.devices) {
      const el = document.createElement("div");
      el.className = "hv-dev";
      el.dataset.kind = d.kind;
      const i = document.createElement("i");
      const span = document.createElement("span");
      el.append(i, span);
      this.labelHost.appendChild(el);
      this.labels.push({ el, p: new THREE.Vector3(this.wx(d.x), d.lift / U + 0.42, this.wz(d.y)), spot: d.kind });
    }
  }

  private v = new THREE.Vector3();
  private placeLabels() {
    for (const l of this.labels) {
      this.v.copy(l.p).project(this.camera);
      const vis = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      l.el.style.transform = `translate(${(((this.v.x + 1) / 2) * this.W).toFixed(1)}px,${(((1 - this.v.y) / 2) * this.H).toFixed(1)}px) translate(-50%,-50%)`;
      l.el.style.visibility = vis ? "" : "hidden";
      if (l.room) l.el.classList.toggle("is-hover", this.hover === l.room || this.focusId === l.room);
    }
  }

  /* ── camera ── */
  private frameHome() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of this.plan.rooms)
      for (const [px, py, pw, ph] of r.parts) {
        x0 = Math.min(x0, px);
        y0 = Math.min(y0, py);
        x1 = Math.max(x1, px + pw);
        y1 = Math.max(y1, py + ph);
      }
    if (!Number.isFinite(x0)) [x0, y0, x1, y1] = [0, 0, this.plan.w, this.plan.h];
    // The orbit turns round the middle of the rooms; the box is measured from there.
    const tx = this.wx((x0 + x1) / 2), tz = this.wz((y0 + y1) / 2);
    const hw = (x1 - x0) / U / 2, hd = (y1 - y0) / U / 2;
    const narrow = this.W < 600;
    const top = narrow ? Math.max(this.H * 0.05, (this.opts.clearTop?.() ?? 0) + 8) : this.H * 0.07;
    const m = narrow ? { l: this.W * 0.03, r: this.W * 0.03, t: top, b: this.H * 0.06 } : { l: this.W * 0.03, r: this.W * 0.04, t: top, b: this.H * 0.07 };
    const fit = fitView({ x0: -hw, x1: hw, z0: -hd, z1: hd, h: WH }, HOME_TH, HOME_PH, this.W, this.H, m);
    this.fitR = fit.r;
    this.pan = fit.pan;
    this.home = { tx, tz, th: HOME_TH, ph: HOME_PH, r: fit.r };
  }

  private setAway(on: boolean) {
    if (on === this.away) return;
    this.away = on;
    this.opts.onAway?.(on);
  }

  private apply() {
    const c = this.cam;
    this.camera.aspect = this.W / this.H;
    const sp = Math.sin(c.ph), cp = Math.cos(c.ph);
    this.camera.position.set(c.tx + c.r * sp * Math.sin(c.th), c.r * cp, c.tz + c.r * sp * Math.cos(c.th));
    this.camera.lookAt(c.tx, 0, c.tz);
    // The fitted view's offset, so the house sits in its box whatever the perspective does to it.
    this.camera.setViewOffset(this.W, this.H, this.pan[0], this.pan[1], this.W, this.H);
    this.camera.updateProjectionMatrix();
    this.sky?.view(Math.atan2(Math.sin(c.th - HOME_TH), Math.cos(c.th - HOME_TH)), Math.PI / 2 - c.ph);
    this.nMat.uniforms.uScale!.value = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.dirty = true;
  }

  private go(to: Cam, ms = FLY_MS) {
    if (this.opts.reduce || !ms) {
      this.cam = { ...to };
      this.tween = null;
      this.apply();
      return;
    }
    this.tween = { from: { ...this.cam }, to, t0: performance.now(), ms };
  }

  private roomView(id: string): Cam | null {
    const r = this.plan.rooms.find((x) => x.id === id);
    if (!r) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py, pw, ph] of r.parts) {
      x0 = Math.min(x0, px);
      y0 = Math.min(y0, py);
      x1 = Math.max(x1, px + pw);
      y1 = Math.max(y1, py + ph);
    }
    const fov = (this.camera.fov * Math.PI) / 180, asp = this.W / this.H;
    const w = (x1 - x0) / U, d = (y1 - y0) / U;
    const r0 = Math.max((d * 1.9) / 2 / Math.tan(fov / 2), (w * 1.8) / 2 / (Math.tan(fov / 2) * asp)) + 0.8;
    const turn = Math.atan2(Math.sin(this.cam.th - HOME_TH), Math.cos(this.cam.th - HOME_TH));
    return { tx: this.wx((x0 + x1) / 2), tz: this.wz((y0 + y1) / 2) + 0.1, th: HOME_TH + turn * 0.5, ph: 0.55, r: Math.max(3.4, r0) };
  }

  private clampR = (r: number) => Math.max(this.fitR * 0.2, Math.min(this.fitR * 1.6, r));

  private resize() {
    const W = Math.max(1, this.host.clientWidth), H = Math.max(1, this.host.clientHeight);
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.renderer.setSize(W, H, false);
    this.frameHome();
    if (!this.focusId && !this.tween) {
      this.cam = { ...this.home };
      this.setAway(false);
    }
    else if (this.focusId) this.cam = this.roomView(this.focusId) ?? this.cam;
    this.apply();
  }

  /* ── pointer: drag to orbit, wheel or pinch to zoom, tap a room ── */
  private bind() {
    const cv = this.renderer.domElement;
    cv.style.touchAction = "none";
    const ptrs = new Map<number, [number, number]>();
    let down: { moved: number } | null = null, pinch: { d: number; r: number } | null = null;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    const pick = (cx: number, cy: number) => {
      const rc = cv.getBoundingClientRect();
      ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return roomAt(this.plan, hit.x * U + this.plan.w / 2, hit.z * U + this.plan.h / 2)?.id ?? null;
    };
    const on = <K extends keyof HTMLElementEventMap>(k: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      cv.addEventListener(k, f as EventListener, o);
      this.disposers.push(() => cv.removeEventListener(k, f as EventListener));
    };
    on("pointerdown", (e) => {
      if (this.backdrop) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      cv.setPointerCapture?.(e.pointerId);
      this.lastUser = performance.now();
      this.tween = null;
      if (ptrs.size === 1) down = { moved: 0 };
      else {
        const [a, b] = [...ptrs.values()] as [[number, number], [number, number]];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), r: this.cam.r };
        down = null;
      }
    });
    on("pointermove", (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) {
        if (e.pointerType === "mouse" && !this.backdrop) {
          const id = pick(e.clientX, e.clientY);
          if (id !== this.hover) {
            this.hover = id;
            this.opts.onHover?.(id);
            this.dirty = true;
          }
          cv.style.cursor = id ? "pointer" : "grab";
        }
        return;
      }
      const dx = e.clientX - p[0], dy = e.clientY - p[1];
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      this.lastUser = performance.now();
      if (ptrs.size >= 2 && pinch) {
        const [a, b] = [...ptrs.values()] as [[number, number], [number, number]];
        this.cam.r = this.clampR((pinch.r * pinch.d) / Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1])));
        this.apply();
        if (!this.focusId) this.setAway(true);
        return;
      }
      if (down) {
        down.moved += Math.abs(dx) + Math.abs(dy);
        if (down.moved > 6) {
          this.cam.th -= dx * 0.0055;
          this.cam.ph = Math.max(0.03, Math.min(1.2, this.cam.ph - dy * 0.0045));
          this.apply();
          if (!this.focusId) this.setAway(true);
          cv.style.cursor = "grabbing";
        }
      }
    });
    const up = (e: PointerEvent) => {
      const was = down;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (was && was.moved <= 6 && e.type === "pointerup") this.opts.onPick(pick(e.clientX, e.clientY));
      down = null;
      cv.style.cursor = "";
    };
    on("pointerup", up);
    on("pointercancel", up);
    on("pointerleave", (e) => {
      if (e.pointerType === "mouse" && this.hover) {
        this.hover = null;
        this.opts.onHover?.(null);
        this.dirty = true;
      }
    });
    on(
      "wheel",
      (e) => {
        if (this.backdrop) return;
        e.preventDefault();
        this.lastUser = performance.now();
        this.tween = null;
        this.cam.r = this.clampR(this.cam.r * Math.exp(e.deltaY * 0.0012));
        this.apply();
        if (!this.focusId) this.setAway(true);
      },
      { passive: false },
    );
  }

  /* ── the page's calls ── */

  /** Which rooms are lit, and the facts their labels carry. */
  setLit(lit: Record<string, Lit>, facts: Record<string, RoomFacts>, tags: Partial<Record<Spot, string>>) {
    const changed = JSON.stringify(Object.keys(lit).sort().map((k) => [k, lit[k]!.needs, lit[k]!.level])) !== JSON.stringify(Object.keys(this.lit).sort().map((k) => [k, this.lit[k]!.needs, this.lit[k]!.level]));
    this.lit = lit;
    if (changed) this.assign();
    for (const l of this.labels) {
      if (l.room) {
        const on = lit[l.room];
        l.el.classList.toggle("is-lit", !!on);
        l.el.classList.toggle("is-needs", !!on?.needs);
        l.el.querySelector("em")!.textContent = facts[l.room]?.fact ?? "";
      } else if (l.spot) {
        const tag = tags[l.spot];
        l.el.querySelector("span")!.textContent = tag ?? "";
        l.el.classList.toggle("has-tag", !!tag);
      }
    }
    this.dirty = true;
  }

  /** Fly to a room (null: back to the whole house). */
  focus(id: string | null) {
    if (id === this.focusId) return;
    this.focusId = id;
    const to = id ? this.roomView(id) : this.home;
    if (!id) this.setAway(false);
    if (to) this.go(to);
  }

  /** Back to the fitted default view. */
  resetView() {
    this.focusId = null;
    this.lastUser = performance.now();
    this.setAway(false);
    this.go(this.home, 450);
  }

  /** While the room's content is open over the house: no input, and a slow drift. */
  setBackdrop(on: boolean) {
    this.backdrop = on;
    this.renderer.domElement.style.pointerEvents = on ? "none" : "";
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible || document.visibilityState === "hidden") return;
    if (!this.backdrop) this.sky?.frame(now);
    if (this.tween) {
      const f = Math.min(1, (now - this.tween.t0) / this.tween.ms), e = ease(f);
      const { from, to } = this.tween;
      let dth = to.th - from.th;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      this.cam = { tx: from.tx + (to.tx - from.tx) * e, tz: from.tz + (to.tz - from.tz) * e, ph: from.ph + (to.ph - from.ph) * e, r: from.r + (to.r - from.r) * e, th: from.th + dth * e };
      this.apply();
      if (f >= 1) this.tween = null;
    } else if (!this.opts.reduce && (this.backdrop || (!this.focusId && now - this.lastUser > 4000))) {
      this.cam.th += (this.backdrop ? 0.03 : 0.012 * Math.sin((now - this.t0) / 7000)) * dt;
      this.apply();
    }
    // The lamps ease to their rooms' levels.
    let moving = false;
    for (const r of this.plan.rooms) {
      const want = this.lit[r.id] ? 0.35 + 0.65 * this.lit[r.id]!.level : 0;
      const was = this.litNow.get(r.id) ?? 0;
      const nowL = this.opts.reduce ? want : was + (want - was) * Math.min(1, dt * 6);
      if (Math.abs(nowL - was) > 0.001) moving = true;
      this.litNow.set(r.id, nowL);
    }
    if (this.opts.reduce && !this.dirty && !moving) return;
    const t = this.opts.reduce ? 2.5 : (now - this.t0) / 1000;
    this.updateLights(t);
    this.step(t);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.dirty = false;
  };

  private updateLights(t: number) {
    const ranked = this.plan.rooms.map((r) => ({ r, v: this.litNow.get(r.id) ?? 0 })).filter((x) => x.v > 0.01).sort((a, b) => b.v - a.v);
    this.lights.forEach((l, i) => {
      const x = ranked[i];
      if (!x) return void (l.intensity = 0);
      const [cx, cy] = centreOf(x.r);
      l.position.set(this.wx(cx), WH * 0.95, this.wz(cy));
      l.color.setHex(this.lit[x.r.id]?.needs ? LIGHT.needs : LIGHT.lamp);
      l.intensity = x.v * 5 * (1 + 0.04 * Math.sin(t * 2 + i));
    });
    this.pools.forEach((m, i) => {
      const id = m.userData.room as string;
      const v = this.litNow.get(id) ?? 0;
      this.poolMat[i]!.opacity = v * 0.32;
      this.poolMat[i]!.color.setHex(this.lit[id]?.needs ? LIGHT.needs : LIGHT.lamp);
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers.splice(0)) d();
    this.sky?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelHost.replaceChildren();
  }
}

/** For the page: can this browser draw it at all? */
export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
