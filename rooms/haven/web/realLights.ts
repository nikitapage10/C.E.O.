import * as THREE from "three";
import { centreOf, type HavenPlan } from "./data.ts";
import { deskRoom, fixtureOf, placeLights, type Fixture, type Light, type PlacedLight } from "./lights.ts";
import type { PlanLight } from "../../../api/_haven/planShape.ts";
import { LIGHT } from "./style.ts";

/**
 * The house's real lights (#974): every placed SwitchBot or Govee light drawn where it stands, lighting its room only
 * while it is really on. A floor lamp is a tall single-colour LED line uplight (about 4 to 5 ft against the house's
 * furniture), in the light's own colour when the vendor says; an under-light (under a counter or a cabinet) a low glow; anything
 * else a small ceiling light. Each has a soft pool on the floor; the house lends the brightest ones its fixed set of
 * point lights (`lamps`), so turning a light on or off never changes how many lights the scene has (no shader rebuild,
 * no flash). Switching eases over a fraction of a second; by day (`day` near 1) the pools and lamps give way to the sun.
 *
 * The Studio's own light (Nikita on the Desk from a desktop, #974) is one more, always on: `desk` true adds it.
 */

/** The LED line's height in world units: about 4.5 ft against the house's furniture (a fridge is 0.96). */
export const LINE_H = 0.72;
const DESK_ID = "desk-studio";

/** Where each kind of fixture shines from, how far, and how bright at full. */
const KIND: Record<Fixture, { y: number; pool: number; dist: number; power: number }> = {
  ceiling: { y: 1.3, pool: 0.95, dist: 4.2, power: 4.2 },
  floor: { y: LINE_H + 0.02, pool: 0.6, dist: 3, power: 2.6 },
  under: { y: 0.1, pool: 0.55, dist: 1.4, power: 1.2 },
};

/** One light's lamp for the house's point-light set: where, what colour, how bright. */
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
  fixture: Fixture;
  p: THREE.Vector3;
  colour: THREE.Color;
  /** 0 to 1, from the light's brightness when the vendor says. */
  power: number;
  want: number;
  level: number;
  group: THREE.Group;
  poolMat: THREE.MeshBasicMaterial;
  lineMat: THREE.MeshBasicMaterial | null;
  haloMat: THREE.SpriteMaterial | null;
  dispose: () => void;
}

/** The colour a light is drawn in: its own when the vendor says, else a warm white. */
export const colourOf = (l: Pick<Light, "rgb">): number => (l.rgb && /^#[0-9a-f]{6}$/i.test(l.rgb) ? parseInt(l.rgb.slice(1), 16) : LIGHT.lamp);

/** What the house draws for a set of lights: each placed one, plus the Studio's when `desk`. Pure, for the tests. */
export function drawList(plan: HavenPlan, lights: readonly Light[], spots: readonly PlanLight[] | undefined, desk: boolean): (PlacedLight & { fixture: Fixture; virtual: boolean })[] {
  const out = placeLights(plan, lights, spots).placed.map((p) => ({ ...p, fixture: fixtureOf(p.light.name), virtual: false }));
  const studio = desk ? deskRoom(plan) : null;
  if (studio) {
    const [x, y] = centreOf(studio);
    out.push({ light: { id: DESK_ID, vendor: "govee", name: studio.name, type: "desk", on: true, online: true }, x, y, fixture: "ceiling", virtual: true });
  }
  return out;
}

/** The marker's height over a light's spot (the house hangs its tap target there). */
export const markerY = (f: Fixture) => (f === "floor" ? LINE_H + 0.08 : f === "under" ? 0.22 : 1.29);

export class RealLights {
  readonly group = new THREE.Group();
  private drawn = new Map<string, Drawn>();
  private poolTex: THREE.CanvasTexture;
  private haloTex: THREE.CanvasTexture;
  private lineGeo = new THREE.BoxGeometry(0.024, LINE_H, 0.024);
  private baseGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.014, 20);
  private puckGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.012, 24);
  private baseMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.4 });

  constructor(
    private wx: (x: number) => number,
    private wz: (y: number) => number,
  ) {
    this.poolTex = new THREE.CanvasTexture(radial([[0, 1], [0.35, 0.42], [1, 0]]));
    this.haloTex = new THREE.CanvasTexture(radial([[0, 0.9], [0.3, 0.28], [1, 0]]));
  }

  /** The lights as they are now: new ones built, moved or gone ones rebuilt or dropped, the rest only re-coloured. */
  set(list: ReturnType<typeof drawList>, reduce: boolean) {
    const seen = new Set<string>();
    for (const { light, x, y, fixture } of list) {
      const key = `${fixture}:${Math.round(x)}:${Math.round(y)}`;
      seen.add(light.id);
      let d = this.drawn.get(light.id);
      if (d && d.key !== key) {
        d.dispose();
        this.drawn.delete(light.id);
        d = undefined;
      }
      if (!d) {
        d = this.build(light.id, key, fixture, x, y);
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

  private build(id: string, key: string, fixture: Fixture, x: number, y: number): Drawn {
    const k = KIND[fixture];
    const g = new THREE.Group();
    g.position.set(this.wx(x), 0, this.wz(y));
    const poolMat = new THREE.MeshBasicMaterial({ map: this.poolTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(k.pool * 2, k.pool * 2), poolMat);
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
      haloMat = new THREE.SpriteMaterial({ map: this.haloTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(0.34, LINE_H * 1.25, 1);
      halo.position.y = 0.014 + LINE_H / 2;
      halo.renderOrder = 9;
      g.add(halo);
    } else if (fixture === "ceiling" && id !== DESK_ID) {
      lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      g.add(new THREE.Mesh(this.puckGeo, lineMat).translateY(k.y + 0.084));
    } else if (fixture === "under") {
      haloMat = new THREE.SpriteMaterial({ map: this.haloTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(0.7, 0.22, 1);
      halo.position.y = 0.08;
      halo.renderOrder = 9;
      g.add(halo);
    }
    this.group.add(g);
    const d: Drawn = {
      key,
      id,
      fixture,
      p: new THREE.Vector3(this.wx(x), k.y, this.wz(y)),
      colour: new THREE.Color(LIGHT.lamp),
      power: 1,
      want: 0,
      level: 0,
      group: g,
      poolMat,
      lineMat,
      haloMat,
      dispose: () => {
        this.group.remove(g);
        pool.geometry.dispose();
        poolMat.dispose();
        lineMat?.dispose();
        haloMat?.dispose();
      },
    };
    return d;
  }

  /**
   * One frame: each light eases to on or off, its pool, line and halo follow, and the lamps for the house's point
   * lights come back in a fixed order (on first, then by id). `day` 0 to 1.
   */
  step(dt: number, day: number, reduce: boolean): Lamp[] {
    const night = 1 - 0.75 * day;
    const lamps: Lamp[] = [];
    for (const d of this.drawn.values()) {
      d.level = reduce ? d.want : d.level + (d.want - d.level) * Math.min(1, dt * 7);
      const v = d.level * d.power;
      d.poolMat.color.copy(d.colour);
      d.poolMat.opacity = v * (d.fixture === "under" ? 0.55 : 0.42) * night;
      // The LED line and the ceiling puck: the light's colour when on, a dark strip when off.
      d.lineMat?.color.copy(d.colour).multiplyScalar(0.1 + 0.9 * v);
      if (d.haloMat) {
        d.haloMat.color.copy(d.colour);
        d.haloMat.opacity = v * 0.55 * (1 - 0.5 * day);
      }
      if (v > 0.01) lamps.push({ key: `${1 - d.want}${d.id}`, p: d.p, colour: d.colour, intensity: v * KIND[d.fixture].power * night, distance: KIND[d.fixture].dist });
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
    this.lineGeo.dispose();
    this.baseGeo.dispose();
    this.puckGeo.dispose();
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
