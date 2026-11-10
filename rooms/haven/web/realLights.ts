import * as THREE from "three";
import { centreOf, type HavenPlan, type PlanRoom } from "./data.ts";
import { deskRoom, fixtureOf, placeLights, roomLightOf, type Fixture, type Light, type PlacedLight } from "./lights.ts";
import { inStudio, kindOf, placeFixture, rowIndex, studioLampCorner, studioLampSpots, type FixturePlace, type LightKind } from "./fixtures.ts";
import type { PlanLight } from "../../../api/_haven/planShape.ts";
import { LIGHT } from "./style.ts";

/**
 * The house's real lights (#974): every placed SwitchBot or Govee light drawn where it stands, lighting its room only
 * while it is really on. A floor lamp is a tall single-colour LED line uplight (about 4 to 5 ft against the house's
 * furniture), in the light's own colour when the vendor says; an under-light (under a counter or a cabinet) a low glow; anything
 * else a small ceiling light. Each has a soft pool on the floor; the house lends the brightest ones its fixed set of
 * point lights (`lamps`), so turning a light on or off never changes how many lights the scene has (no shader rebuild,
 * no flash). Switching eases over a fraction of a second.
 *
 * The Studio's own light (Nikita on the Desk from a desktop, #974) is one more, always on: `desk` true adds it.
 *
 * A room light (#1002) is a room's own overhead lights, a SwitchBot switch (lights.ts roomLightOf) or the Studio's:
 * it lights that whole room and no further (a pool the size of the room, a lamp reaching just its corners, since the
 * house casts no shadows and a longer reach would light the rooms next door through the walls), and while it's off the
 * room is dark at night.
 *
 * A home's fixtures (#1007, fixtures.ts) are drawn as what they are, where they run: a row of ceiling spots (a puck per
 * spot, a faint beam down and a small pool under each), a backlight strip (a bright line under the wall cabinets, the
 * panelling washed in light, the counter in front lit), a single ceiling fitting. By day the fittings themselves stay
 * bright and the pools only ease back (Nikita, 2026-11-10: on or off has to be easy to tell in the sun); unlit, a
 * fitting is a dark puck or a dark strip.
 */

/** What a light is drawn as: a fixture, a whole room's lights (#1002), or a home's fixture kind (#1007). */
export type DrawFixture = Fixture | "room" | LightKind;

/** A room's box in plan units: its middle, width and depth. */
export interface RoomBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** The box round a room's parts, with its area-weighted middle. */
export function boxOf(room: PlanRoom): RoomBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of room.parts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  const [cx, cy] = centreOf(room);
  return { cx, cy, w: x1 - x0, h: y1 - y0 };
}

/** The LED line's height in world units: about 4.5 ft against the house's furniture (a fridge is 0.96). */
export const LINE_H = 0.72;
const DESK_ID = "desk-studio";
/** The ceiling fittings' height (the walls are 1.4). */
const CEIL = 1.384;
/** A backlight's line: just under the wall cabinets (they hang from 0.64), over the counter's top (0.36). */
const BACK_TOP = 0.625, BACK_LOW = 0.37;

/** Where each kind of fixture shines from, how far, and how bright at full. */
const KIND: Record<DrawFixture, { y: number; pool: number; dist: number; power: number }> = {
  ceiling: { y: 1.3, pool: 0.95, dist: 4.2, power: 4.2 },
  // A room's own lights: the pool and the reach come from the room's size (`RoomBox`), these are the floor.
  room: { y: 1.3, pool: 0.8, dist: 1.6, power: 4.6 },
  floor: { y: LINE_H + 0.02, pool: 0.6, dist: 3, power: 2.6 },
  under: { y: 0.1, pool: 0.55, dist: 1.4, power: 1.2 },
  // #1007: per lamp point of a row (one or two a row), a strip's one, a fitting's one.
  spots: { y: 1.2, pool: 0.34, dist: 2.2, power: 3.2 },
  backlight: { y: 0.52, pool: 0.3, dist: 1.5, power: 2.6 },
  glow: { y: 1.2, pool: 0.8, dist: 2, power: 3.6 },
};

export interface Lamp {
  key: string;
  p: THREE.Vector3;
  colour: THREE.Color;
  intensity: number;
  distance: number;
}

interface Drawn {
  key: string;
  id: string;
  fixture: DrawFixture;
  /** How far its lamps reach (world units). */
  dist: number;
  /** Where its lamps stand: one, or two along a long row. */
  ps: THREE.Vector3[];
  colour: THREE.Color;
  /** 0 to 1, from the light's brightness when the vendor says. */
  power: number;
  want: number;
  level: number;
  group: THREE.Group;
  poolMat: THREE.MeshBasicMaterial;
  /** The fitting itself: the LED line, the ceiling pucks, the backlight's strip. */
  lineMat: THREE.MeshBasicMaterial | null;
  haloMat: THREE.SpriteMaterial | null;
  /** A row's beams, a backlight's washed panelling. */
  washMat: THREE.MeshBasicMaterial | null;
  dispose: () => void;
}

/** The colour a light is drawn in: its own when the vendor says, else a warm white. */
export const colourOf = (l: Pick<Light, "rgb">): number => (l.rgb && /^#[0-9a-f]{6}$/i.test(l.rgb) ? parseInt(l.rgb.slice(1), 16) : LIGHT.lamp);

/** One light as the house draws it: where its marker stands, what it is, the room it lights or the run it is. */
export type DrawItem = PlacedLight & { fixture: DrawFixture; virtual: boolean; room?: RoomBox; place?: FixturePlace };

/**
 * What the house draws for a set of lights: each placed one (a home's fixture where it runs, #1007; a SwitchBot switch
 * as its room's lights, #1002), plus the Studio's when `desk`. Pure, for the tests. `plan` is the drawn (furnished)
 * plan, so a fixture follows the kitchen as drawn.
 */
export function drawList(plan: HavenPlan, lights: readonly Light[], spots: readonly PlanLight[] | undefined, desk: boolean): DrawItem[] {
  // The Studio's floor lamps with no saved spot stand in its corners (#1007, fixtures.ts studioLampSpots).
  const corners = studioLampSpots(plan);
  let studioLamps = 0;
  const out: DrawItem[] = placeLights(plan, lights, spots).placed.map((p) => {
    if (corners && !p.spot && fixtureOf(p.light.name) === "floor" && inStudio(plan, p.x, p.y)) {
      const at = corners[studioLampCorner(p.light.name, studioLamps++)];
      return { ...p, ...at, fixture: "floor" as const, virtual: false };
    }
    const kind = kindOf(p.light.name, p.spot);
    const place = kind ? placeFixture(plan, kind, p.spot ?? null, rowIndex(p.light.name)) : null;
    if (place) {
      const { x0, y0, x1, y1 } = place.run;
      return { ...p, x: (x0 + x1) / 2, y: (y0 + y1) / 2, fixture: place.kind, virtual: false, place };
    }
    const room = roomLightOf(plan, p.light, p);
    return room ? { ...p, fixture: "room", virtual: false, room: boxOf(room) } : { ...p, fixture: fixtureOf(p.light.name), virtual: false };
  });
  const studio = desk ? deskRoom(plan) : null;
  if (studio) {
    const [x, y] = centreOf(studio);
    out.push({ light: { id: DESK_ID, vendor: "govee", name: studio.name, type: "desk", on: true, online: true }, x, y, fixture: "room", virtual: true, room: boxOf(studio) });
  }
  return out;
}

/** The marker's height over a light's spot (the house hangs its tap target there). */
export const markerY = (f: DrawFixture) => (f === "floor" ? LINE_H + 0.08 : f === "under" ? 0.22 : f === "backlight" ? BACK_TOP + 0.12 : 1.29);

/** How far a room light reaches, in world units: just the room's far corners from its middle, never next door. */
export const roomReach = (b: RoomBox, u = 100) => Math.max(KIND.room.dist, (0.62 * Math.hypot(b.w, b.h)) / u);

/** How many spots a row of `len` plan units holds: about one every 80, three to twelve. */
export const spotCount = (len: number) => Math.max(3, Math.min(12, Math.round(len / 80)));

export class RealLights {
  readonly group = new THREE.Group();
  private drawn = new Map<string, Drawn>();
  private poolTex: THREE.CanvasTexture;
  /** A room's pool: even over most of the floor, soft only at its walls (#1002). */
  private roomTex: THREE.CanvasTexture;
  private haloTex: THREE.CanvasTexture;
  /** Bright along one edge, fading to nothing at the other (#1007): a backlight's wash and the counter in front of it. */
  private fadeTex: THREE.CanvasTexture;
  private lineGeo = new THREE.BoxGeometry(0.024, LINE_H, 0.024);
  private baseGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.014, 20);
  private puckGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.012, 24);
  private spotGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.014, 18);
  private beamGeo: THREE.ConeGeometry;
  private baseMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.4 });

  constructor(
    private wx: (x: number) => number,
    private wz: (y: number) => number,
  ) {
    this.poolTex = new THREE.CanvasTexture(radial([[0, 1], [0.35, 0.42], [1, 0]]));
    this.haloTex = new THREE.CanvasTexture(radial([[0, 0.9], [0.3, 0.28], [1, 0]]));
    this.roomTex = new THREE.CanvasTexture(radial([[0, 1], [0.55, 0.75], [0.95, 0.12], [1, 0]]));
    this.fadeTex = new THREE.CanvasTexture(fade());
    // A spot's beam: a cone from the puck to the floor, bright at the top and nearly gone by the floor (vertex colours).
    const beamH = CEIL - 0.02;
    this.beamGeo = new THREE.ConeGeometry(0.2, beamH, 18, 1, true);
    const pos = this.beamGeo.getAttribute("position")!;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + beamH / 2) / beamH;
      col.fill(0.08 + 0.92 * t * t, i * 3, i * 3 + 3);
    }
    this.beamGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }

  /** The lights as they are now: new ones built, moved or gone ones rebuilt or dropped, the rest only re-coloured. */
  set(list: ReturnType<typeof drawList>, reduce: boolean) {
    const seen = new Set<string>();
    const r = (v: number) => Math.round(v);
    for (const { light, x, y, fixture, room, place } of list) {
      const key = place
        ? `${place.kind}:${r(place.run.x0)}:${r(place.run.y0)}:${r(place.run.x1)}:${r(place.run.y1)}`
        : room
          ? `room:${r(room.cx)}:${r(room.cy)}:${r(room.w)}:${r(room.h)}`
          : `${fixture}:${r(x)}:${r(y)}`;
      seen.add(light.id);
      let d = this.drawn.get(light.id);
      if (d && d.key !== key) {
        d.dispose();
        this.drawn.delete(light.id);
        d = undefined;
      }
      if (!d) {
        d = place ? this.buildFixture(light.id, key, place) : this.build(light.id, key, fixture, x, y, room);
        this.drawn.set(light.id, d);
      }
      d.colour.setHex(colourOf(light));
      d.want = light.online && light.on === true ? 1 : 0;
      d.power = typeof light.brightness === "number" ? 0.35 + 0.65 * Math.max(0, Math.min(1, light.brightness / 100)) : 1;
      if (reduce) d.level = d.want;
    }
    for (const [id, d] of this.drawn)
      if (!seen.has(id)) {
        d.dispose();
        this.drawn.delete(id);
      }
  }

  private additive(map: THREE.Texture | null): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  }

  private halo(): THREE.SpriteMaterial {
    return new THREE.SpriteMaterial({ map: this.haloTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  }

  private build(id: string, key: string, fixture: DrawFixture, x: number, y: number, room?: RoomBox): Drawn {
    const k = KIND[fixture];
    const g = new THREE.Group();
    // A room's lights hang over the room's middle, wherever its marker stands.
    if (room) [x, y] = [room.cx, room.cy];
    g.position.set(this.wx(x), 0, this.wz(y));
    const poolMat = this.additive(room ? this.roomTex : this.poolTex);
    const pool = new THREE.Mesh(room ? new THREE.PlaneGeometry((room.w / 100) * 1.02, (room.h / 100) * 1.02) : new THREE.PlaneGeometry(k.pool * 2, k.pool * 2), poolMat);
    pool.rotation.x = -Math.PI / 2;
    // Just over the room pools (0.01) and the floor, never on the same depth as either.
    pool.position.y = 0.014;
    pool.renderOrder = 3;
    g.add(pool);
    let lineMat: THREE.MeshBasicMaterial | null = null, haloMat: THREE.SpriteMaterial | null = null;
    if (fixture === "floor") {
      g.add(new THREE.Mesh(this.baseGeo, this.baseMat).translateY(0.007));
      lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      g.add(new THREE.Mesh(this.lineGeo, lineMat).translateY(0.014 + LINE_H / 2));
      haloMat = this.halo();
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(0.34, LINE_H * 1.25, 1);
      halo.position.y = 0.014 + LINE_H / 2;
      halo.renderOrder = 9;
      g.add(halo);
    } else if ((fixture === "ceiling" || fixture === "glow") && id !== DESK_ID) {
      lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      g.add(new THREE.Mesh(this.puckGeo, lineMat).translateY(CEIL));
      // The fitting's own glow (#1007), so a ceiling light reads as on from above, by day too.
      haloMat = this.halo();
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(0.42, 0.42, 1);
      halo.position.y = CEIL - 0.02;
      halo.renderOrder = 9;
      g.add(halo);
    } else if (fixture === "under") {
      haloMat = this.halo();
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(0.7, 0.22, 1);
      halo.position.y = 0.08;
      halo.renderOrder = 9;
      g.add(halo);
    }
    this.group.add(g);
    return this.drawnOf(id, key, fixture, g, [new THREE.Vector3(this.wx(x), k.y, this.wz(y))], room ? roomReach(room) : k.dist, poolMat, lineMat, haloMat, null, [pool.geometry]);
  }

  /** A home's fixture where it runs (#1007): a row of spots, a backlight strip, or a single fitting. */
  private buildFixture(id: string, key: string, place: FixturePlace): Drawn {
    const { kind, run } = place;
    if (kind === "glow") return this.build(id, key, "glow", run.x0, run.y0);
    const k = KIND[kind];
    const g = new THREE.Group();
    const a = new THREE.Vector3(this.wx(run.x0), 0, this.wz(run.y0)), b = new THREE.Vector3(this.wx(run.x1), 0, this.wz(run.y1));
    const len = Math.max(0.01, a.distanceTo(b));
    // Turned so a box's or a plane's local x runs from a to b.
    const turn = Math.atan2(-(b.z - a.z), b.x - a.x);
    const at = (t: number) => a.clone().lerp(b, t);
    const geos: THREE.BufferGeometry[] = [];
    const poolMat = this.additive(kind === "spots" ? this.poolTex : this.fadeTex);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const haloMat = this.halo();
    const washMat = this.additive(kind === "spots" ? null : this.fadeTex);
    let ps: THREE.Vector3[];
    if (kind === "spots") {
      washMat.vertexColors = true;
      const n = spotCount(len * 100);
      const poolGeo = new THREE.PlaneGeometry(k.pool * 2, k.pool * 2);
      geos.push(poolGeo);
      for (let i = 0; i < n; i++) {
        const p = at((i + 0.5) / n);
        const puck = new THREE.Mesh(this.spotGeo, lineMat);
        puck.position.set(p.x, CEIL, p.z);
        g.add(puck);
        const halo = new THREE.Sprite(haloMat);
        halo.scale.set(0.28, 0.28, 1);
        halo.position.set(p.x, CEIL - 0.02, p.z);
        halo.renderOrder = 9;
        g.add(halo);
        const beam = new THREE.Mesh(this.beamGeo, washMat);
        beam.position.set(p.x, (CEIL - 0.02) / 2, p.z);
        beam.renderOrder = 8;
        g.add(beam);
        const pool = new THREE.Mesh(poolGeo, poolMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(p.x, 0.014, p.z);
        pool.renderOrder = 3;
        g.add(pool);
      }
      ps = (len > 3.5 ? [0.25, 0.75] : [0.5]).map((t) => at(t).setY(k.y));
    } else {
      // The backlight: the strip under the wall cabinets, the panelling below it washed (bright at the top), and the
      // counter in front lit, brightest at the wall.
      const out = new THREE.Vector3(place.out?.[0] ?? 0, 0, place.out?.[1] ?? 1).normalize();
      const mid = at(0.5);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.018, 0.024), lineMat);
      geos.push(strip.geometry);
      strip.position.copy(mid).addScaledVector(out, 0.02).setY(BACK_TOP);
      strip.rotation.y = turn;
      g.add(strip);
      const washH = BACK_TOP - BACK_LOW;
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(len, washH), washMat);
      geos.push(wash.geometry);
      wash.position.copy(mid).addScaledVector(out, 0.012).setY(BACK_LOW + washH / 2);
      wash.rotation.y = turn;
      wash.renderOrder = 8;
      g.add(wash);
      // Flat on the counter: local x along the run, its bright edge (the texture's top, local +y) against the wall.
      const counter = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.3), poolMat);
      geos.push(counter.geometry);
      counter.position.copy(mid).addScaledVector(out, 0.15).setY(BACK_LOW + 0.006);
      counter.rotation.set(-Math.PI / 2, Math.atan2(out.x, out.z), 0, "YXZ");
      counter.renderOrder = 3;
      g.add(counter);
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(Math.min(len * 1.05, 2.6), 0.18, 1);
      halo.position.copy(mid).addScaledVector(out, 0.05).setY(BACK_TOP);
      halo.renderOrder = 9;
      g.add(halo);
      ps = [mid.clone().addScaledVector(out, 0.3).setY(k.y)];
    }
    this.group.add(g);
    return this.drawnOf(id, key, kind, g, ps, k.dist, poolMat, lineMat, haloMat, washMat, geos);
  }

  private drawnOf(id: string, key: string, fixture: DrawFixture, g: THREE.Group, ps: THREE.Vector3[], dist: number, poolMat: THREE.MeshBasicMaterial, lineMat: THREE.MeshBasicMaterial | null, haloMat: THREE.SpriteMaterial | null, washMat: THREE.MeshBasicMaterial | null, geos: THREE.BufferGeometry[]): Drawn {
    return {
      key,
      id,
      fixture,
      dist,
      ps,
      colour: new THREE.Color(LIGHT.lamp),
      power: 1,
      want: 0,
      level: 0,
      group: g,
      poolMat,
      lineMat,
      haloMat,
      washMat,
      dispose: () => {
        this.group.remove(g);
        for (const x of geos) x.dispose();
        poolMat.dispose();
        lineMat?.dispose();
        haloMat?.dispose();
        washMat?.dispose();
      },
    };
  }

  /**
   * One frame: each light eases to on or off, its pool, line and halo follow, and the lamps for the house's point
   * lights come back in a fixed order (on first, then by id). `day` 0 to 1.
   */
  step(dt: number, day: number, reduce: boolean): Lamp[] {
    // By day the pools and the lamps ease back, never out (#1007): a light that's on reads as on in the sun.
    const lit = 1 - 0.5 * day;
    const lamp = 1 - 0.6 * day;
    const lamps: Lamp[] = [];
    for (const d of this.drawn.values()) {
      d.level = reduce ? d.want : d.level + (d.want - d.level) * Math.min(1, dt * 7);
      const v = d.level * d.power;
      d.poolMat.color.copy(d.colour);
      const pool = d.fixture === "under" ? 0.55 : d.fixture === "room" ? 0.3 : d.fixture === "spots" ? 0.5 : d.fixture === "backlight" ? 0.75 : 0.42;
      d.poolMat.opacity = v * pool * lit;
      // The fitting itself: the light's colour when on (brighter still by day), a dark puck or strip when off.
      d.lineMat?.color.copy(d.colour).multiplyScalar(0.06 + (0.94 + 0.5 * day) * v);
      if (d.haloMat) {
        d.haloMat.color.copy(d.colour);
        d.haloMat.opacity = v * (0.6 + 0.25 * day);
      }
      if (d.washMat) {
        d.washMat.color.copy(d.colour);
        d.washMat.opacity = v * (d.fixture === "spots" ? 0.1 + 0.06 * day : 0.7 + 0.2 * day);
      }
      if (v > 0.01)
        d.ps.forEach((p, i) => lamps.push({ key: `${1 - d.want}${d.id}:${i}`, p, colour: d.colour, intensity: (v * KIND[d.fixture].power * lamp) / Math.sqrt(d.ps.length), distance: d.dist }));
    }
    // The lights that are on first, then by id: a fixed order, so a lamp never hops between lights mid-fade.
    return lamps.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  get size() {
    return this.drawn.size;
  }

  dispose() {
    for (const d of this.drawn.values()) d.dispose();
    this.drawn.clear();
    this.poolTex.dispose();
    this.haloTex.dispose();
    this.roomTex.dispose();
    this.fadeTex.dispose();
    this.lineGeo.dispose();
    this.baseGeo.dispose();
    this.puckGeo.dispose();
    this.spotGeo.dispose();
    this.beamGeo.dispose();
    this.baseMat.dispose();
  }
}

/** A soft white disc on a canvas, from the centre out: [stop, alpha] pairs. */
function radial(stops: [number, number][]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  }
  return c;
}

/** White along the top fading to nothing at the bottom, soft at the left and right ends (#1007). */
function fade(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 64);
    x.globalCompositeOperation = "destination-in";
    const h = x.createLinearGradient(0, 0, 128, 0);
    h.addColorStop(0, "rgba(0,0,0,0)");
    h.addColorStop(0.08, "rgba(0,0,0,1)");
    h.addColorStop(0.92, "rgba(0,0,0,1)");
    h.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = h;
    x.fillRect(0, 0, 128, 64);
  }
  return c;
}
