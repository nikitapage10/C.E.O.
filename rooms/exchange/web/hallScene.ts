import { isShown, showParts } from "@ceo/engine/web/sceneShow.ts";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PointLight,
  Points,
  Raycaster,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { comeUndone, glyphMaterial, sigilAtlas, SIGIL_GLYPHS } from "@ceo/engine/sigils/undone.ts";
import { edgeFactor, SOFT, wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import type { TapeItem } from "../data/floor.ts";
import { bookWord, HOLDINGS, POSTS, shareWord, type HallBook, type HallHolding, type HallPost, type HallSoon, type HallView } from "../data/hall.ts";
import { dprGuard, sceneDpr } from "@ceo/engine/web/phone.ts";

/**
 * The Exchange's trade floor in three.js (#823; Nikita, 2026-11-05: "trade floor, mostly physical, some mid-assembly,
 * marquee with real items"). A futuristic exchange floor at night: polished black stone inlaid with gold, the busiest
 * Polymarket markets each a trading post (a lacquered ring counter, a column, and a crown of six screens showing that
 * market's odds and the day's move), the curved marquee over the back wall running the live tape, and a kiosk at the
 * front for the book that shows how many positions are open and nothing more. At the floor's edges three more posts
 * stand mid-assembly: gold wire with the solid rising into it and sigil nanites streaming in, each one of the room's
 * real "still to come". The middle of the frame stays solid; toward its edges the stone, the walls and the columns
 * come undone into gold wire and nanites (@ceo/engine/sigils/undone.ts), the Senate's language.
 *
 * The book stands front and centre (#988): an oval gold-rimmed plinth between the two busiest posts, its open
 * positions a shallow arc of lacquered pillars on it, each as tall as its share of the book, a lit ticket over it (the
 * side and the share; the page's tag names the market; never a figure) and sigil nanites rising off its top. Signed
 * out, the pillars stand empty in gold wire, the kiosk in front saying the book is behind the passkey. Round it all, a dense field
 * of gold motes drifts up through the hall (one draw, moved on the GPU), and the wire grid the edges come undone into
 * runs up the side walls and round the plinth too.
 *
 * WASD swivels the view round the floor within a set arc and dollies it in and out (the shared helper's orbit mode),
 * resisted past the soft edge and eased back when the keys let go; dragging swivels the same arc. A post is picked by
 * a click; each post, the kiosk and the unbuilt posts report where they sit on screen for the page's tags. When a
 * price ticks between reads, its post's screens flash and nanites rise off its crown. Loaded lazily (HallStage.tsx);
 * under reduced motion nothing moves.
 */

export interface HallOpts {
  phone: boolean;
  reduce: boolean;
  view: HallView;
  /** How many px the page's panel covers on the right, so the floor centres in what's left. */
  inset: () => number;
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
}

export interface Hall {
  set: (view: HallView) => void;
  /** Light one post (from the page's list), or none. */
  focus: (id: string | null) => void;
  dispose: () => void;
}

const GOLD = 0xc9a85c;
const GOLD_HI = 0xe8c77a;
const TONE: Record<HallPost["tone"], number> = { up: 0x5fe0a2, down: 0xf07a8f, flat: 0xb9c0cc };
const TONE_CSS: Record<HallPost["tone"], string> = { up: "#6be6ab", down: "#f48a9c", flat: "#c4cad6" };
const PHONE_W = 760;
/** Where the posts stand (x, z): the busiest first, either side of the book's ring. */
const LIVE: [number, number][] = [
  [-5.9, -0.6],
  [5.9, -0.6],
  [-8.8, -3.2],
  [8.8, -3.2],
  [0, -5.8],
];
/**
 * The book's ring at the floor's centre: an oval plinth between the two busiest posts (its middle and half-widths), the
 * kiosk on the stone at its front, and the posts still being assembled round the floor's rim.
 */
const RING = { x: 0, z: 2.3, rx: 4.7, rz: 2.05 };
const BOOK: [number, number] = [0, 5.05];
/** The pillars' places across the plinth in a shallow arc, the biggest in the middle, then out to either side (x). */
const SLOTS = [0, -1.9, 1.9, -3.75, 3.75].slice(0, HOLDINGS);
const slotAt = (k: number): [number, number] => [RING.x + SLOTS[k]!, RING.z - 0.55 + 0.075 * SLOTS[k]! * SLOTS[k]!];
/** A pillar's height for its size against the biggest; the empty wire ones signed out. */
const pillarH = (rel: number) => 0.8 + 2.9 * Math.sqrt(Math.max(0, Math.min(1, rel)));
const EMPTY_H = 1.5;
const SOON: [number, number][] = [
  [-9.8, 4.6],
  [-4.4, -10],
  [6.4, 5.2],
];
const CROWN_Y = 3.62;
const CROWN_R = 1.12;
const POST_H = 4.25;
/** The marquee: a curved band over the back wall. */
const MQ = { cz: 16, r: 27.4, y: 6.7, h: 2, arc: 1.18 };
/** The swivel: how far either way the view turns (rad), and how far it dollies in or out (share). */
const ARC = 0.42;
const ZOOM_ARC = 0.2;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
function swing(v: number, d: number, lim: number): number {
  const out = d !== 0 && Math.sign(d) === Math.sign(v);
  return Math.max(-lim, Math.min(lim, v + (out ? d * edgeFactor(Math.abs(v) / lim) : d)));
}

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const COND = `"Big Shoulders Display Variable","Big Shoulders Display","Arial Narrow",sans-serif`;
const MONO = `"Geist Mono Variable","Geist Mono",ui-monospace,monospace`;

/** Lines of `text` that fit `w` at the context's font, at most `max`, the last cut with an ellipsis. */
function wrap(g: CanvasRenderingContext2D, text: string, w: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= w || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  if (out.length > max) {
    const kept = out.slice(0, max);
    let last = kept[max - 1]!;
    while (last.length > 1 && g.measureText(`${last}…`).width > w) last = last.slice(0, -1);
    kept[max - 1] = `${last.replace(/\s+\S*$/, "") || last}…`;
    return kept;
  }
  return out;
}

/** A screen's LED grain: fine dark rows and columns over what was drawn. */
function grain(g: CanvasRenderingContext2D, w: number, h: number, step = 4) {
  g.fillStyle = "rgba(0,0,0,.28)";
  for (let y = 0; y < h; y += step) g.fillRect(0, y, w, 1);
  g.fillStyle = "rgba(0,0,0,.14)";
  for (let x = 0; x < w; x += step) g.fillRect(x, 0, 1, h);
}

/** A post's screen: the market's name, its odds big, the day's move; or, for a post still being built, what it waits on. */
function drawScreen(g: CanvasRenderingContext2D, w: number, h: number, what: { post: HallPost; rank: number } | { soon: HallSoon } | { empty: string }) {
  g.clearRect(0, 0, w, h);
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0c0d11");
  bg.addColorStop(1, "#060709");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(201,168,92,.55)";
  g.lineWidth = 4;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.textBaseline = "alphabetic";
  if ("post" in what) {
    const p = what.post;
    g.fillStyle = "#c9a85c";
    g.font = `500 26px ${MONO}`;
    g.fillText(`POST ${String(what.rank + 1).padStart(2, "0")}`, 28, 50);
    g.textAlign = "right";
    g.fillText("POLYMARKET", w - 28, 50);
    g.textAlign = "left";
    g.fillStyle = "#ece6d6";
    g.font = `600 46px ${COND}`;
    wrap(g, p.name.toUpperCase(), w - 56, 2).forEach((l, i) => g.fillText(l, 28, 110 + i * 48));
    g.font = `700 150px ${COND}`;
    g.fillStyle = "#fff4dc";
    g.fillText(p.odds, 24, h - 44);
    if (p.move) {
      g.textAlign = "right";
      g.font = `700 70px ${COND}`;
      g.fillStyle = TONE_CSS[p.tone];
      g.fillText(p.move, w - 30, h - 52);
      g.textAlign = "left";
    }
  } else if ("soon" in what) {
    g.fillStyle = "#c9a85c";
    g.font = `500 26px ${MONO}`;
    g.fillText("STILL TO COME", 28, 54);
    g.fillStyle = "#e8dcc0";
    g.font = `600 60px ${COND}`;
    wrap(g, what.soon.name.toUpperCase(), w - 56, 2).forEach((l, i) => g.fillText(l, 28, 140 + i * 62));
    g.fillStyle = "#9a917e";
    g.font = `500 28px ${MONO}`;
    wrap(g, what.soon.on, w - 56, 2).forEach((l, i) => g.fillText(l, 28, h - 74 + i * 34));
  } else {
    g.fillStyle = "#5d5a52";
    g.font = `500 28px ${MONO}`;
    g.textAlign = "center";
    g.fillText(what.empty, w / 2, h / 2 + 10);
    g.textAlign = "left";
  }
  grain(g, w, h);
}

/** The book kiosk's screen: a count or a state, never a figure. */
function drawBook(g: CanvasRenderingContext2D, w: number, h: number, b: HallBook) {
  const [big, small] = bookWord(b);
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#08090c";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(201,168,92,.6)";
  g.lineWidth = 4;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = "#c9a85c";
  g.font = `500 24px ${MONO}`;
  g.fillText("YOUR BOOK · READ-ONLY", 26, 46);
  const live = b.state === "live" && b.open !== null;
  g.fillStyle = live ? "#fff4dc" : "#d8ccb0";
  g.font = live ? `700 120px ${COND}` : `600 54px ${COND}`;
  g.fillText(live ? big : small.toUpperCase(), 24, live ? h - 64 : h / 2 + 30);
  if (live) {
    g.fillStyle = "#b9ad92";
    g.font = `500 26px ${MONO}`;
    g.fillText(small.toUpperCase(), 26, h - 26);
  }
  grain(g, w, h);
}

/** A pillar's ticket: the side and its share of the book (the page's tag over it names the market); veiled while Hide is on. Never a figure. */
function drawTicket(g: CanvasRenderingContext2D, w: number, h: number, t: HallHolding, rank: number, hide: boolean) {
  g.clearRect(0, 0, w, h);
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0e0d0a");
  bg.addColorStop(1, "#060608");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(232,199,122,.8)";
  g.lineWidth = 4;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = "#c9a85c";
  g.font = `500 22px ${MONO}`;
  g.fillText(`POSITION ${String(rank + 1).padStart(2, "0")}`, 24, 42);
  if (hide) {
    g.fillStyle = "rgba(201,168,92,.16)";
    for (let x = -h; x < w; x += 18) {
      g.beginPath();
      g.moveTo(x, h - 14);
      g.lineTo(x + h, 60);
      g.lineTo(x + h + 7, 60);
      g.lineTo(x + 7, h - 14);
      g.fill();
    }
    g.fillStyle = "#d8ccb0";
    g.font = `600 52px ${COND}`;
    g.fillText("HIDDEN", 24, h - 40);
    grain(g, w, h);
    return;
  }
  g.fillStyle = TONE_CSS[t.tone];
  g.font = `600 38px ${COND}`;
  g.fillText(wrap(g, t.side.toUpperCase(), w - 48, 1)[0] ?? "", 24, 92);
  g.fillStyle = "#fff4dc";
  g.font = `700 132px ${COND}`;
  const sw = shareWord(t.share);
  g.fillText(sw, 20, h - 28);
  const x = 30 + g.measureText(sw).width;
  g.fillStyle = "#b9ad92";
  g.font = `500 24px ${MONO}`;
  g.fillText("OF", x, h - 64);
  g.fillText("BOOK", x, h - 34);
  grain(g, w, h);
}

/** The marquee's run: each item its name, its odds, the day's move; or, until Polymarket answers, what it is waiting on. */
function drawTape(g: CanvasRenderingContext2D, w: number, h: number, items: TapeItem[], idle: string): number {
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#050507";
  g.fillRect(0, 0, w, h);
  const mid = h / 2 + 22;
  if (!items.length) {
    g.fillStyle = "#8f866f";
    g.font = `600 64px ${COND}`;
    g.textAlign = "center";
    for (let x = w / 4; x < w; x += w / 2) g.fillText(idle.toUpperCase(), x, mid);
    g.textAlign = "left";
    grain(g, w, h, 5);
    return 0;
  }
  // Each item's width, measured once; as many as fit the strip make one pass, and whole passes tile it with the
  // spare room shared out between the items, so the wrap is seamless and the type keeps its shape.
  const parts = items.map((m) => {
    g.font = `600 64px ${COND}`;
    const name = m.name.toUpperCase();
    const nw = g.measureText(name).width;
    g.font = `700 76px ${COND}`;
    const ow = g.measureText(m.odds).width;
    g.font = `700 56px ${COND}`;
    const mw = m.move ? g.measureText(m.move).width : 0;
    return { m, name, nw, ow, mw, w: nw + 22 + ow + 14 + mw + 90 };
  });
  const fit: typeof parts = [];
  let one = 0;
  for (const p of parts) {
    if (one + p.w > w && fit.length) break;
    fit.push(p);
    one += p.w;
  }
  const reps = Math.max(1, Math.floor(w / one));
  const extra = (w / reps - one) / fit.length;
  for (let k = 0; k < reps; k++) {
    let x = (k * w) / reps;
    for (const p of fit) {
      g.font = `600 64px ${COND}`;
      g.fillStyle = "#e3d6b8";
      g.fillText(p.name, x, mid);
      x += p.nw + 22;
      g.font = `700 76px ${COND}`;
      g.fillStyle = "#fff6e0";
      g.fillText(p.m.odds, x, mid + 2);
      x += p.ow + 14;
      if (p.m.move) {
        g.font = `700 56px ${COND}`;
        g.fillStyle = TONE_CSS[p.m.tone];
        g.fillText(p.m.move, x, mid);
        x += p.mw;
      }
      x += 40 + extra / 2;
      g.fillStyle = "rgba(201,168,92,.7)";
      g.fillRect(x, h / 2 - 6, 10, 10);
      x += 50 + extra / 2;
    }
  }
  grain(g, w, h, 5);
  return reps;
}

/** The stone: near-black, flecked, inlaid with gold every few metres. */
function floorTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#101116";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${150 + Math.random() * 60},${140 + Math.random() * 40},${120 + Math.random() * 40},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  g.strokeStyle = "rgba(201,168,92,.55)";
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 509, 509);
  g.strokeStyle = "rgba(201,168,92,.16)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(256, 0);
  g.lineTo(256, 512);
  g.moveTo(0, 256);
  g.lineTo(512, 256);
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The back wall: dark panels with fine seams. */
function wallTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#0d0e12");
  gr.addColorStop(1, "#15161b");
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = "rgba(0,0,0,.5)";
  for (let x = 0; x < 512; x += 64) g.fillRect(x, 0, 2, 256);
  g.fillStyle = "rgba(201,168,92,.08)";
  for (let x = 0; x < 512; x += 64) g.fillRect(x + 2, 0, 1, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** A soft round glow, white on clear, for sprites tinted at use. */
function glowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.3, "rgba(255,255,255,.4)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A ring of wire round a vertical axis, for the edges to come undone into. */
function ring(out: number[], cx: number, y: number, cz: number, r: number, n = 24) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const b = ((k + 1) / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, cx + Math.cos(b) * r, y, cz + Math.sin(b) * r);
  }
}

/** An oval of wire round a vertical axis. */
function oval(out: number[], cx: number, y: number, cz: number, rx: number, rz: number, n = 48) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const b = ((k + 1) / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz, cx + Math.cos(b) * rx, y, cz + Math.sin(b) * rz);
  }
}

interface PostRig {
  g: Group;
  at: Vector3;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  screen: MeshBasicMaterial;
  strip: MeshBasicMaterial;
  pool: Sprite;
  light: PointLight | null;
  hit: Mesh;
  post: HallPost | null;
  sig: string;
  flash: number;
  lit: number;
}

interface HoldRig {
  g: Group;
  at: Vector3;
  /** The column, scaled to its height; its solid and its wire. */
  col: Group;
  solid: Mesh;
  wire: LineSegments;
  strip: Mesh;
  stripM: MeshBasicMaterial;
  ticket: Mesh;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  screen: MeshBasicMaterial;
  pool: Sprite;
  hit: Mesh;
  hold: HallHolding | null;
  sig: string;
  h: number;
  lit: number;
  phase: number;
}

interface SoonRig {
  g: Group;
  at: Vector3;
  plane: Plane;
  band: Mesh;
  phase: number;
  y: number;
}

export async function createHall(host: HTMLElement, canvas: HTMLCanvasElement, opts: HallOpts): Promise<Hall> {
  const { reduce } = opts;
  const PH = opts.phone;
  let view = opts.view;
  const renderer = new WebGLRenderer({ canvas, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(sceneDpr()); // 2x on a phone, stepped down while frames run slow (#1070)
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.localClippingEnabled = true;
  const scene = new Scene();
  scene.background = new Color(0x060609);
  scene.fog = new Fog(0x07070a, 36, 84);
  const cam = new PerspectiveCamera(42, 1, 0.1, 200);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const px = { value: renderer.getPixelRatio() };
  try {
    await Promise.all([document.fonts.load(`600 40px ${COND}`), document.fonts.load(`500 20px ${MONO}`)]);
  } catch {
    /* the fallback faces are fine */
  }
  const atlas = keep(await sigilAtlas());
  const NG = SIGIL_GLYPHS.length;

  // ---- light ------------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0x9aa3c4, 0x0b0907, 0.6));
  const key = new DirectionalLight(0xffe4b8, 0.95);
  key.position.set(7, 15, 12);
  scene.add(key);
  const rim = new DirectionalLight(0x8fa6ff, 0.35);
  rim.position.set(-12, 6, -14);
  scene.add(rim);
  const board = new PointLight(0xffd9a0, 26, 22, 1.6);
  board.position.set(0, MQ.y, -8.2);
  scene.add(board);

  // ---- materials --------------------------------------------------------------------------------------------------
  const shell = keep(new MeshStandardMaterial({ color: 0x23262e, metalness: 0.65, roughness: 0.34 }));
  const lacquer = keep(new MeshStandardMaterial({ color: 0x0d0e12, metalness: 0.35, roughness: 0.28 }));
  const brass = keep(new MeshStandardMaterial({ color: 0x9c7c3c, metalness: 0.9, roughness: 0.3, emissive: 0x241a08 }));
  const goldLine = keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.38, depthWrite: false }));
  const goldWire = keep(new LineBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.75, depthWrite: false }));
  const glowTex = keep(glowTexture());
  /** The Senate's wire skin over a solid: its hard edges in gold. */
  const skin = <M extends Mesh>(m: M, mat = goldLine, angle = 24): M => {
    m.add(new LineSegments(keep(new EdgesGeometry(m.geometry, angle)), mat));
    return m;
  };
  const glow = (col: number, size: number, op: number) => {
    const s = new Sprite(keep(new SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: op, depthWrite: false, blending: AdditiveBlending })));
    s.scale.setScalar(size);
    return s;
  };

  // ---- the hall ---------------------------------------------------------------------------------------------------
  const ftex = keep(floorTexture());
  ftex.repeat.set(9, 7);
  const floor = new Mesh(keep(new PlaneGeometry(50, 38)), keep(new MeshStandardMaterial({ map: ftex, color: 0xb8b4ac, metalness: 0.4, roughness: 0.5 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -3);
  scene.add(floor);
  // The pit: a raised dais with a gold ring inlaid round the posts.
  const dais = new Mesh(keep(new CylinderGeometry(11.2, 11.4, 0.14, 96)), keep(new MeshStandardMaterial({ color: 0x14151a, metalness: 0.5, roughness: 0.5 })));
  dais.position.set(0, 0.07, -2.6);
  scene.add(skin(dais, goldLine, 30));
  const inlay = new Mesh(keep(new RingGeometry(10.55, 10.7, 128)), keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 })));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.set(0, 0.145, -2.6);
  scene.add(inlay);
  const wtex = keep(wallTexture());
  wtex.repeat.set(7, 2);
  const wall = new Mesh(keep(new PlaneGeometry(60, 16)), keep(new MeshStandardMaterial({ map: wtex, color: 0xaaa8a2, metalness: 0.3, roughness: 0.6 })));
  wall.position.set(0, 8, -13);
  scene.add(wall);
  // Columns down both sides, solid near the middle; the frame's edges take them apart.
  const colG = keep(new BoxGeometry(0.9, 13, 0.9));
  const capG = keep(new BoxGeometry(1.3, 0.3, 1.3));
  const cols: [number, number][] = [];
  for (const x of [-19, 19]) for (const z of [-11, -5.5, 0, 5.5]) cols.push([x, z]);
  for (const x of [-12.5, -6.2, 6.2, 12.5]) cols.push([x, -12.3]);
  for (const [x, z] of cols) {
    const c = skin(new Mesh(colG, shell));
    c.position.set(x, 6.5, z);
    scene.add(c);
    for (const y of [0.15, 12.85]) {
      const cap = skin(new Mesh(capG, brass));
      cap.position.set(x, y, z);
      scene.add(cap);
    }
  }

  // ---- the marquee ------------------------------------------------------------------------------------------------
  /** The marquee's strip, drawn at 8192 × 192 (half that on a phone); the band shows about this share of it at once. */
  const STRIP = 8192;
  const TW = PH ? STRIP / 2 : STRIP;
  const TH = PH ? 96 : 192;
  const tapeCv = document.createElement("canvas");
  tapeCv.width = TW;
  tapeCv.height = TH;
  const tapeG = tapeCv.getContext("2d")!;
  const tapeTex = keep(new CanvasTexture(tapeCv));
  tapeTex.colorSpace = SRGBColorSpace;
  tapeTex.wrapS = RepeatWrapping;
  tapeTex.anisotropy = 4;
  if (PH) tapeG.scale(0.5, 0.5);
  const th0 = Math.PI - MQ.arc / 2;
  // Seen from inside the curve, so the strip is flipped to read left to right; one screen shows about this much of it.
  const show = (MQ.r * MQ.arc) / MQ.h / (STRIP / 192);
  tapeTex.repeat.set(-show, 1);
  const band = new Mesh(keep(new CylinderGeometry(MQ.r, MQ.r, MQ.h, 96, 1, true, th0, MQ.arc)), keep(new MeshBasicMaterial({ map: tapeTex, side: DoubleSide, toneMapped: false })));
  band.position.set(0, MQ.y, MQ.cz);
  scene.add(band);
  const railG = keep(new CylinderGeometry(MQ.r + 0.06, MQ.r + 0.06, 0.16, 96, 1, true, th0 - 0.01, MQ.arc + 0.02));
  for (const dy of [MQ.h / 2 + 0.08, -MQ.h / 2 - 0.08]) {
    const rail = new Mesh(railG, keep(new MeshStandardMaterial({ color: 0xb8924a, metalness: 0.9, roughness: 0.25, emissive: 0x3a2a0c, side: DoubleSide })));
    rail.position.set(0, MQ.y + dy, MQ.cz);
    scene.add(rail);
  }
  const backing = new Mesh(keep(new CylinderGeometry(MQ.r + 0.3, MQ.r + 0.3, MQ.h + 1.1, 96, 1, true, th0 - 0.02, MQ.arc + 0.04)), keep(new MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0.5, roughness: 0.5, side: DoubleSide })));
  backing.position.set(0, MQ.y, MQ.cz);
  scene.add(skin(backing, goldLine, 40));
  const mqGlow = glow(GOLD_HI, 1, 0.12);
  mqGlow.scale.set(34, 4.5, 1);
  mqGlow.position.set(0, MQ.y, -10.4);
  scene.add(mqGlow);
  let reps = 0;
  const idleWord = () => (view.status === "failed" ? "Polymarket isn't answering" : view.status === "off" ? "Polymarket isn't connected here" : "Reading Polymarket's odds");
  const paintTape = () => {
    reps = drawTape(tapeG, STRIP, 192, view.tape, idleWord());
    tapeTex.needsUpdate = true;
  };

  // ---- the posts --------------------------------------------------------------------------------------------------
  const baseG = keep(new CylinderGeometry(1.55, 1.72, 1.0, 48));
  const topG = keep(new CylinderGeometry(1.8, 1.78, 0.08, 48));
  const stripG = keep(new TorusGeometry(1.64, 0.028, 6, 72));
  const colPostG = keep(new CylinderGeometry(0.2, 0.28, 2.3, 18));
  const capHexG = keep(new CylinderGeometry(CROWN_R + 0.1, CROWN_R + 0.1, 0.1, 6));
  const hexBackG = keep(new CylinderGeometry(CROWN_R * 0.82, CROWN_R * 0.82, 0.9, 6));
  const screenG = keep(new PlaneGeometry(CROWN_R * 0.98, 0.86));
  const hitG = keep(new CylinderGeometry(1.9, 1.9, POST_H + 0.3, 12));
  const hitMat = keep(new MeshBasicMaterial({ visible: false }));
  const apothem = CROWN_R * Math.cos(Math.PI / 6) + 0.012;

  /** One post's body, in the given materials; returns the group and the wire skin laid over it. */
  const body = (sh: Material, br: Material, screen: Material | null) => {
    const g = new Group();
    const add = (m: Mesh, y: number) => {
      m.position.y = y;
      g.add(m);
      return m;
    };
    add(skin(new Mesh(baseG, sh)), 0.5);
    add(skin(new Mesh(topG, br), goldLine, 30), 1.04);
    add(skin(new Mesh(colPostG, sh)), 2.2);
    add(skin(new Mesh(capHexG, br)), CROWN_Y + 0.5);
    add(skin(new Mesh(capHexG, br)), CROWN_Y - 0.5);
    add(new Mesh(hexBackG, sh), CROWN_Y);
    if (screen)
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const s = new Mesh(screenG, screen);
        s.position.set(Math.sin(a) * apothem, CROWN_Y, Math.cos(a) * apothem);
        s.rotation.y = a;
        g.add(s);
      }
    return g;
  };

  const posts: PostRig[] = LIVE.map(([x, z], i) => {
    const cv = document.createElement("canvas");
    cv.width = PH ? 256 : 512;
    cv.height = PH ? 208 : 416;
    const tex = keep(new CanvasTexture(cv));
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    const screen = keep(new MeshBasicMaterial({ map: tex, toneMapped: false }));
    const g = body(shell, brass, screen);
    g.position.set(x, 0.14, z);
    // The day's way, in the lit strip round the counter and the pool of light on the stone under it.
    const strip = keep(new MeshBasicMaterial({ color: TONE.flat, transparent: true, opacity: 0.9, toneMapped: false }));
    const st = new Mesh(stripG, strip);
    st.rotation.x = Math.PI / 2;
    st.position.y = 0.88;
    g.add(st);
    const pool = glow(TONE.flat, 6, 0.0);
    pool.position.y = 0.1;
    pool.scale.set(6, 6, 1);
    g.add(pool);
    const light = PH || i > 2 ? null : new PointLight(0xffe2b0, 0, 7, 1.8);
    if (light) {
      light.position.y = CROWN_Y + 0.9;
      g.add(light);
    }
    const hit = new Mesh(hitG, hitMat);
    hit.position.y = POST_H / 2;
    g.add(hit);
    scene.add(g);
    return { g, at: new Vector3(x, 0.14, z), canvas: cv, tex, screen, strip, pool, light, hit, post: null, sig: "", flash: 0, lit: 0 };
  });

  // The posts still being assembled: the whole post in gold wire, the solid rising into it below a moving plane.
  const soon: SoonRig[] = SOON.map(([x, z], i) => {
    const plane = new Plane(new Vector3(0, -1, 0), 1.5);
    const sh = keep(new MeshStandardMaterial({ color: 0x2a2d35, metalness: 0.6, roughness: 0.36, emissive: 0x15110a, clippingPlanes: [plane], side: DoubleSide }));
    const br = keep(new MeshStandardMaterial({ color: 0x9c7c3c, metalness: 0.9, roughness: 0.3, emissive: 0x3a2a0c, clippingPlanes: [plane] }));
    const cv = document.createElement("canvas");
    cv.width = PH ? 256 : 512;
    cv.height = PH ? 208 : 416;
    const tex = keep(new CanvasTexture(cv));
    tex.colorSpace = SRGBColorSpace;
    const scr = keep(new MeshBasicMaterial({ map: tex, toneMapped: false, clippingPlanes: [plane] }));
    const g = body(sh, br, scr);
    // The wire it is being built into: brighter than the skin, so the unbuilt part reads as a frame, not a ghost.
    g.traverse((o) => {
      if (o instanceof LineSegments) o.material = goldWire;
    });
    g.position.set(x, 0.02, z);
    const bandM = new Mesh(keep(new TorusGeometry(1.85, 0.055, 6, 72)), keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, toneMapped: false })));
    bandM.rotation.x = Math.PI / 2;
    // The build line's own light, so the new solid reads gold where it is being laid.
    const weld = glow(GOLD_HI, 4.2, 0.5);
    bandM.add(weld);
    if (!PH) {
      const lamp = new PointLight(0xffd9a0, 7, 6, 1.6);
      bandM.add(lamp);
    }
    g.add(bandM);
    scene.add(g);
    (g.userData as { cv: HTMLCanvasElement; tex: CanvasTexture }).cv = cv;
    (g.userData as { cv: HTMLCanvasElement; tex: CanvasTexture }).tex = tex;
    return { g, at: new Vector3(x, 0.02, z), plane, band: bandM, phase: i * 2.1, y: 1.5 };
  });

  // ---- the book's ring: a plinth at the floor's centre, its positions a ring of pillars ------------------------------
  const plinth = new Mesh(keep(new CylinderGeometry(1, 1.03, 0.22, 72)), keep(new MeshStandardMaterial({ color: 0x111216, metalness: 0.6, roughness: 0.38 })));
  plinth.scale.set(RING.rx, 1, RING.rz);
  plinth.position.set(RING.x, 0.25, RING.z);
  scene.add(skin(plinth, goldLine, 30));
  const rimM = keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.85, toneMapped: false }));
  const rimG = keep(new TorusGeometry(1, 0.006, 6, 120));
  const rimIn = keep(new TorusGeometry(1, 0.008, 6, 96));
  const ringGlowM = keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  const rimA = new Mesh(rimG, rimM);
  rimA.rotation.x = Math.PI / 2;
  rimA.position.set(RING.x, 0.37, RING.z);
  rimA.scale.set(RING.rx - 0.18, RING.rz - 0.18, 3);
  scene.add(rimA);
  const rimB = new Mesh(rimIn, ringGlowM);
  rimB.rotation.x = Math.PI / 2;
  rimB.position.set(RING.x, 0.37, RING.z);
  rimB.scale.set(RING.rx * 0.6, RING.rz * 0.45, 2);
  scene.add(rimB);
  // The ring's own light: a pool on the plinth, and a faint shaft rising out of the middle.
  const ringPool = glow(GOLD_HI, 1, 0.22);
  ringPool.scale.set(RING.rx * 2.4, RING.rz * 2.6, 1);
  ringPool.position.set(RING.x, 0.42, RING.z);
  scene.add(ringPool);
  const shaft = glow(GOLD_HI, 1, 0.08);
  shaft.scale.set(5, 9, 1);
  shaft.position.set(RING.x, 4.2, RING.z - 0.6);
  scene.add(shaft);
  const ringLamp = PH ? null : new PointLight(0xffd9a0, 9, 9, 1.6);
  if (ringLamp) {
    ringLamp.position.set(RING.x, 4.6, RING.z + 0.4);
    scene.add(ringLamp);
  }

  const unitG = keep(new BoxGeometry(1, 1, 1));
  const unitEdges = keep(new EdgesGeometry(unitG));
  const stripGeo = keep(new BoxGeometry(0.07, 1, 0.02));
  const ticketG = keep(new PlaneGeometry(1.7, 1.08));
  const tFrameG = keep(new BoxGeometry(1.78, 1.16, 0.04));
  const pillarHitG = keep(new BoxGeometry(1.7, 1, 1.0));
  const pillarM = keep(new MeshStandardMaterial({ color: 0x15161b, metalness: 0.55, roughness: 0.3, emissive: 0x0d0a04 }));
  const holds: HoldRig[] = SLOTS.map((_, k) => {
    const [x, z] = slotAt(k);
    const g = new Group();
    g.position.set(x, 0.36, z);
    const col = new Group();
    const solid = new Mesh(unitG, pillarM);
    solid.scale.set(0.7, 1, 0.7);
    solid.position.y = 0.5;
    const wire = new LineSegments(unitEdges, goldLine);
    wire.scale.set(0.72, 1, 0.72);
    wire.position.y = 0.5;
    const stripM = keep(new MeshBasicMaterial({ color: TONE.flat, transparent: true, opacity: 0.9, toneMapped: false }));
    const strip = new Mesh(stripGeo, stripM);
    strip.position.set(0, 0.5, 0.365);
    col.add(solid, wire, strip);
    col.scale.y = EMPTY_H;
    g.add(col);
    const cap = skin(new Mesh(keep(new BoxGeometry(0.9, 0.07, 0.9)), brass), goldLine, 30);
    cap.name = "cap";
    g.add(cap);
    const cv = document.createElement("canvas");
    cv.width = PH ? 256 : 448;
    cv.height = PH ? 162 : 284;
    const tex = keep(new CanvasTexture(cv));
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    const screen = keep(new MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));
    const ticket = new Mesh(ticketG, screen);
    const frame = skin(new Mesh(tFrameG, lacquer), goldWire, 30);
    frame.position.z = -0.03;
    ticket.add(frame);
    g.add(ticket);
    const pool = glow(TONE.flat, 2.6, 0);
    pool.position.y = 0.06;
    g.add(pool);
    const hit = new Mesh(pillarHitG, hitMat);
    g.add(hit);
    scene.add(g);
    return { g, at: new Vector3(x, 0.36, z), col, solid, wire, strip, stripM, ticket, canvas: cv, tex, screen, pool, hit, hold: null, sig: "", h: EMPTY_H, lit: 0, phase: k * 1.7 };
  });

  // The book's kiosk: a low brass-rimmed podium with one angled screen, at the ring's front lip.
  const kiosk = new Group();
  kiosk.position.set(BOOK[0], 0.02, BOOK[1]);
  const kBase = skin(new Mesh(keep(new BoxGeometry(1.6, 1.05, 0.9)), shell));
  kBase.position.y = 0.52;
  kiosk.add(kBase);
  const kTop = skin(new Mesh(keep(new BoxGeometry(1.75, 0.07, 1.05)), brass));
  kTop.position.y = 1.08;
  kiosk.add(kTop);
  const bookCv = document.createElement("canvas");
  bookCv.width = PH ? 256 : 512;
  bookCv.height = PH ? 160 : 320;
  const bookTex = keep(new CanvasTexture(bookCv));
  bookTex.colorSpace = SRGBColorSpace;
  const kScr = new Mesh(keep(new PlaneGeometry(1.5, 0.94)), keep(new MeshBasicMaterial({ map: bookTex, toneMapped: false })));
  kScr.position.set(0, 1.62, 0.05);
  kScr.rotation.x = -0.32;
  kiosk.add(kScr);
  const kFrame = skin(new Mesh(keep(new BoxGeometry(1.6, 1.04, 0.06)), lacquer));
  kFrame.position.set(0, 1.62, 0.0);
  kFrame.rotation.x = -0.32;
  kiosk.add(kFrame);
  kiosk.rotation.y = 0;
  const kHit = new Mesh(keep(new BoxGeometry(2, 2.4, 1.4)), hitMat);
  kHit.position.y = 1.2;
  kiosk.add(kHit);
  scene.add(kiosk);

  // ---- the nanites: tick bursts off the crowns, and the stream into the posts being built ----------------------------
  const NB = PH ? 90 : 240;
  const NS = (PH ? 26 : 70) * SOON.length;
  /** The nanites rising off the pillars' tops, a share each (or, signed out, drifting up the empty wire). */
  const NH = (PH ? 12 : 30) * HOLDINGS;
  const NN = NB + NS + NH;
  const np = new Float32Array(NN * 3);
  const nt = new Float32Array(NN * 3);
  const na = new Float32Array(NN);
  const ng = new Float32Array(NN);
  const nz = new Float32Array(NN);
  for (let i = 0; i < NN; i++) {
    ng[i] = Math.floor(Math.random() * NG);
    nz[i] = i < NB ? 0.7 + Math.random() * 0.5 : i < NB + NS ? 0.45 + Math.random() * 0.4 : 0.4 + Math.random() * 0.35;
  }
  const nGeo = keep(new BufferGeometry());
  nGeo.setAttribute("position", new BufferAttribute(np, 3));
  nGeo.setAttribute("tint", new BufferAttribute(nt, 3));
  nGeo.setAttribute("alpha", new BufferAttribute(na, 1));
  nGeo.setAttribute("glyph", new BufferAttribute(ng, 1));
  nGeo.setAttribute("sz", new BufferAttribute(nz, 1));
  const nanites = new Points(nGeo, keep(glyphMaterial(atlas, px, 22)));
  nanites.frustumCulled = false;
  nanites.renderOrder = 10;
  scene.add(nanites);
  type Mote = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; c: Color };
  const motes: Mote[] = Array.from({ length: NB }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, c: new Color() }));
  let mi = 0;
  const spawn = (x: number, y: number, z: number, c: Color) => {
    const m = motes[mi]!;
    ng[mi] = Math.floor(Math.random() * NG);
    mi = (mi + 1) % NB;
    const a = Math.random() * Math.PI * 2;
    const s = 0.4 + Math.random() * 0.9;
    Object.assign(m, { x: x + Math.cos(a) * CROWN_R, y: y + (Math.random() - 0.5) * 0.8, z: z + Math.sin(a) * CROWN_R, vx: Math.cos(a) * s * 0.4, vy: 0.7 + Math.random() * 0.9, vz: Math.sin(a) * s * 0.4, life: 1.6 + Math.random() * 1.2 });
    m.max = m.life;
    m.c.copy(c);
  };
  const streams = Array.from({ length: NS }, (_, i) => ({ post: i % SOON.length, a: Math.random() * Math.PI * 2, r: 2.4 + Math.random() * 2.2, k: Math.random(), w: 0.12 + Math.random() * 0.2, lift: 1 + Math.random() * 2.4 }));
  const goldC = new Color(GOLD_HI);
  const climbs = Array.from({ length: NH }, (_, i) => ({ slot: i % HOLDINGS, k: Math.random(), w: 0.18 + Math.random() * 0.22, a: Math.random() * Math.PI * 2, r: 0.12 + Math.random() * 0.4, rise: 1.4 + Math.random() * 2.2 }));

  // ---- the motes: a dense field of gold dust drifting up through the hall, moved on the GPU (one draw) -------------
  const NM = PH ? 900 : 3200;
  const mBase = new Float32Array(NM * 3);
  const mSeed = new Float32Array(NM);
  for (let i = 0; i < NM; i++) {
    // Thickest over the floor's middle and round the ring, thinning toward the walls.
    const near = Math.random() < 0.35;
    const r = near ? Math.random() * 6 : Math.pow(Math.random(), 0.7) * 22;
    const a = Math.random() * Math.PI * 2;
    mBase.set([(near ? RING.x : 0) + Math.cos(a) * r * (near ? 1.1 : 1), Math.random() * 14, (near ? RING.z : -3) + Math.sin(a) * r * (near ? 0.5 : 0.75)], i * 3);
    mSeed[i] = Math.random();
  }
  const mGeo = keep(new BufferGeometry());
  mGeo.setAttribute("position", new BufferAttribute(mBase, 3));
  mGeo.setAttribute("seed", new BufferAttribute(mSeed, 1));
  const moteU = { t: { value: 0 }, px };
  const motesM = keep(
    new ShaderMaterial({
      uniforms: moteU,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: `attribute float seed; uniform float t, px; varying float vA; varying float vS;
        void main(){ vec3 p = position; float sp = .12 + seed * .3;
          p.y = mod(p.y + t * sp, 14.);
          p.x += sin(t * .23 + seed * 31.) * (.25 + seed * .5);
          p.z += cos(t * .19 + seed * 17.) * (.25 + seed * .4);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          float tw = .55 + .45 * sin(t * (1.1 + seed * 2.3) + seed * 40.);
          vA = tw * smoothstep(0., 1.2, p.y) * (1. - smoothstep(10., 14., p.y)) * (1. - smoothstep(30., 60., -mv.z));
          vS = seed;
          gl_PointSize = (1.6 + seed * seed * 4.2) * px * (14. / -mv.z);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying float vS;
        void main(){ vec2 q = gl_PointCoord - .5; float d = dot(q, q); if (d > .25) discard;
          float a = vA * (1. - d * 4.); vec3 c = mix(vec3(.79, .62, .3), vec3(1., .9, .65), vS);
          gl_FragColor = vec4(c, a * .8); }`,
    }),
  );
  const moteField = new Points(mGeo, motesM);
  moteField.frustumCulled = false;
  moteField.renderOrder = 9;
  scene.add(moteField);

  // ---- the edges come undone ----------------------------------------------------------------------------------------
  let stepUndone: ((t: number, r: WebGLRenderer) => void) | null = null;
  {
    const wire: number[] = [];
    for (let x = -24; x <= 24; x += 2) wire.push(x, 0.02, -20, x, 0.02, 14);
    for (let z = -20; z <= 14; z += 2) wire.push(-24, 0.02, z, 24, 0.02, z);
    for (let x = -28; x <= 28; x += 2) wire.push(x, 0, -12.9, x, 16, -12.9);
    for (let y = 0; y <= 16; y += 2) wire.push(-28, y, -12.9, 28, y, -12.9);
    for (const [x, z] of cols) {
      for (const [dx, dz] of [
        [-0.46, -0.46],
        [0.46, -0.46],
        [0.46, 0.46],
        [-0.46, 0.46],
      ] as const)
        wire.push(x + dx, 0, z + dz, x + dx, 13, z + dz);
      for (let y = 1; y < 13; y += 1.5) ring(wire, x, y, z, 0.66, 4);
    }
    // The side walls' grid, the plinth's rings and the pillars' slots, so the ring and the hall's sides come undone too.
    for (let z = -12; z <= 8; z += 2) for (const x of [-23.5, 23.5]) wire.push(x, 0, z, x, 14, z);
    for (let y = 0; y <= 14; y += 2) for (const x of [-23.5, 23.5]) wire.push(x, y, -12, x, y, 8);
    for (const [d, y] of [
      [0.05, 0.38],
      [0.6, 0.02],
      [1.2, 0.02],
    ] as const)
      oval(wire, RING.x, y, RING.z, RING.rx + d, RING.rz + d, 56);
    for (let k = 0; k < SLOTS.length; k++) {
      const [x, z] = slotAt(k);
      ring(wire, x, 0.4, z, 0.5, 4);
    }
    for (const [x, z] of [...LIVE, ...SOON]) {
      ring(wire, x, 0.16, z, 1.8);
      ring(wire, x, 1.06, z, 1.84);
      ring(wire, x, CROWN_Y + 0.56, z, CROWN_R + 0.14, 6);
    }
    for (let k = 0; k <= 40; k++) {
      const a = th0 + (k / 40) * MQ.arc;
      const b = th0 + ((k + 1) / 40) * MQ.arc;
      if (k < 40) for (const y of [MQ.y - MQ.h / 2 - 0.2, MQ.y + MQ.h / 2 + 0.2]) wire.push(Math.sin(a) * MQ.r, y, MQ.cz + Math.cos(a) * MQ.r, Math.sin(b) * MQ.r, y, MQ.cz + Math.cos(b) * MQ.r);
    }
    const ND = PH ? 640 : 2000;
    const dust = new Float32Array(ND * 3);
    for (let i = 0; i < ND; i++) {
      const u = Math.random();
      if (u < 0.6) dust.set([(Math.random() - 0.5) * 48, 0.05, -20 + Math.random() * 34], i * 3);
      else if (u < 0.78) dust.set([(Math.random() - 0.5) * 56, Math.random() * 15, -12.8], i * 3);
      else if (u < 0.86) dust.set([Math.sign(Math.random() - 0.5) * 23.4, Math.random() * 14, -12 + Math.random() * 20], i * 3);
      else {
        const [x, z] = cols[Math.floor(Math.random() * cols.length)]!;
        dust.set([x + (Math.random() - 0.5), Math.random() * 13, z + (Math.random() - 0.5)], i * 3);
      }
    }
    const undone = comeUndone({
      wire,
      dust,
      atlas,
      px,
      peel: PH ? 200 : 640,
      keep,
      shape: [0.84, 1.28],
      drift: (x, y, z) => (y < 0.1 ? [(Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3] : z < -12 ? [(Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.5, 0.4 + Math.random() * 0.6] : [-Math.sign(x) * (0.3 + Math.random() * 0.5), 0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3]),
    });
    undone.addTo(scene);
    stepUndone = undone.step;
  }

  // ---- what the floor shows ---------------------------------------------------------------------------------------
  const tc = new Color();
  const paintPost = (rig: PostRig, i: number) => {
    const g = rig.canvas.getContext("2d")!;
    g.save();
    if (PH) g.scale(0.5, 0.5);
    drawScreen(g, 512, 416, rig.post ? { post: rig.post, rank: i } : { empty: view.status === "reading" ? "READING…" : "—" });
    g.restore();
    rig.tex.needsUpdate = true;
  };
  const paintSoon = () =>
    soon.forEach((s, i) => {
      const u = s.g.userData as { cv: HTMLCanvasElement; tex: CanvasTexture };
      const g = u.cv.getContext("2d")!;
      const it = view.soon[i];
      g.save();
      if (PH) g.scale(0.5, 0.5);
      drawScreen(g, 512, 416, it ? { soon: it } : { empty: "" });
      g.restore();
      u.tex.needsUpdate = true;
      showParts(s.g, !!it);
    });
  const paintBook = () => {
    const g = bookCv.getContext("2d")!;
    g.save();
    if (PH) g.scale(0.5, 0.5);
    drawBook(g, 512, 320, view.book);
    g.restore();
    bookTex.needsUpdate = true;
  };
  const paintHold = (rig: HoldRig, k: number) => {
    const g = rig.canvas.getContext("2d")!;
    g.save();
    if (PH) g.scale(256 / 448, 256 / 448);
    if (rig.hold) drawTicket(g, 448, 284, rig.hold, k, !!view.book.hide);
    else g.clearRect(0, 0, 448, 284);
    g.restore();
    rig.tex.needsUpdate = true;
  };
  const applyHolds = () => {
    const list = view.book.state === "live" ? (view.book.holds ?? []) : [];
    holds.forEach((rig, k) => {
      const t = list[k] ?? null;
      const sig = t ? `${t.name}|${t.side}|${t.share.toFixed(3)}|${t.tone}|${view.book.hide ? 1 : 0}` : "-";
      rig.hold = t;
      if (sig !== rig.sig) paintHold(rig, k);
      rig.sig = sig;
      rig.stripM.color.setHex(t ? TONE[t.tone] : GOLD);
      (rig.pool.material as SpriteMaterial).color.setHex(t ? TONE[t.tone] : GOLD);
    });
  };
  const apply = (first: boolean) => {
    const was = new Map(posts.map((r) => [r.post?.id ?? "", r.post?.prob ?? -1]));
    posts.forEach((rig, i) => {
      const p = view.posts[i] ?? null;
      const before = p ? was.get(p.id) : undefined;
      const sig = p ? `${p.id}|${p.odds}|${p.move}|${p.name}` : `-${view.status}`;
      rig.post = p;
      if (sig !== rig.sig || first) paintPost(rig, i);
      rig.sig = sig;
      rig.strip.color.setHex(p ? TONE[p.tone] : 0x3a3a3e);
      (rig.pool.material as SpriteMaterial).color.setHex(p ? TONE[p.tone] : GOLD);
      if (!first && p && before !== undefined && before >= 0 && Math.abs(before - p.prob) >= 0.001 && !reduce) {
        rig.flash = 1;
        tc.setHex(TONE[p.prob > before ? "up" : "down"]);
        for (let k = 0; k < 18; k++) spawn(rig.at.x, CROWN_Y + 0.2, rig.at.z, tc);
      }
    });
    paintTape();
    paintSoon();
    paintBook();
    applyHolds();
  };
  apply(true);

  // ---- sizing, the camera, the pointer, the keys -------------------------------------------------------------------
  const phone = () => host.clientWidth < PHONE_W;
  const size = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < PHONE_W ? 52 : 40;
    cam.updateProjectionMatrix();
    px.value = renderer.getPixelRatio();
  };
  size();
  const guard = dprGuard((d) => {
    renderer.setPixelRatio(d);
    size();
  });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
  ro?.observe(host);
  let yaw = 0;
  let yawTo = 0;
  let zoom = 1;
  let zoomTo = 1;
  // Aimed a little forward of the floor's middle (#988), so the book's ring sits front and centre.
  const look = new Vector3(0, 2.4, -2.9);
  // WASD swivels the view round the floor (not free roam): A/D within a set arc, W/S in and out within tight bounds,
  // both resisted past the soft edge and eased back inside it when the keys let go; Escape snaps home. Ignored while
  // typing, and Space is left alone for hold-to-talk (the shared helper's rules).
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => ({ kind: "disc", cx: look.x, cz: look.z, r: 1 }),
    origin: () => [look.x, look.z],
    forward: () => [look.x - cam.position.x, look.z - cam.position.z],
    orbit: {
      turn: (r) => (yawTo = swing(yawTo, r * 0.7, ARC)),
      zoom: (a) => (zoomTo = 1 + swing(zoomTo - 1, -a * 0.3, ZOOM_ARC)),
      home: () => {
        yawTo = 0;
        zoomTo = 1;
      },
    },
  });
  const ray = new Raycaster();
  const ptr = new Vector2();
  let downAt: { x: number; y: number } | null = null;
  let lastX = 0;
  let hover: string | null = null;
  let focusId: string | null = null;
  const pickAt = (cx: number, cy: number): string | null => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, cam);
    const list: [Object3D, string][] = posts.filter((p) => p.post).map((p) => [p.hit, p.post!.id]);
    list.push([kHit, "book"]);
    for (const h of holds) if (h.hold) list.push([h.hit, h.hold.id]);
    const hit = ray.intersectObjects(
      list.map(([m]) => m),
      false,
    )[0];
    return hit ? (list.find(([m]) => m === hit.object)?.[1] ?? null) : null;
  };
  const onMove = (e: PointerEvent) => {
    if (downAt) {
      yawTo = swing(yawTo, -(e.clientX - lastX) * 0.005, ARC);
      lastX = e.clientX;
      return;
    }
    if (e.pointerType !== "mouse") return;
    const id = pickAt(e.clientX, e.clientY);
    canvas.style.cursor = id ? "pointer" : "grab";
    if (id !== hover) {
      hover = id;
      opts.onHover(id);
    }
  };
  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
    lastX = e.clientX;
  };
  const onUp = (e: PointerEvent) => {
    const d = downAt;
    downAt = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id) opts.onPick(id);
  };
  const onLeave = () => {
    downAt = null;
    if (hover) opts.onHover((hover = null));
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  // ---- anchors for the tags ----------------------------------------------------------------------------------------
  const placed = new Map<string, string>();
  const tmp = new Vector3();
  const report = (id: string, p: Vector3, show = true) => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    tmp.copy(p).project(cam);
    const x = ((tmp.x + 1) / 2) * w;
    const y = ((1 - tmp.y) / 2) * h;
    const on = show && tmp.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
    const k = on ? `${Math.round(x)}|${Math.round(y)}` : "off";
    if (placed.get(id) === k) return;
    placed.set(id, k);
    opts.onPlace(id, x, y, on);
  };

  // ---- each frame ---------------------------------------------------------------------------------------------------
  let T = 0;
  let scroll = 0;
  const tA = new Vector3();
  const draw = (dt: number) => {
    T += dt * (reduce ? 0 : 1);
    stepUndone?.(reduce ? 0 : T, renderer);
    // The marquee runs at a steady reading pace; a whole pass per screen's worth of strip.
    if (!reduce && reps) {
      // About 1.4 m of band a second, whatever the strip holds.
      scroll += (dt * 1.4) / ((STRIP / 192) * MQ.h);
      tapeTex.offset.x = -(scroll % 1);
    }
    mqGlow.material.opacity = 0.1 + (reduce ? 0 : 0.03 * Math.sin(T * 0.9));
    // The posts: the lit one brighter, a tick's flash fading, the pool of light as wide as the market's share.
    posts.forEach((rig, i) => {
      const p = rig.post;
      const lit = !!p && (p.id === focusId || p.id === hover);
      rig.lit = damp(rig.lit, lit ? 1 : 0, 6, dt);
      rig.flash = Math.max(0, rig.flash - dt * 0.8);
      const k = 1 + rig.flash * 0.9 + rig.lit * 0.25;
      rig.screen.color.setScalar(p ? k : 0.55);
      rig.strip.opacity = p ? 0.55 + 0.35 * rig.lit + 0.25 * rig.flash + (reduce ? 0 : 0.08 * Math.sin(T * 1.6 + i)) : 0.25;
      const share = p ? 0.35 + 0.65 * Math.sqrt(p.share) : 0;
      (rig.pool.material as SpriteMaterial).opacity = p ? 0.1 + 0.16 * share + 0.18 * rig.lit + 0.2 * rig.flash : 0;
      rig.pool.scale.setScalar(4 + 4 * share);
      if (rig.light) {
        rig.light.intensity = p ? 3 + 6 * rig.lit + 8 * rig.flash : 0;
        if (p) rig.light.color.setHex(rig.flash > 0.05 ? TONE[p.tone] : 0xffe2b0);
      }
    });
    // The book's ring: each pillar grows to its share, its ticket turned to the view and bobbing a little; signed out
    // (or with nothing open) the pillars stand empty in wire.
    moteU.t.value = T;
    const holdsOn = view.book.state === "live" && (view.book.holds?.length ?? 0) > 0;
    rimM.opacity = 0.7 + (reduce ? 0 : 0.15 * Math.sin(T * 1.3));
    ringGlowM.opacity = (holdsOn ? 0.45 : 0.25) + (reduce ? 0 : 0.15 * Math.sin(T * 0.7));
    holds.forEach((rig) => {
      const t = rig.hold;
      const on = !!t;
      rig.g.visible = on || !holdsOn;
      if (!rig.g.visible) return;
      const target = t ? pillarH(t.rel) : EMPTY_H;
      rig.h = reduce ? target : damp(rig.h, target, 2.4, dt);
      rig.col.scale.y = rig.h;
      rig.solid.visible = on;
      rig.strip.visible = on;
      rig.wire.material = on ? goldLine : goldWire;
      const cap = rig.g.getObjectByName("cap");
      if (cap) {
        cap.visible = on;
        cap.position.y = rig.h + 0.035;
      }
      const lit = on && (t.id === focusId || t.id === hover);
      rig.lit = damp(rig.lit, lit ? 1 : 0, 6, dt);
      rig.ticket.visible = on;
      rig.ticket.position.y = rig.h + 0.72 + (reduce ? 0 : Math.sin(T * 0.8 + rig.phase) * 0.05);
      rig.ticket.rotation.y = Math.atan2(cam.position.x - rig.at.x, cam.position.z - rig.at.z);
      rig.screen.color.setScalar(1 + 0.3 * rig.lit);
      rig.stripM.opacity = 0.6 + 0.3 * rig.lit + (reduce ? 0 : 0.1 * Math.sin(T * 1.8 + rig.phase));
      (rig.pool.material as SpriteMaterial).opacity = on ? 0.2 + 0.25 * rig.lit : 0.07;
      rig.hit.scale.y = rig.h + 1.2;
      rig.hit.position.y = (rig.h + 1.2) / 2;
    });
    for (let j = 0; j < NH; j++) {
      const q = NB + NS + j;
      const c = climbs[j]!;
      const rig = holds[c.slot];
      if (!rig || !rig.g.visible) {
        na[q] = 0;
        continue;
      }
      const on = !!rig.hold;
      c.k += dt * c.w * (reduce ? 0 : on ? 1 : 0.5);
      if (c.k >= 1) {
        c.k -= 1;
        c.a = Math.random() * Math.PI * 2;
        ng[q] = Math.floor(Math.random() * NG);
      }
      const a = c.a + c.k * 1.6;
      const r = c.r * (1 + c.k * 1.5);
      np.set([rig.at.x + Math.cos(a) * r, rig.at.y + (on ? rig.h : 0.1) + c.k * c.rise * (on ? 1.3 : 0.9), rig.at.z + Math.sin(a) * r], q * 3);
      nt.set([goldC.r, goldC.g, goldC.b], q * 3);
      na[q] = Math.sin(Math.PI * Math.min(1, c.k)) * (on ? 0.8 : 0.4);
    }
    // The posts being built: the solid rises slowly into its wire and the nanites stream in at the line.
    soon.forEach((s) => {
      const u = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(T * 0.12 + s.phase);
      s.y = 1.3 + ease(u) * 1.7;
      s.plane.constant = s.at.y + s.y;
      s.band.position.y = s.y;
      (s.band.material as MeshBasicMaterial).opacity = 0.55 + (reduce ? 0 : 0.3 * Math.sin(T * 3 + s.phase));
    });
    for (let i = 0; i < NB; i++) {
      const m = motes[i]!;
      if (m.life <= 0) {
        na[i] = 0;
        continue;
      }
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      np.set([m.x, m.y, m.z], i * 3);
      nt.set([m.c.r, m.c.g, m.c.b], i * 3);
      const f = m.life / m.max;
      na[i] = Math.max(0, Math.min(1, f * 2.5) * Math.min(1, (1 - f) * 6)) * 0.85;
    }
    for (let j = 0; j < NS; j++) {
      const q = NB + j;
      const st = streams[j]!;
      const s = soon[st.post]!;
      if (!isShown(s.g)) {
        na[q] = 0;
        continue;
      }
      st.k += dt * st.w * (reduce ? 0 : 1);
      if (st.k >= 1) {
        st.k -= 1;
        st.a = Math.random() * Math.PI * 2;
        ng[q] = Math.floor(Math.random() * NG);
      }
      const e = ease(Math.min(1, st.k));
      const r = st.r + (1.8 - st.r) * e;
      const a = st.a + e * 1.4;
      np.set([s.at.x + Math.cos(a) * r, s.at.y + s.y + st.lift * (1 - e), s.at.z + Math.sin(a) * r], q * 3);
      nt.set([goldC.r, goldC.g, goldC.b], q * 3);
      na[q] = Math.min(1, st.k * 5) * (1 - Math.max(0, (st.k - 0.85) / 0.15)) * 0.7;
    }
    for (const k of ["position", "tint", "alpha", "glyph"]) nGeo.attributes[k]!.needsUpdate = true;
    // The camera: up in the gallery, looking down across the posts at the marquee; it sways a little.
    pan.step(dt);
    const ek = reduce ? 1 : 1 - Math.exp(-dt * 4);
    if (!pan.busy && !downAt) {
      if (Math.abs(yawTo) > ARC * SOFT) yawTo = damp(yawTo, Math.sign(yawTo) * ARC * SOFT, 4, dt);
      if (Math.abs(zoomTo - 1) > ZOOM_ARC * SOFT) zoomTo = damp(zoomTo, 1 + Math.sign(zoomTo - 1) * ZOOM_ARC * SOFT, 4, dt);
    }
    yaw += (yawTo - yaw) * ek;
    zoom += (zoomTo - zoom) * ek;
    const ph = phone();
    const th = Math.PI / 2 + yaw + (reduce ? 0 : Math.sin(T * 0.05) * 0.05);
    const D = (ph ? (cam.aspect < 0.7 ? 31 : 27) : 23.5) * zoom;
    const camY = (ph ? 11 : 9.4) * (0.65 + 0.35 * zoom);
    cam.position.set(look.x + Math.cos(th) * D, camY, look.z + Math.sin(th) * D);
    cam.lookAt(look.x, look.y, look.z);
    const w = host.clientWidth;
    const h = host.clientHeight;
    const inset = ph ? 0 : opts.inset();
    cam.setViewOffset(w, h, inset / 2, ph ? -h * 0.08 : -h * 0.07, w, h);
    renderer.render(scene, cam);
    posts.forEach((rig) => {
      if (rig.post) report(rig.post.id, tA.set(rig.at.x, rig.at.y + POST_H + 0.25, rig.at.z));
    });
    report("book", tA.set(BOOK[0], 2.35, BOOK[1]));
    holds.forEach((rig) => {
      if (rig.hold) report(rig.hold.id, tA.set(rig.at.x, rig.at.y + rig.h + 1.32, rig.at.z));
    });
    soon.forEach((s, i) => report(`soon-${i}`, tA.set(s.at.x, POST_H + 0.4, s.at.z), isShown(s.g)));
  };

  // ---- the loop ---------------------------------------------------------------------------------------------------
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
  const minStep = PH ? 1000 / 30 - 2 : 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    guard.frame(now);
    if (!visible || document.visibilityState === "hidden") {
      last = now;
      return;
    }
    if (now - last < minStep) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    draw(dt);
  };
  // Compile before the first frame (#759), then one draw, still unseen, so the first frame on screen doesn't stall.
  await yieldNow();
  await renderer.compileAsync(scene, cam).catch(() => undefined);
  await yieldNow();
  draw(0.016);
  raf = requestAnimationFrame(frame);

  return {
    set: (next) => {
      view = next;
      apply(false);
    },
    focus: (id) => {
      focusId = id;
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      pan.dispose();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** How many posts the floor has room for (the page shows the rest in its list). */
export const POST_SLOTS = Math.min(POSTS, LIVE.length);
