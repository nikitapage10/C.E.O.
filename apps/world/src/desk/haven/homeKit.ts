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
  "towelbar", "litterbox", "coatrack", "tunnel", "greenhouse", "bowls", "sideboard", "upper", "dj",
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
  };
}

export function disposeHomeMats(m: HomeMats) {
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
      // A big flat TV on the wall.
      b(M.black, L, H, Math.max(0.02, D), 0, lift + H / 2, 0);
      b(M.screen, L * 0.97, H * 0.94, 0.004, 0, lift + H / 2, -Math.max(0.02, D) / 2 - 0.002);
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
    case "sideboard": {
      // A black sideboard, its doors drawn in, under floating shelves.
      b(M.black, L, H, D, 0, H / 2, 0);
      b(M.dark, 0.004, H * 0.8, 0.004, 0, H / 2, fz - 0.002);
      for (const y of [H + 0.28, H + 0.52]) b(M.black, L, 0.025, Math.min(D, 0.24), 0, y, D / 2 - Math.min(D, 0.24) / 2);
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
