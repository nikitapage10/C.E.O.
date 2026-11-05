import * as THREE from "three";
import type { Kind, Spot } from "./data.ts";
import type { GymGeo } from "./gymKit.ts";

/**
 * The home's furniture and pet devices in 3D (#747), the way gymKit.ts models the Gym: a few primitives each, in the
 * night-interior look (black flat-front cabinets, white stone tops, stainless appliances, white sanitaryware, glass).
 * Each model is built along its local X (the run along the wall it stands against), its back at local +Z (the wall),
 * its front at -Z (the room), on the floor at its middle, and sized to the plan's footprint. house.ts turns it so its
 * back meets the nearest wall.
 */

export const HOME_MODELS = new Set<Kind>([
  "counter", "range", "fridge", "island", "tv", "sofa", "cattree", "lamp", "shower", "tub", "wc", "vanity",
  "towelbar", "litterbox", "coatrack", "tunnel", "greenhouse", "bowls", "sideboard", "upper", "dj", "art", "espresso",
]);

export interface HomeMats {
  black: THREE.MeshStandardMaterial;
  soft: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  marble: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  green: THREE.MeshBasicMaterial;
  warm: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  grey: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  /** The canvases' picture (#764): black-and-white trees and mountains, drawn here, no image file. */
  art: THREE.MeshStandardMaterial;
}

/**
 * One black-and-white picture of trees and mountains (#764), drawn on a canvas: a pale sky, three ranges of peaks
 * fading into mist, snow on the far ones, and a dark line of pines along the bottom. Seeded, so it is the same each time.
 */
export function drawArt(c: HTMLCanvasElement) {
  const W = (c.width = 1000), H = (c.height = 600);
  const x = c.getContext("2d");
  if (!x) return;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sky = x.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#f4f4f2");
  sky.addColorStop(0.55, "#d9d9d6");
  sky.addColorStop(1, "#bdbdba");
  x.fillStyle = sky;
  x.fillRect(0, 0, W, H);
  const range = (base: number, amp: number, step: number, tone: string, snow: boolean) => {
    const pts: [number, number][] = [];
    for (let px = -step; px <= W + step; px += step * (0.6 + rnd() * 0.8)) pts.push([px, base - amp * (0.35 + rnd() * 0.65)]);
    x.beginPath();
    x.moveTo(-step, H);
    for (const [px, py] of pts) x.lineTo(px, py);
    x.lineTo(W + step, H);
    x.closePath();
    x.fillStyle = tone;
    x.fill();
    if (snow)
      for (const [px, py] of pts)
        if (py < base - amp * 0.6) {
          x.beginPath();
          x.moveTo(px, py);
          x.lineTo(px - 18, py + 26);
          x.lineTo(px - 4, py + 20);
          x.lineTo(px + 6, py + 30);
          x.lineTo(px + 20, py + 24);
          x.closePath();
          x.fillStyle = "rgba(250,250,248,0.9)";
          x.fill();
        }
    const mist = x.createLinearGradient(0, base - 30, 0, base + 60);
    mist.addColorStop(0, "rgba(235,235,232,0)");
    mist.addColorStop(1, "rgba(235,235,232,0.55)");
    x.fillStyle = mist;
    x.fillRect(0, base - 30, W, 90);
  };
  range(300, 210, 90, "#9a9a98", true);
  range(380, 150, 70, "#6c6c6b", true);
  range(460, 110, 55, "#3e3e3e", false);
  // The pines: stacked triangles on a dark bank.
  x.fillStyle = "#121212";
  x.fillRect(0, 540, W, 60);
  for (let px = -10; px < W + 20; px += 14 + rnd() * 22) {
    const h = 70 + rnd() * 120, w = h * (0.28 + rnd() * 0.08), base = 548 + rnd() * 20;
    x.fillStyle = rnd() > 0.5 ? "#0c0c0c" : "#1c1c1c";
    for (let k = 0; k < 4; k++) {
      const top = base - h + (k * h) / 5, bot = base - h + ((k + 1.6) * h) / 5, ww = w * (0.45 + k * 0.2);
      x.beginPath();
      x.moveTo(px, top);
      x.lineTo(px - ww / 2, bot);
      x.lineTo(px + ww / 2, bot);
      x.closePath();
      x.fill();
    }
    x.fillRect(px - 1.5, base - 6, 3, 10);
  }
  // A fine grain, like a print.
  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(rnd() * 255);
    x.fillStyle = `rgba(${v},${v},${v},0.05)`;
    x.fillRect(rnd() * W, rnd() * H, 1.4, 1.4);
  }
}

export function homeMats(): HomeMats {
  const m = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  return {
    black: m({ color: 0x111113, roughness: 0.45 }),
    soft: m({ color: 0x18181b, roughness: 0.95 }),
    stone: m({ color: 0xeeece8, roughness: 0.3 }),
    marble: m({ color: 0xe4e3e0, roughness: 0.22, emissive: 0x101012, emissiveIntensity: 0.2 }),
    white: m({ color: 0xf3f3f1, roughness: 0.28 }),
    steel: m({ color: 0xb9bcc0, roughness: 0.28, metalness: 0.85 }),
    chrome: m({ color: 0xdfe3e8, roughness: 0.12, metalness: 0.95 }),
    glass: m({ color: 0xd8e6f0, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    screen: m({ color: 0x08090c, roughness: 0.2, emissive: 0x0c1a2e, emissiveIntensity: 1 }),
    green: new THREE.MeshBasicMaterial({ color: 0x39ff7a, transparent: true, opacity: 0.85 }),
    warm: m({ color: 0xfff1d6, roughness: 0.4, emissive: 0xffd29a, emissiveIntensity: 1.2 }),
    dark: m({ color: 0x050506, roughness: 0.6 }),
    grey: m({ color: 0x8a8d92, roughness: 0.6 }),
    leaf: m({ color: 0x3f8f52, roughness: 0.7, emissive: 0x7dff9a, emissiveIntensity: 0.15 }),
    art: artMat(),
  };
}

function artMat(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, emissive: 0xffffff, emissiveIntensity: 0.12 });
  if (typeof document === "undefined") return mat;
  const c = document.createElement("canvas");
  drawArt(c);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  mat.map = tex;
  mat.emissiveMap = tex;
  return mat;
}

export function disposeHomeMats(m: HomeMats) {
  m.art.map?.dispose();
  for (const v of Object.values(m)) v.dispose();
}

/** A furniture model: L along the wall, D into the room, H tall, lifted `lift` off the floor. Null: draw it as a box. */
export function homeModel(G: GymGeo, M: HomeMats, k: Kind, L: number, D: number, H: number, lift: number): THREE.Group | null {
  const g = new THREE.Group();
  const b = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => G.b(g, mat, sx, sy, sz, x, y, z);
  const c = (mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: "x" | "y" | "z" = "y") => G.c(g, mat, r, len, x, y, z, axis);
  const fz = -D / 2;
  switch (k) {
    case "counter": {
      // Black flat-front base cabinets, a white stone top, a white marble backsplash up to the uppers.
      b(M.black, L, H - 0.03, D - 0.02, 0, (H - 0.03) / 2, 0.01);
      b(M.stone, L + 0.01, 0.03, D + 0.01, 0, H - 0.015, 0);
      b(M.marble, L, 0.27, 0.012, 0, H + 0.135, D / 2 - 0.006);
      const n = Math.max(1, Math.round(L / 0.5));
      for (let i = 1; i < n; i++) b(M.dark, 0.004, H - 0.06, 0.004, -L / 2 + (L * i) / n, (H - 0.03) / 2, fz - 0.001);
      return g;
    }
    case "upper": {
      // Floating black cabinets above the counter.
      b(M.black, L, H, D, 0, lift + H / 2, 0);
      return g;
    }
    case "range": {
      // A stainless gas range set into the run, its grates, and the stainless microwave over it.
      const top = 0.37;
      b(M.steel, L, top, D + 0.02, 0, top / 2, -0.01);
      b(M.dark, L * 0.86, 0.012, D * 0.8, 0, top + 0.006, 0);
      b(M.dark, L * 0.7, top * 0.45, 0.004, 0, top * 0.42, fz - 0.012);
      b(M.steel, L, 0.15, Math.max(0.2, D * 0.9), 0, 0.5 + 0.075, D / 2 - Math.max(0.2, D * 0.9) / 2);
      b(M.dark, L * 0.62, 0.11, 0.004, -L * 0.1, 0.575, D / 2 - Math.max(0.2, D * 0.9) - 0.002);
      return g;
    }
    case "fridge": {
      // A stainless French-door fridge, its freezer drawer below, set into floor-to-ceiling black cabinets.
      const h = Math.max(H, 0.9);
      b(M.black, L + 0.12, 1.12, D, 0, 0.56, 0.01);
      b(M.steel, L, h, D * 0.96, 0, h / 2, -0.02);
      b(M.dark, 0.006, h * 0.6, 0.004, 0, h * 0.68, fz - 0.002);
      b(M.dark, L, 0.006, 0.004, 0, h * 0.38, fz - 0.002);
      for (const s of [-1, 1]) c(M.chrome, 0.008, h * 0.4, s * 0.04, h * 0.66, fz - 0.03);
      b(M.chrome, L * 0.6, 0.012, 0.012, 0, h * 0.34, fz - 0.03);
      return g;
    }
    case "island": {
      // A white island on a recessed kick, green light under it.
      const kick = 0.06;
      b(M.white, L, H - kick, D, 0, kick + (H - kick) / 2, 0);
      b(M.stone, L + 0.03, 0.03, D + 0.03, 0, H - 0.015, 0);
      b(M.dark, L - 0.06, kick, D - 0.06, 0, kick / 2, 0);
      b(M.green, L - 0.02, 0.006, D - 0.02, 0, 0.004, 0);
      return g;
    }
    case "tv": {
      // A big flat TV on the wall, 16:9 (Nikita 2026-11-05: it read as a plain bar). Its height follows its width; it
      // hangs clear above the console, a thin black bezel round a dark glass screen with a faint glow, a slim chin with
      // a small light at the bottom, and a wall plate behind it so it stands off the wall.
      const h = L * (9 / 16), dep = 0.035, y0 = Math.max(lift, 0.62), cy = y0 + h / 2;
      b(M.dark, L * 0.3, h * 0.3, 0.02, 0, cy, D / 2 - 0.01);
      b(M.black, L, h, dep, 0, cy, D / 2 - 0.02 - dep / 2);
      const front = D / 2 - 0.02 - dep - 0.002;
      b(M.screen, L - 0.03, h - 0.045, 0.004, 0, cy + 0.008, front);
      b(M.dark, L, 0.022, dep + 0.006, 0, y0 + 0.011, D / 2 - 0.02 - dep / 2 - 0.003);
      b(M.warm, 0.012, 0.004, 0.004, 0, y0 + 0.011, front - 0.002);
      return g;
    }
    case "espresso": {
      // The silver Breville (Nikita 2026-11-05): a brushed-steel body, the bean hopper in smoked glass on top, the
      // group head and portafilter at the front with its black handle, a pressure dial, the steam wand at the side,
      // and the drip tray at the foot. It stands on whatever it sits on (lift).
      const W = Math.max(L, 0.3), d = Math.max(D, 0.28), h = Math.max(H, 0.4), y = lift;
      b(M.steel, W, h * 0.78, d, 0, y + (h * 0.78) / 2, 0);
      b(M.chrome, W * 1.01, 0.012, d * 1.01, 0, y + h * 0.78, 0);
      c(M.glass, W * 0.22, h * 0.22, -W * 0.18, y + h * 0.78 + h * 0.11, d * 0.08);
      c(M.black, W * 0.23, 0.02, -W * 0.18, y + h - 0.01, d * 0.08);
      b(M.dark, W * 0.86, 0.035, d * 0.42, 0, y + 0.018, -d / 2 - d * 0.18);
      b(M.chrome, W * 0.84, 0.004, d * 0.4, 0, y + 0.037, -d / 2 - d * 0.18);
      c(M.chrome, 0.035, 0.03, -W * 0.05, y + h * 0.42, -d / 2 - 0.012, "z");
      c(M.steel, 0.032, 0.03, -W * 0.05, y + h * 0.36, -d / 2 - 0.03);
      b(M.black, 0.03, 0.025, 0.13, -W * 0.05, y + h * 0.36, -d / 2 - 0.11);
      c(M.white, 0.03, 0.006, W * 0.22, y + h * 0.6, -d / 2 - 0.004, "z");
      c(M.chrome, 0.006, h * 0.32, W * 0.42, y + h * 0.35, -d / 2 - 0.03);
      b(M.warm, 0.02, 0.006, 0.004, W * 0.22, y + h * 0.3, -d / 2 - 0.003);
      return g;
    }
    case "sofa": {
      // A low black sofa: a base, seat cushions, a back along the wall side.
      const back = Math.min(0.2, D * 0.28);
      b(M.soft, L, H * 0.55, D, 0, (H * 0.55) / 2, 0);
      b(M.soft, L, H, back, 0, H / 2, D / 2 - back / 2);
      const n = Math.max(1, Math.round(L / 0.7));
      for (let i = 0; i < n; i++) b(M.soft, L / n - 0.02, 0.06, D - back - 0.02, -L / 2 + (L / n) * (i + 0.5), H * 0.55 + 0.03, -back / 2);
      return g;
    }
    case "cattree": {
      // A tall black cat tree: a base, posts, platforms and a perch at the top.
      const w = Math.min(L, D);
      b(M.soft, w, 0.04, w, 0, 0.02, 0);
      for (const [x, z] of [[-w * 0.22, -w * 0.18], [w * 0.2, w * 0.2]] as const) c(M.black, 0.035, H, x, H / 2, z);
      for (const [y, s, x] of [[0.3, 0.7, 0.05], [0.58, 0.6, -0.08], [H - 0.04, 0.75, 0]] as const) b(M.soft, w * s, 0.035, w * s, w * x, y, 0);
      b(M.soft, w * 0.5, 0.12, w * 0.5, 0, 0.48, w * 0.12);
      return g;
    }
    case "lamp": {
      // An arc floor lamp: a heavy base, a pole, an arm over, a lit shade.
      const h = Math.max(H, 0.8);
      c(M.black, Math.min(L, D) * 0.4, 0.03, 0, 0.015, 0);
      c(M.steel, 0.01, h, 0, h / 2, 0);
      c(M.steel, 0.01, 0.4, 0, h, -0.2, "z");
      G.s(g, M.warm, 0.07, 0, h - 0.05, -0.4);
      return g;
    }
    case "shower": {
      // A frameless glass walk-in shower: marble-look tile behind, a glass front with a steel handle, a head.
      b(M.marble, L, 1.08, 0.02, 0, 0.54, D / 2 - 0.01);
      b(M.white, L, 0.03, D, 0, 0.015, 0);
      b(M.glass, L, 1.0, 0.012, 0, 0.52, fz);
      b(M.glass, 0.012, 1.0, D, L / 2, 0.52, 0);
      c(M.steel, 0.008, 0.18, L * 0.1, 0.55, fz - 0.03);
      c(M.chrome, 0.05, 0.01, 0, 0.92, D / 2 - 0.12);
      return g;
    }
    case "tub": {
      // An alcove tub: the white tub, marble-look tile on the wall, a chrome head, a steel rod and a black curtain,
      // two black wire caddies.
      b(M.white, L, 0.24, D, 0, 0.12, 0);
      b(M.grey, L - 0.08, 0.01, D - 0.08, 0, 0.245, 0);
      b(M.marble, L, 0.84, 0.02, 0, 0.66, D / 2 - 0.01);
      c(M.chrome, 0.04, 0.01, -L * 0.3, 0.88, D / 2 - 0.1);
      c(M.steel, 0.008, L, 0, 0.98, fz + 0.02, "x");
      b(M.soft, L * 0.45, 0.72, 0.01, -L * 0.25, 0.62, fz + 0.03);
      for (const y of [0.55, 0.75]) b(M.black, 0.2, 0.06, 0.06, L * 0.22, y, D / 2 - 0.05);
      return g;
    }
    case "wc": {
      // A white toilet: the tank at the wall, the bowl and seat, a paper holder beside it.
      const w = Math.min(L, 0.42);
      b(M.white, w, 0.34, 0.16, 0, 0.32, D / 2 - 0.1);
      c(M.white, w * 0.42, 0.3, 0, 0.15, -D * 0.05);
      c(M.white, w * 0.46, 0.03, 0, 0.31, -D * 0.05);
      c(M.chrome, 0.02, 0.1, L / 2 + 0.06, 0.4, D / 2 - 0.05, "x");
      return g;
    }
    case "vanity": {
      // A long black vanity with steel bar pulls, a white top and an undermount sink, a chrome faucet, a black soap
      // pump; a wide frameless mirror over it with a bar light above.
      b(M.black, L, H - 0.03, D - 0.02, 0, (H - 0.03) / 2, 0.01);
      b(M.stone, L + 0.01, 0.03, D + 0.01, 0, H - 0.015, 0);
      const n = Math.max(2, Math.round(L / 0.45));
      for (let i = 0; i < n; i++) b(M.steel, Math.min(0.18, L / n - 0.08), 0.012, 0.012, -L / 2 + (L / n) * (i + 0.5), H * 0.72, fz - 0.012);
      b(M.dark, 0.36, 0.006, D * 0.5, 0, H + 0.002, 0);
      c(M.chrome, 0.012, 0.12, 0, H + 0.06, D / 2 - 0.08);
      c(M.black, 0.014, 0.08, 0.26, H + 0.04, D / 2 - 0.08);
      b(M.chrome, Math.min(L, L * 0.92), 0.4, 0.01, 0, H + 0.38, D / 2 - 0.005);
      b(M.warm, Math.min(L * 0.6, 1.0), 0.03, 0.04, 0, H + 0.62, D / 2 - 0.03);
      return g;
    }
    case "towelbar": {
      // A steel bar on the wall with two black towels over it.
      c(M.steel, 0.008, L, 0, lift + H, -0.01, "x");
      for (const s of [-1, 1]) b(M.soft, L * 0.4, H * 0.9, 0.02, s * L * 0.22, lift + H * 0.55, -0.01);
      return g;
    }
    case "litterbox": {
      // A small grey covered litter box.
      b(M.grey, L, H * 0.6, D, 0, H * 0.3, 0);
      b(M.grey, L * 0.96, H * 0.4, D * 0.9, 0, H * 0.8, 0.01);
      b(M.dark, L * 0.4, H * 0.45, 0.004, 0, H * 0.45, fz - 0.002);
      return g;
    }
    case "coatrack": {
      // A black coat rack, a coat or two on it, shoes on the floor by it.
      c(M.black, 0.015, H, 0, H / 2, 0.06);
      c(M.black, Math.min(L, D) * 0.35, 0.02, 0, 0.01, 0.06);
      b(M.soft, 0.18, 0.45, 0.1, 0, H - 0.32, 0.04);
      for (const x of [-0.12, 0.02, 0.14]) b(M.black, 0.08, 0.05, 0.2, x * (L / 0.44), 0.025, -0.1);
      return g;
    }
    case "tunnel": {
      // The white cat tunnel: two plush donuts side by side.
      const r = Math.min(D, L / 2) * 0.42;
      const tor = new THREE.TorusGeometry(r, r * 0.45, 12, 24);
      for (const s of [-1, 1]) {
        const o = new THREE.Mesh(tor, M.white);
        o.position.set(s * (L / 4), r * 0.45, 0);
        o.rotation.x = Math.PI / 2;
        o.scale.y = 1;
        g.add(o);
      }
      g.userData.dispose = () => tor.dispose();
      return g;
    }
    case "greenhouse": {
      // A small clear plant greenhouse on wheels, plants inside, a grow light on top.
      const h = Math.max(H, 0.9);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) c(M.dark, 0.015, 0.03, (sx * L) / 2.3, 0.015, (sz * D) / 2.3);
      b(M.glass, L, h - 0.04, D, 0, 0.04 + (h - 0.04) / 2, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(M.black, 0.012, h - 0.04, 0.012, (sx * L) / 2, 0.04 + (h - 0.04) / 2, (sz * D) / 2);
      for (const y of [0.3, 0.62]) {
        b(M.white, L - 0.02, 0.01, D - 0.02, 0, y, 0);
        for (const x of [-0.25, 0.05, 0.3]) G.s(g, M.leaf, 0.07, x * L, y + 0.07, 0);
      }
      b(M.green, L * 0.8, 0.012, 0.03, 0, h - 0.02, 0);
      return g;
    }
    case "bowls": {
      // Two raised steel bowls on a low black stand.
      b(M.black, L, H * 0.7, D, 0, (H * 0.7) / 2, 0);
      for (const s of [-1, 1]) c(M.steel, Math.min(L / 4.4, D / 2.2), H * 0.35, s * L * 0.24, H * 0.7 + H * 0.17, 0);
      return g;
    }
    case "dj": {
      // The DJ deck on its black stand: two platters, the mixer between, a thin green light along the front.
      const top = H * 0.85;
      b(M.black, L, 0.03, D, 0, top, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(M.black, 0.025, top, 0.025, sx * (L / 2 - 0.03), top / 2, sz * (D / 2 - 0.03));
      for (const s of [-1, 1]) {
        b(M.dark, L * 0.36, 0.04, D * 0.8, s * L * 0.3, top + 0.035, 0);
        c(M.grey, Math.min(L * 0.13, D * 0.32), 0.012, s * L * 0.3, top + 0.06, 0);
      }
      b(M.dark, L * 0.16, 0.05, D * 0.8, 0, top + 0.04, 0);
      b(M.green, L * 0.9, 0.006, 0.006, 0, top + 0.012, -D / 2 - 0.004);
      return g;
    }
    case "art": {
      // Five tall gallery-wrapped canvases side by side, the one picture split across them: white edges, the picture
      // on the faces (local -Z, into the room). The plane is turned to face the room, so the picture's left is +X.
      const n = 5, gap = Math.min(0.06, L * 0.03), pw = (L - gap * (n - 1)) / n, dep = Math.max(0.025, Math.min(D, 0.04));
      const planes: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        const cx = -L / 2 + pw / 2 + i * (pw + gap);
        b(M.white, pw, H, dep, cx, lift + H / 2, D / 2 - dep / 2);
        const geo = new THREE.PlaneGeometry(pw, H);
        const j = n - 1 - i, uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let v = 0; v < uv.count; v++) uv.setX(v, (j + uv.getX(v)) / n);
        planes.push(geo);
        const face = new THREE.Mesh(geo, M.art);
        face.rotation.y = Math.PI;
        face.position.set(cx, lift + H / 2, D / 2 - dep - 0.002);
        g.add(face);
      }
      g.userData.dispose = () => planes.forEach((p) => p.dispose());
      return g;
    }
    case "sideboard": {
      // A black sideboard, its doors drawn in, under floating shelves.
      b(M.black, L, H, D, 0, H / 2, 0);
      b(M.dark, 0.004, H * 0.8, 0.004, 0, H / 2, fz - 0.002);
      for (const y of [H + 0.58, H + 0.82]) b(M.black, L, 0.025, Math.min(D, 0.24), 0, y, D / 2 - Math.min(D, 0.24) / 2);
      return g;
    }
  }
  return null;
}

/**
 * The pets' devices (#747), modelled after what is actually there: the Petlibro fountain (square, black base, steel
 * top), the dry feeder (tall, round, black, its bowl at the front), the wet feeder (round, black, a steel bowl), and the
 * Litter-Robot (a round dark drum with its opening at the front, a step, the waste-drawer base) on a black mat. Built
 * with the front at local -Z; null for the other devices (house.ts keeps their simple shapes).
 */
export function deviceModel(G: GymGeo, M: HomeMats, kind: Spot, s: number): THREE.Group | null {
  const g = new THREE.Group();
  const b = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => G.b(g, mat, sx * s, sy * s, sz * s, x * s, y * s, z * s);
  const c = (mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: "x" | "y" | "z" = "y") => G.c(g, mat, r * s, len * s, x * s, y * s, z * s, axis);
  switch (kind) {
    case "fountain":
      b(M.black, 22, 10, 22, 0, 5, 0);
      b(M.steel, 20, 4, 20, 0, 12, 0);
      c(M.glass, 3, 4, 0, 15, 0);
      return g;
    case "dry-feeder":
      c(M.black, 11, 38, 0, 19, 2);
      c(M.dark, 11.5, 2, 0, 38, 2);
      b(M.black, 16, 8, 10, 0, 4, -10);
      c(M.steel, 5, 3, 0, 9, -11);
      return g;
    case "wet-feeder":
      c(M.black, 14, 10, 0, 5, 0);
      c(M.steel, 9, 3, 0, 10.5, 0);
      return g;
    case "litter":
      // The black mat under it, the drawer base, the step, the drum and its front opening.
      b(M.soft, 64, 1, 70, 0, 0.5, -6);
      b(M.dark, 50, 16, 50, 0, 8, 0);
      b(M.black, 32, 4, 12, 0, 18, -27);
      G.s(g, M.dark, 24 * s, 0, 40 * s, 0);
      b(M.black, 48, 6, 48, 0, 19, 0);
      c(M.grey, 13, 2, 0, 40, -22, "z");
      c(M.green, 1.2, 1, 0, 58, -18, "z");
      return g;
  }
  return null;
}
