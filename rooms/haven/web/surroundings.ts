import * as THREE from "three";

/**
 * What stands round the home (#1007, #1020). Nikita, 2026-11-10: the grey all round the apartment was boring; the city
 * round it should look like somewhere. So the home is a unit of a light courtyard block: since #1035 up on an upper
 * floor (the courtyards and the street well below it, `below`) and mid-way along the block's street wing, through the
 * wing from the street on one side to the courtyard on the other (about twice the home's size), with a small entrance
 * alcove outside its front door; the block wrapping round, a second, larger courtyard further along with a pool deck,
 * a street with parked cars and street lamps on the home's other side, a riverside trail and parking decks across it,
 * and a boulevard with a planted median beyond the block's south end. The roofs aren't plain grey (#1020):
 * units of different heights and tones carrying plant, solar panels, skylights, terraces with planters and one pool;
 * by night some windows are lit and lights are strung over the courtyards and terraces. All generic and made up (no
 * real place is modelled), eight draw calls in all, unlit with the shading baked in; the street, the sidewalks and the
 * roofs carry a small baked pattern (#1022).
 *
 * World units (a metre each across, heights squashed like the house's: the walls are 1.4). `home` is the home's box
 * (its rooms), `keep` the boxes nothing may cover (every room, the decks, the walk to a detached block, the entrance
 * alcove), `east` which side the courtyard is on (the house puts it east, #1035).
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
  rx?: number;
  ry?: number;
  c?: number;
}

/** What a roof of the block carries (#1020): plant, panels, skylights, a terrace, the one pool, or nothing. */
export type RoofUse = "plain" | "hvac" | "solar" | "sky" | "terrace" | "pool";
export interface RoofUnit extends Box2 {
  /** Its height over the ground, around the neighbours' storey. */
  h: number;
  /** Which of the roof tones. */
  tone: number;
  use: RoofUse;
}

const area = (b: Box2) => (b.x1 - b.x0) * (b.z1 - b.z0);
const union = (a: Box2, b: Box2): Box2 => ({ x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) });
const overlaps = (a: Box2, b: Box2) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

/** A roof part split along its length into units of 5 to 10, each its own height and tone (#1020). */
function units(b: Box2, r: () => number, H: number): RoofUnit[] {
  const along = b.x1 - b.x0 >= b.z1 - b.z0;
  const len = along ? b.x1 - b.x0 : b.z1 - b.z0;
  const out: RoofUnit[] = [];
  for (let t = 0; t < len - 0.01; ) {
    let step = 5 + r() * 5;
    if (len - t - step < 3) step = len - t;
    const u = along ? { x0: b.x0 + t, z0: b.z0, x1: b.x0 + t + step, z1: b.z1 } : { x0: b.x0, z0: b.z0 + t, x1: b.x1, z1: b.z0 + t + step };
    const k = r();
    const use: RoofUse = k < 0.3 ? "hvac" : k < 0.48 ? "solar" : k < 0.62 ? "sky" : k < 0.76 ? "terrace" : "plain";
    out.push({ ...u, h: H * (0.55 + r() * 0.22), tone: Math.floor(r() * ROOF_TONES.length), use });
    t += step;
  }
  return out;
}

const ROOF_TONES = [0xc9c8c1, 0xb7b9b6, 0xd8d6cf, 0x8e9194, 0xc2b8a8, 0xe4e3de, 0x9fa4a6];

/**
 * The plan of the surroundings, pure (for the tests), from the home's box (#1007, re-proportioned in #1020): the home
 * on the block's outer corner by the street and the boulevard; the courtyard its balconies face just past that corner,
 * about twice the home's size; the block wrapping round it; a second, larger courtyard further along with a pool deck
 * at its far end; the street on the home's other side with a riverside trail and parking decks across it; the
 * boulevard with a planted median along the block's near end. Laid out as if the courtyard were to the east, then
 * mirrored when it's to the west. Generic and made up: proportions only.
 */
export function layout(home: Box2, keep: readonly Box2[], east = true, H = 1.4) {
  const X = (x: number) => (east ? x : home.x0 + home.x1 - x);
  const mb = (b: Box2): Box2 => (east ? b : { x0: X(b.x1), z0: b.z0, x1: X(b.x0), z1: b.z1 });
  const r = rand(29);
  const W = home.x1 - home.x0, D = home.z1 - home.z0;
  const K = keep.map(mb);
  const cluster = K.reduce(union, home);
  const wing = Math.max(8, Math.min(12, Math.min(W, D)));
  // The courtyard by the home (#1035): right off its courtyard side, the home's whole depth through the wing from the
  // street to it, a little more of the courtyard south of the home than north, about twice its size.
  const y1w = Math.max(8, W * 1.3), y1d = Math.max(8, (2 * W * D) / y1w);
  const y1z0 = home.z0 - Math.min(D * 0.25, Math.max(0, y1d - D) * 0.4);
  const yard1 = { x0: home.x1 + 0.6, z0: y1z0, x1: home.x1 + 0.6 + y1w, z1: y1z0 + y1d };
  // The larger one, a wing further along and a little further back, its pool deck at the far end.
  const y2w = Math.max(10, W * 1.6), y2d = Math.max(12, D * 2.2);
  const yard2 = { x0: yard1.x1 + wing, z0: yard1.z1 - y1d * 0.1 - y2d, x1: yard1.x1 + wing + y2w, z1: yard1.z1 - y1d * 0.1 };
  const poolD = Math.min(4, y2d * 0.22);
  const pool = { x0: yard2.x0 + 1.6, z0: yard2.z0 + 1.4, x1: yard2.x1 - 1.6, z1: yard2.z0 + 1.4 + poolD };
  const poolDeck = { x0: yard2.x0 + 0.3, z0: yard2.z0 + 0.3, x1: yard2.x1 - 0.3, z1: pool.z1 + 1.6 };
  // The block (#1035): the home in the middle of its street wing, the block carrying on past it both ways along the
  // street, wrapping both courtyards; the boulevard beyond its south end.
  const outer = { x0: cluster.x0 - 0.3, z0: Math.min(yard1.z0, yard2.z0) - wing * 0.8, x1: yard2.x1 + wing * 0.9, z1: Math.max(cluster.z1 + Math.max(wing, D * 0.9), yard1.z1 + wing * 0.8) };
  const pad = K.map((k) => ({ x0: k.x0 - 0.25, z0: k.z0 - 0.25, x1: k.x1 + 0.25, z1: k.z1 + 0.25 }));
  // No roof inside the home's own outline (#1022): an empty stretch between its rooms is a light well, paved, not a
  // neighbour's roof standing in the flat.
  const homeBox = mb(home);
  const roofs = cutAll(outer, [yard1, yard2, { x0: homeBox.x0 - 0.25, z0: homeBox.z0 - 0.25, x1: homeBox.x1 + 0.25, z1: homeBox.z1 + 0.25 }, ...pad]).flatMap((b) => units(b, r, H));
  // One roof has the pool (the largest unit clear of the home), a terrace or two the others' way.
  const big = roofs.filter((u) => u.x1 - u.x0 >= 5 && u.z1 - u.z0 >= 5 && !overlaps(u, { x0: cluster.x0 - 6, z0: cluster.z0 - 6, x1: cluster.x1 + 6, z1: cluster.z1 + 6 }));
  const top = big.sort((a, b) => area(b) - area(a))[0];
  if (top) top.use = "pool";
  // The street along the block's street face: sidewalks, the carriageway, then across it the trail, river and decks.
  const face = outer.x0;
  const street = { a: face - 1.2, b: face - 10.2 };
  const across = face - 11.6;
  const blvd = { z0: outer.z1 + 1.6, z1: outer.z1 + 17.6 };
  const zs = { z0: outer.z0 - 34, z1: blvd.z0 };
  const deckZ0 = blvd.z0 - Math.max(22, D * 2.5);
  const decks = [
    { x0: across - 16.8, z0: deckZ0, x1: across - 0.8, z1: (deckZ0 + blvd.z0 - 1.5) / 2 - 0.8 },
    { x0: across - 16.8, z0: (deckZ0 + blvd.z0 - 1.5) / 2 + 0.8, x1: across - 0.8, z1: blvd.z0 - 1.5 },
  ];
  const park = { x0: across - 16.8, z0: zs.z0 - 40, x1: across - 0.4, z1: deckZ0 - 1 };
  const trail = { x0: across - 19, z0: zs.z0 - 40, x1: across - 17.6, z1: blvd.z0 - 0.5 };
  const bank = { x0: across - 22, z0: zs.z0 - 40, x1: across - 17.2, z1: blvd.z1 + 40 };
  const river = { x0: across - 36, z0: zs.z0 - 40, x1: across - 22, z1: blvd.z1 + 40 };
  const farBank = { x0: across - 50, z0: zs.z0 - 40, x1: across - 36, z1: blvd.z1 + 40 };
  const bx0 = across - 17.2, bx1 = outer.x1 + 34;
  const bounds = { x0: farBank.x0, z0: zs.z0 - 40, x1: bx1, z1: blvd.z1 + 40 };
  const m = (x: number) => X(x);
  return {
    outer: mb(outer),
    yard1: mb(yard1),
    yard2: mb(yard2),
    pool: mb(pool),
    poolDeck: mb(poolDeck),
    roofs: roofs.map((u) => ({ ...u, ...mb(u) })),
    face: m(face),
    street: { a: m(street.a), b: m(street.b) },
    across: m(across),
    zs,
    blvd: { ...blvd, x0: Math.min(m(bx0), m(bx1)), x1: Math.max(m(bx0), m(bx1)) },
    decks: decks.map(mb),
    park: mb(park),
    trail: mb(trail),
    bank: mb(bank),
    river: mb(river),
    farBank: mb(farBank),
    bounds: mb(bounds),
    s: east ? 1 : -1,
    wing,
  };
}

/**
 * Heights of the ground layers (#1020): each a clear step over the next where they overlap, so no two surfaces fight
 * over the same depth when the camera turns (the strobe on the auto-rotate).
 */
/** The house camera's near plane at orbit distance `r` (#1020): 4% of it, 0.05 to 0.8, so the depth buffer stays fine out at the block. */
export const nearFor = (r: number) => Math.max(0.05, Math.min(0.8, r * 0.04));

export const LV = { base: -0.02, water: 0.004, asphalt: 0.02, paving: 0.03, grass: 0.035, lane: 0.04, trail: 0.05, lawn: 0.06, walk: 0.07, median: 0.1, glow: 0.12 };

/** A storey of the block, floor to floor, in world units (the walls are squashed to `wallH`, a slab on top). */
export const STOREY = 1.6;
/** A raised block's look (#1035): its brick base storeys, the brick's tone and the dark panel above. */
const BASE_STOREYS = 2, BRICK = 0xcbbca3, PANEL = 0x343d55;

/**
 * `below`: storeys of the block under the home (#1035: the home is up on an upper floor, the courtyards and the street
 * well below it). The group sits that far down, so the home's floor stays at 0: the block's walls rise from the ground
 * to round the home's floor, its roofs just above it, and the home and what `keep` holds stand on the block's own
 * floors. `door`: the front door, in world units with its way out, for the small entrance alcove outside it.
 */
export function makeSurroundings(o: { home: Box2; keep: readonly Box2[]; east?: boolean; phone?: boolean; wallH: number; below?: number; door?: { x: number; z: number; out: [number, number]; w: number } }): Surroundings & { bounds: Box2 } {
  const H = o.wallH;
  const L = layout(o.home, o.keep, o.east ?? true, H);
  const { s } = L;
  const below = Math.max(0, o.below ?? 0), lift = below * STOREY;
  const group = new THREE.Group();
  group.name = "surroundings";
  group.position.y = -lift;
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const r = rand(31);
  // Unlit (#1007): the house's eight point lights would be worked out for every pixel of every roof and street, which
  // a phone or a software renderer can't afford, so the shading is baked into the geometry (a face's light from its
  // facing, `shade`) and the time of day is a colour (`update`). Everything solid is one instanced mesh, the trees'
  // crowns a second, the glowing windows and lamp heads a third, the lamps' pools a fourth, the string lights a fifth.
  const box = shade(new THREE.BoxGeometry(1, 1, 1));
  geos.push(box);
  const dims: [THREE.MeshBasicMaterial, THREE.Color][] = [];
  const baked = () => {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    mats.push(m);
    dims.push([m, new THREE.Color(0xffffff)]);
    return m;
  };
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Piece[], order = 0) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      tmp.position.set(p.x, p.y, p.z);
      tmp.rotation.set(p.rx ?? 0, p.ry ?? 0, 0);
      tmp.scale.set(p.sx, p.sy, p.sz);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, col.setHex(p.c ?? 0xffffff));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.renderOrder = order;
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const solid: Piece[] = [], crowns: Piece[] = [], glow: Piece[] = [], pools: Piece[] = [];
  // Textured tops (#1022, Nikita: texture on the street, the sidewalks and the roofs): flat quads with the pattern laid
  // in world units, still unlit, one draw call a surface.
  const skins: Record<Skin, Quad[]> = { asphalt: [], walk: [], roof: [] };
  const skin = (k: Skin, b: Box2, y: number, c: number) => skins[k].push({ ...b, y, c });
  const strings: number[] = [];
  const slab = (b: Box2, y0: number, h: number, c: number): Piece => ({ x: (b.x0 + b.x1) / 2, y: y0 + h / 2, z: (b.z0 + b.z1) / 2, sx: b.x1 - b.x0, sy: h, sz: b.z1 - b.z0, c });
  const top = (b: Box2, y: number, c: number) => solid.push(slab(b, y - 0.03, 0.03, c));
  const pad = o.keep.map((k) => ({ x0: k.x0 - 0.4, z0: k.z0 - 0.4, x1: k.x1 + 0.4, z1: k.z1 + 0.4 }));
  const clear = (x: number, z: number) => !pad.some((k) => x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1);
  const parts = (b: Box2) => cutAll(b, pad);
  const tree = (x: number, z: number, size = 1) => {
    if (!clear(x, z)) return;
    const big = size * 0.62;
    const h = (0.7 + r() * 0.5) * big;
    solid.push({ x, y: h * 0.25, z, sx: 0.12, sy: h * 0.5, sz: 0.12, c: 0x4a3a2c });
    crowns.push({ x, y: h * 0.5 + 0.45 * big, z, sx: (1.3 + r() * 0.7) * big, sy: (1.1 + r() * 0.5) * big, sz: (1.3 + r() * 0.7) * big, ry: r() * 3, c: [0x4f7a45, 0x5b8a4c, 0x466e3f, 0x6a9455][Math.floor(r() * 4)] });
  };
  /** A string of lights from a to b, sagging in the middle (night only). */
  const strand = (ax: number, az: number, bx: number, bz: number, y: number) => {
    const n = Math.max(6, Math.round(Math.hypot(bx - ax, bz - az) / 0.35));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      strings.push(ax + (bx - ax) * t, y - 0.35 * 4 * t * (1 - t), az + (bz - az) * t);
    }
  };
  const post = (x: number, z: number, y0: number, h: number) => solid.push({ x, y: y0 + h / 2, z, sx: 0.06, sy: h, sz: 0.06, c: 0x2a2c30 });

  // The block's ground under everything, so the light-wells round the home read as paving, not the plain.
  solid.push(slab(L.outer, LV.base - 0.02, 0.02, 0x9d9b94));
  // A raised block's walls (#1035): a warm brick base two storeys high, dark panel above it to the roof; a light,
  // generic version of a loft block's look.
  const walls = (b: Box2, h: number, top: number) => {
    if (!lift) return solid.push(slab(b, 0, h, top));
    solid.push(slab(b, 0, h, PANEL));
    solid.push(slab({ x0: b.x0 - 0.02, z0: b.z0 - 0.02, x1: b.x1 + 0.02, z1: b.z1 + 0.02 }, 0, Math.min(h, BASE_STOREYS * STOREY), BRICK));
  };
  // The block's own floors under the home and what it keeps clear (#1035): up from the ground to just under the
  // home's floor.
  if (lift > 0) for (const k of o.keep) walls({ x0: k.x0 - 0.25, z0: k.z0 - 0.25, x1: k.x1 + 0.25, z1: k.z1 + 0.25 }, lift - 0.03, PANEL);

  // The roofs (#1020): each unit its own height and tone, and on top whatever it carries; up on the home's floor
  // when the home is (#1035), the walls under them down to the ground.
  for (const u of L.roofs.map((v) => ({ ...v, h: v.h + lift }))) {
    const w = u.x1 - u.x0, d = u.z1 - u.z0, cx = (u.x0 + u.x1) / 2, cz = (u.z0 + u.z1) / 2;
    walls(u, u.h, ROOF_TONES[u.tone]!);
    skin("roof", u, u.h + 0.004, ROOF_TONES[u.tone]!);
    const inner = { x0: u.x0 + 0.7, z0: u.z0 + 0.7, x1: u.x1 - 0.7, z1: u.z1 - 0.7 };
    const iw = inner.x1 - inner.x0, id = inner.z1 - inner.z0;
    if (iw < 1.2 || id < 1.2) continue;
    const at = (fx: number, fz: number) => [inner.x0 + fx * iw, inner.z0 + fz * id] as const;
    if (u.use === "hvac") {
      for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
        const [x, z] = at(0.15 + r() * 0.7, 0.15 + r() * 0.7);
        const sw = 0.6 + r() * 0.9, sd = 0.5 + r() * 0.6;
        solid.push({ x, y: u.h + 0.12, z, sx: sw, sy: 0.24, sz: sd, c: 0xb4b7b5 });
        solid.push({ x, y: u.h + 0.25, z, sx: sw * 0.5, sy: 0.03, sz: sd * 0.6, c: 0x6d7174 });
      }
    } else if (u.use === "solar") {
      // Rows of panels tilted toward the sun, their long side across the roof's length.
      const along = w >= d;
      const rows = Math.max(1, Math.floor((along ? id : iw) / 1.1));
      for (let i = 0; i < rows; i++) {
        const f = (i + 0.5) / rows;
        const [x, z] = along ? [cx, inner.z0 + f * id] : [inner.x0 + f * iw, cz];
        solid.push({ x, y: u.h + 0.12, z, sx: along ? iw : 0.8, sy: 0.03, sz: along ? 0.8 : id, rx: along ? 0.35 : 0, ry: along ? 0 : 0, c: 0x22344f });
      }
    } else if (u.use === "sky") {
      for (let i = 0; i < 3; i++) {
        const [x, z] = at(0.2 + i * 0.3, 0.3 + r() * 0.4);
        solid.push({ x, y: u.h + 0.05, z, sx: 0.9, sy: 0.1, sz: 0.9, c: 0x9fb7c6 });
      }
    } else if (u.use === "terrace") {
      // A deck with planters round it, a table or two, and lights strung across it.
      const t = { x0: inner.x0 + iw * 0.1, z0: inner.z0 + id * 0.1, x1: inner.x1 - iw * 0.1, z1: inner.z1 - id * 0.1 };
      solid.push(slab(t, u.h, 0.04, 0x9b7b5c));
      for (const [px, pz] of [[t.x0, t.z0], [t.x1, t.z0], [t.x0, t.z1], [t.x1, t.z1]] as const) {
        solid.push({ x: px, y: u.h + 0.1, z: pz, sx: 0.5, sy: 0.2, sz: 0.5, c: 0x6b5a48 });
        crowns.push({ x: px, y: u.h + 0.32, z: pz, sx: 0.6, sy: 0.4, sz: 0.6, ry: r() * 3, c: 0x5b8a4c });
      }
      const [tx, tz] = [(t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2];
      solid.push({ x: tx, y: u.h + 0.12, z: tz, sx: 0.5, sy: 0.04, sz: 0.5, c: 0xe0ddd5 });
      post(t.x0, t.z0, u.h, 0.6);
      post(t.x1, t.z1, u.h, 0.6);
      strand(t.x0, t.z0, t.x1, t.z1, u.h + 0.6);
    } else if (u.use === "pool") {
      // The rooftop pool: a deck, the water a light blue, loungers along one side.
      const deck = { x0: inner.x0, z0: inner.z0, x1: inner.x1, z1: inner.z1 };
      solid.push(slab(deck, u.h, 0.05, 0xd9d2c4));
      const wtr = { x0: deck.x0 + iw * 0.15, z0: deck.z0 + id * 0.25, x1: deck.x1 - iw * 0.15, z1: deck.z1 - id * 0.25 };
      solid.push(slab(wtr, u.h + 0.05, 0.02, 0x7fd3e8));
      for (let i = 0; i < 4; i++) solid.push({ x: wtr.x0 + ((i + 0.5) / 4) * (wtr.x1 - wtr.x0), y: u.h + 0.09, z: deck.z0 + id * 0.12, sx: 0.35, sy: 0.06, sz: 0.8, c: 0xf2f0ea });
      post(deck.x0, deck.z0, u.h, 0.7);
      post(deck.x1, deck.z0, u.h, 0.7);
      strand(deck.x0, deck.z0, deck.x1, deck.z0, u.h + 0.7);
    }
  }

  // The entrance alcove (#1035): a little recess outside the front door, up on the home's floor, its two side walls
  // and a warm light over the door.
  if (o.door) {
    const { x, z, out, w } = o.door;
    const deep = 1.1, half = w / 2 + 0.3;
    const along: [number, number] = [-out[1], out[0]];
    const at = (u: number, v: number): [number, number] => [x + along[0] * u + out[0] * v, z + along[1] * u + out[1] * v];
    const box2 = (u0: number, v0: number, u1: number, v1: number): Box2 => {
      const [ax, az] = at(u0, v0), [bx, bz] = at(u1, v1);
      return { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) };
    };
    solid.push(slab(box2(-half, 0, half, deep), 0, lift - 0.01, 0xcfccc4));
    for (const sgn of [-1, 1]) solid.push(slab(box2(sgn * half - 0.04, 0, sgn * half + 0.04, deep), lift, H * 0.9, 0xe2e0da));
    const [lx, lz] = at(0, 0.06);
    glow.push({ x: lx, y: lift + H * 0.78, z: lz, sx: out[0] ? 0.05 : 0.22, sy: 0.05, sz: out[0] ? 0.22 : 0.05, c: 0xffd29a });
    const [px, pz] = at(0, deep / 2);
    pools.push({ x: px, y: lift + 0.01, z: pz, sx: 1.6, sy: 1, sz: 1.6 });
  }

  // Windows on the courtyard walls and the street face: dark glass by day, some lit warm at night.
  // A row on every storey up to the home's (#1035).
  const windows = (x0: number, z0: number, x1: number, z1: number, out: [number, number]) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let t = 0.8; t < len - 0.5; t += 1.3) {
      const x = x0 + ((x1 - x0) * t) / len + out[0] * 0.03, z = z0 + ((z1 - z0) * t) / len + out[1] * 0.03;
      if (!clear(x - out[0] * 0.5, z - out[1] * 0.5)) continue;
      for (let k = 0; k <= below; k++) {
        const lit = r() < 0.32;
        glow.push({ x, y: k * STOREY + H * 0.3, z, sx: out[0] ? 0.03 : 0.55, sy: 0.22, sz: out[0] ? 0.55 : 0.03, c: lit ? 0xffd9a0 : 0x2b3138 });
      }
    }
  };
  for (const y of [L.yard1, L.yard2]) {
    windows(y.x0, y.z0, y.x1, y.z0, [0, 1]);
    windows(y.x0, y.z1, y.x1, y.z1, [0, -1]);
    windows(y.x0, y.z0, y.x0, y.z1, [1, 0]);
    windows(y.x1, y.z0, y.x1, y.z1, [-1, 0]);
  }
  windows(L.face, L.outer.z0, L.face, L.outer.z1, [-s, 0]);
  windows(L.outer.x0, L.outer.z1, L.outer.x1, L.outer.z1, [0, 1]);

  // The courtyards: paving, four lawns with a cross of paths, beds of shrubs, trees, and lights strung across.
  for (const [y, i] of [[L.yard1, 0], [L.yard2, 1]] as const) {
    for (const p of parts(y)) top(p, LV.paving, 0xa9a69e);
    const inner = i ? { ...y, z0: L.poolDeck.z1 + 0.6 } : y;
    const inset = { x0: inner.x0 + 0.9, z0: inner.z0 + 0.9, x1: inner.x1 - 0.9, z1: inner.z1 - 0.9 };
    const mx = (inner.x0 + inner.x1) / 2, mz = (inner.z0 + inner.z1) / 2;
    for (const [a, b] of [[inset.x0, mx - 0.5], [mx + 0.5, inset.x1]] as const)
      for (const [c, d] of [[inset.z0, mz - 0.5], [mz + 0.5, inset.z1]] as const) if (b - a > 0.6 && d - c > 0.6) for (const q of parts({ x0: a, z0: c, x1: b, z1: d })) top(q, LV.lawn, 0x6f9a52);
    for (const b of [{ x0: y.x0 + 0.2, z0: y.z1 - 0.7, x1: y.x1 - 0.2, z1: y.z1 - 0.2 }, { x0: y.x0 + 0.2, z0: inner.z0 + 0.2, x1: y.x0 + 0.7, z1: y.z1 - 0.2 }]) for (const q of parts(b)) solid.push(slab(q, 0, 0.18, 0x3f6338));
    for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) tree(inset.x0 + fx! * (inset.x1 - inset.x0), inset.z0 + fz! * (inset.z1 - inset.z0), i ? 1.15 : 1);
    tree(mx, mz, 1.3);
    if (i) for (let k = 0; k < 4; k++) tree(inset.x0 + 0.4 + r() * (inset.x1 - inset.x0 - 0.8), inset.z1 - 0.4 - r() * 1.2, 0.9);
    // Lights strung corner to corner over the paths, from four posts.
    const ys = H * 0.62;
    for (const [px, pz] of [[inset.x0, inset.z0], [inset.x1, inset.z0], [inset.x0, inset.z1], [inset.x1, inset.z1]] as const) if (clear(px, pz)) post(px, pz, 0, ys);
    if (clear(inset.x0, inset.z0) && clear(inset.x1, inset.z1)) strand(inset.x0, inset.z0, inset.x1, inset.z1, ys);
    if (clear(inset.x1, inset.z0) && clear(inset.x0, inset.z1)) strand(inset.x1, inset.z0, inset.x0, inset.z1, ys);
  }
  // The pool deck at the larger courtyard's far end: the deck, the water, loungers and a strand along it.
  top(L.poolDeck, LV.walk, 0xd9d2c4);
  solid.push(slab(L.pool, LV.walk - 0.03, 0.05, 0x7fd3e8));
  for (let i = 0; i < 6; i++) solid.push({ x: L.pool.x0 + ((i + 0.5) / 6) * (L.pool.x1 - L.pool.x0), y: LV.walk + 0.05, z: L.pool.z1 + 0.8, sx: 0.35, sy: 0.06, sz: 0.8, c: 0xf2f0ea });
  post(L.poolDeck.x0, L.poolDeck.z1, 0, H * 0.6);
  post(L.poolDeck.x1, L.poolDeck.z1, 0, H * 0.6);
  strand(L.poolDeck.x0, L.poolDeck.z1, L.poolDeck.x1, L.poolDeck.z1, H * 0.6);

  // The street: asphalt, a dashed centre line, sidewalks either side, parked cars along both curbs.
  const { a: sa, b: sb } = L.street;
  const zs = L.zs;
  const xs = (p: number, q: number) => ({ x0: Math.min(p, q), x1: Math.max(p, q) });
  skin("asphalt", { ...xs(sa, sb), z0: zs.z0, z1: zs.z1 }, LV.asphalt, 0x3a3c40);
  skin("walk", { ...xs(L.face, sa), z0: zs.z0, z1: L.blvd.z0 - 0.01 }, LV.walk, 0xb8b6ae);
  skin("walk", { ...xs(sb, L.across), z0: zs.z0, z1: L.blvd.z0 - 0.01 }, LV.walk, 0xb8b6ae);
  const mid = (sa + sb) / 2;
  for (let z = zs.z0 + 1; z < zs.z1 - 1; z += 4) solid.push({ x: mid, y: LV.lane - 0.01, z, sx: 0.2, sy: 0.02, sz: 1.8, c: 0xd9d4c2 });
  const carCols = [0xe8e8e6, 0x1d1f22, 0x7d8288, 0x9e2b25, 0x2b4a73, 0xc9c6bd, 0x3b3f44, 0xb0b4b8];
  const car = (x: number, z: number, y0: number, along = true) => {
    const c = carCols[Math.floor(r() * carCols.length)]!;
    solid.push({ x, y: y0 + 0.17, z, sx: along ? 1.8 : 4.3, sy: 0.3, sz: along ? 4.3 : 1.8, c });
    solid.push({ x, y: y0 + 0.42, z, sx: along ? 1.6 : 2.2, sy: 0.22, sz: along ? 2.2 : 1.6, c: 0x23262b });
  };
  for (const lx of [sa - s * 1.2, sb + s * 1.2]) for (let z = L.outer.z0 - 6 + r() * 3; z < L.blvd.z0 - 3; z += 5.6 + r() * 4) if (r() > 0.3) car(lx, z, LV.asphalt);

  // Street lamps along the block's sidewalk and both sides of the boulevard: heads that glow, a pool under each.
  const lamp = (x: number, z: number, dx: number, dz: number) => {
    solid.push({ x, y: 0.55, z, sx: 0.07, sy: 1.1, sz: 0.07, c: 0x2a2c30 });
    glow.push({ x: x + dx * 0.25, y: 1.1, z: z + dz * 0.25, sx: dz ? 0.18 : 0.5, sy: 0.06, sz: dz ? 0.5 : 0.18, c: 0xffd29a });
    pools.push({ x: x + dx * 0.4, y: LV.glow, z: z + dz * 0.4, sx: 5, sy: 1, sz: 5 });
  };
  for (let z = L.outer.z0 + 2; z < L.outer.z1; z += 9) lamp(L.face - s * 0.7, z, -s, 0);
  for (let x = L.blvd.x0 + 4; x < L.blvd.x1; x += 10) {
    lamp(x, L.blvd.z0 - 0.7, 0, 1);
    lamp(x + 5, L.blvd.z1 + 0.7, 0, -1);
  }

  // Across the street: the parking decks (levels, ramps' stripes, cars on top) and the riverside park and trail.
  for (const d of L.decks) {
    const lv = 3, h = H * 0.95;
    solid.push(slab(d, 0, h, 0xc4c3bd));
    for (let k = 1; k < lv; k++) solid.push(slab({ x0: d.x0 - 0.04, z0: d.z0 - 0.04, x1: d.x1 + 0.04, z1: d.z1 + 0.04 }, (h * k) / lv - 0.03, 0.06, 0x8f9194));
    for (let z = d.z0 + 1.2; z < d.z1 - 1.5; z += 2.6) if (r() > 0.45) car(d.x0 + 3 + r() * (d.x1 - d.x0 - 6), z, h, false);
  }
  top(L.park, LV.grass, 0x6d8f55);
  top(L.bank, LV.grass, 0x6d8f55);
  top(L.farBank, LV.grass, 0x6a8a52);
  top(L.trail, LV.trail, 0xc2b79f);
  solid.push(slab(L.river, LV.base, LV.water - LV.base, 0x3d5a6b));
  for (let tz = L.park.z0 + 6; tz < L.park.z1; tz += 4 + r() * 5) tree(L.park.x0 + (L.park.x1 - L.park.x0) * (0.2 + r() * 0.6), tz, 1.1 + r() * 0.3);
  for (let tz = L.bank.z0 + 6; tz < L.bank.z1 - 4; tz += 5 + r() * 6) tree((L.bank.x0 + L.bank.x1) / 2 + (r() - 0.5) * 2, tz, 1.2 + r() * 0.4);
  for (let tz = L.farBank.z0 + 6; tz < L.farBank.z1 - 4; tz += 6 + r() * 6) tree((L.farBank.x0 + L.farBank.x1) / 2 + (r() - 0.5) * 6, tz, 1.3);

  // The boulevard along the block's near end: two carriageways, the planted median with its trees, the sidewalks,
  // and a row of low buildings beyond it.
  const bz = L.blvd;
  skin("asphalt", { x0: bz.x0, z0: bz.z0, x1: bz.x1, z1: bz.z1 }, LV.asphalt, 0x3a3c40);
  const bm = (bz.z0 + bz.z1) / 2;
  top({ x0: bz.x0, z0: bm - 1.2, x1: bz.x1, z1: bm + 1.2 }, LV.median, 0x5f8048);
  for (let tx = bz.x0 + 3; tx < bz.x1; tx += 6 + r() * 3) tree(tx, bm, 1.1);
  skin("walk", { x0: L.outer.x0, z0: L.outer.z1, x1: L.outer.x1, z1: bz.z0 }, LV.walk, 0xb8b6ae);
  skin("walk", { x0: bz.x0, z0: bz.z1, x1: bz.x1, z1: bz.z1 + 1.4 }, LV.walk, 0xb8b6ae);
  const nb = o.phone ? 5 : 8;
  for (let i = 0, x = bz.x0 + 18; i < nb && x < bz.x1 - 6; i++) {
    const len = 8 + r() * 10, dep = 9 + r() * 6, h = H * (0.55 + r() * 0.5);
    solid.push({ x: x + len / 2, y: h / 2, z: bz.z1 + 2 + dep / 2, sx: len, sy: h, sz: dep, c: ROOF_TONES[Math.floor(r() * ROOF_TONES.length)]! });
    if (r() < 0.6) solid.push({ x: x + len * (0.3 + r() * 0.4), y: h + 0.12, z: bz.z1 + 2 + dep * (0.3 + r() * 0.4), sx: 1.2, sy: 0.24, sz: 0.8, c: 0xb4b7b5 });
    x += len + 1.5 + r() * 2;
  }

  add(box, baked(), solid);
  const texs: THREE.Texture[] = [];
  for (const k of Object.keys(skins) as Skin[]) {
    const tex = new THREE.CanvasTexture(pattern(k));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    texs.push(tex);
    const geo = quads(skins[k], SKIN_TILE[k]);
    if (!geo) continue;
    geos.push(geo);
    const m = baked();
    m.map = tex;
    // Drawn over the slab it lies on without fighting it for depth (#1020's strobe).
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  const crown = shade(new THREE.IcosahedronGeometry(0.5, 0));
  geos.push(crown);
  add(crown, baked(), crowns);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  mats.push(glowMat);
  add(box, glowMat, glow);
  const poolTex = new THREE.CanvasTexture(disc());
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  mats.push(poolMat);
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  geos.push(plane);
  add(plane, poolMat, pools, 2);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(strings), 3));
  geos.push(sg);
  const stringMat = new THREE.PointsMaterial({ color: 0xffd9a0, size: o.phone ? 2.5 : 3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  mats.push(stringMat);
  const bulbs = new THREE.Points(sg, stringMat);
  bulbs.frustumCulled = false;
  bulbs.renderOrder = 3;
  group.add(bulbs);

  return {
    group,
    bounds: L.bounds,
    update(day: number) {
      const night = 1 - Math.max(0, Math.min(1, day));
      for (const [m, c] of dims) m.color.copy(c).multiply(tint.copy(DAY).lerp(NIGHT, night));
      poolMat.opacity = 0.35 * night;
      glowMat.color.setScalar(0.3 + 0.7 * night);
      stringMat.opacity = 0.95 * night;
      bulbs.visible = night > 0.05;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      poolTex.dispose();
      for (const t of texs) t.dispose();
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

/** The textured surfaces (#1022). */
type Skin = "asphalt" | "walk" | "roof";
interface Quad extends Box2 {
  y: number;
  c: number;
}
/** Metres one repeat of each pattern covers. */
const SKIN_TILE: Record<Skin, number> = { asphalt: 6, walk: 2.4, roof: 4 };

/** Flat quads facing up, their UVs in world units over `tile`, their colours with the sun baked in as `shade` does. */
function quads(list: readonly Quad[], tile: number): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const pos = new Float32Array(list.length * 12), uv = new Float32Array(list.length * 8), col = new Float32Array(list.length * 12);
  const idx: number[] = [];
  const lit = 0.55 + 0.45 * Math.max(0, SUN.y);
  const c = new THREE.Color();
  list.forEach((q, i) => {
    const corners = [[q.x0, q.z0], [q.x1, q.z0], [q.x1, q.z1], [q.x0, q.z1]] as const;
    c.setHex(q.c);
    corners.forEach(([x, z], k) => {
      pos.set([x, q.y, z], i * 12 + k * 3);
      uv.set([x / tile, -z / tile], i * 8 + k * 2);
      col.set([c.r * lit, c.g * lit, c.b * lit], i * 12 + k * 3);
    });
    const o = i * 4;
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A small greyscale pattern, near white so the surface's own tone shows through (#1022): asphalt's grit with a crack
 * or two, the sidewalk's square slabs and their joints, a roof's membrane in strips with gravel. Fixed seeds, so the
 * same every load; drawn once on a 256 canvas.
 */
function pattern(k: Skin): HTMLCanvasElement {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const x = cv.getContext("2d");
  if (!x) return cv;
  const r = rand(k === "asphalt" ? 7 : k === "walk" ? 13 : 17);
  const grey = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;
  x.fillStyle = grey(k === "walk" ? 236 : 226);
  x.fillRect(0, 0, S, S);
  // Grit: fine flecks lighter and darker than the ground.
  for (let i = 0; i < (k === "asphalt" ? 2600 : 1400); i++) {
    const v = r() < 0.5 ? 150 + r() * 50 : 245 + r() * 10;
    x.fillStyle = grey(Math.round(v), 0.55);
    const d = r() < 0.85 ? 1 : 2;
    x.fillRect(Math.floor(r() * S), Math.floor(r() * S), d, d);
  }
  x.lineCap = "round";
  if (k === "asphalt") {
    // Patches and a couple of hairline cracks.
    for (let i = 0; i < 5; i++) {
      x.fillStyle = grey(200 + Math.round(r() * 20), 0.35);
      x.fillRect(r() * S, r() * S, 20 + r() * 50, 14 + r() * 30);
    }
    x.strokeStyle = grey(120, 0.6);
    x.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      let px = r() * S, py = r() * S;
      x.beginPath();
      x.moveTo(px, py);
      for (let j = 0; j < 6; j++) x.lineTo((px += (r() - 0.5) * 36), (py += (r() - 0.5) * 36));
      x.stroke();
    }
  } else if (k === "walk") {
    // Square slabs, a joint between each, each slab a shade of its own.
    const n = 4, q = S / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        x.fillStyle = grey(225 + Math.round(r() * 25), 0.5);
        x.fillRect(i * q + 2, j * q + 2, q - 4, q - 4);
      }
    x.strokeStyle = grey(150, 0.9);
    x.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      x.beginPath();
      x.moveTo(i * q, 0);
      x.lineTo(i * q, S);
      x.moveTo(0, i * q);
      x.lineTo(S, i * q);
      x.stroke();
    }
  } else {
    // A roof membrane laid in strips with welded seams, and a few vents' stains.
    const n = 5, q = S / n;
    for (let i = 0; i < n; i++) {
      x.fillStyle = grey(212 + Math.round(r() * 26), 0.45);
      x.fillRect(0, i * q, S, q);
    }
    x.strokeStyle = grey(165, 0.85);
    x.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      x.beginPath();
      x.moveTo(0, i * q);
      x.lineTo(S, i * q);
      x.stroke();
    }
    for (let i = 0; i < 4; i++) {
      x.fillStyle = grey(180, 0.25);
      x.beginPath();
      x.arc(r() * S, r() * S, 6 + r() * 14, 0, Math.PI * 2);
      x.fill();
    }
  }
  return cv;
}
