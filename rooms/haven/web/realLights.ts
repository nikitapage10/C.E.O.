import * as THREE from "three";
import { centreOf, type HavenPlan, type PlanRoom } from "./data.ts";
import { deskRoom, fixtureOf, placeLights, roomLightOf, type Fixture, type Light, type PlacedLight } from "./lights.ts";
import { bedLampSpots, inBedroom, inStudio, kindOf, placeFixture, rowIndex, studioLampCorner, studioLampSpots, type FixturePlace, type LightKind } from "./fixtures.ts";
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
export type DrawFixture = Fixture | "room" | "spill" | LightKind;

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
/** A backlight's line: just under the wall cabinets (they hang from 0.64), over the counter's top (0.36). */
const BACK_TOP = 0.625, BACK_LOW = 0.37;

/** Where each kind of fixture shines from, how far, and how bright at full. */
const KIND: Record<DrawFixture, { y: number; pool: number; dist: number; power: number }> = {
  ceiling: { y: 1.3, pool: 0.95, dist: 4.2, power: 4.2 },
  // A room's own lights: the pool and the reach come from the room's size (`RoomBox`), these are the floor.
  room: { y: 1.3, pool: 0.8, dist: 1.6, power: 4.6 },
  floor: { y: LINE_H + 0.02, pool: 0.6, dist: 3, power: 2.6 },
  under: { y: 0.1, pool: 0.55, dist: 1.4, power: 1.2 },
  // #1020: an overhead zone's one lamp (its reach from the zone's size, this the floor), the backlight's, the hall's
  // glow, and the living room's spill from next door.
  spots: { y: 1.25, pool: 0, dist: 3, power: 4.2 },
  backlight: { y: 0.52, pool: 0.3, dist: 1.5, power: 2.6 },
  glow: { y: 1.2, pool: 0, dist: 1.8, power: 3.2 },
  spill: { y: 0.85, pool: 0, dist: 2.4, power: 3.2 },
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
export type DrawItem = PlacedLight & { fixture: DrawFixture; virtual: boolean; room?: RoomBox; place?: FixturePlace; glowAt?: { x: number; y: number } };

/**
 * What the house draws for a set of lights: each placed one (a home's fixture where it runs, #1007; a SwitchBot switch
 * as its room's lights, #1002), plus the Studio's when `desk`. Pure, for the tests. `plan` is the drawn (furnished)
 * plan, so a fixture follows the kitchen as drawn.
 */
export function drawList(plan: HavenPlan, lights: readonly Light[], spots: readonly PlanLight[] | undefined, desk: boolean): DrawItem[] {
  // The Studio's floor lamps with no saved spot stand in its corners (#1007, fixtures.ts studioLampSpots).
  const corners = studioLampSpots(plan);
  let studioLamps = 0;
  // The main bedroom's pair (#1060): a floor lamp with no saved spot that names the bedroom, or no room at all, stands
  // in a corner either side of the dresser (fixtures.ts bedLampSpots), by "left" or "right" in its name, else by order.
  const bedSpots = bedLampSpots(plan);
  let bedLamps = 0;
  const bedLamp = (light: Light): DrawItem => {
    const n = ` ${light.name.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    const at = bedSpots![/ left /.test(n) ? 0 : / right /.test(n) ? 1 : bedLamps++ % 2]!;
    return { light, ...at, fixture: "floor", virtual: false };
  };
  const { placed, loose } = placeLights(plan, lights, spots);
  const out: DrawItem[] = placed.map((p) => {
    if (corners && !p.spot && fixtureOf(p.light.name) === "floor" && inStudio(plan, p.x, p.y)) {
      const at = corners[studioLampCorner(p.light.name, studioLamps++)];
      return { ...p, ...at, fixture: "floor" as const, virtual: false };
    }
    if (bedSpots && !p.spot && fixtureOf(p.light.name) === "floor" && inBedroom(plan, p.x, p.y)) return bedLamp(p.light);
    const kind = kindOf(p.light.name, p.spot);
    const place = kind ? placeFixture(plan, kind, p.spot ?? null, rowIndex(p.light.name)) : null;
    if (place) {
      const { x0, y0, x1, y1 } = place.run;
      return { ...p, x: (x0 + x1) / 2, y: (y0 + y1) / 2, fixture: place.kind, virtual: false, place };
    }
    const room = roomLightOf(plan, p.light, p);
    return room ? { ...p, fixture: "room", virtual: false, room: boxOf(room) } : { ...p, fixture: fixtureOf(p.light.name), virtual: false };
  });
  if (bedSpots) for (const l of loose) if (fixtureOf(l.name) === "floor") out.push(bedLamp(l));
  const spill = spillOf(plan, out);
  if (spill) out.push(spill);
  const studio = desk ? deskRoom(plan) : null;
  if (studio) {
    const [x, y] = centreOf(studio);
    out.push({ light: { id: DESK_ID, vendor: "govee", name: studio.name, type: "desk", on: true, online: true }, x, y, fixture: "room", virtual: true, room: boxOf(studio) });
  }
  return out;
}

const LIVING = /\bliving\b/i;

/**
 * The living room's spill (#1020, Nikita: it shouldn't be dark when the kitchen and dining room are lit): a soft,
 * dim light over the living room while any of the open kitchen's lights is on (an overhead zone or the backlight),
 * coming from its lamp when it has one (the lamp glows with it). Nothing when a light of its own already lights it.
 */
export function spillOf(plan: HavenPlan, list: readonly DrawItem[]): DrawItem | null {
  const room = plan.rooms.find((r) => !r.detached && LIVING.test(r.name));
  if (!room) return null;
  const box = boxOf(room);
  if (list.some((d) => d.fixture === "room" && d.room && Math.abs(d.room.cx - box.cx) < 1 && Math.abs(d.room.cy - box.cy) < 1)) return null;
  const near = list.filter((d) => d.fixture === "spots" || d.fixture === "backlight");
  if (!near.length) return null;
  const on = near.some((d) => d.light.online && d.light.on === true);
  const lamp = plan.items.find((i) => i.k === "lamp" && room.parts.some(([x, y, w, h]) => i.x >= x && i.x <= x + w && i.y >= y && i.y <= y + h));
  return {
    light: { id: "spill-living", vendor: "switchbot", name: room.name, type: "spill", on, online: true, brightness: 80 },
    x: box.cx,
    y: box.cy,
    fixture: "spill",
    virtual: true,
    room: box,
    ...(lamp ? { glowAt: { x: lamp.x, y: lamp.y } } : {}),
  };
}

/** How far a room light reaches, in world units: just the room's far corners from its middle, never next door. */
export const roomReach = (b: RoomBox, u = 100) => Math.max(KIND.room.dist, (0.62 * Math.hypot(b.w, b.h)) / u);

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
  private baseMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.4 });

  constructor(
    private wx: (x: number) => number,
    private wz: (y: number) => number,
  ) {
    this.poolTex = new THREE.CanvasTexture(radial([[0, 1], [0.35, 0.42], [1, 0]]));
    this.haloTex = new THREE.CanvasTexture(radial([[0, 0.9], [0.3, 0.28], [1, 0]]));
    this.roomTex = new THREE.CanvasTexture(radial([[0, 1], [0.55, 0.75], [0.95, 0.12], [1, 0]]));
    this.fadeTex = new THREE.CanvasTexture(fade());
  }

  /** The lights as they are now: new ones built, moved or gone ones rebuilt or dropped, the rest only re-coloured. */
  set(list: ReturnType<typeof drawList>, reduce: boolean) {
    const seen = new Set<string>();
    const r = (v: number) => Math.round(v);
    for (const { light, x, y, fixture, room, place, glowAt } of list) {
      const key = place
        ? `${place.kind}:${r(place.run.x0)}:${r(place.run.y0)}:${r(place.run.x1)}:${r(place.run.y1)}`
        : room
          ? `${fixture}:${r(room.cx)}:${r(room.cy)}:${r(room.w)}:${r(room.h)}`
          : `${fixture}:${r(x)}:${r(y)}`;
      seen.add(light.id);
      let d = this.drawn.get(light.id);
      if (d && d.key !== key) {
        d.dispose();
        this.drawn.delete(light.id);
        d = undefined;
      }
      if (!d) {
        d = place ? this.buildFixture(light.id, key, place) : this.build(light.id, key, fixture, x, y, room, glowAt);
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

  private build(id: string, key: string, fixture: DrawFixture, x: number, y: number, room?: RoomBox, glowAt?: { x: number; y: number }): Drawn {
    const k = KIND[fixture];
    const g = new THREE.Group();
    // A room's lights hang over the room's middle, wherever its marker stands; spill light from its lamp, if it has one.
    if (room) [x, y] = [room.cx, room.cy];
    const lampAt = glowAt ?? { x, y };
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
    } else if (fixture === "spill" && glowAt) {
      // The living room's lamp, lit with the room next door (#1020): a soft glow round its shade.
      haloMat = this.halo();
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(0.7, 0.7, 1);
      halo.position.set(this.wx(glowAt.x) - this.wx(x), 0.8, this.wz(glowAt.y) - this.wz(y));
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
    return this.drawnOf(id, key, fixture, g, [new THREE.Vector3(this.wx(lampAt.x), k.y, this.wz(lampAt.y))], room ? roomReach(room) : k.dist, poolMat, lineMat, haloMat, null, [pool.geometry]);
  }

  /**
   * A home's fixture where it runs (#1007): since #1020 the overhead lights (a row of spots, a single fitting) are soft
   * light filling their zone, no fitting to see, and the backlight is the glow on the panelling and the counter.
   */
  private buildFixture(id: string, key: string, place: FixturePlace): Drawn {
    const { kind, run } = place;
    const k = KIND[kind];
    const g = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    if (kind === "spots" || kind === "glow") {
      const z = place.zone ?? { x0: run.x0 - 100, y0: run.y0 - 100, x1: run.x1 + 100, y1: run.y1 + 100 };
      const w = Math.max(20, z.x1 - z.x0), h = Math.max(20, z.y1 - z.y0);
      const poolMat = this.additive(this.roomTex);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry((w / 100) * 1.04, (h / 100) * 1.04), poolMat);
      geos.push(pool.geometry);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(this.wx((z.x0 + z.x1) / 2), 0.014, this.wz((z.y0 + z.y1) / 2));
      pool.renderOrder = 3;
      g.add(pool);
      // One lamp over the zone's middle, reaching its far corners.
      const box: RoomBox = { cx: (z.x0 + z.x1) / 2, cy: (z.y0 + z.y1) / 2, w, h };
      this.group.add(g);
      return this.drawnOf(id, key, kind, g, [new THREE.Vector3(this.wx(box.cx), k.y, this.wz(box.cy))], Math.max(k.dist, (0.62 * Math.hypot(w, h)) / 100), poolMat, null, null, null, geos);
    }
    // The backlight: the panelling under the wall cabinets washed (bright at the top) and the counter in front lit,
    // brightest at the wall.
    const a = new THREE.Vector3(this.wx(run.x0), 0, this.wz(run.y0)), b = new THREE.Vector3(this.wx(run.x1), 0, this.wz(run.y1));
    const len = Math.max(0.01, a.distanceTo(b));
    // Turned so a plane's local x runs from a to b.
    const turn = Math.atan2(-(b.z - a.z), b.x - a.x);
    const out = new THREE.Vector3(place.out?.[0] ?? 0, 0, place.out?.[1] ?? 1).normalize();
    const mid = a.clone().lerp(b, 0.5);
    const poolMat = this.additive(this.fadeTex);
    const washMat = this.additive(this.fadeTex);
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
    this.group.add(g);
    return this.drawnOf(id, key, kind, g, [mid.clone().addScaledVector(out, 0.3).setY(k.y)], k.dist, poolMat, null, null, washMat, geos);
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
      const pool = d.fixture === "under" ? 0.55 : d.fixture === "room" ? 0.3 : d.fixture === "spots" ? 0.34 : d.fixture === "glow" ? 0.32 : d.fixture === "spill" ? 0.42 : d.fixture === "backlight" ? 0.75 : 0.42;
      d.poolMat.opacity = v * pool * lit;
      // The fitting itself: the light's colour when on (brighter still by day), a dark puck or strip when off.
      d.lineMat?.color.copy(d.colour).multiplyScalar(0.06 + (0.94 + 0.5 * day) * v);
      if (d.haloMat) {
        d.haloMat.color.copy(d.colour);
        d.haloMat.opacity = v * (0.6 + 0.25 * day);
      }
      if (d.washMat) {
        d.washMat.color.copy(d.colour);
        d.washMat.opacity = v * (0.75 + 0.2 * day);
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
