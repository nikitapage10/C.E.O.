import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SIGILS } from "@ceo/engine/sigils/sigils.ts";
import { islandGlowOn, studioGreenOf } from "./fixtures.ts";
import { centreOf, roomAt, type HavenPlan, type Lit, type PlanRoom, type Seg, type Spot } from "./data.ts";
import { makeNight, type Night } from "./night.ts";
import { makeSurroundings, nearFor, STOREY, type Box2 } from "./surroundings.ts";
import { THREAD_TO, threadPoint, type GaugeId, type Tone } from "./plinth.ts";
import { FLOOR_PAINT, KIND_STYLE, LIGHT } from "./style.ts";
import { gymBeyond, gymRoom, withGym } from "./gymFill.ts";
import { emittersOf, type EmitterIn } from "./emitters.ts";
import { disposeMats, GYM_MODELS, GymGeo, gymMats, gymModel } from "./gymKit.ts";
import { CatBrain, navGrid, type CatSignals } from "./catBrain.ts";
import { BALCONY_DOOR, furnish } from "./furnish.ts";
import type { Light } from "./lights.ts";
import { drawList, RealLights } from "./realLights.ts";
import { dayLevel, sunAt } from "./daylight.ts";
import { SURROUND_LABELS, type PlanLight } from "../../../api/_haven/planShape.ts";
import { deviceModel, disposeHomeMats, HOME_MODELS, homeMats, homeModel, STUDIO_GREEN, type HomeMats } from "./homeKit.ts";
import type { HouseCat } from "./myshkaHouse.ts";
import { registerShotRender } from "@ceo/engine/web/screenshot.ts";
import { wasdPan, type WasdPan } from "@ceo/engine/web/wasdPan.ts";
import { dprGuard, sceneDpr } from "@ceo/engine/web/phone.ts";

/**
 * The Haven's house in 3D (#616): a generic renderer for whatever floor plan the private store holds. Nikita's round-6
 * pick, a blend of two concepts: the night interior (grey wood, white and black furniture, lamp pools, green LEDs,
 * night windows) seen through frosted-glass walls, where only the rooms with something going on are lit and the quiet
 * ones stay dim. Sigil nanites (the code-and-rune glyphs Ilyr is built from, relay/sigils.ts) hang in the glass of the
 * lit rooms, drift up in their light, rise off the devices that are working and swarm the ones that need Nikita.
 *
 * Starts on a high three-quarter view fitted to the plan (#1076: about 45° up, looking down over the whole home from the
 * hall's side toward the studio, the Gym block at the top), after a quick fly-up from beside the building, one unit up on an upper floor of a courtyard block with a street, a park and a boulevard round it
 * (surroundings.ts, #1007, #1035), on a
 * Denver plain under its sky (night.ts, #665), all in the one scene; drag to orbit, pinch or
 * scroll to zoom, tap a room to fly in (300 ms), and `resetView` comes back to the fitted view. Reduced motion: every move is
 * instant and the frame is still (drawn only when something changes). Loaded lazily, with three from the Lattice's own
 * chunk, and only for a passkey session with a plan.
 *
 * Real light (#974): by day the house is lit by the sun over Denver (daylight.ts), at night by its lights alone. Once
 * the lights are read (setLights), only the placed lights that are really on light the rooms (realLights.ts: a floor
 * lamp's LED line, an under-light's glow, soft light over a ceiling light's area), and the Studio's while Nikita is on the Desk from a desktop;
 * before that, or without the lights' keys, the rooms with something going on glow as they did. The scene keeps one
 * fixed set of point lights whatever is on (a change in their number rebuilds every shader, a visible flash).
 */

export interface HouseOpts {
  reduce: boolean;
  onPick: (room: string | null) => void;
  onHover?: (room: string | null) => void;
  /** The camera has left the default view (a drag or a zoom), or come back to it. */
  onAway?: (away: boolean) => void;
  /** A device's marker was tapped (the Nest's opens the climate control, #671). */
  onSpot?: (spot: Spot) => void;
  /** Play the opening fly-up (#1076): once per open of the Haven, the page decides; never under reduced motion. */
  intro?: boolean;
  /** Pixels at the top of the house's box to keep clear on a narrow screen (the page's heading sits there). */
  clearTop?: () => number;
  /** A box (px, in the house's own frame) the fitted view keeps the rooms out of: the instrument strip (#680). */
  keepClear?: () => { x: number; y: number; w: number; h: number } | null;
  /** Where a gauge's lamp is (px, in the house's own frame), for its thread; null when it's out of sight. */
  lampAt?: (id: GaugeId) => [number, number] | null;
  /** The gauges in the order their threads land, left to right in the fitted view (#718), so the strip can follow it. */
  onOrder?: (ids: GaugeId[]) => void;
  /** The gauges stand in a rail down the side (#729): ordered top to bottom, their threads leave the lamps sideways. */
  rail?: () => boolean;
}

/** A gauge's thread (#680): its lamp's tone and how busy its nanites are (0 to 1). */
export interface ThreadState {
  id: GaugeId;
  tone: Tone;
  level: number;
  /** Its own colour ("r,g,b"), for a thread whose reading has one: the climate's heat or cool (#718). */
  rgb?: string;
}

export interface RoomFacts {
  /** The room's short line under its name: "vacuum running", "3 to get". */
  fact?: string;
}

const U = 100; // plan units per world unit
/** The point lights the house has, whatever is on (#974: a fixed count; a change rebuilds every shader). */
const LAMPS = 8;
const DAY_SKY = new THREE.Color(0xe6eefa);
const DAY_GROUND = new THREE.Color(0x4a4540);
const WH = 1.4; // wall height, in step with the furniture (#806): a little taller than #671's 1.15 for the 12 ft ceilings
const SILL = WH * 0.25, WIN_TOP = WH * 0.92; // windows run from a 3 ft sill to a foot below the wall top, never past it
const DOOR_H = WH * 0.71; // a balcony door: floor to ~8.5 ft of a 12 ft wall
const T = 0.06; // wall thickness
const FLY_MS = 300;
const GLYPHS = SIGILS.slice(0, 64);

/** The orbit: target (tx, tz, and `ly` above the floor, 0 unless a view looks up), turn, tilt from straight down, distance. */
export type Cam = { tx: number; tz: number; th: number; ph: number; r: number; ly?: number };

/**
 * The standard view (#1076, Nikita's pick): a high three-quarter view, the camera on the hall's side of the home looking
 * across it toward the studio, the Gym block at the top of the frame, about 45° above the floor. "Reset view" comes back
 * here too.
 */
export const HOME_TH = -0.82;
export const HOME_PH = 0.8;
/**
 * The opening fly-up (#1076): a short hold on the street view (long enough for the room loader's cover to fade off it),
 * then a quick ease-out rise into the standard view.
 */
export const RISE_HOLD_MS = 550;
export const RISE_MS = 1900;

/**
 * Where the fly-up starts (#1076): low beside the building, a little round from the standard view's turn, nearly level,
 * looking along the street face of the block across to the home, so the rise reads as coming up from the street.
 */
export function riseFrom(home: Cam): Cam {
  return { ...home, th: home.th - 0.12, ph: 1.37, r: home.r * 0.82, ly: 0 };
}
const FOV = 30;
type V3 = [number, number, number];

/**
 * Fit a box (the plan's rooms, floor to wall tops, in world units round the orbit target) into a W×H frame at a given
 * orbit angle: the camera distance that makes its projection fill the inner box (the frame less its margins, in px),
 * and the view offset (px) that centres the projection there. Perspective makes the near end bigger, so the box's
 * picture is off-centre round the target; the offset puts it back without moving the orbit's pivot.
 */
export function fitView(box: { x0: number; x1: number; z0: number; z1: number; h: number; corners?: [number, number][] }, th: number, ph: number, W: number, H: number, m: { l: number; r: number; t: number; b: number }) {
  const tan = Math.tan((FOV * Math.PI) / 360);
  const d: V3 = [Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)];
  const f: V3 = [-d[0], -d[1], -d[2]];
  // right = f × (0,1,0), up = right × f
  const rl = Math.hypot(f[2], f[0]) || 1;
  const rt: V3 = [-f[2] / rl, 0, f[0] / rl];
  const up: V3 = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pts: V3[] = [];
  // The rooms' own corners when given (an L-shaped or split plan leaves its bounding box's corners empty), else the box's.
  const flat: [number, number][] = box.corners?.length ? box.corners : [[box.x0, box.z0], [box.x0, box.z1], [box.x1, box.z0], [box.x1, box.z1]];
  for (const [x, z] of flat) for (const y of [0, box.h]) pts.push([x, y, z]);
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

/** The walls: every room part's edges, merged where they run together, with the doors and balcony doors cut out. Generic. */
/** Storeys of the building under the home (#1035): it is up on an upper floor, the ground and the street well below. */
export const STOREYS_BELOW = 5;

/**
 * The front door (#1035): a door with a room of the home on one side and nothing of the home on the other, a hall's
 * first; with the way out from it, a unit step in plan (and world) axes. Null when the plan has none.
 */
/**
 * Which side the courtyard is on (#1040, #1044): the side its living room's balcony door faces (the balcony looks onto
 * the courtyard), the long street across the home from it. East when there is no balcony to go by.
 */
export function courtyardEast(plan: HavenPlan, x0: number, x1: number): boolean {
  const living = plan.rooms.find((r) => !r.detached && /\bliving\b/i.test(r.name));
  const own = (s: Seg) => !living || living.parts.some(([px, py, w, h]) => s[0] >= px - 6 && s[0] <= px + w + 6 && s[1] >= py - 6 && s[1] <= py + h + 6);
  const xs = plan.balconies.filter((s) => s[0] === s[2] && own(s)).map((s) => s[0]);
  if (!xs.length) return true;
  const mid = (x0 + x1) / 2;
  // A balcony on the east half puts the courtyard east, the street west.
  return xs.reduce((a, b) => a + b, 0) / xs.length > mid;
}

export function frontDoor(plan: HavenPlan): { seg: Seg; out: [number, number] } | null {
  const home = plan.rooms.filter((r) => !r.detached);
  const roomAt = (x: number, y: number) => home.find((r) => r.parts.some(([px, py, w, h]) => x > px && x < px + w && y > py && y < py + h));
  const found: { seg: Seg; out: [number, number]; hall: boolean }[] = [];
  for (const d of plan.doors) {
    const hz = d[1] === d[3];
    if (!hz && d[0] !== d[2]) continue;
    const mx = (d[0] + d[2]) / 2, my = (d[1] + d[3]) / 2;
    for (const k of [-1, 1]) {
      const out: [number, number] = hz ? [0, k] : [k, 0];
      const inner = roomAt(mx - out[0] * 12, my - out[1] * 12);
      if (inner && !roomAt(mx + out[0] * 12, my + out[1] * 12)) found.push({ seg: d, out, hall: /\b(hall|hallway|entry|foyer|corridor)\b/i.test(inner.name) });
    }
  }
  const pick = found.find((f) => f.hall) ?? found[0];
  return pick ? { seg: pick.seg, out: pick.out } : null;
}

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
    for (const d of [...plan.doors, ...(plan.balconies ?? [])]) if (d[1] === y && d[3] === y) l = cut(l, [Math.min(d[0], d[2]), Math.max(d[0], d[2])]);
    for (const s of l) if (s[1] - s[0] > 1) out.push([s[0], y, s[1], y]);
  }
  for (const [x, l0] of V) {
    let l = merge(l0);
    for (const d of [...plan.doors, ...(plan.balconies ?? [])]) if (d[0] === x && d[2] === x) l = cut(l, [Math.min(d[1], d[3]), Math.max(d[1], d[3])]);
    for (const s of l) if (s[1] - s[0] > 1) out.push([x, s[0], x, s[1]]);
  }
  return out;
}

/**
 * Where the kitchen is looked at from (#747): the camera's turn that puts it on the side of the main bedroom, so the
 * room-focus view reads like walking out of the bedroom toward the hall and the kitchen. Null for any other room, or
 * when the plan has no bedroom.
 */
export function kitchenFrom(plan: HavenPlan, room: PlanRoom): number | null {
  if (room.tab !== "kitchen" && !/\bkitchen\b/i.test(room.name)) return null;
  const beds = plan.rooms.filter((r) => !r.detached && /\b(master|bed)/i.test(r.name) && !/\bbath/i.test(r.name));
  if (!beds.length) return null;
  const [kx, ky] = centreOf(room);
  const bed = beds.find((r) => /\bmaster|primary/i.test(r.name)) ?? beds.reduce((a, b) => (Math.hypot(...sub(centreOf(b), [kx, ky])) < Math.hypot(...sub(centreOf(a), [kx, ky])) ? b : a));
  const [bx, by] = centreOf(bed);
  // The camera sits at the target plus (sin th, cos th) in world x and z, which run with the plan's x and y.
  return Math.atan2(bx - kx, by - ky);
}
const sub = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];

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
type Role = { k: "dust"; room: PlanRoom; level: number } | { k: "wall"; seg: Seg; needs: boolean } | { k: "rise"; x: number; y: number; lift: number; spread: number } | { k: "swarm"; x: number; y: number; spread: number } | { k: "path" } | { k: "field" };

const fract = (v: number) => v - Math.floor(v);
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

export class House {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 2600);
  private scene = new THREE.Scene();
  private world = new THREE.Group();
  private cam: Cam = { tx: 0, tz: 0, th: 0, ph: 0.3, r: 12 };
  private home: Cam = { tx: 0, tz: 0, th: 0, ph: 0.3, r: 12 };
  private fitR = 12;
  private pan: [number, number] = [0, 0];
  private away = false;
  private night: Night | null = null;
  /** The courtyard block, the street and the rest round the home (#1007, surroundings.ts). */
  private around: ReturnType<typeof makeSurroundings> | null = null;
  private tween: { from: Cam; to: Cam; t0: number; ms: number; intro?: boolean } | null = null;
  private W = 1;
  private H = 1;
  private raf = 0;
  private guard: { frame: (now: number) => void };
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
  /** The real lights (#974), drawn once they are read; null until then (the rooms' activity glow stands in). */
  private real: RealLights | null = null;
  private realOn = false;
  private hemi!: THREE.HemisphereLight;
  private moon!: THREE.DirectionalLight;
  private sun!: THREE.DirectionalLight;
  /** Daylight now (eased) and wanted, 0 night to 1 day, and when the sun was last looked up. */
  private dayNow = -1;
  private dayWant = 0;
  private dayAt = -1e9;
  /** Placing a light (#974): the next tap on the floor is its spot. */
  private placing: { name: string; onPlace: (x: number, y: number) => void } | null = null;
  /** The drawn plan's offset from the stored one (the Gym moved out back shifts the home, gymFill.ts gymBeyond). */
  private shift: [number, number] = [0, 0];
  /** On a desktop, not a phone: the Studio's light is taken as on (#974). */
  private desk = false;
  private gymLights: THREE.PointLight[] = [];
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
  /** The gauges' threads (#680): a 2D layer over the scene, from each lamp on the strip to its device. */
  private thr = document.createElement("canvas");
  private thrCtx: CanvasRenderingContext2D | null = null;
  private threads: ThreadState[] = [];
  private ends = new Map<GaugeId, THREE.Vector3>();
  private dot: HTMLCanvasElement | null = null;
  private tints = new Map<string, HTMLCanvasElement>();
  /** Myshka (#729): where he's going (catBrain.ts), and his body once its model is in (myshkaHouse.ts, lazy). */
  private catBrain: CatBrain | null = null;
  private cat: HouseCat | null = null;
  private gone = false;
  /** WASD to look around (#776): a pan over the plan, Q/E to turn. */
  private wasd!: WasdPan;

  constructor(
    private host: HTMLElement,
    private labelHost: HTMLElement,
    private plan: HavenPlan,
    private opts: HouseOpts,
  ) {
    // The Gym drawn filled out (#718): whatever of the kit the plan doesn't place, placed in its free floor.
    // Drawn beyond the home (#729), at the top of the default view, not in front of it.
    // The main rooms dressed from their own walls (#747, furnish.ts), before the Gym is moved out back.
    this.plan = withGym(gymBeyond(furnish(plan)));
    const main = plan.rooms.find((r) => !r.detached), drawn = main && this.plan.rooms.find((r) => r.id === main.id);
    if (main && drawn) this.shift = [main.parts[0]![0] - drawn.parts[0]![0], main.parts[0]![1] - drawn.parts[0]![1]];
    const phone = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.desk = !phone && !(typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
    this.N = phone ? 700 : 1400;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    // At most 2x on a phone, stepped down while frames run slow (the engine's sceneDpr and dprGuard, #1070), 1.75x on
    // a small landscape screen, 2x on a desktop.
    this.renderer.setPixelRatio(sceneDpr(phone ? 1.75 : 2));
    this.guard = dprGuard((d) => {
      this.renderer.setPixelRatio(d);
      this.thr.width = Math.round(this.W * d);
      this.thr.height = Math.round(this.H * d);
      this.dirty = true;
    }, phone ? 1.75 : 2);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = "hv-gl";
    host.appendChild(this.renderer.domElement);
    // A picture of the page for Skippy (#1027, look_at_screen): drawn right before it is read, even when the house is idle.
    this.disposers.push(registerShotRender(this.renderer.domElement, () => this.renderer.render(this.scene, this.camera)));
    this.thr.className = "hv-thr";
    this.thr.setAttribute("aria-hidden", "true");
    host.appendChild(this.thr);
    this.thrCtx = this.thr.getContext("2d");
    for (const [id, to] of Object.entries(THREAD_TO) as [GaugeId, (typeof THREAD_TO)[GaugeId]][]) {
      const p = threadPoint(this.plan, to);
      if (p) this.ends.set(id, new THREE.Vector3(this.wx(p[0]), p[2] / U, this.wz(p[1])));
    }
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
    this.walls = wallsOf(this.plan);
    this.wasd = wasdPan({ el: host, reduce: opts.reduce, enabled: () => !this.backdrop, bounds: () => ({ kind: "box", x0: this.wx(0), x1: this.wx(this.plan.w), z0: this.wz(0), z1: this.wz(this.plan.h) }), origin: () => [this.cam.tx, this.cam.tz], forward: () => [-Math.sin(this.cam.th), -Math.cos(this.cam.th)], rotate: (d) => (this.stopIntro(), (this.tween = null), (this.cam.th += d), (this.lastUser = performance.now())) });
    this.disposers.push(() => this.wasd.dispose());
    this.build();
    this.startCat();
    this.bind();
    this.resize();
    this.cam = { ...this.home };
    // The opening fly-up (#1076): the camera starts low beside the building and rises quickly into the standard view.
    // Once per open of the Haven (the page says when, `intro`); reduced motion starts on the standard view. Any drag,
    // pinch, scroll, tap or key hands the camera straight over (stopIntro).
    if (!opts.reduce && opts.intro) {
      this.cam = riseFrom(this.home);
      this.tween = { from: { ...this.cam }, to: this.home, t0: -1, ms: RISE_MS, intro: true };
    }
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
    // Night: a dim cool sky and a low moon, so quiet rooms stay legible but dark. By day (#974) the sky brightens and
    // the sun comes up; both lights are always there, only their strength changes (no shader rebuild at dusk).
    this.hemi = new THREE.HemisphereLight(0x8890b0, 0x0a0a0c, 0.55);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9fb2ff, 0.35);
    this.moon.position.set(-4, 9, 3);
    this.scene.add(this.moon);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 0);
    this.scene.add(this.sun);
    // A few lamps, moved to whichever rooms (or real lights) are lit: a fixed count, so no shader rebuilds.
    for (let i = 0; i < LAMPS; i++) {
      const l = new THREE.PointLight(LIGHT.lamp, 0, 4.2, 1.6);
      l.position.set(0, WH * 0.95, 0);
      this.scene.add(l);
      this.lights.push(l);
    }
    this.world.add(this.floor());
    // The block round the home first (surroundings.ts), then the Denver night round that: the plain, the city's lights
    // (none on the block's own streets and roofs, where they'd sit on its surfaces and flicker, #1020), the range, the sky.
    const b = this.roomBounds();
    const around = this.surroundings();
    const rooms = { x0: this.wx(b[0]), x1: this.wx(b[2]), z0: this.wz(b[1]), z1: this.wz(b[3]) };
    this.night = makeNight({
      centre: [this.wx((b[0] + b[2]) / 2), this.wz((b[1] + b[3]) / 2)],
      keep: around ? { x0: Math.min(rooms.x0, around.x0), x1: Math.max(rooms.x1, around.x1), z0: Math.min(rooms.z0, around.z0), z1: Math.max(rooms.z1, around.z1) } : rooms,
      west: Math.atan2(-Math.sin(HOME_TH), -Math.cos(HOME_TH)),
      phone: Math.min(window.innerWidth, window.innerHeight) < 600,
    });
    // The plain and its lights down at the street, under the upper floor the home is on (#1035).
    this.night.group.position.y = -STOREYS_BELOW * STOREY;
    this.scene.add(this.night.group);
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
    this.balconies();
    this.furniture();
    this.devices();
    this.lightPools();
    this.real = new RealLights(this.wx, this.wz);
    this.world.add(this.real.group);
    this.nanites();
    this.buildLabels();
  }

  /**
   * The home as one unit of a courtyard block (#1007): the block's roofs on every side the home's rooms, decks and
   * walk don't take, the courtyard on the side its balconies face, the street on the other (surroundings.ts).
   */
  private surroundings(): Box2 | null {
    const P = this.plan;
    const W = (x0: number, y0: number, x1: number, y1: number): Box2 => ({ x0: this.wx(Math.min(x0, x1)), z0: this.wz(Math.min(y0, y1)), x1: this.wx(Math.max(x0, x1)), z1: this.wz(Math.max(y0, y1)) });
    const keep: Box2[] = P.rooms.flatMap((r) => r.parts.map(([x, y, w, h]) => W(x, y, x + w, y + h)));
    for (const [x1, y1, x2, y2] of [...(P.decks ?? []), ...P.balconies]) keep.push(W(Math.min(x1, x2) - 140, Math.min(y1, y2) - 140, Math.max(x1, x2) + 140, Math.max(y1, y2) + 140));
    P.path.forEach(([x, y], i) => {
      const n = P.path[i + 1];
      if (n) keep.push(W(Math.min(x, n[0]) - 20, Math.min(y, n[1]) - 20, Math.max(x, n[0]) + 20, Math.max(y, n[1]) + 20));
    });
    const home = P.rooms.filter((r) => !r.detached).flatMap((r) => r.parts);
    if (!home.length) return null;
    const hx0 = Math.min(...home.map((p) => p[0])), hx1 = Math.max(...home.map((p) => p[0] + p[2]));
    const hy0 = Math.min(...home.map((p) => p[1])), hy1 = Math.max(...home.map((p) => p[1] + p[3]));
    // The home as it sits in its building (#1035, #1040, #1044): the courtyard on the side its living room's balcony
    // faces, the long street on the other, up on an upper floor; its front door off a small entrance alcove.
    const door = frontDoor(P);
    let alcove: { x: number; z: number; out: [number, number]; w: number } | undefined;
    if (door) {
      const [x0, y0, x1, y1] = door.seg;
      alcove = { x: this.wx((x0 + x1) / 2), z: this.wz((y0 + y1) / 2), out: door.out, w: Math.hypot(x1 - x0, y1 - y0) / U };
      const pts = [-1, 1].flatMap((k) => [0, 1.1].map((v) => [alcove!.x - door.out[1] * k * (alcove!.w / 2 + 0.35) + door.out[0] * v, alcove!.z + door.out[0] * k * (alcove!.w / 2 + 0.35) + door.out[1] * v]));
      keep.push({ x0: Math.min(...pts.map((p) => p[0]!)), z0: Math.min(...pts.map((p) => p[1]!)), x1: Math.max(...pts.map((p) => p[0]!)), z1: Math.max(...pts.map((p) => p[1]!)) });
    }
    this.around = makeSurroundings({ home: W(hx0, hy0, hx1, hy1), keep, east: courtyardEast(P, hx0, hx1), phone: Math.min(window.innerWidth, window.innerHeight) < 600, wallH: WH, below: STOREYS_BELOW, door: alcove });
    this.world.add(this.around.group);
    return this.around.bounds;
  }

  /** Myshka, loaded after the house: a failed load just leaves the house without him. */
  private startCat() {
    this.catBrain = new CatBrain(navGrid(this.plan, this.walls), this.plan, this.opts.reduce);
    void import("./myshkaHouse.ts")
      .then((m) => m.loadHouseCat())
      .then((cat) => {
        if (this.gone) return cat.dispose();
        this.cat = cat;
        this.world.add(cat.group);
        this.host.dataset.cat = "on";
        // Reduced motion: settle him into his loaf once, then he stays as drawn.
        if (this.opts.reduce) for (let i = 0; i < 90; i++) this.poseCat(2.5, 1 / 30);
        this.dirty = true;
      })
      .catch(() => undefined);
  }

  private poseCat(t: number, dt: number) {
    if (!this.cat || !this.catBrain) return;
    this.cat.update(this.catBrain.update(performance.now(), dt), t, dt, (x, y) => [this.wx(x), this.wz(y)], U);
  }

  /** What the pets' devices say (#729): a feed sends Myshka to the feeders, a Litter-Robot cycle to the litter. */
  setCat(s: CatSignals) {
    this.catBrain?.setSignals(s);
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
        } else if (paint.grain === "rubber") {
          // Gym tiles (#718): metre squares with fine seams and a fleck of colour.
          for (let k = 0; k < (w * h) / 40; k++) {
            c.fillStyle = rnd() < 0.15 ? `rgba(120,140,170,${0.25 + rnd() * 0.2})` : `rgba(255,255,255,${0.02 + rnd() * 0.05})`;
            c.fillRect(x + rnd() * w, y + rnd() * h, 1.6, 1.6);
          }
          c.strokeStyle = "rgba(0,0,0,.45)";
          c.lineWidth = 1.2;
          for (let xx = x; xx < x + w; xx += 100) c.strokeRect(xx, y, 100, h);
          for (let yy = y; yy < y + h; yy += 100) c.strokeRect(x, yy, w, 100);
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
      if (it.k === "lrug") {
        // White with a soft grey border and a faint grey weave (#1057).
        c.fillRect(it.x, it.y, it.w, it.h);
        const b = Math.min(it.w, it.h) * 0.06;
        c.strokeStyle = "#9c9da1";
        c.lineWidth = b * 0.5;
        c.strokeRect(it.x + b, it.y + b, it.w - 2 * b, it.h - 2 * b);
        c.fillStyle = "rgba(120,122,128,0.10)";
        for (let gx = it.x + 2 * b; gx < it.x + it.w - 2 * b; gx += 10) c.fillRect(gx, it.y + 2 * b, 1.2, it.h - 4 * b);
        continue;
      }
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
    const tall = this.plan.tall ?? [];
    for (const w of this.plan.windows) {
      const hz = w[1] === w[3];
      const L = (hz ? Math.abs(w[2] - w[0]) : Math.abs(w[3] - w[1])) / U;
      // A tall window (#1022) is one pane from just over the floor.
      const high = tall.some((t) => t.every((v, i) => v === w[i]));
      const sill = high ? WH * 0.04 : SILL;
      const n = high ? 1 : Math.max(1, Math.round(L / 0.5)), seg = L / n;
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        list.push({ x: this.wx(w[0] + (w[2] - w[0]) * f), y: (sill + WIN_TOP) / 2, z: this.wz(w[1] + (w[3] - w[1]) * f), sx: hz ? seg - 0.02 : T + 0.012, sy: WIN_TOP - sill, sz: hz ? T + 0.012 : seg - 0.02 });
      }
    }
    this.disposers.push(() => (mat.dispose(), tex.dispose()));
    if (list.length) this.world.add(this.instanced(new THREE.BoxGeometry(1, 1, 1), mat, list, 2));
  }

  private furniture() {
    const groups = new Map<string, { x: number; y: number; z: number; sx: number; sy: number; sz: number }[]>();
    this.gymKit();
    this.homeKit();
    for (const it of this.plan.items) {
      const st = KIND_STYLE[it.k];
      if (st.height <= 2 || GYM_MODELS.has(it.k) || HOME_MODELS.has(it.k)) continue;
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

  /**
   * Which wall a footprint backs onto (#747): the nearest side of the room part it stands in, and the turn that puts
   * a model's back (local +Z) against it. `along` and `into` are its size along that wall and out from it, in plan units.
   */
  private backing(x0: number, y0: number, x1: number, y1: number): { rot: number; along: number; into: number } {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const part = this.plan.rooms.flatMap((r) => r.parts).find(([x, y, pw, ph]) => cx >= x && cx < x + pw && cy >= y && cy < y + ph);
    const w = x1 - x0, h = y1 - y0;
    if (!part) {
      // Outside on a balcony (#1060: the patio set): its back against the outside wall it stands just beyond.
      const out: [number, number, number, number][] = [];
      for (const [px, py, pw, ph] of this.plan.rooms.filter((r) => !r.detached).flatMap((r) => r.parts)) {
        const overX = x1 > px && x0 < px + pw, overY = y1 > py && y0 < py + ph;
        if (overY && x1 <= px) out.push([px - x1, Math.PI / 2, h, w]);
        if (overY && x0 >= px + pw) out.push([x0 - px - pw, -Math.PI / 2, h, w]);
        if (overX && y1 <= py) out.push([py - y1, 0, w, h]);
        if (overX && y0 >= py + ph) out.push([y0 - py - ph, Math.PI, w, h]);
      }
      const near = out.filter((g) => g[0] <= 60).sort((a, b) => a[0] - b[0])[0];
      return near ? { rot: near[1], along: near[2], into: near[3] } : { rot: 0, along: w, into: h };
    }
    const [px, py, pw, ph] = part;
    // An edge where the same room carries on into another of its parts is no wall to back onto (#1060: the Studio's
    // left-hand screen by its nook).
    const room = this.plan.rooms.find((r) => r.parts.includes(part));
    const open = (s: "n" | "s" | "w" | "e") =>
      !!room?.parts.some(([qx, qy, qw, qh]) => {
        if (s === "n" || s === "s") return Math.abs(s === "n" ? qy + qh - py : qy - (py + ph)) <= 2 && qx < x1 && qx + qw > x0;
        return Math.abs(s === "w" ? qx + qw - px : qx - (px + pw)) <= 2 && qy < y1 && qy + qh > y0;
      });
    const gaps: [number, number, number, number][] = [
      [open("n") ? Infinity : y0 - py, Math.PI, w, h], // north
      [open("s") ? Infinity : py + ph - y1, 0, w, h], // south
      [open("w") ? Infinity : x0 - px, -Math.PI / 2, h, w], // west
      [open("e") ? Infinity : px + pw - x1, Math.PI / 2, h, w], // east
    ];
    const [, rot, along, into] = gaps.reduce((a, b) => (b[0] < a[0] ? b : a));
    return { rot, along, into };
  }

  private mats: HomeMats | null = null;

  /** The home's furniture, modelled (#747, homeKit.ts): cabinets and tops, appliances, sofas, baths, the cat's things. */
  private homeKit() {
    const M = (this.mats = homeMats());
    const G = new GymGeo(gymMats());
    this.disposers.push(() => (G.dispose(), disposeMats(G.mats), disposeHomeMats(M)));
    const all = new THREE.Group();
    for (const it of this.plan.items) {
      if (!HOME_MODELS.has(it.k)) continue;
      const st = KIND_STYLE[it.k];
      const [x0, y0, x1, y1] = it.round ? [it.x - it.w / 2, it.y - it.w / 2, it.x + it.w / 2, it.y + it.w / 2] : [it.x, it.y, it.x + it.w, it.y + it.h];
      const { rot, along, into } = this.backing(x0, y0, x1, y1);
      const m = homeModel(G, M, it.k, along / U, into / U, st.height / U, st.lift / U);
      if (!m) continue;
      m.position.set(this.wx((x0 + x1) / 2), 0, this.wz((y0 + y1) / 2));
      m.rotation.y = rot;
      // A round accent chair faces the coffee table it stands by (#1022), not the wall behind it.
      const table = it.k === "accent" ? this.plan.items.filter((t) => t.k === "ctable").sort((a, b) => Math.hypot(a.x - it.x, a.y - it.y) - Math.hypot(b.x - it.x, b.y - it.y))[0] : undefined;
      if (table) m.rotation.y = Math.atan2(-(this.wx(table.x + table.w / 2) - m.position.x), -(this.wz(table.y + table.h / 2) - m.position.z));
      if (m.userData.dispose) this.disposers.push(m.userData.dispose as () => void);
      all.add(m);
    }
    // One mesh a material: a few draw calls for the whole home's furniture, however many pieces it has.
    all.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    all.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
      const list = byMat.get(o.material as THREE.Material) ?? [];
      list.push(g.index ? g.toNonIndexed() : g);
      if (g.index) g.dispose();
      byMat.set(o.material as THREE.Material, list);
    });
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      this.disposers.push(() => merged.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = (mat as THREE.MeshStandardMaterial).transparent ? 3 : 1;
      this.world.add(mesh);
    }
  }

  /**
   * The balcony doors (#747): a tall glass door in a black frame with a transom over it, and the balcony beyond: a
   * slab on the side away from the rooms with a low glass rail round it. A wide balcony's wall is glazed like the other
   * rooms' (#860): its windows are drawn with theirs, the door is one of these, and its slab (`decks`) runs its width.
   */
  private balconies() {
    const list = this.plan.balconies ?? [];
    if (!list.length) return;
    const frame = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5 });
    const pane = new THREE.MeshStandardMaterial({ color: 0xb8c4dd, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, emissive: 0x16203a, emissiveIntensity: 0.6 });
    const slab = new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.9 });
    const rail = new THREE.MeshStandardMaterial({ color: 0xd8e6f0, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.disposers.push(() => (frame.dispose(), pane.dispose(), slab.dispose(), rail.dispose(), geo.dispose()));
    const box = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, order = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.scale.set(sx, sy, sz);
      o.position.set(x, y, z);
      o.renderOrder = order;
      this.world.add(o);
    };
    const decks = this.plan.decks ?? [];
    // A door no deck holds (a plan drawn before #860) gets a balcony just wider than itself.
    const holds = (d: Seg, s: Seg) => (s[1] === s[3] ? d[1] === s[1] && d[3] === s[1] && Math.min(d[0], d[2]) >= Math.min(s[0], s[2]) && Math.max(d[0], d[2]) <= Math.max(s[0], s[2]) : d[0] === s[0] && d[2] === s[0] && Math.min(d[1], d[3]) >= Math.min(s[1], s[3]) && Math.max(d[1], d[3]) <= Math.max(s[1], s[3]));
    const along = (s: Seg) => {
      const hz = s[1] === s[3];
      const a = hz ? Math.min(s[0], s[2]) : Math.min(s[1], s[3]), b = hz ? Math.max(s[0], s[2]) : Math.max(s[1], s[3]);
      const mid = (a + b) / 2, line = hz ? s[1] : s[0];
      // Outside: the side of the wall with no room.
      const probe = (d: number) => (hz ? roomAt(this.plan, mid, line + d) : roomAt(this.plan, line + d, mid));
      const out = probe(30) ? -1 : probe(-30) ? 1 : 1;
      const at = (t: number, off: number): [number, number] => (hz ? [this.wx(t), this.wz(line + off)] : [this.wx(line + off), this.wz(t)]);
      const put = (mat: THREE.Material, len: number, sy: number, dep: number, t: number, off: number, y: number, order = 0) => {
        const [x, z] = at(t, off);
        box(mat, hz ? len : dep, sy, hz ? dep : len, x, y, z, order);
      };
      return { a, b, mid, out, put };
    };
    for (const s of list) {
      const { a, b, mid, put } = along(s);
      const L = (b - a) / U;
      const H = DOOR_H, tr = DOOR_H * 0.86;
      // One single door (Nikita 2026-11-05, #935: single doors, never a pair, and one door wide): glass, a frame round
      // it, the transom bar. furnish.ts draws every balcony door that wide; an opening wider still gets a fixed glass
      // sidelight beside it, split off by a full-height mullion.
      put(pane, L, H, 0.012, mid, 0, H / 2, 3);
      for (const e of [a + 2, b - 2]) put(frame, 0.035, H, T + 0.02, e, 0, H / 2);
      put(frame, L, 0.035, T + 0.02, mid, 0, H);
      put(frame, L, 0.025, T + 0.02, mid, 0, tr);
      const leaf = Math.min(b - a, BALCONY_DOOR);
      if (b - a > leaf + 4) put(frame, 0.035, H, T + 0.02, a + leaf, 0, H / 2);
      // The handle, a tall bar near the door's free edge, so a door never reads as a window.
      put(frame, 0.03, WH * 0.12, 0.06, a + leaf - 8, 0, WH * 0.3);
    }
    // The balconies beyond.
    for (const s of [...decks, ...list.filter((d) => !decks.some((k) => holds(d, k)))]) {
      const { a, b, mid, out, put } = along(s);
      const dep = 120, wide = b - a + (b - a > 140 ? 24 : 80);
      put(slab, wide / U, 0.04, dep / U, mid, out * (dep / 2 + 3), -0.015);
      const RH = WH * 0.3; // the balcony rail: about waist height against the wall
      put(rail, wide / U, RH, 0.01, mid, out * (dep + 3), RH / 2, 3);
      put(frame, wide / U, 0.02, 0.025, mid, out * (dep + 3), RH);
      for (const e of [mid - wide / 2, mid + wide / 2]) put(rail, 0.01, RH, dep / U, e, out * (dep / 2 + 3), RH / 2, 3);
    }
  }

  /** The Gym's equipment, modelled (#718, gymKit.ts), and its own lights: a cool white overhead, always on. */
  private gymKit() {
    const mats = gymMats();
    const G = new GymGeo(mats);
    this.disposers.push(() => (G.dispose(), disposeMats(mats)));
    const bar = !this.plan.items.some((i) => i.k === "barbell");
    for (const it of this.plan.items) {
      if (!GYM_MODELS.has(it.k)) continue;
      const st = KIND_STYLE[it.k];
      const w = (it.round ? it.w : it.w) / U, d = (it.round ? it.w : it.h) / U;
      const along = w >= d;
      const m = gymModel(G, it.k, along ? w : d, along ? d : w, st.height / U, st.lift / U, bar);
      if (!m) continue;
      m.position.set(this.wx(it.round ? it.x : it.x + it.w / 2), 0, this.wz(it.round ? it.y : it.y + it.h / 2));
      // Its front (local -Z, where a rack holds its bar) faces into the room, away from the nearer wall.
      const cx = it.round ? it.x : it.x + it.w / 2, cy = it.round ? it.y : it.y + it.h / 2;
      const part = this.plan.rooms.flatMap((r) => r.parts).find(([x, y, pw, ph]) => cx >= x && cx < x + pw && cy >= y && cy < y + ph);
      const flip = part ? (along ? cy - part[1] < part[1] + part[3] - cy : cx - part[0] < part[0] + part[2] - cx) : false;
      m.rotation.y = (along ? 0 : Math.PI / 2) + (flip ? Math.PI : 0);
      this.world.add(m);
    }
    const room = gymRoom(this.plan);
    if (!room) return;
    const bar0 = new THREE.MeshBasicMaterial({ color: 0xf4f7ff });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.disposers.push(() => (bar0.dispose(), geo.dispose()));
    for (const [x, y, w, h] of room.parts) {
      const along = w >= h;
      const n = Math.max(1, Math.round((along ? w : h) / 220));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        const px = along ? x + w * f : x + w / 2, py = along ? y + h / 2 : y + h * f;
        // A linear ceiling light, drawn bright, and a point light under it.
        for (const off of [-0.25, 0.25]) {
          const strip = new THREE.Mesh(geo, bar0);
          strip.scale.set(along ? 0.5 : 0.04, 0.015, along ? 0.04 : 0.5);
          strip.position.set(this.wx(px) + (along ? 0 : (off * h) / U), WH - 0.02, this.wz(py) + (along ? (off * h) / U : 0));
          strip.renderOrder = 4;
          this.world.add(strip);
        }
        const l = new THREE.PointLight(LIGHT.gym, 1.6, 4.5, 1.4);
        l.position.set(this.wx(px), WH * 0.9, this.wz(py));
        this.scene.add(l);
        this.gymLights.push(l);
      }
    }
  }

  private devices() {
    const body = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.4, emissive: 0x4fd6ff, emissiveIntensity: 0.25 });
    this.disposers.push(() => (body.dispose(), dark.dispose()));
    const s = 1 / U;
    const G = new GymGeo(gymMats());
    this.disposers.push(() => (G.dispose(), disposeMats(G.mats)));
    for (const d of this.plan.devices) {
      // The pets' devices as they are (#747): modelled, their front to the room.
      const model = this.mats ? deviceModel(G, this.mats, d.kind, s) : null;
      if (model) {
        model.position.set(this.wx(d.x), d.lift / U, this.wz(d.y));
        model.rotation.y = this.backing(d.x - 10, d.y - 10, d.x + 10, d.y + 10).rot;
        this.world.add(model);
        continue;
      }
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
    // Devices standing together share one wider, calmer emitter (#729), so the pets' corner isn't one dense cloud.
    const live: EmitterIn[] = [];
    for (const d of P.devices) {
      const room = d.lights ?? roomAt(P, d.x, d.y)?.id;
      const l = room ? this.lit[room] : undefined;
      if (!l || d.kind === "thermostat") continue;
      live.push({ x: d.x, y: d.y, lift: d.lift, needs: l.needs });
    }
    for (const e of emittersOf(live)) {
      const spread = e.spread / U;
      jobs.push({ role: () => ({ k: "rise", x: e.x, y: e.y, lift: e.lift, spread }), weight: 40 * e.weight * (e.n > 1 ? 0.8 : 1) });
      if (e.needs) jobs.push({ role: () => ({ k: "swarm", x: e.x, y: e.y, spread }), weight: 46 * (e.n > 1 ? 0.7 : 1) });
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
        // A shared emitter rises slower, over its devices' spread.
        const f = fract(t * (r.spread ? 0.15 : 0.22) * sp + a);
        const ang = b * 6.283 + t * (r.spread ? 0.8 : 1.4) * sp;
        const rad = 0.04 + f * 0.14 + r.spread * fract(c * 3.7);
        x = this.wx(r.x) + Math.cos(ang) * rad;
        z = this.wz(r.y) + Math.sin(ang) * rad;
        y = r.lift / U + 0.15 + f * 1.5;
        al = (1 - f) * 0.9;
        [cr, cg, cb] = [0.62, 1, 0.78];
        sz = 0.075;
      } else if (r.k === "swarm") {
        const ang = a * 6.283 + t * (0.8 + c) * (b > 0.5 ? 1 : -1) * (r.spread ? 0.6 : 1);
        const rad = 0.16 + b * 0.14 + r.spread;
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
      if (d.kind === "thermostat" && this.opts.onSpot) {
        el.classList.add("is-tap");
        el.title = "Climate";
        const tap = (e: Event) => {
          e.stopPropagation();
          this.opts.onSpot?.(d.kind);
        };
        el.addEventListener("click", tap);
        this.disposers.push(() => el.removeEventListener("click", tap));
      }
      this.labelHost.appendChild(el);
      this.labels.push({ el, p: new THREE.Vector3(this.wx(d.x), d.lift / U + 0.42, this.wz(d.y)), spot: d.kind });
    }
    this.aroundLabels();
  }

  /** The streets' and the river's names round the block (#1040), only when the plan carries them (private, never built in). */
  private aroundLabels() {
    const names = this.plan.surroundings?.labels;
    if (!names || !this.around) return;
    for (const k of SURROUND_LABELS) {
      const text = names[k];
      if (!text) continue;
      const el = document.createElement("div");
      el.className = "hv-lab hv-street";
      const b = document.createElement("b");
      b.textContent = text;
      el.append(b);
      this.labelHost.appendChild(el);
      const a = this.around.anchors[k];
      this.labels.push({ el, p: new THREE.Vector3(a.x, a.y, a.z) });
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
  /** The rooms' extent in plan units: [x0, y0, x1, y1]. */
  private roomBounds(): [number, number, number, number] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of this.plan.rooms)
      for (const [px, py, pw, ph] of r.parts) {
        x0 = Math.min(x0, px);
        y0 = Math.min(y0, py);
        x1 = Math.max(x1, px + pw);
        y1 = Math.max(y1, py + ph);
      }
    return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, this.plan.w, this.plan.h];
  }

  private frameHome() {
    const [x0, y0, x1, y1] = this.roomBounds();
    // The orbit turns round the middle of the rooms; the box is measured from there.
    const tx = this.wx((x0 + x1) / 2), tz = this.wz((y0 + y1) / 2);
    const hw = (x1 - x0) / U / 2, hd = (y1 - y0) / U / 2;
    const narrow = this.W < 600;
    const top = narrow ? Math.max(this.H * 0.04, (this.opts.clearTop?.() ?? 0) + 6) : this.H * 0.05;
    // Snug (#671): the rooms' own corners fill the box, with only a sliver of margin.
    const m0 = narrow ? { l: this.W * 0.02, r: this.W * 0.02, t: top, b: this.H * 0.04 } : { l: this.W * 0.015, r: this.W * 0.02, t: top, b: this.H * 0.04 };
    const corners: [number, number][] = [];
    for (const r of this.plan.rooms) for (const [px, py, pw, ph] of r.parts) for (const [cx, cy] of [[px, py], [px + pw, py], [px, py + ph], [px + pw, py + ph]] as const) corners.push([this.wx(cx) - tx, this.wz(cy) - tz]);
    const fitWith = (m: typeof m0) => {
      const fit = fitView({ x0: -hw, x1: hw, z0: -hd, z1: hd, h: WH, corners }, HOME_TH, HOME_PH, this.W, this.H, m);
      // A touch closer than the fit (Nikita, 07:17Z): the box's outermost corners (the near walls' tops) may just touch the edge.
      return { home: { tx, tz, th: HOME_TH, ph: HOME_PH, r: fit.r * 0.93 } as Cam, pan: fit.pan };
    };
    let best = fitWith(m0);
    // The instrument strip (#680) sits in the dark to the lower right of the house: when the rooms would run under it,
    // give the fit more room below or to the right, whichever leaves the house bigger.
    const keep = this.opts.keepClear?.();
    if (keep && keep.w > 0 && keep.h > 0 && this.hits(best, corners, tx, tz, keep)) {
      let found: typeof best | null = null;
      for (let k = 1; k <= 24 && !found; k++) {
        const below = fitWith({ ...m0, b: m0.b + k * this.H * 0.025 });
        const beside = fitWith({ ...m0, r: m0.r + k * this.W * 0.025 });
        const ok = [below, beside].filter((f) => !this.hits(f, corners, tx, tz, keep)).sort((a, b) => a.home.r - b.home.r);
        found = ok[0] ?? null;
      }
      if (found) best = found;
    }
    this.fitR = best.home.r;
    this.pan = best.pan;
    this.home = best.home;
    this.sendOrder(best);
  }

  private orderKey = "";
  /** Where each thread lands across the fitted view, left to right (#718): the strip lines its gauges up the same way. */
  private sendOrder(view: { home: Cam; pan: [number, number] }) {
    if (!this.opts.onOrder || !this.ends.size) return;
    const ids = [...this.ends.keys()];
    const xs = this.screenAt(view, ids.map((id) => this.ends.get(id)!));
    const side = this.opts.rail?.() ?? false;
    const order = ids.map((id, i) => ({ id, x: xs[i]![side ? 1 : 0] })).sort((a, b) => a.x - b.x).map((o) => o.id);
    const key = `${side ? "side" : "foot"}:${order.join(",")}`;
    if (key === this.orderKey) return;
    this.orderKey = key;
    this.opts.onOrder(order);
  }

  /** World points as screen px from a given view, leaving the camera as it was. */
  private screenAt(view: { home: Cam; pan: [number, number] }, pts: THREE.Vector3[]): [number, number][] {
    const c = view.home, sp = Math.sin(c.ph), cp = Math.cos(c.ph);
    const cam = this.camera.clone();
    cam.aspect = this.W / this.H;
    cam.position.set(c.tx + c.r * sp * Math.sin(c.th), c.r * cp, c.tz + c.r * sp * Math.cos(c.th));
    cam.lookAt(c.tx, 0, c.tz);
    cam.setViewOffset(this.W, this.H, view.pan[0], view.pan[1], this.W, this.H);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return pts.map((p) => {
      this.v.copy(p).project(cam);
      return [((this.v.x + 1) / 2) * this.W, ((1 - this.v.y) / 2) * this.H];
    });
  }

  /** Would the rooms, seen from this view, run under the box (px)? Their outline's corners and edges against it. */
  private hits(view: { home: Cam; pan: [number, number] }, corners: [number, number][], tx: number, tz: number, box: { x: number; y: number; w: number; h: number }): boolean {
    const was = { cam: this.cam, pan: this.pan };
    this.cam = view.home;
    this.pan = view.pan;
    const c = this.cam, sp = Math.sin(c.ph), cp = Math.cos(c.ph);
    this.camera.aspect = this.W / this.H;
    this.camera.position.set(c.tx + c.r * sp * Math.sin(c.th), c.r * cp, c.tz + c.r * sp * Math.cos(c.th));
    this.camera.lookAt(c.tx, 0, c.tz);
    this.camera.setViewOffset(this.W, this.H, this.pan[0], this.pan[1], this.W, this.H);
    // The near plane with the distance (#1020): a fixed 0.05 left the depth buffer too coarse out at the block's streets
    // and courtyards, so their layers fought over each pixel and strobed as the view turned. Nothing comes nearer the
    // camera than a few percent of its distance to what it looks at.
    this.camera.near = nearFor(c.r);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const pts: [number, number][] = [];
    for (const [x, z] of corners)
      for (const y of [0, WH]) {
        this.v.set(x + tx, y, z + tz).project(this.camera);
        pts.push([((this.v.x + 1) / 2) * this.W, ((1 - this.v.y) / 2) * this.H]);
      }
    this.cam = was.cam;
    this.pan = was.pan;
    // Pad the box a little, so the walls don't graze it.
    const pad = 10, bx0 = box.x - pad, by0 = box.y - pad, bx1 = box.x + box.w + pad, by1 = box.y + box.h + pad;
    return hullHits(hullOf(pts), [bx0, by0, bx1, by1]);
  }

  private setAway(on: boolean) {
    if (on === this.away) return;
    this.away = on;
    this.opts.onAway?.(on);
  }

  private apply() {
    const c = this.cam;
    this.camera.aspect = this.W / this.H;
    const sp = Math.sin(c.ph), cp = Math.cos(c.ph), tx = c.tx + (this.wasd?.x ?? 0), tz = c.tz + (this.wasd?.z ?? 0);
    this.camera.position.set(tx + c.r * sp * Math.sin(c.th), c.r * cp, tz + c.r * sp * Math.cos(c.th));
    this.camera.lookAt(tx, c.ly ?? 0, tz);
    // The fitted view's offset, so the house sits in its box whatever the perspective does to it.
    this.camera.setViewOffset(this.W, this.H, this.pan[0], this.pan[1], this.W, this.H);
    // The near plane with the distance (#1020): a fixed 0.05 left the depth buffer too coarse out at the block's streets
    // and courtyards, so their layers fought over each pixel and strobed as the view turned. Nothing comes nearer the
    // camera than a few percent of its distance to what it looks at.
    this.camera.near = nearFor(c.r);
    this.camera.updateProjectionMatrix();
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
    // The kitchen (#747) as it is seen walking out of the bedroom: from the bedroom's side, lower and closer, looking
    // across the island to the fridge and the cabinet run.
    const from = kitchenFrom(this.plan, r);
    if (from) return { tx: this.wx((x0 + x1) / 2), tz: this.wz((y0 + y1) / 2), th: from, ph: 0.98, r: Math.max(2.6, r0 * 0.72) };
    return { tx: this.wx((x0 + x1) / 2), tz: this.wz((y0 + y1) / 2) + 0.1, th: HOME_TH + turn * 0.5, ph: 0.55, r: Math.max(3.4, r0) };
  }

  /** The fit changed under the fly-up: it lands on the new standard view, and starts from the new street view if it hasn't begun. */
  private retarget() {
    if (!this.tween?.intro) return;
    this.tween.to = this.home;
    if (this.tween.t0 < 0) {
      this.tween.from = riseFrom(this.home);
      this.cam = { ...this.tween.from };
    }
  }

  /** The user took the camera (#1076): any move stops the fly-up where it is; the view is theirs, so "Reset view" shows. */
  private stopIntro() {
    if (!this.tween?.intro) return;
    this.tween = null;
    if (!this.focusId) this.setAway(true);
  }

  private clampR = (r: number) => Math.max(this.fitR * 0.2, Math.min(this.fitR * 1.6, r));

  private resize() {
    const W = Math.max(1, this.host.clientWidth), H = Math.max(1, this.host.clientHeight);
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.renderer.setSize(W, H, false);
    const pr = this.renderer.getPixelRatio();
    this.thr.width = Math.round(W * pr);
    this.thr.height = Math.round(H * pr);
    this.frameHome();
    if (!this.focusId && !this.tween) {
      this.cam = { ...this.home };
      this.setAway(false);
    } else if (this.tween?.intro) this.retarget();
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
    /** Where a point on the canvas meets the floor, in the drawn plan's units, or null. */
    const floorAt = (cx: number, cy: number): [number, number] | null => {
      const rc = cv.getBoundingClientRect();
      ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return [hit.x * U + this.plan.w / 2, hit.z * U + this.plan.h / 2];
    };
    const pick = (cx: number, cy: number) => {
      const at = floorAt(cx, cy);
      return at ? (roomAt(this.plan, at[0], at[1])?.id ?? null) : null;
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
      this.stopIntro();
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
          cv.style.cursor = this.placing ? "crosshair" : id ? "pointer" : "grab";
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
          this.cam.ph = Math.max(0.03, Math.min(1.42, this.cam.ph - dy * 0.0045));
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
      if (was && was.moved <= 6 && e.type === "pointerup") {
        if (this.placing) {
          // The spot on the floor, in the stored plan's units; a tap off the plan does nothing.
          const at = floorAt(e.clientX, e.clientY);
          if (at && at[0] >= 0 && at[1] >= 0 && at[0] <= this.plan.w && at[1] <= this.plan.h) this.placing.onPlace(at[0] + this.shift[0], at[1] + this.shift[1]);
        } else this.opts.onPick(pick(e.clientX, e.clientY));
      }
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
        this.stopIntro();
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
    this.wasd.home();
    this.go(this.home, 450);
  }

  /**
   * Play the opening fly-up again (#1076): the kept Haven has come back on screen. Not under reduced motion, nor with a
   * room open over the house; its clock starts on the first frame drawn.
   */
  rise() {
    if (this.opts.reduce || this.focusId || this.backdrop) return;
    this.setAway(false);
    this.cam = riseFrom(this.home);
    this.tween = { from: { ...this.cam }, to: this.home, t0: -1, ms: RISE_MS, intro: true };
    this.apply();
  }

  /** While the room's content is open over the house: no input, and a slow drift. */
  setBackdrop(on: boolean) {
    this.backdrop = on;
    this.renderer.domElement.style.pointerEvents = on ? "none" : "";
    this.thr.style.visibility = on ? "hidden" : "";
    this.dirty = true;
  }

  /** The strip's box changed: fit the default view round it again (#680). */
  refit() {
    this.frameHome();
    if (!this.focusId && !this.tween && !this.away) this.cam = { ...this.home };
    else if (this.tween?.intro) this.retarget();
    this.apply();
  }

  /** The gauges' threads: their tones and how busy each is (#680). */
  setThreads(list: ThreadState[]) {
    this.threads = list;
    this.dirty = true;
  }

  /** Lamp positions move when the strip scrolls or the page lays out again: draw the threads again. */
  touch() {
    this.dirty = true;
  }

  /**
   * The lights (#931, #974, #1020): each placed light drawn where it stands (realLights.ts) as soft light over its area,
   * lit only while it's really on. No markers over them: the Lights panel switches and moves them. `spots` are the
   * stored plan's (the page keeps them, so placing a light doesn't rebuild the house). Null: the lights aren't read
   * here, and the rooms' activity glow stands in. The host's `data-lights` / `data-lights-on` count what's drawn.
   */
  setLights(lights: readonly Light[] | null, spots: readonly PlanLight[] | undefined) {
    this.realOn = lights !== null;
    // The stored plan's spots, on the drawn plan: the Gym moved out back shifts the home's coordinates (gymBeyond).
    const moved = spots?.map((s) => ({ ...s, x: s.x - this.shift[0], y: s.y - this.shift[1], ...(s.x2 !== undefined && s.y2 !== undefined ? { x2: s.x2 - this.shift[0], y2: s.y2 - this.shift[1] } : {}) }));
    const list = lights ? drawList(this.plan, lights, moved, this.desk) : [];
    this.real?.set(list, this.opts.reduce);
    // The island's green underglow follows its real light (#1085).
    if (this.mats) {
      const on = islandGlowOn(lights);
      this.mats.underglow.visible = on;
      this.mats.underwash.visible = on;
      this.mats.underhalo.visible = on;
      // In the Studio lamps' green (#1122): theirs while one is on in green, else the house's Studio green.
      const green = studioGreenOf(lights) ?? STUDIO_GREEN;
      for (const m of [this.mats.underglow, this.mats.underwash, this.mats.underhalo]) m.color.setHex(green);
      this.host.dataset.islandGlow = on ? "on" : "off";
    }
    const placed = list.filter((d) => !d.virtual);
    this.host.dataset.lights = String(placed.length);
    this.host.dataset.lightsOn = String(placed.filter((d) => d.light.online && d.light.on === true).length);
    this.dirty = true;
  }

  /**
   * Placing a light (#974): while `name` is set, a tap on the house's floor is that light's spot, handed back in the
   * stored plan's units (`onPlace`) instead of opening a room. Null ends it.
   */
  setPlacing(name: string | null, onPlace: (x: number, y: number) => void) {
    this.placing = name ? { name, onPlace } : null;
    this.renderer.domElement.style.cursor = name ? "crosshair" : "";
    if (name) this.host.dataset.placing = "";
    else delete this.host.dataset.placing;
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    this.guard.frame(now);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible || document.visibilityState === "hidden") return;
    if (this.tween && this.tween.t0 < 0) {
      // The fly-up's clock starts once the first frame is drawn (the shaders compile on it), after a short hold.
      if (!this.dirty) this.tween.t0 = now + RISE_HOLD_MS;
    } else if (this.tween) {
      const f = Math.max(0, Math.min(1, (now - this.tween.t0) / this.tween.ms)), e = ease(f);
      const { from, to } = this.tween;
      let dth = to.th - from.th;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      this.cam = { tx: from.tx + (to.tx - from.tx) * e, tz: from.tz + (to.tz - from.tz) * e, ph: from.ph + (to.ph - from.ph) * e, r: from.r + (to.r - from.r) * e, th: from.th + dth * e, ly: (from.ly ?? 0) + ((to.ly ?? 0) - (from.ly ?? 0)) * e };
      this.apply();
      if (f >= 1) this.tween = null;
    } else if (!this.opts.reduce && (this.backdrop || (!this.focusId && now - this.lastUser > 4000))) {
      this.cam.th += (this.backdrop ? 0.03 : 0.012 * Math.sin((now - this.t0) / 7000)) * dt;
      this.apply();
    }
    // WASD (#776) takes the camera from the fly-up the moment a key goes down (#1076).
    if (this.wasd.keys) this.stopIntro();
    if (this.wasd.step(dt)) {
      this.lastUser = now;
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
    this.updateLights(t, dt, now);
    this.step(t);
    if (!this.opts.reduce) this.poseCat(t, dt);
    if (this.night) {
      // The sky is there day and night (#1002); by day it turns blue and the city lights give way (night.ts).
      this.night.group.visible = !this.backdrop;
      if (this.around) {
        this.around.group.visible = !this.backdrop;
        this.around.update(Math.max(0, this.dayNow));
      }
      this.night.update(this.renderer.domElement.width, this.renderer.domElement.height, t, this.camera, this.renderer.getPixelRatio(), Math.max(0, this.dayNow));
    }
    this.renderer.render(this.scene, this.camera);
    this.drawThreads(t);
    this.placeLabels();
    this.dirty = false;
  };

  /**
   * The threads (#680): a faint curve from each gauge's lamp, rising, into its device, with nanites drifting up it,
   * quick and bright for a busy reading, few and slow for a quiet one, ember for a device that's down, and only the
   * faint curve while it waits. Still in reduced motion (the motes evenly spaced).
   */
  private drawThreads(t: number) {
    const x = this.thrCtx;
    if (!x) return;
    const pr = this.renderer.getPixelRatio();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, this.thr.width, this.thr.height);
    if (this.backdrop || !this.opts.lampAt || !this.threads.length) return;
    x.setTransform(pr, 0, 0, pr, 0, 0);
    if (!this.dot) {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const g = c.getContext("2d");
      if (g) {
        const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        gr.addColorStop(0, "rgba(255,255,255,1)");
        gr.addColorStop(0.35, "rgba(255,255,255,.55)");
        gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr;
        g.fillRect(0, 0, 32, 32);
      }
      this.dot = c;
    }
    const tint = this.tints;
    const dotOf = (rgb: string) => {
      let c = tint.get(rgb);
      if (c) return c;
      c = document.createElement("canvas");
      c.width = c.height = 32;
      const g = c.getContext("2d")!;
      g.drawImage(this.dot!, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = `rgb(${rgb})`;
      g.fillRect(0, 0, 32, 32);
      tint.set(rgb, c);
      return c;
    };
    this.threads.forEach((th, k) => {
      const end = this.ends.get(th.id);
      const a = this.opts.lampAt?.(th.id);
      if (!end || !a) return;
      this.v.copy(end).project(this.camera);
      if (this.v.z >= 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) return;
      const b: [number, number] = [((this.v.x + 1) / 2) * this.W, ((1 - this.v.y) / 2) * this.H];
      // Rise straight up off the lamp, then lean over into the device; from the side rail (#729), leave it sideways.
      const side = this.opts.rail?.() ?? false;
      const rise = side ? Math.max(40, (a[0] - b[0]) * 0.5) : Math.max(40, (a[1] - b[1]) * 0.55);
      const c1: [number, number] = side ? [a[0] - rise, a[1]] : [a[0], a[1] - rise];
      const c2: [number, number] = side ? [b[0] + Math.min(60, rise * 0.4), b[1] + (a[1] - b[1]) * 0.25] : [b[0] + (a[0] - b[0]) * 0.25, b[1] + Math.min(60, rise * 0.4)];
      const at = (u: number): [number, number] => {
        const v = 1 - u;
        return [v * v * v * a[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b[0], v * v * v * a[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b[1]];
      };
      const rgb = th.tone === "down" ? "255,154,106" : (th.rgb ?? "240,201,135");
      x.globalCompositeOperation = "source-over";
      x.strokeStyle = `rgba(${rgb},${th.tone === "wait" ? 0.1 : 0.2})`;
      x.lineWidth = 1;
      x.setLineDash(th.tone === "wait" ? [2, 5] : []);
      x.beginPath();
      x.moveTo(a[0], a[1]);
      x.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b[0], b[1]);
      x.stroke();
      x.setLineDash([]);
      if (th.tone === "wait") return;
      const n = th.tone === "down" ? 10 : Math.round(14 + th.level * 22);
      const speed = th.tone === "down" ? 0.04 : 0.07 + th.level * 0.12;
      const img = dotOf(rgb);
      x.globalCompositeOperation = "lighter";
      for (let i = 0; i < n; i++) {
        const sd = this.seeds[(k * 41 + i * 3) % this.seeds.length]!, sd2 = this.seeds[(k * 41 + i * 3 + 1) % this.seeds.length]!;
        const u = this.opts.reduce ? (i + 0.5) / n : fract(sd + t * speed * (0.7 + sd2 * 0.6));
        const [px, py] = at(u);
        const wob = Math.sin(t * 2 + sd * 40) * 2.2 * (1 - Math.abs(u - 0.5) * 2);
        const fade = Math.min(1, u * 6, (1 - u) * 6);
        const r = 2.2 + sd2 * 2.4;
        x.globalAlpha = (0.35 + 0.55 * sd2) * fade;
        x.drawImage(img, px + wob - r, py - r, r * 2, r * 2);
      }
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";
    });
  }

  private updateLights(t: number, dt: number, now: number) {
    // Day or night (#974): the sun over Denver, looked up every half minute and eased in.
    if (now - this.dayAt > 30_000) {
      this.dayAt = now;
      const sun = sunAt(new Date());
      this.dayWant = dayLevel(sun.alt);
      // North is the top of the plan (-z), east its right (+x).
      const c = Math.cos(sun.alt);
      this.sun.position.set(Math.sin(sun.az) * c * 10, Math.max(0.5, Math.sin(sun.alt) * 10), -Math.cos(sun.az) * c * 10);
    }
    this.dayNow = this.dayNow < 0 || this.opts.reduce ? this.dayWant : this.dayNow + (this.dayWant - this.dayNow) * Math.min(1, dt * 0.5);
    const day = this.dayNow;
    this.hemi.intensity = 0.55 + day * 1.25;
    this.hemi.color.setHex(0x8890b0).lerp(DAY_SKY, day);
    this.hemi.groundColor.setHex(0x0a0a0c).lerp(DAY_GROUND, day);
    this.moon.intensity = 0.35 * (1 - day);
    this.sun.intensity = 1.9 * day;
    // The Gym's overhead (#718): on whatever the readings say, brighter while its week has sessions to do.
    const gym = gymRoom(this.plan);
    const gv = gym ? (this.litNow.get(gym.id) ?? 0) : 0;
    for (const l of this.gymLights) l.intensity = (1.5 + gv * 1.4) * (1 - 0.6 * day);
    if (this.realOn && this.real) {
      // Real light (#974): only the lights that are on, each in its own colour; the rooms' activity glow is off.
      const lamps = this.real.step(dt, day, this.opts.reduce);
      this.lights.forEach((l, i) => {
        const x = lamps[i];
        if (!x) return void (l.intensity = 0);
        l.position.copy(x.p);
        l.color.copy(x.colour);
        l.distance = x.distance;
        l.intensity = x.intensity;
      });
      for (const m of this.poolMat) m.opacity = 0;
      return;
    }
    this.real?.step(dt, day, this.opts.reduce);
    const ranked = this.plan.rooms.map((r) => ({ r, v: this.litNow.get(r.id) ?? 0 })).filter((x) => x.v > 0.01).sort((a, b) => b.v - a.v);
    this.lights.forEach((l, i) => {
      const x = ranked[i];
      if (!x || i >= 6) return void (l.intensity = 0);
      const [cx, cy] = centreOf(x.r);
      l.position.set(this.wx(cx), WH * 0.95, this.wz(cy));
      l.color.setHex(this.lit[x.r.id]?.needs ? LIGHT.needs : LIGHT.lamp);
      l.distance = 4.2;
      // Something running (or wanting Nikita) breathes on top of the steady glow of a connected room (#671).
      const busy = (this.lit[x.r.id]?.level ?? 0) >= 0.6 ? 0.16 : 0.04;
      l.intensity = x.v * 5 * (1 + busy * Math.sin(t * (busy > 0.1 ? 2.6 : 2) + i)) * (1 - 0.7 * day);
    });
    this.pools.forEach((m, i) => {
      const id = m.userData.room as string;
      const v = this.litNow.get(id) ?? 0;
      this.poolMat[i]!.opacity = v * 0.32 * (1 - 0.7 * day);
      this.poolMat[i]!.color.setHex(this.lit[id]?.needs ? LIGHT.needs : LIGHT.lamp);
    });
  }

  dispose() {
    this.gone = true;
    this.cat?.dispose();
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers.splice(0)) d();
    this.night?.dispose();
    this.around?.dispose();
    this.real?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.thr.remove();
    this.labelHost.replaceChildren();
  }
}

/** The convex hull of points (px), counter-clockwise in screen terms. */
export function hullOf(p: [number, number][]): [number, number][] {
  const pts = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of pts.reverse()) {
    while (hi.length >= 2 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop();
    hi.push(q);
  }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Does a convex polygon touch a box [x0, y0, x1, y1]? (separating axes: the box's two and the polygon's edges) */
export function hullHits(h: [number, number][], b: [number, number, number, number]): boolean {
  if (!h.length) return false;
  const xs = h.map((p) => p[0]), ys = h.map((p) => p[1]);
  if (Math.max(...xs) < b[0] || Math.min(...xs) > b[2] || Math.max(...ys) < b[1] || Math.min(...ys) > b[3]) return false;
  const box: [number, number][] = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  for (let i = 0; i < h.length; i++) {
    const p = h[i]!, q = h[(i + 1) % h.length]!;
    const nx = q[1] - p[1], ny = p[0] - q[0];
    const proj = (v: [number, number]) => v[0] * nx + v[1] * ny;
    const hp = h.map(proj), bp = box.map(proj);
    if (Math.max(...hp) < Math.min(...bp) || Math.min(...hp) > Math.max(...bp)) return false;
  }
  return true;
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
