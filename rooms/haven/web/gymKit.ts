import * as THREE from "three";
import type { Kind } from "./data.ts";

/**
 * The Gym's equipment in 3D (#718): a power rack with a loaded bar, an adjustable bench, a dumbbell rack, kettlebells,
 * a treadmill with its console lit, a spin bike and the mirror, built from a few primitives each in the house's
 * night-interior look (black powder-coated steel, chrome sleeves, black bumper plates with a few coloured ones, a soft
 * blue console glow). Each model is built along its local X (the long side), on the floor at its middle, and sized to
 * the plan's footprint, so a plan's own pieces and the Gym's fill (gymFill.ts) draw the same way.
 */

export const GYM_MODELS = new Set<Kind>(["rack", "barbell", "bench", "dbrack", "kettle", "treadmill", "bike", "mirror"]);

export interface GymMats {
  steel: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  pad: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  blue: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  belt: THREE.MeshStandardMaterial;
}

export function gymMats(): GymMats {
  const m = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  return {
    steel: m({ color: 0x2b2d33, roughness: 0.42, metalness: 0.65 }),
    chrome: m({ color: 0xd8dce2, roughness: 0.18, metalness: 0.95 }),
    rubber: m({ color: 0x141518, roughness: 0.9 }),
    pad: m({ color: 0x1c1d22, roughness: 0.55 }),
    plate: m({ color: 0x17181b, roughness: 0.75 }),
    red: m({ color: 0xb0282e, roughness: 0.6 }),
    blue: m({ color: 0x2747a6, roughness: 0.6 }),
    screen: m({ color: 0x0a1020, roughness: 0.2, emissive: 0x4a9bff, emissiveIntensity: 1.4 }),
    glass: m({ color: 0xcfd8ea, roughness: 0.04, metalness: 0.9, emissive: 0x1b2333, emissiveIntensity: 0.5 }),
    belt: m({ color: 0x0c0c0e, roughness: 0.95 }),
  };
}

export function disposeMats(m: GymMats) {
  for (const v of Object.values(m)) v.dispose();
}

/** Geometry cache, shared by every model in the scene and disposed with it. */
export class GymGeo {
  private box = new THREE.BoxGeometry(1, 1, 1);
  private cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
  private sph = new THREE.SphereGeometry(0.5, 20, 14);
  private tor = new THREE.TorusGeometry(0.5, 0.09, 10, 24, Math.PI);
  constructor(private m: GymMats) {}
  dispose() {
    this.box.dispose();
    this.cyl.dispose();
    this.sph.dispose();
    this.tor.dispose();
  }
  /** A box by its size and middle. */
  b(g: THREE.Group, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rz = 0) {
    const o = new THREE.Mesh(this.box, mat);
    o.scale.set(sx, sy, sz);
    o.position.set(x, y, z);
    o.rotation.z = rz;
    g.add(o);
    return o;
  }
  /** A cylinder along an axis ("x", "y" or "z"). */
  c(g: THREE.Group, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: "x" | "y" | "z" = "y") {
    const o = new THREE.Mesh(this.cyl, mat);
    o.scale.set(r * 2, len, r * 2);
    if (axis === "x") o.rotation.z = Math.PI / 2;
    if (axis === "z") o.rotation.x = Math.PI / 2;
    o.position.set(x, y, z);
    g.add(o);
    return o;
  }
  s(g: THREE.Group, mat: THREE.Material, r: number, x: number, y: number, z: number) {
    const o = new THREE.Mesh(this.sph, mat);
    o.scale.setScalar(r * 2);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  }
  handle(g: THREE.Group, r: number, x: number, y: number, z: number) {
    const o = new THREE.Mesh(this.tor, this.m.steel);
    o.scale.setScalar(r * 2);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  }
  get mats() {
    return this.m;
  }
}

/** A loaded barbell along X: the bar, chrome sleeves, a stack of plates each side (red and blue on the outside). */
function barbell(G: GymGeo, g: THREE.Group, len: number, y: number, z: number, plates: number) {
  const M = G.mats;
  G.c(g, M.chrome, 0.012, len, 0, y, z, "x");
  for (const side of [-1, 1]) {
    const sx = side * (len / 2 - 0.12);
    G.c(g, M.chrome, 0.022, 0.24, sx, y, z, "x");
    G.c(g, M.steel, 0.035, 0.02, side * (len / 2 - 0.25), y, z, "x");
    for (let i = 0; i < plates; i++) {
      const r = i === 0 ? 0.2 : 0.2 - i * 0.03;
      const mat = i === plates - 1 && plates > 1 ? (side < 0 ? M.red : M.blue) : M.plate;
      G.c(g, mat, r, 0.045, side * (len / 2 - 0.21 + i * 0.05), y, z, "x");
    }
  }
}

/** One piece, built along its local X with `L` (long) and `D` (deep), `H` tall, on the floor at its middle. `bar`: the rack holds its own bar (when the plan has no barbell of its own). */
export function gymModel(G: GymGeo, k: Kind, L: number, D: number, H: number, lift: number, bar = true): THREE.Group | null {
  const M = G.mats;
  const g = new THREE.Group();
  const t = 0.05;
  switch (k) {
    case "rack": {
      // A four-post power rack: uprights, the top frame, the base, J-hooks with the bar racked, safety arms, and
      // plates stored on the back pegs.
      const h = Math.max(H, 0.9);
      const x = L / 2 - t, z = D / 2 - t;
      for (const sx of [-x, x]) for (const sz of [-z, z]) G.b(g, M.steel, t, h, t, sx, h / 2, sz);
      for (const sz of [-z, z]) G.b(g, M.steel, L, t, t, 0, h - t / 2, sz);
      for (const sx of [-x, x]) G.b(g, M.steel, t, t, D, sx, h - t / 2, 0);
      for (const sz of [-z, z]) G.b(g, M.steel, L, t * 0.6, t, 0, t * 0.3, sz);
      for (const sx of [-x, x]) G.b(g, M.steel, t, t * 0.6, D, sx, t * 0.3, 0);
      // A pull-up bar, chrome.
      G.c(g, M.chrome, 0.016, L + 0.08, 0, h - t * 1.6, -z, "x");
      // J-hooks and the racked bar, a touch over half height.
      const by = h * 0.58;
      for (const sx of [-x, x]) G.b(g, M.chrome, 0.05, 0.05, 0.06, sx, by - 0.03, -z + 0.06);
      if (bar) barbell(G, g, Math.max(L + 0.5, 1.6), by, -z + 0.06, 3);
      // Safety arms, low.
      for (const sx of [-x, x]) G.b(g, M.chrome, 0.03, 0.03, D * 0.9, sx, h * 0.32, 0);
      // Plate storage pegs on the back posts.
      for (const sx of [-x, x]) {
        G.c(g, M.chrome, 0.02, 0.18, sx, h * 0.22, z + 0.09, "z");
        for (let i = 0; i < 3; i++) G.c(g, i === 2 ? (sx < 0 ? M.red : M.blue) : M.plate, 0.2 - i * 0.03, 0.04, sx, h * 0.22, z + 0.05 + i * 0.045, "z");
      }
      return g;
    }
    case "barbell": {
      barbell(G, g, Math.max(L, 1.2), lift, 0, 3);
      return g;
    }
    case "bench": {
      // An adjustable bench: a flat seat, the back raised to an incline, its frame and the rear wheels.
      const h = Math.max(H, 0.42);
      const seat = L * 0.38, back = L * 0.58;
      G.b(g, M.steel, L * 0.92, 0.05, 0.07, 0, 0.12, 0);
      G.b(g, M.steel, 0.06, 0.04, D * 1.1, -L * 0.42, 0.02, 0);
      G.b(g, M.steel, 0.06, 0.04, D * 1.1, L * 0.42, 0.02, 0);
      G.b(g, M.steel, 0.05, h - 0.1, 0.06, -L * 0.18, (h - 0.1) / 2, 0);
      G.b(g, M.pad, seat, 0.08, D, -L / 2 + seat / 2 + 0.04, h, 0);
      const a = 0.45;
      const bx = -L / 2 + seat + 0.06 + (Math.cos(a) * back) / 2;
      G.b(g, M.pad, back, 0.08, D, bx, h + (Math.sin(a) * back) / 2, 0, a);
      G.b(g, M.steel, 0.05, h * 0.6, 0.05, bx + 0.05, h * 0.55, 0, -0.5);
      for (const sz of [-1, 1]) G.c(g, M.rubber, 0.05, 0.04, L * 0.46, 0.05, (sz * D) / 2, "z");
      return g;
    }
    case "dbrack": {
      // A two-tier dumbbell rack with a row of pairs, lighter to heavier along it.
      const h = Math.max(H, 0.55);
      for (const sx of [-L / 2 + t, 0, L / 2 - t]) {
        G.b(g, M.steel, t, h, t, sx, h / 2, D * 0.25);
        G.b(g, M.steel, t, h * 0.6, t, sx, h * 0.3, -D * 0.25);
        G.b(g, M.steel, t, t, D, sx, 0.02, 0);
      }
      const tiers: [number, number][] = [
        [h * 0.95, D * 0.15],
        [h * 0.55, -D * 0.15],
      ];
      const n = Math.max(3, Math.floor(L / 0.24));
      tiers.forEach(([ty, tz], ti) => {
        G.b(g, M.steel, L, 0.03, D * 0.42, 0, ty - 0.05, tz, 0);
        for (let i = 0; i < n; i++) {
          const r = 0.045 + ((ti * n + i) / (n * 2)) * 0.045;
          const x = -L / 2 + (L / n) * (i + 0.5);
          G.c(g, M.chrome, 0.012, D * 0.32, x, ty + r - 0.03, tz, "z");
          for (const s of [-1, 1]) G.c(g, M.plate, r, 0.06, x, ty + r - 0.03, tz + s * D * 0.17, "z");
        }
      });
      return g;
    }
    case "kettle": {
      // A row of kettlebells, small to big.
      const n = Math.max(1, Math.min(5, Math.round(L / 0.3)));
      for (let i = 0; i < n; i++) {
        const r = 0.07 + i * 0.015;
        const x = -L / 2 + (L / n) * (i + 0.5);
        G.s(g, i === n - 1 ? M.red : M.plate, r, x, r, 0);
        G.handle(g, r * 0.8, x, r * 1.75, 0);
      }
      return g;
    }
    case "treadmill": {
      // The deck and its belt, the side rails, the posts up to the console (lit) and the handles.
      G.b(g, M.steel, L, 0.12, D, 0, 0.06, 0);
      G.b(g, M.belt, L * 0.86, 0.02, D * 0.7, -L * 0.04, 0.13, 0);
      for (const sz of [-1, 1]) G.b(g, M.chrome, L * 0.86, 0.015, 0.03, -L * 0.04, 0.135, (sz * D) / 2 - 0.03);
      const cx = L / 2 - 0.12, ch = Math.max(H, 1.0);
      for (const sz of [-1, 1]) G.b(g, M.steel, 0.06, ch, 0.06, cx, ch / 2, (sz * D) / 2 - 0.04, 0.12);
      G.b(g, M.steel, 0.24, 0.16, D * 0.9, cx - 0.04, ch, 0, -0.5);
      G.b(g, M.screen, 0.02, 0.1, D * 0.5, cx - 0.12, ch + 0.03, 0, -0.5);
      for (const sz of [-1, 1]) G.b(g, M.rubber, 0.36, 0.035, 0.035, cx - 0.22, ch * 0.82, (sz * D) / 2 - 0.04);
      return g;
    }
    case "bike": {
      // A spin bike: base feet, the flywheel up front (with a chrome face), the frame, the seat and the bars.
      const h = Math.max(H, 0.9);
      G.b(g, M.steel, 0.06, 0.05, D * 1.2, -L * 0.4, 0.025, 0);
      G.b(g, M.steel, 0.06, 0.05, D * 1.2, L * 0.4, 0.025, 0);
      G.b(g, M.steel, L * 0.8, 0.06, 0.06, 0, 0.08, 0);
      G.c(g, M.plate, 0.22, 0.06, L * 0.28, 0.32, 0, "z");
      G.c(g, M.chrome, 0.16, 0.065, L * 0.28, 0.32, 0, "z");
      G.b(g, M.steel, 0.06, h * 0.75, 0.06, -L * 0.12, h * 0.4, 0, 0.25);
      G.b(g, M.steel, 0.06, h * 0.8, 0.06, L * 0.2, h * 0.45, 0, -0.2);
      G.b(g, M.steel, L * 0.42, 0.06, 0.06, 0.04, h * 0.5, 0, 0.15);
      G.b(g, M.pad, 0.26, 0.06, 0.14, -L * 0.22, h * 0.82, 0);
      G.b(g, M.steel, 0.1, 0.04, D * 0.9, L * 0.32, h * 0.92, 0);
      for (const sz of [-1, 1]) G.b(g, M.rubber, 0.16, 0.035, 0.035, L * 0.4, h * 0.94, (sz * D) / 2 - 0.05);
      G.b(g, M.screen, 0.06, 0.05, 0.1, L * 0.3, h * 0.98, 0);
      return g;
    }
    case "mirror": {
      // A wall mirror: a thin frame and the glass.
      const h = Math.max(H, 0.9);
      G.b(g, M.steel, L, h, Math.min(D, 0.04), 0, h / 2 + 0.05, 0);
      G.b(g, M.glass, L - 0.04, h - 0.04, Math.min(D, 0.04) + 0.006, 0, h / 2 + 0.05, 0);
      return g;
    }
    default:
      return null;
  }
}
