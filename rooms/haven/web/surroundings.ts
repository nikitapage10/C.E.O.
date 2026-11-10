import * as THREE from "three";

/**
 * What stands round the home (#1007). Nikita, 2026-11-10: the grey all round the apartment was boring; the sky and the
 * mountains are nice, the city round it should look like somewhere. So the home is one unit in a low courtyard block:
 * its flat roofs flush with the walls on every side the home doesn't take, a landscaped courtyard (lawn, paths, a few
 * trees) on the home's balcony side and a second one further along, a street with parked cars and street lamps on the
 * other side, low neighbours and a parking deck across it, a boulevard with a planted median at one end, and a strip of
 * park and river beyond the street. All generic and made up (no real place is modelled), built from a few instanced
 * boxes, cones and planes (about a dozen draw calls), lit by the same sun and moon as the house; by night only the
 * street lamps glow.
 *
 * World units (a metre each across, heights squashed like the house's: the walls are 1.4). `home` is the home's box
 * (its rooms), `keep` the boxes nothing may cover (every room, the decks, the walk to a detached block), `east` which
 * side the courtyard is on: the side the balconies face.
 */

export interface Box2 {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Surroundings {
  group: THREE.Group;
  /** Per frame: daylight 0 (night) to 1 (day). */
  update(day: number): void;
  dispose(): void;
}

/** The parts of `a` outside `b`: up to four boxes. */
export function cut(a: Box2, b: Box2): Box2[] {
  if (b.x1 <= a.x0 || b.x0 >= a.x1 || b.z1 <= a.z0 || b.z0 >= a.z1) return [a];
  const out: Box2[] = [];
  if (b.z0 > a.z0) out.push({ x0: a.x0, z0: a.z0, x1: a.x1, z1: b.z0 });
  if (b.z1 < a.z1) out.push({ x0: a.x0, z0: b.z1, x1: a.x1, z1: a.z1 });
  const z0 = Math.max(a.z0, b.z0), z1 = Math.min(a.z1, b.z1);
  if (b.x0 > a.x0) out.push({ x0: a.x0, z0, x1: b.x0, z1 });
  if (b.x1 < a.x1) out.push({ x0: b.x1, z0, x1: a.x1, z1 });
  return out;
}

/** `a` less every box in `bs`, small slivers dropped. */
export function cutAll(a: Box2, bs: readonly Box2[]): Box2[] {
  let parts = [a];
  for (const b of bs) parts = parts.flatMap((p) => cut(p, b));
  return parts.filter((p) => p.x1 - p.x0 > 0.15 && p.z1 - p.z0 > 0.15);
}

/** A small fixed-seed random, so the block is the same every load. */
function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647), s / 2147483647);
}

interface Piece {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry?: number;
  c?: number;
}

/**
 * The plan of the surroundings, pure (for the tests): every box by what it is. The courtyard block's roofs, its
 * courtyards, the street and the rest, laid out from the home's box.
 */
export function layout(home: Box2, keep: readonly Box2[], east = true) {
  const W = home.x1 - home.x0, D = home.z1 - home.z0;
  // Mirror x when the courtyard is to the west: everything is laid out as if it were to the east.
  const s = east ? 1 : -1;
  const X = (x: number) => (east ? x : home.x0 + home.x1 - x);
  const bx = (x0: number, z0: number, x1: number, z1: number): Box2 => ({ x0: Math.min(X(x0), X(x1)), z0, x1: Math.max(X(x0), X(x1)), z1 });
  const wing = Math.max(8, Math.min(14, Math.min(W, D)));
  // The block: the home's street face is its outer edge; it runs on past the home on every other side.
  const outer = bx(home.x0 - 0.3, home.z0 - D * 0.9 - wing, home.x1 + W * 0.9 + wing * 3.2, home.z1 + wing * 0.9);
  const yard1 = bx(home.x1 + 0.6, home.z0 + D * 0.08, home.x1 + 0.6 + Math.max(8, W * 0.75), home.z1 - D * 0.12);
  const y2x0 = home.x1 + 0.6 + Math.max(8, W * 0.75) + wing;
  const yard2 = bx(y2x0, outer.z0 + wing, y2x0 + Math.max(8, W * 0.7), home.z0 + D * 0.2);
  const pad = keep.map((k) => ({ x0: k.x0 - 0.25, z0: k.z0 - 0.25, x1: k.x1 + 0.25, z1: k.z1 + 0.25 }));
  const roofs = cutAll(outer, [yard1, yard2, ...pad]);
  // The street along the block's street face; the far side's sidewalk, then the neighbours.
  const face = east ? outer.x0 : outer.x1;
  const street = { a: face - s * 1.2, b: face - s * 10.2 };
  const across = face - s * 11.6;
  const zs = { z0: outer.z0 - 30, z1: outer.z1 + 40 };
  // The boulevard past the block's far end (larger z).
  const blvd = { z0: outer.z1 + 2.5, z1: outer.z1 + 18 };
  return { outer, yard1, yard2, roofs, face, street, across, zs, blvd, s, wing };
}

export function makeSurroundings(o: { home: Box2; keep: readonly Box2[]; east?: boolean; phone?: boolean; wallH: number }): Surroundings {
  const L = layout(o.home, o.keep, o.east ?? true);
  const { s } = L;
  const group = new THREE.Group();
  group.name = "surroundings";
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const r = rand(29);
  // Unlit (#1007): the house's eight point lights would be worked out for every pixel of every roof and street, which
  // a phone or a software renderer can't afford, so the shading is baked into the geometry (a face's light from its
  // facing, `shade`) and the time of day is a colour (`update`).
  const box = shade(new THREE.BoxGeometry(1, 1, 1));
  geos.push(box);
  // Every material with its colour by day; by night each turns a dim moonlit blue, so the home's own lights stay what
  // the eye goes to.
  const dims: [THREE.MeshBasicMaterial, THREE.Color][] = [];
  const std = (color: number, ..._look: unknown[]) => {
    const m = new THREE.MeshBasicMaterial({ color, vertexColors: true });
    mats.push(m);
    dims.push([m, new THREE.Color(color)]);
    return m;
  };
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Piece[], order = 0) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      tmp.position.set(p.x, p.y, p.z);
      tmp.rotation.set(0, p.ry ?? 0, 0);
      tmp.scale.set(p.sx, p.sy, p.sz);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      if (p.c !== undefined) m.setColorAt(i, col.setHex(p.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.renderOrder = order;
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const slab = (b: Box2, y0: number, h: number, c?: number): Piece => ({ x: (b.x0 + b.x1) / 2, y: y0 + h / 2, z: (b.z0 + b.z1) / 2, sx: b.x1 - b.x0, sy: h, sz: b.z1 - b.z0, c });

  // The block's roofs, flush with the home's walls, with a low parapet line where a roof meets the open air.
  const H = o.wallH;
  // The block's ground, under everything, so the light-wells round the home read as paving, not the plain.
  add(box, std(0x9d9b94, 1), [slab(L.outer, -0.011, 0.007)]);
  // The neighbours' units sit a little lower than the home's walls, so the home reads as the one opened up.
  const RH = H * 0.62;
  const roofTone = [0xc9c8c1, 0xc4c5c0, 0xcdccc5];
  add(box, std(0xffffff, 0.9), L.roofs.map((b, i) => slab(b, 0, RH, roofTone[i % 3])));
  // Rooftop plant: a few low boxes, kept off the edges.
  const units: Piece[] = [];
  for (const b of L.roofs) {
    const n = Math.floor(((b.x1 - b.x0) * (b.z1 - b.z0)) / 60);
    for (let i = 0; i < Math.min(6, n); i++) {
      const w = 0.8 + r() * 1.4, d = 0.6 + r() * 1;
      if (b.x1 - b.x0 < w + 1.2 || b.z1 - b.z0 < d + 1.2) continue;
      units.push({ x: b.x0 + 0.6 + w / 2 + r() * (b.x1 - b.x0 - w - 1.2), y: RH + 0.08, z: b.z0 + 0.6 + d / 2 + r() * (b.z1 - b.z0 - d - 1.2), sx: w, sy: 0.16, sz: d, c: 0xb9bbb8 });
    }
  }
  add(box, std(0xffffff, 0.7), units);

  // The courtyards: a lawn, a paved path round and across it, planting beds and a few trees.
  const lawn: Piece[] = [], paving: Piece[] = [], beds: Piece[] = [];
  const trunks: Piece[] = [], crowns: Piece[] = [];
  const tree = (x: number, z: number, size = 1) => {
    const big = size * 0.62;
    const h = (0.7 + r() * 0.5) * big;
    trunks.push({ x, y: h * 0.25, z, sx: 0.12, sy: h * 0.5, sz: 0.12 });
    crowns.push({ x, y: h * 0.5 + 0.45 * big, z, sx: (1.3 + r() * 0.7) * big, sy: (1.1 + r() * 0.5) * big, sz: (1.3 + r() * 0.7) * big, ry: r() * 3, c: [0x4f7a45, 0x5b8a4c, 0x466e3f, 0x6a9455][Math.floor(r() * 4)] });
  };
  const pad = o.keep.map((k) => ({ x0: k.x0 - 0.4, z0: k.z0 - 0.4, x1: k.x1 + 0.4, z1: k.z1 + 0.4 }));
  const clear = (x: number, z: number) => !pad.some((k) => x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1);
  const treeAt = (x: number, z: number, big = 1) => clear(x, z) && tree(x, z, big);
  const parts = (b: Box2) => cutAll(b, pad);
  for (const y of [L.yard1, L.yard2]) {
    paving.push(...parts(y).map((b) => slab(b, 0, 0.02)));
    const inset = { x0: y.x0 + 0.9, z0: y.z0 + 0.9, x1: y.x1 - 0.9, z1: y.z1 - 0.9 };
    const mx = (y.x0 + y.x1) / 2, mz = (y.z0 + y.z1) / 2;
    // Four lawns, a cross of paths between them.
    for (const [a, b] of [[inset.x0, mx - 0.5], [mx + 0.5, inset.x1]] as const)
      for (const [c, d] of [[inset.z0, mz - 0.5], [mz + 0.5, inset.z1]] as const) if (b - a > 0.6 && d - c > 0.6) lawn.push(...parts({ x0: a, z0: c, x1: b, z1: d }).map((q) => slab(q, 0, 0.035)));
    // Beds of shrubs along the long sides, a tree in each lawn, one in the middle of the cross.
    for (const b of [{ x0: y.x0 + 0.2, z0: y.z0 + 0.2, x1: y.x1 - 0.2, z1: y.z0 + 0.7 }, { x0: y.x0 + 0.2, z0: y.z1 - 0.7, x1: y.x1 - 0.2, z1: y.z1 - 0.2 }]) beds.push(...parts(b).map((q) => slab(q, 0, 0.16)));
    for (const [tx, tz] of [[(inset.x0 + mx) / 2, (inset.z0 + mz) / 2], [(mx + inset.x1) / 2, (mz + inset.z1) / 2], [(inset.x0 + mx) / 2, (mz + inset.z1) / 2]]) treeAt(tx!, tz!);
    treeAt(mx, mz, 1.25);
  }
  add(box, std(0xa9a69e, 0.95), paving);
  add(box, std(0x6f9a52, 1), lawn);
  add(box, std(0x3f6338, 1), beds);

  // The street: asphalt, the curbs and sidewalks either side, a dashed centre line, parked cars along both curbs.
  const { a: sa, b: sb } = L.street;
  const zs = L.zs;
  const xs = (p: number, q: number) => ({ x0: Math.min(p, q), x1: Math.max(p, q) });
  add(box, std(0x34363a, 0.95), [slab({ ...xs(sa, sb), z0: zs.z0, z1: zs.z1 }, 0, 0.01)]);
  add(box, std(0xb8b6ae, 0.9), [
    slab({ ...xs(L.face, sa), z0: zs.z0, z1: zs.z1 }, 0, 0.04),
    slab({ ...xs(sb, L.across), z0: zs.z0, z1: zs.z1 }, 0, 0.04),
  ]);
  const mid = (sa + sb) / 2;
  const dashes: Piece[] = [];
  for (let z = zs.z0 + 1; z < zs.z1; z += 4) dashes.push({ x: mid, y: 0.012, z, sx: 0.12, sy: 0.006, sz: 1.8 });
  add(box, std(0xd9d4c2, 0.8), dashes);
  const bodies: Piece[] = [], cabins: Piece[] = [];
  const carCols = [0xe8e8e6, 0x1d1f22, 0x7d8288, 0x9e2b25, 0x2b4a73, 0xc9c6bd, 0x3b3f44, 0xb0b4b8];
  const lane = [sa - s * 1.2, sb + s * 1.2];
  for (const lx of lane)
    for (let z = L.outer.z0 - 6 + r() * 3; z < L.outer.z1 + 6; z += 5.6 + r() * 4) {
      if (r() < 0.3) continue;
      const c = carCols[Math.floor(r() * carCols.length)]!;
      bodies.push({ x: lx, y: 0.2, z, sx: 1.8, sy: 0.3, sz: 4.3, c });
      cabins.push({ x: lx, y: 0.45, z: z + 0.2, sx: 1.6, sy: 0.22, sz: 2.2, c: 0x23262b });
    }
  add(box, std(0xffffff, 0.45, { metalness: 0.3 }), bodies);
  add(box, std(0xffffff, 0.3, { metalness: 0.2 }), cabins);

  // Street lamps along the block's sidewalk, their heads glowing and a pool under each by night.
  const poles: Piece[] = [], heads: Piece[] = [];
  const lampX = L.face - s * 0.7;
  for (let z = L.outer.z0 + 2; z < L.outer.z1; z += 9) {
    poles.push({ x: lampX, y: 0.55, z, sx: 0.07, sy: 1.1, sz: 0.07 });
    heads.push({ x: lampX - s * 0.25, y: 1.1, z, sx: 0.5, sy: 0.06, sz: 0.18 });
  }
  add(box, std(0x2a2c30, 0.6), poles);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffd29a, toneMapped: false });
  mats.push(headMat);
  add(box, headMat, heads);
  const poolTex = new THREE.CanvasTexture(disc());
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  mats.push(poolMat);
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  geos.push(plane);
  add(plane, poolMat, heads.map((h) => ({ x: h.x - s * 0.4, y: 0.05, z: h.z, sx: 5, sy: 1, sz: 5 })), 2);

  // Across the street: low neighbours (two to four storeys, squashed like the house) and a parking deck.
  const blocks: Piece[] = [];
  const nb = o.phone ? 5 : 8;
  let z = L.outer.z0 - 8;
  for (let i = 0; i < nb && z < L.outer.z1 + 8; i++) {
    const len = 9 + r() * 12, dep = 10 + r() * 10, h = (i % 3 === 1 ? 2.2 : 1.1) + r() * 1.2;
    const deck = i % 3 === 1;
    blocks.push({ x: L.across - s * (dep / 2 + 0.6), y: h / 2, z: z + len / 2, sx: dep, sy: h, sz: len, c: deck ? 0xc4c3bd : [0xcfcac0, 0xbfc3c6, 0xd6d2c8][i % 3] });
    if (deck) for (let k = 1; k < 4; k++) blocks.push({ x: L.across - s * (dep / 2 + 0.6), y: (h * k) / 4, z: z + len / 2, sx: dep + 0.05, sy: 0.05, sz: len + 0.05, c: 0x8f9194 });
    z += len + 1.2 + r() * 2;
  }
  add(box, std(0xffffff, 0.9), blocks);

  // The park and the river beyond the neighbours: a long strip of grass, a trail, trees along the bank, the water.
  const park0 = L.across - s * 26, park1 = park0 - s * 10, river1 = park1 - s * 14;
  add(box, std(0x6d8f55, 1), [slab({ ...xs(park0, park1), z0: zs.z0 - 40, z1: zs.z1 + 40 }, 0, 0.02)]);
  add(box, std(0xc2b79f, 1), [slab({ ...xs(park0 - s * 3, park0 - s * 4.2), z0: zs.z0 - 40, z1: zs.z1 + 40 }, 0, 0.03)]);
  const water = std(0x3d5a6b, 0.25, { metalness: 0.1 });
  add(box, water, [slab({ ...xs(park1, river1), z0: zs.z0 - 40, z1: zs.z1 + 40 }, 0, 0.008)]);
  for (let tz = zs.z0 - 30; tz < zs.z1 + 30; tz += 5 + r() * 6) tree(park1 + s * (1 + r() * 2), tz, 1.2 + r() * 0.4);

  // The boulevard at the block's far end: two carriageways and a planted median with trees.
  const bx0 = L.across - 30, bx1 = L.outer.x1 + 30;
  add(box, std(0x34363a, 0.95), [slab({ x0: bx0, z0: L.blvd.z0, x1: bx1, z1: L.blvd.z1 }, 0, 0.011)]);
  const bm = (L.blvd.z0 + L.blvd.z1) / 2;
  add(box, std(0x5f8048, 1), [slab({ x0: bx0, z0: bm - 1, x1: bx1, z1: bm + 1 }, 0, 0.06)]);
  for (let tx = bx0 + 3; tx < bx1; tx += 7 + r() * 3) tree(tx, bm, 1.1);
  add(box, std(0xb8b6ae, 0.9), [slab({ x0: L.outer.x0, z0: L.outer.z1, x1: L.outer.x1, z1: L.blvd.z0 }, 0, 0.04)]);

  // The trees last: one mesh for the trunks, one for the crowns (low-poly, an octahedron each).
  add(box, std(0x4a3a2c, 1), trunks);
  const crown = shade(new THREE.IcosahedronGeometry(0.5, 0));
  geos.push(crown);
  add(crown, std(0xffffff, 0.95, { flatShading: true }), crowns);

  return {
    group,
    update(day: number) {
      const night = 1 - Math.max(0, Math.min(1, day));
      for (const [m, c] of dims) m.color.copy(c).multiply(tint.copy(DAY).lerp(NIGHT, night));
      poolMat.opacity = 0.35 * night;
      headMat.color.setHex(0xffd29a).multiplyScalar(0.25 + 0.75 * night);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      poolTex.dispose();
      group.clear();
    },
  };
}

const DAY = new THREE.Color(1, 1, 1), NIGHT = new THREE.Color(0.13, 0.15, 0.22);
const tint = new THREE.Color();
/** The sun's way, for the baked shading: high in the south-west of the plan. */
const SUN = new THREE.Vector3(-0.45, 0.85, 0.3).normalize();

/** A geometry with its light baked in as vertex colours: a face toward the sun full, one away from it in shade. */
function shade<G extends THREE.BufferGeometry>(g: G): G {
  const n = g.getAttribute("normal")!;
  const c = new Float32Array(n.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) c.fill(0.55 + 0.45 * Math.max(0, v.fromBufferAttribute(n, i).dot(SUN)), i * 3, i * 3 + 3);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

function disc(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  }
  return c;
}
