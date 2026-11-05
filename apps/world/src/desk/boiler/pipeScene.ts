import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CurvePath,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineCurve3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { CODE, ARC } from "@ceo/engine/sigils/sigils.ts";
import type { StationState } from "./pipes.ts";
import type { MapGeo, PipeKind, RoomSection, V2 } from "./rooms.ts";
import type { SchemModel } from "./schematic.ts";
import { windRoom, type RoomWind } from "./wind.ts";

/**
 * The Boiler Room's pipe map in three.js (#732, room by room since #743), from the approved B4 demo (concepts
 * 2026-11-04, board/r2/pipes.js): a blueprint sheet, the riveted boiler with its flickering firebox at the heart, a
 * trunk on each side, and each room a manifold off its trunk: a brass header in the room's colour, and one branch pipe
 * per connection, job or part, a station (a junction and a gauge) at its tip. Healthy branches carry soft flow pulses;
 * a late one flows slow and amber; a shut one has a coral valve on it and a dry pipe; a broken one cracks, steams and
 * drips coral with its gauge in the red; one not connected yet stays dry, and a planned one is a ghost. Hovering a
 * pipe, valve or gauge tells the page which (onHover), a click or tap picks it (onPick), and the page can track one
 * station's place on screen for its card. Loaded lazily by PipeBoard.tsx. With reduced motion nothing moves.
 */

const CORAL = "#ff6f61";
const AMBER = "#e8b84a";
const FLOW = "#ffd9a0";
const R = 0.15;
const RB = 0.085;
const H = 0.32;
const NS = 220;
const ND = 14;
const MAX_GLOWS = 3;

const W = (p: V2, h = H) => new Vector3(p[0], h, p[1]);

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export type MapTarget = { pipe: string } | { room: string };

export interface SceneSection {
  id: string;
  name: string;
  c: string;
  pipes: { id: string; name: string; kind: PipeKind }[];
}

export interface PipeSceneOpts {
  reduce: boolean;
  onPick: (t: MapTarget | null) => void;
  onHover: (t: MapTarget | null) => void;
}

interface Gauge {
  cv: HTMLCanvasElement;
  tex: CanvasTexture;
  g: Group;
  v: number;
  to: number;
  drawn: number;
}

/**
 * One thing on the floor with a state: on the overview a branch pipe and its station; in a room's own run (#789) a
 * part (a station, no pipe) or a connection (a pipe, no station). `id` is what a hover or pick opens, `key` what its
 * state is read by (a part and the link into it can open the same card yet hold different states).
 */
interface Station {
  id: string;
  key: string;
  room: string;
  kind: PipeKind;
  /** The stretch of pipe a crack or a valve sits on. */
  root: Vector3;
  tip: Vector3;
  /** Where the card points. */
  anchor: Vector3;
  body: Mesh<BufferGeometry, MeshStandardMaterial> | null;
  pipe: Mesh<TubeGeometry, Material> | null;
  flow: Mesh<TubeGeometry, ShaderMaterial> | null;
  gauge: Gauge | null;
  wheel: Group | null;
  crack: Group | null;
  sleeve: Mesh<CylinderGeometry, MeshStandardMaterial> | null;
  crackAt: Vector3;
  label: HTMLDivElement | null;
  state: StationState;
  /** Its run, for the sigils that ride the flow. */
  run: Vector3[];
}

interface Header {
  room: string;
  flow: ShaderMaterial;
  tube: Mesh;
  run: Vector3[];
}

type Box = [number, number, number, number];

const gaugeG = new CylinderGeometry(0.27, 0.27, 0.07, 32);

export class PipeScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private cam = new PerspectiveCamera(32, 1, 0.1, 400);
  private lbls: HTMLDivElement;
  private labels: { d: HTMLDivElement; pos: Vector3; net: boolean; below?: boolean }[] = [];
  private net = new Group();
  private headers: Header[] = [];
  private stations: Station[] = [];
  private byId = new Map<string, Station>();
  private gauges: Gauge[] = [];
  private boilerGauge: Gauge;
  private fire: PointLight;
  private door: Mesh<CircleGeometry, MeshBasicMaterial>;
  private glows: PointLight[] = [];
  private flowOk: ShaderMaterial;
  private flowLate: ShaderMaterial;
  private steamGeo = new BufferGeometry();
  private steamPos = new Float32Array(NS * 3);
  private steamVel = new Float32Array(NS * 3);
  private steamAge = new Float32Array(NS);
  private steamLife = new Float32Array(NS);
  private steamU = { px: { value: 1 }, on: { value: 0 } };
  private dripGeo = new BufferGeometry();
  private dripPos = new Float32Array(ND * 3);
  private dripVy = new Float32Array(ND);
  private drips: Points;
  private leaks: Station[] = [];
  private geo: MapGeo | null = null;
  private focusBox: Box = [-10, -6, 10, 6];
  private look = new Vector3();
  private dist = 0;
  private raf = 0;
  private last = performance.now();
  private T = 0;
  private visible = true;
  private dirty = 4;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private ray = new Raycaster();
  private mouse = new Vector2();
  private moved = false;
  private lastMove: { x: number; y: number } | null = null;
  private hoverKey = "";
  private picks: Object3D[] = [];
  private brass = new MeshStandardMaterial({ color: 0xb48a50, metalness: 0.85, roughness: 0.32 });
  private iron = new MeshStandardMaterial({ color: 0x24262b, metalness: 0.7, roughness: 0.5 });
  private dryMat = new MeshStandardMaterial({ color: 0x4b4338, metalness: 0.6, roughness: 0.55 });
  private ghostMat = new MeshBasicMaterial({ color: 0x3a414d, wireframe: true, transparent: true, opacity: 0.4 });
  private bands = new Map<string, MeshStandardMaterial>();
  /** A room's own connections each carry a flow sized to their length. */
  private ownFlows: ShaderMaterial[] = [];
  /** The station the page's card follows, and where it is on screen. */
  track: string | null = null;
  onTrack: ((x: number, y: number) => void) | null = null;
  private tracked = "";
  /** WASD to look around the map (#776). */
  private pan: ReturnType<typeof wasdPan>;
  private boiler: Group;
  private boilerLbl: HTMLDivElement;
  /** The whole map, or one room's own run (#789), and what that run was laid from. */
  private mode: "map" | "room" = "map";
  private roomSrc: { section: RoomSection; model: SchemModel } | null = null;
  private roomPer = 0;
  private lastSet: [Record<string, StationState>, string | null, string | null] | null = null;
  private sigils: Sigils;

  constructor(
    private host: HTMLElement,
    private opts: PipeSceneOpts,
  ) {
    const canvas = document.createElement("canvas");
    canvas.className = "bp-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    this.lbls = document.createElement("div");
    this.lbls.className = "bp-lbls";
    canvas.after(this.lbls);

    const renderer = (this.renderer = new WebGLRenderer({ canvas, antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const scene = this.scene;
    scene.background = new Color(0x0b0d11);
    scene.add(new HemisphereLight(0xc8d4ff, 0x15110c, 0.9));
    const key = new DirectionalLight(0xfff0dc, 2.2);
    key.position.set(-8, 18, 10);
    scene.add(key);
    const rim = new DirectionalLight(0x7fa6ff, 0.9);
    rim.position.set(10, 6, -12);
    scene.add(rim);

    // The floor: a blueprint sheet with a faint grid.
    const floor = new Mesh(
      new PlaneGeometry(90, 60),
      new ShaderMaterial({
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `varying vec2 vP; void main(){ vec2 g = abs(fract(vP)-.5); float l = 1.-smoothstep(.0,.03,min(g.x,g.y)); vec2 g4 = abs(fract(vP*.25)-.5); float L = 1.-smoothstep(.0,.012,min(g4.x,g4.y));
          float v = 1.-smoothstep(10.,28.,length(vP)); vec3 c = vec3(.043,.051,.066) + vec3(.03,.036,.05)*l*v + vec3(.05,.06,.08)*L*v; gl_FragColor = vec4(c,1.); }`,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // ---- the boiler ----
    const brass = this.brass;
    const iron = this.iron;
    const boltG = new SphereGeometry(0.022, 6, 4);
    const boiler = (this.boiler = new Group());
    scene.add(boiler);
    const shell = new Mesh(new CylinderGeometry(1.25, 1.35, 1.7, 48), iron);
    shell.position.y = 0.85;
    boiler.add(shell);
    const dome = new Mesh(new SphereGeometry(1.25, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: 0x2c2c30, metalness: 0.8, roughness: 0.35 }));
    dome.position.y = 1.7;
    dome.scale.y = 0.45;
    boiler.add(dome);
    const M = new Matrix4();
    for (const y of [0.18, 0.9, 1.62]) {
      const band = new Mesh(new TorusGeometry(1.3, 0.05, 8, 64), brass);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      boiler.add(band);
      const rivets = new InstancedMesh(boltG, brass, 36);
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        M.makeTranslation(Math.cos(a) * 1.33, y + 0.09, Math.sin(a) * 1.33);
        rivets.setMatrixAt(k, M);
      }
      boiler.add(rivets);
    }
    this.door = new Mesh(new CircleGeometry(0.42, 32), new MeshBasicMaterial({ color: 0xff7a2a }));
    this.door.position.set(0, 0.7, 1.33);
    boiler.add(this.door);
    const doorRim = new Mesh(new TorusGeometry(0.44, 0.06, 8, 40), brass);
    doorRim.position.set(0, 0.7, 1.34);
    boiler.add(doorRim);
    const barG = new BoxGeometry(0.04, 0.7, 0.04);
    for (let k = -2; k <= 2; k++) {
      const b = new Mesh(barG, iron);
      b.position.set(k * 0.15, 0.7, 1.36);
      boiler.add(b);
    }
    this.fire = new PointLight(0xff8a3a, 6, 7, 1.6);
    this.fire.position.set(0, 0.7, 2.1);
    boiler.add(this.fire);
    const stack = new Mesh(new CylinderGeometry(0.16, 0.2, 1.1, 16), iron);
    stack.position.set(0.55, 2.1, -0.35);
    boiler.add(stack);
    this.boilerGauge = this.makeGauge(new Vector3(-0.5, 2.55, 0.35), 0.55, 1.5, boiler);
    this.boilerGauge.g.rotation.x = 0.5;
    this.boilerLbl = this.label("The boiler", new Vector3(0, 3.2, 0), "is-boiler", false);

    scene.add(this.net);
    this.flowOk = flowMat(1.2, FLOW);
    this.flowLate = flowMat(0.35, AMBER);

    for (let i = 0; i < MAX_GLOWS; i++) {
      const l = new PointLight(CORAL, 0, 3.5, 1.5);
      scene.add(l);
      this.glows.push(l);
    }
    // Steam: soft points rising from every crack. Drips under them.
    this.steamGeo.setAttribute("position", new BufferAttribute(this.steamPos, 3));
    this.steamGeo.setAttribute("age", new BufferAttribute(this.steamAge, 1));
    const steam = new Points(
      this.steamGeo,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: this.steamU,
        vertexShader: `attribute float age; uniform float px; varying float vA; void main(){ vA = age; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = (12. + age*60.) * px * (10./-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying float vA; uniform float on; void main(){ float d = length(gl_PointCoord-.5); if(d>.5) discard; float a = (1.-d*2.); a *= a; vec3 c = mix(vec3(1.,.55,.48), vec3(.86,.88,.92), smoothstep(.0,.35,vA)); gl_FragColor = vec4(c, a*.42*(1.-vA)*smoothstep(0.,.08,vA)*on); }`,
      }),
    );
    steam.frustumCulled = false;
    scene.add(steam);
    this.dripGeo.setAttribute("position", new BufferAttribute(this.dripPos, 3));
    this.drips = new Points(this.dripGeo, new PointsMaterial({ color: 0xffb0a6, size: 0.06, transparent: true, opacity: 0.85 }));
    this.drips.frustumCulled = false;
    this.drips.visible = false;
    scene.add(this.drips);
    // The sigils that ride the flow: the Desk's glyphs, not dots.
    this.sigils = new Sigils(opts.reduce);
    scene.add(this.sigils.points);

    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerleave", this.onLeave);
    this.lbls.addEventListener("click", this.onLabel);
    this.ro = new ResizeObserver(() => this.size());
    this.ro.observe(host);
    this.io = new IntersectionObserver(([e]) => {
      this.visible = !!e?.isIntersecting;
      if (this.visible) this.dirty = 4;
    });
    this.io.observe(host);
    document.addEventListener("visibilitychange", this.onVis);
    const b = () => this.geo?.box ?? this.focusBox;
    this.pan = wasdPan({ el: host, reduce: opts.reduce, bounds: () => ({ kind: "box", x0: b()[0], z0: b()[1], x1: b()[2], z1: b()[3] }), origin: () => [this.look.x, this.look.z], forward: () => [this.look.x - this.cam.position.x, this.look.z - this.cam.position.z] });
    this.size();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Lay the rooms' manifolds (again, whenever the set of pipes changes). */
  build(sections: SceneSection[], geo: MapGeo): void {
    this.clearNet();
    this.mode = "map";
    this.roomSrc = null;
    this.boiler.visible = true;
    this.boilerLbl.style.display = "";
    this.geo = geo;
    this.focusBox = geo.box;
    const net = this.net;
    const brass = this.brass;
    const { flange, band } = this.kit();
    const bodyG = new CylinderGeometry(0.17, 0.17, 0.3, 16);

    for (const t of geo.trunks) {
      const a = W(t[0]!);
      const b = W(t[1]!);
      const tan = b.clone().sub(a).normalize();
      net.add(tube(a, b, R * 1.15, brass));
      flange(a, tan, null, 1.1);
      flange(b, tan, null, 1.1);
    }

    for (const sec of sections) {
      const g = geo.sections.find((x) => x.id === sec.id);
      if (!g) continue;
      const pts = g.header.map((p) => W(p));
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const tan = pts[1]!.clone().sub(a).normalize();
      const endTan = b.clone().sub(pts[pts.length - 2]!).normalize();
      const curve = runCurve(pts, 0.45);
      const len = curve.getLength();
      const head = tubeAlong(curve, R, brass);
      head.userData.room = sec.id;
      net.add(head);
      this.picks.push(head);
      const fm = flowMat(1.2, FLOW, len);
      const hf = tubeAlong(curve, R * 1.05, fm);
      net.add(hf);
      this.headers.push({ room: sec.id, flow: fm, tube: hf, run: pts });
      flange(a.clone().addScaledVector(tan, 0.35), tan, sec.c);
      flange(b, endTan, sec.c);
      // Each turn of a wound header wears a band in the room's colour.
      for (let k = 1; k < pts.length - 1; k++) {
        const m = new Mesh(new SphereGeometry(R * 1.35, 16, 12), band(sec.c));
        m.position.copy(pts[k]!);
        net.add(m);
      }
      // The room's own valve, where its header leaves the trunk.
      const w = valveWheel(0.2, brass);
      w.position.copy(a).addScaledVector(tan, 0.7).add(new Vector3(0, 0.3, 0));
      w.rotation.x = -Math.PI / 2;
      net.add(w);
      const lb = this.label(sec.name, W(g.label, 0.45), `is-room ${g.label[0] < 0 ? "is-left" : "is-right"}`, true);
      lb.dataset.room = sec.id;
      lb.style.color = sec.c;

      sec.pipes.forEach((p, k) => {
        const pg = g.pipes[k];
        if (!pg) return;
        const root = W(pg.root);
        const tip = W(pg.tip);
        const dir = tip.clone().sub(root).normalize();
        const planned = p.kind === "planned";
        const pipe = tube<Material>(root, tip, RB, planned ? this.ghostMat : brass);
        pipe.userData.pipe = p.id;
        net.add(pipe);
        this.picks.push(pipe);
        const flow = tube(root, tip, RB * 1.12, this.flowOk);
        flow.visible = false;
        net.add(flow);
        if (!planned) flange(root.clone().addScaledVector(dir, 0.2), dir, k % 2 ? sec.c : null, 0.62);
        const body = new Mesh<BufferGeometry, MeshStandardMaterial>(bodyG, stationMat());
        body.position.copy(tip);
        body.userData.pipe = p.id;
        net.add(body);
        this.picks.push(body);
        const gauge = this.makeGauge(tip.clone().add(new Vector3(0, 0.45, 0)), 0.5, 0.72, net);
        gauge.g.rotation.x = 0.35;
        gauge.g.traverse((o) => (o.userData.pipe = p.id));
        this.picks.push(gauge.g);
        // A branch that runs toward the viewer carries its name under its station, one away from it over it.
        const below = pg.tip[1] > pg.root[1];
        const lb = this.label(p.name, below ? tip.clone().add(new Vector3(0, -H, 0.34)) : tip.clone().add(new Vector3(0, 0.8, 0)), "is-st", true);
        if (below) this.labels[this.labels.length - 1]!.below = true;
        lb.dataset.pipe = p.id;
        lb.title = p.name;
        const st: Station = { id: p.id, key: p.id, room: sec.id, kind: p.kind, root, tip, anchor: tip.clone().setY(tip.y + 0.75), body, pipe, flow, gauge, wheel: null, crack: null, sleeve: null, crackAt: root.clone().lerp(tip, 0.5), label: lb, state: "ok", run: [root, tip] };
        this.stations.push(st);
        this.byId.set(p.id, st);
      });
    }
    this.dirty = 4;
  }

  /**
   * One room's own run (#789): its parts as stations and its connections as pipes at right angles between them, wound
   * in bands to fit the view (boiler/wind.ts). The boiler steps aside; everything else (flow, cracks, valves, steam,
   * gauges, the sigils, hover and pick, the card that follows) works as it does on the whole map.
   */
  showRoom(section: RoomSection, model: SchemModel): void {
    this.roomSrc = { section, model };
    this.layRoom();
  }

  /** The shape the room's run should take: wide on a desk; on a phone the camera turns, so the same. */
  private want(): number {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return 1.6;
    return this.phone() ? h / w : w / h;
  }

  private layRoom(): void {
    const src = this.roomSrc;
    if (!src) return;
    const wind = windRoom(src.section, src.model, this.want());
    this.roomPer = wind.per;
    this.buildRoom(wind, src.section);
    this.roomSrc = src;
    if (this.lastSet) this.set(...this.lastSet);
  }

  private buildRoom(w: RoomWind, sec: RoomSection): void {
    this.clearNet();
    this.mode = "room";
    this.geo = null;
    this.boiler.visible = false;
    this.boilerLbl.style.display = "none";
    this.focusBox = w.box;
    const net = this.net;
    const brass = this.brass;
    const { flange, band } = this.kit();

    for (const n of w.nodes) {
      const at = W(n.at);
      const ghost = n.kind === "planned";
      const geo = n.hub ? new CylinderGeometry(0.34, 0.4, 0.5, 6) : (KIND_BODY[n.kind] ?? KIND_BODY.service!)();
      const body = new Mesh<BufferGeometry, MeshStandardMaterial>(geo, stationMat(n.hub ? sec.c : undefined));
      if (ghost) body.material.wireframe = true;
      body.position.copy(at).setY(n.hub ? 0.3 : at.y);
      body.userData.pipe = n.target;
      net.add(body);
      this.picks.push(body);
      if (n.hub) {
        const ring = new Mesh(new TorusGeometry(0.46, 0.05, 8, 36), band(sec.c));
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(at).setY(0.08);
        net.add(ring);
      }
      const gauge = this.makeGauge(at.clone().add(new Vector3(0, n.hub ? 0.7 : 0.45, 0)), 0.5, n.hub ? 0.9 : 0.72, net);
      gauge.g.rotation.x = 0.35;
      gauge.g.traverse((o) => (o.userData.pipe = n.target));
      this.picks.push(gauge.g);
      const lb = this.label(n.name, at.clone().add(new Vector3(0, n.hub ? 1.2 : 0.85, 0)), n.hub ? "is-st is-node is-hub" : "is-st is-node", true);
      lb.dataset.pipe = n.target;
      lb.title = n.sub ? `${n.name}: ${n.sub}` : n.name;
      if (n.hub) lb.style.color = sec.c;
      const st: Station = { id: n.target, key: n.key, room: sec.id, kind: ghost ? "planned" : "part", root: at, tip: at, anchor: at.clone().setY(at.y + (n.hub ? 1.0 : 0.75)), body, pipe: null, flow: null, gauge, wheel: null, crack: null, sleeve: null, crackAt: at, label: lb, state: "ok", run: [] };
      this.stations.push(st);
      if (!this.byId.has(n.target)) this.byId.set(n.target, st);
    }

    for (const l of w.links) {
      const pts = l.path.map((p) => W(p));
      const curve = runCurve(pts, 0.4);
      const len = curve.getLength();
      const pipe = tubeAlong<Material>(curve, RB, l.planned ? this.ghostMat : brass);
      pipe.userData.pipe = l.target;
      net.add(pipe);
      this.picks.push(pipe);
      const fm = flowMat(1.2, FLOW, len);
      this.ownFlows.push(fm);
      const flow = tubeAlong(curve, RB * 1.12, fm);
      flow.visible = false;
      net.add(flow);
      // The connection's own flanges, where it leaves a part and where it reaches the next.
      if (!l.planned && pts.length > 1) {
        const t0 = pts[1]!.clone().sub(pts[0]!).normalize();
        const t1 = pts[pts.length - 1]!.clone().sub(pts[pts.length - 2]!).normalize();
        flange(pts[0]!.clone().addScaledVector(t0, 0.42), t0, null, 0.62);
        flange(pts[pts.length - 1]!.clone().addScaledVector(t1, -0.42), t1, sec.c, 0.62);
      }
      // The stretch the crack or valve sits on: the segment halfway along.
      const mid = W(l.mid);
      let seg = 0;
      for (let k = 0; k < pts.length - 1; k++) if (onSeg(mid, pts[k]!, pts[k + 1]!)) seg = k;
      const d = pts[seg + 1]!.clone().sub(pts[seg]!).normalize();
      const root = mid.clone().addScaledVector(d, -0.4);
      const tip = mid.clone().addScaledVector(d, 0.4);
      const st: Station = { id: l.target, key: l.key, room: sec.id, kind: l.planned ? "planned" : "link", root, tip, anchor: mid.clone().setY(mid.y + 0.55), body: null, pipe, flow, gauge: null, wheel: null, crack: null, sleeve: null, crackAt: mid, label: null, state: "ok", run: pts };
      this.stations.push(st);
      if (!this.byId.has(l.target)) this.byId.set(l.target, st);
    }
    this.dirty = 4;
  }

  /** The fittings both views share: a flange (with a band in a room's colour) and the band's material. */
  private kit() {
    const flangeG = new CylinderGeometry(R * 1.55, R * 1.55, 0.09, 20);
    const bandG = new CylinderGeometry(R * 1.08, R * 1.08, 0.16, 20);
    const up = new Vector3(0, 1, 0);
    const band = (c: string) => {
      let m = this.bands.get(c);
      if (!m) this.bands.set(c, (m = new MeshStandardMaterial({ color: c, metalness: 0.2, roughness: 0.6 })));
      return m;
    };
    const flange = (pos: Vector3, tan: Vector3, colour: string | null, scale = 1) => {
      const g = new Group();
      g.position.copy(pos);
      g.quaternion.setFromUnitVectors(up, tan);
      g.scale.setScalar(scale);
      g.add(new Mesh(flangeG, this.brass));
      if (colour) {
        const b = new Mesh(bandG, band(colour));
        b.position.y = 0.2;
        g.add(b);
      }
      this.net.add(g);
    };
    return { flange, band };
  }

  /** Every pipe's state, the room in focus (null for the whole map) and the pipe the panel is on. */
  set(states: Record<string, StationState>, focusRoom: string | null, current: string | null): void {
    this.lastSet = [states, focusRoom, current];
    const coral = new Color(CORAL);
    const amber = new Color(AMBER);
    const room = this.mode === "room";
    for (const s of this.stations) {
      const st = states[s.key] ?? "dry";
      s.state = st;
      if (s.gauge) {
        s.gauge.to = gaugeOf(s.key, st);
        if (this.opts.reduce) s.gauge.v = s.gauge.to;
      }
      if (st === "shut" && !s.wheel && s.pipe) {
        const wm = new MeshStandardMaterial({ color: CORAL, metalness: 0.5, roughness: 0.4, emissive: coral, emissiveIntensity: 0.4 });
        s.wheel = valveWheel(0.16, wm);
        s.wheel.position.copy(s.root).lerp(s.tip, 0.4).add(new Vector3(0.2, 0.06, 0));
        s.wheel.rotation.y = Math.PI / 2;
        s.wheel.traverse((o) => (o.userData.pipe = s.id));
        this.net.add(s.wheel);
        this.picks.push(s.wheel);
      }
      if (s.wheel) s.wheel.visible = st === "shut";
      if (st === "leak" && !s.crack && s.pipe) this.makeCrack(s);
      if (s.crack) s.crack.visible = st === "leak";
      if (s.body) {
        const m = s.body.material;
        m.emissive.copy(st === "late" ? amber : coral);
        m.emissiveIntensity = st === "leak" || st === "shut" ? 0.45 : st === "late" ? 0.35 : 0;
        // A room's own hub keeps its colour; every other station greys while it waits.
        if (!m.userData.hub) m.color.setHex(st === "dry" ? 0x3a4049 : 0x5f6b78);
      }
      if (s.pipe && s.kind !== "planned") s.pipe.material = st === "dry" ? this.dryMat : this.brass;
      if (s.flow) {
        s.flow.visible = st === "ok" || st === "late";
        if (this.ownFlows.includes(s.flow.material)) {
          s.flow.material.uniforms.speed!.value = st === "late" ? 0.35 : 1.2;
          (s.flow.material.uniforms.col!.value as Color).set(st === "late" ? AMBER : FLOW);
        } else s.flow.material = st === "late" ? this.flowLate : this.flowOk;
      }
      if (s.label) {
        // In a room's own run every part is named; on the whole map only the ones that need a look.
        const show = room || st === "leak" || st === "shut" || st === "late" || focusRoom === s.room || current === s.id;
        const base = s.label.className.includes("is-node") ? `is-node${s.label.className.includes("is-hub") ? " is-hub" : ""} ` : "";
        s.label.className = `bp-lb is-st ${base}is-${st}${show ? " is-show" : ""}${current === s.id ? " is-sel" : ""}`;
      }
    }
    for (const h of this.headers) {
      const mine = this.stations.filter((s) => s.room === h.room);
      const ok = mine.some((s) => s.state === "ok");
      h.tube.visible = ok || mine.some((s) => s.state === "late");
      h.flow.uniforms.speed!.value = ok ? 1.2 : 0.35;
      (h.flow.uniforms.col!.value as Color).set(ok ? FLOW : AMBER);
    }
    for (const l of this.labels) if (l.d.classList.contains("is-room")) l.d.classList.toggle("is-sel", l.d.dataset.room === focusRoom);
    this.leaks = this.stations.filter((s) => s.state === "leak");
    this.glows.forEach((l, i) => {
      const s = this.leaks[i];
      l.intensity = 0;
      if (s) l.position.copy(s.crackAt).add(new Vector3(0, 0.45, 0));
    });
    this.steamU.on.value = this.leaks.length ? 1 : 0;
    this.drips.visible = this.leaks.length > 0;
    for (let i = 0; i < NS; i++) this.respawn(i, Math.random());
    for (let i = 0; i < ND; i++) {
      const s = this.leaks[i % Math.max(1, this.leaks.length)];
      if (s) this.dripPos.set([s.crackAt.x + (Math.random() - 0.5) * 0.15, Math.random() * H, s.crackAt.z + (Math.random() - 0.5) * 0.15], i * 3);
      this.dripVy[i] = 0;
    }
    this.steamGeo.attributes.position!.needsUpdate = true;
    this.steamGeo.attributes.age!.needsUpdate = true;
    this.dripGeo.attributes.position!.needsUpdate = true;
    this.boilerGauge.to = this.stations.some((s) => s.state === "leak" || s.state === "shut" || s.state === "late") ? 0.62 : 0.5;
    if (!room) {
      const sec = focusRoom ? this.geo?.sections.find((x) => x.id === focusRoom) : null;
      this.focusBox = sec ? sec.box : (this.geo?.box ?? this.focusBox);
    }
    // The sigils ride whatever flows: the headers with pressure, every flowing or late branch or connection.
    const runs: { pts: Vector3[]; late: boolean }[] = [];
    for (const h of this.headers) if (h.tube.visible) runs.push({ pts: h.run, late: h.flow.uniforms.speed!.value < 1 });
    for (const s of this.stations) if (s.run.length > 1 && (s.state === "ok" || s.state === "late")) runs.push({ pts: s.run, late: s.state === "late" });
    this.sigils.lay(runs, room ? 70 : 110);
    this.dirty = 4;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.pan.dispose();
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVis);
    const c = this.renderer.domElement;
    c.removeEventListener("click", this.onClick);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerleave", this.onLeave);
    this.lbls.removeEventListener("click", this.onLabel);
    this.clearNet();
    freeTree(this.scene);
    for (const m of [this.flowOk, this.flowLate, this.dryMat, this.ghostMat, this.brass, this.iron, ...this.bands.values()]) m.dispose();
    this.sigils.dispose();
    this.renderer.dispose();
    c.remove();
    this.lbls.remove();
  }

  private clearNet() {
    freeTree(this.net);
    this.net.clear();
    for (const s of this.stations) s.body?.material.dispose();
    for (const m of this.ownFlows) m.dispose();
    this.ownFlows = [];
    const gone = new Set(this.stations.map((s) => s.gauge).filter(Boolean));
    this.gauges = this.gauges.filter((g) => !gone.has(g));
    for (const l of this.labels) if (l.net) l.d.remove();
    this.labels = this.labels.filter((l) => !l.net);
    this.stations = [];
    this.byId.clear();
    this.headers = [];
    this.picks = [];
    this.leaks = [];
  }

  private label(txt: string, pos: Vector3, cls: string, net: boolean) {
    const d = document.createElement("div");
    d.className = `bp-lb ${cls}`;
    d.textContent = txt;
    this.lbls.append(d);
    this.labels.push({ d, pos, net });
    return d;
  }

  private makeGauge(pos: Vector3, value: number, scale: number, parent: Object3D): Gauge {
    const cv = document.createElement("canvas");
    cv.width = cv.height = scale > 1 ? 160 : 96;
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new Mesh(gaugeG, [this.brass, new MeshBasicMaterial({ map: tex }), this.brass]);
    const g = new Group();
    g.add(m);
    g.position.copy(pos);
    g.scale.setScalar(scale);
    parent.add(g);
    const stem = new Mesh(new CylinderGeometry(0.03, 0.03, Math.max(0.05, pos.y - H), 8), this.brass);
    stem.position.set(pos.x, (pos.y + H) / 2, pos.z);
    parent.add(stem);
    const gg: Gauge = { cv, tex, g, v: value, to: value, drawn: -1 };
    this.gauges.push(gg);
    drawGauge(gg, 0);
    return gg;
  }

  private makeCrack(s: Station) {
    const coral = new Color(CORAL);
    const crack = new Group();
    const dir = s.tip.clone().sub(s.root).normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    const shardMat = new MeshStandardMaterial({ color: 0x3a2320, emissive: coral, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.5 });
    const shards = new Group();
    shards.position.copy(s.crackAt);
    shards.quaternion.copy(q);
    for (let k = 0; k < 6; k++) {
      const m = new Mesh(new BoxGeometry(0.035, 0.025, 0.1), shardMat);
      const a = (k / 6) * Math.PI * 2;
      m.position.set(Math.cos(a) * RB * 1.1, (Math.random() - 0.5) * 0.08, Math.sin(a) * RB * 1.1);
      m.rotation.set(Math.random(), Math.random(), Math.random());
      shards.add(m);
    }
    crack.add(shards);
    const sleeve = new Mesh(new CylinderGeometry(RB * 1.25, RB * 1.25, 0.32, 12, 1, true), new MeshStandardMaterial({ color: 0xb4614c, metalness: 0.6, roughness: 0.4, emissive: coral, emissiveIntensity: 0.6 }));
    sleeve.position.copy(s.crackAt);
    sleeve.quaternion.copy(q);
    sleeve.userData.pipe = s.id;
    crack.add(sleeve);
    const puddle = new Mesh(new CircleGeometry(0.45, 28), new MeshBasicMaterial({ color: CORAL, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false }));
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(s.crackAt.x + 0.15, 0.01, s.crackAt.z);
    crack.add(puddle);
    this.net.add(crack);
    this.picks.push(sleeve);
    s.crack = crack;
    s.sleeve = sleeve;
  }

  private onVis = () => {
    if (!document.hidden) this.dirty = 4;
  };

  private targetAt(clientX: number, clientY: number): MapTarget | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.cam);
    const hit = this.ray.intersectObjects(this.picks.filter((o) => o.visible), true)[0];
    if (!hit) return null;
    for (let o: Object3D | null = hit.object; o; o = o.parent) {
      if (typeof o.userData.pipe === "string") return { pipe: o.userData.pipe as string };
      if (typeof o.userData.room === "string") return { room: o.userData.room as string };
    }
    return null;
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.lastMove = { x: e.clientX, y: e.clientY };
    this.moved = true;
  };
  private onLeave = () => {
    this.lastMove = null;
    this.moved = true;
  };
  private onClick = (e: MouseEvent) => this.opts.onPick(this.targetAt(e.clientX, e.clientY));
  private onLabel = (e: MouseEvent) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>(".bp-lb");
    if (d?.dataset.pipe) this.opts.onPick({ pipe: d.dataset.pipe });
    else if (d?.dataset.room) this.opts.onPick({ room: d.dataset.room });
  };

  private respawn(i: number, age = 0) {
    const s = this.leaks.length ? this.leaks[i % this.leaks.length]! : null;
    const at = s ? s.crackAt : new Vector3(0, -5, 0);
    this.steamPos.set([at.x + (Math.random() - 0.5) * 0.08, at.y + 0.08 + age * 1.0, at.z + (Math.random() - 0.5) * 0.08], i * 3);
    this.steamVel.set([0.25 + Math.random() * 0.4, 0.8 + Math.random() * 0.7, (Math.random() - 0.5) * 0.4], i * 3);
    this.steamAge[i] = age;
    this.steamLife[i] = 1.4 + Math.random() * 1.2;
  }

  private size() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.steamU.px.value = this.renderer.getPixelRatio();
    // A room's own run winds to the map's shape: lay it again when the shape calls for a different band.
    if (this.mode === "room" && this.roomSrc && windRoom(this.roomSrc.section, this.roomSrc.model, this.want()).per !== this.roomPer) this.layRoom();
    this.dirty = 4;
  }

  private phone() {
    return this.host.clientWidth < 600;
  }

  /** Where the camera looks and how far back it stands to fit a box on the floor. */
  private fit(b: Box): { c: Vector3; d: number } {
    const tn = 2 * Math.tan((this.cam.fov * Math.PI) / 360);
    const w = b[2] - b[0] + 1.4;
    const h = b[3] - b[1] + 1.4;
    const a = this.cam.aspect;
    const d = this.phone() ? Math.max(h / (tn * a), (w * 0.82) / tn) : Math.max(w / (tn * a), (h * 0.82) / tn);
    return { c: new Vector3((b[0] + b[2]) / 2, 0, (b[1] + b[3]) / 2), d: d * 1.02 };
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const reduce = this.opts.reduce;
    if (!this.visible || document.hidden || (reduce && this.dirty <= 0 && !this.moved && !this.pan.busy)) {
      this.last = now;
      return;
    }
    const real = Math.min(0.5, (now - this.last) / 1000);
    const dt = reduce ? 0 : Math.min(0.05, real);
    this.last = now;
    this.T += dt;
    const T = this.T;
    if (this.dirty > 0) this.dirty--;
    const k = reduce ? 1 : 1 - Math.pow(0.05, dt);

    for (const m of [this.flowOk, this.flowLate]) m.uniforms.t!.value = T;
    for (const h of this.headers) h.flow.uniforms.t!.value = T;
    for (const m of this.ownFlows) m.uniforms.t!.value = T;
    this.sigils.step(dt, this.renderer.getPixelRatio());
    this.glows.forEach((l, i) => (l.intensity = this.leaks[i] ? (reduce ? 2.4 : 2 + Math.random()) : 0));
    for (const s of this.leaks) if (s.sleeve) s.sleeve.material.emissiveIntensity = reduce ? 0.6 : 0.5 + 0.25 * Math.sin(T * 5);
    if (!reduce) {
      for (const s of this.stations) {
        if (!s.body) continue;
        if (s.state === "leak" || s.state === "shut") s.body.material.emissiveIntensity = 0.35 + 0.2 * Math.sin(T * 3);
        else if (s.state === "late") s.body.material.emissiveIntensity = 0.3 + 0.15 * Math.sin(T * 2);
      }
    }
    if (this.leaks.length && dt > 0) {
      const p = this.steamPos;
      const v = this.steamVel;
      for (let i = 0; i < NS; i++) {
        this.steamAge[i]! += dt / this.steamLife[i]!;
        if (this.steamAge[i]! >= 1) this.respawn(i);
        p[i * 3]! += v[i * 3]! * dt;
        p[i * 3 + 1]! += v[i * 3 + 1]! * dt;
        p[i * 3 + 2]! += v[i * 3 + 2]! * dt;
        v[i * 3 + 1]! *= 0.995;
        v[i * 3]! += Math.sin(T + i) * dt * 0.1;
      }
      this.steamGeo.attributes.position!.needsUpdate = true;
      this.steamGeo.attributes.age!.needsUpdate = true;
      for (let i = 0; i < ND; i++) {
        this.dripVy[i]! -= 9.8 * dt * 0.4;
        this.dripPos[i * 3 + 1]! += this.dripVy[i]! * dt;
        if (this.dripPos[i * 3 + 1]! < 0) {
          this.dripPos[i * 3 + 1] = H - 0.1;
          this.dripVy[i] = -Math.random() * 0.5;
        }
      }
      this.dripGeo.attributes.position!.needsUpdate = true;
    }
    // The gauges: a leak's needle shakes in the red.
    for (const g of this.gauges) {
      g.v += (g.to - g.v) * k * 0.6;
      if (Math.abs(g.v - g.drawn) > 0.004) drawGauge(g, 0);
    }
    if (!reduce) for (const s of this.leaks) if (s.gauge) drawGauge(s.gauge, Math.sin(T * 23) * 0.025 + Math.sin(T * 7) * 0.02);
    this.fire.intensity = reduce ? 5.4 : 5 + Math.sin(T * 9) * 0.8 + Math.random() * 0.8;
    this.door.material.color.setHSL(0.06 + (reduce ? 0.005 : Math.random() * 0.01), 1, reduce ? 0.5 : 0.5 + Math.sin(T * 6) * 0.04);

    // The camera: fits the whole map, or the room in focus, with a slow drift. On a phone the map turns so its rooms
    // run top to bottom.
    const { c, d } = this.fit(this.focusBox);
    const ease = reduce || !this.dist ? 1 : 1 - Math.pow(0.04, real);
    this.look.lerp(c, ease);
    this.dist += (d - this.dist) * ease;
    const cam = this.cam;
    const sway = reduce ? 0 : Math.sin(T * 0.1) * 0.08;
    if (this.phone()) cam.position.set(this.look.x + this.dist * 0.52, this.dist * 0.85, this.look.z + Math.sin(sway) * this.dist * 0.3);
    else cam.position.set(this.look.x + Math.sin(sway) * this.dist * 0.4, this.dist * 0.84, this.look.z + this.dist * 0.55);
    this.pan.step(real);
    cam.position.x += this.pan.x;
    cam.position.z += this.pan.z;
    cam.lookAt(this.look.x + this.pan.x, this.look.y, this.look.z + this.pan.z);
    this.renderer.render(this.scene, cam);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const v = new Vector3();
    for (const l of this.labels) {
      v.copy(l.pos).project(cam);
      l.d.style.transform = `translate(${((v.x + 1) / 2) * w}px,${((1 - v.y) / 2) * h}px) translate(-50%,${l.below ? "2px" : "-100%"})`;
    }
    // Hover: what's under the pointer, told once per change.
    if (this.moved) {
      this.moved = false;
      const t = this.lastMove ? this.targetAt(this.lastMove.x, this.lastMove.y) : null;
      const key = t ? ("pipe" in t ? `p:${t.pipe}` : `r:${t.room}`) : "";
      this.renderer.domElement.style.cursor = t ? "pointer" : "default";
      if (key !== this.hoverKey) {
        this.hoverKey = key;
        this.opts.onHover(t);
      }
    }
    // The card follows its station.
    const s = this.track ? this.byId.get(this.track) : null;
    if (s && this.onTrack) {
      v.copy(s.anchor).project(cam);
      const x = Math.round(((v.x + 1) / 2) * w);
      const y = Math.round(((1 - v.y) / 2) * h);
      const key = `${s.id}:${x}:${y}`;
      if (key !== this.tracked) {
        this.tracked = key;
        this.onTrack(x, y);
      }
    }
  };

  /** Whether this view has a station or pipe for a card. */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Ask for a few frames (after the page moves the card's station). */
  wake(): void {
    this.dirty = Math.max(this.dirty, 2);
    this.tracked = "";
  }
}

function valveWheel(r: number, mat: MeshStandardMaterial) {
  const g = new Group();
  g.add(new Mesh(new TorusGeometry(r, 0.03, 8, 30), mat));
  for (let k = 0; k < 4; k++) {
    const s = new Mesh(new BoxGeometry(r * 2, 0.025, 0.025), mat);
    s.rotation.z = (k * Math.PI) / 4;
    g.add(s);
  }
  g.add(new Mesh(new SphereGeometry(0.05, 10, 8), mat));
  return g;
}

/** Free a tree's geometries and textures (materials shared across rebuilds are freed by dispose). */
function freeTree(root: Object3D) {
  const seen = new Set<unknown>();
  const free = (x: { dispose?: () => void } | null | undefined) => {
    if (x && !seen.has(x) && typeof x.dispose === "function" && x !== gaugeG) {
      seen.add(x);
      x.dispose();
    }
  };
  root.traverse((o: Object3D) => {
    const m = o as Mesh;
    if (m.geometry) free(m.geometry);
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as (Material | undefined)[];
    for (const mat of mats) if (mat) free((mat as Material & { map?: Texture | null }).map);
  });
}

/** A gauge's needle for a state, 0..1: healthy ones sit mid-green, each a touch apart. */
function gaugeOf(id: string, s: StationState): number {
  if (s === "leak") return 0.94;
  if (s === "late") return 0.72;
  if (s === "shut") return 0.02;
  if (s === "dry") return 0.06;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.42 + (h % 15) / 100;
}

/** The flow inside a pipe: soft pulses running outward from the boiler. */
function flowMat(speed: number, col: string, len = 1.05): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { t: { value: 0 }, len: { value: len }, speed: { value: speed }, col: { value: new Color(col) } },
    vertexShader: `varying vec2 vU; varying float vN; void main(){ vU = uv; vN = normal.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vU; varying float vN; uniform float t,len,speed; uniform vec3 col;
      void main(){ float d = vU.x*len; float s = fract(d*.9 - t*speed*.55); float p = smoothstep(0.,.18,s)*smoothstep(.55,.18,s);
        float top = smoothstep(.15,.95,vN); gl_FragColor = vec4(col*(.35+p*1.4), (.10+p*.55)*top); }`,
  });
}

function drawGauge(gg: Gauge, jitter: number) {
  const c = gg.cv.getContext("2d");
  if (!c) return;
  const s = gg.cv.width;
  const m = s / 2;
  const r = s * 0.458;
  const u = s / 192;
  c.clearRect(0, 0, s, s);
  c.fillStyle = "#e9e2d0";
  c.beginPath();
  c.arc(m, m, r + 4 * u, 0, 7);
  c.fill();
  const A = (v: number) => Math.PI * 0.75 + v * Math.PI * 1.5;
  const arc = (a: number, b: number, col: string) => {
    c.strokeStyle = col;
    c.lineWidth = 12 * u;
    c.beginPath();
    c.arc(m, m, r - 12 * u, A(a), A(b));
    c.stroke();
  };
  arc(0.25, 0.65, "#4caf7d");
  arc(0.65, 0.8, "#d9a63a");
  arc(0.8, 1, "#e0574b");
  c.strokeStyle = "#2a2a2a";
  for (let k = 0; k <= 10; k++) {
    const a = A(k / 10);
    const inner = r - (k % 5 ? 20 : 28) * u;
    c.lineWidth = (k % 5 ? 2 : 4) * u;
    c.beginPath();
    c.moveTo(m + Math.cos(a) * (r - 4 * u), m + Math.sin(a) * (r - 4 * u));
    c.lineTo(m + Math.cos(a) * inner, m + Math.sin(a) * inner);
    c.stroke();
  }
  const a = A(Math.max(0, Math.min(1, gg.v + jitter)));
  c.strokeStyle = "#b8221a";
  c.lineWidth = 5 * u;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(m - Math.cos(a) * 14 * u, m - Math.sin(a) * 14 * u);
  c.lineTo(m + Math.cos(a) * (r - 14 * u), m + Math.sin(a) * (r - 14 * u));
  c.stroke();
  c.fillStyle = "#222";
  c.beginPath();
  c.arc(m, m, 9 * u, 0, 7);
  c.fill();
  c.strokeStyle = "#8a6b3e";
  c.lineWidth = 8 * u;
  c.beginPath();
  c.arc(m, m, r + 4 * u, 0, 7);
  c.stroke();
  gg.tex.needsUpdate = true;
  gg.drawn = gg.v + jitter;
}

/** A straight tube from a to b. */
function tube<M extends Material>(a: Vector3, b: Vector3, r: number, mat: M) {
  return new Mesh(new TubeGeometry(new LineCurve3(a, b), Math.max(2, Math.ceil(a.distanceTo(b) * 8)), r, 12, false), mat);
}

/** A tube along a run. */
function tubeAlong<M extends Material>(curve: CurvePath<Vector3>, r: number, mat: M) {
  return new Mesh(new TubeGeometry(curve, Math.max(4, Math.ceil(curve.getLength() * 8)), r, 12, false), mat);
}

/** A run through its corners, each corner a bend rather than a kink. */
function runCurve(pts: Vector3[], bend: number): CurvePath<Vector3> {
  const path = new CurvePath<Vector3>();
  let cur = pts[0]!.clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i]!;
    const p = pts[i - 1]!;
    const q = pts[i + 1]!;
    const a = c.clone().addScaledVector(p.clone().sub(c).normalize(), Math.min(bend, c.distanceTo(p) / 2));
    const b = c.clone().addScaledVector(q.clone().sub(c).normalize(), Math.min(bend, c.distanceTo(q) / 2));
    if (cur.distanceTo(a) > 1e-4) path.add(new LineCurve3(cur, a));
    path.add(new QuadraticBezierCurve3(a, c.clone(), b));
    cur = b;
  }
  const end = pts[pts.length - 1] ?? cur;
  if (cur.distanceTo(end) > 1e-4 || !path.curves.length) path.add(new LineCurve3(cur, end.clone()));
  return path;
}

/** Whether p lies on the segment a–b (on the floor). */
function onSeg(p: Vector3, a: Vector3, b: Vector3): boolean {
  const e = 1e-3;
  return p.x >= Math.min(a.x, b.x) - e && p.x <= Math.max(a.x, b.x) + e && p.z >= Math.min(a.z, b.z) - e && p.z <= Math.max(a.z, b.z) + e;
}

/** A station's own material: steel, or a room's colour for its hub. */
function stationMat(hub?: string) {
  const m = new MeshStandardMaterial({ color: hub ?? 0x5f6b78, metalness: hub ? 0.4 : 0.8, roughness: 0.35, emissive: new Color(CORAL), emissiveIntensity: 0 });
  if (hub) m.userData.hub = true;
  return m;
}

/** A part's body by what it is: a service a post, storage a squat tank, an agent a sphere, you a cone, a schedule a box. */
const KIND_BODY: Record<string, () => BufferGeometry> = {
  service: () => new CylinderGeometry(0.17, 0.17, 0.3, 16),
  store: () => new CylinderGeometry(0.26, 0.26, 0.24, 20),
  agent: () => new SphereGeometry(0.2, 18, 12),
  person: () => new ConeGeometry(0.2, 0.36, 18),
  room: () => new CylinderGeometry(0.24, 0.28, 0.34, 6),
  job: () => new BoxGeometry(0.3, 0.26, 0.3),
  planned: () => new CylinderGeometry(0.17, 0.17, 0.3, 10),
};

/** The glyphs that ride the flow: the Desk's sigils (code marks and runes), never dots. */
const GLYPHS = [...CODE.filter((g) => g.length === 1), ...ARC.filter((g) => !/[\u{1F700}-\u{1F77F}]/u.test(g))].slice(0, 16);
const CELLS = 4;
const MAX_SIGILS = 120;

/**
 * Sigils carried along the flowing pipes, spread by length, warm on a flowing pipe and amber on a late one. One draw
 * call: a point each, its glyph read from a 4 × 4 atlas. With reduced motion they hold still where they were laid.
 */
class Sigils {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private pos = new Float32Array(MAX_SIGILS * 3);
  private glyph = new Float32Array(MAX_SIGILS);
  private late = new Float32Array(MAX_SIGILS);
  private runs: { pts: Vector3[]; cum: number[]; len: number }[] = [];
  private on: { run: number; d: number; v: number }[] = [];
  private tex: CanvasTexture;
  private tmp = new Vector3();

  constructor(private reduce: boolean) {
    const cv = document.createElement("canvas");
    const cell = 64;
    cv.width = cv.height = cell * CELLS;
    const c = cv.getContext("2d");
    if (c) {
      c.fillStyle = "#fff";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `600 ${cell * 0.62}px "Overpass Mono Variable", ui-monospace, monospace`;
      GLYPHS.forEach((g, i) => c.fillText(g, (i % CELLS) * cell + cell / 2, Math.floor(i / CELLS) * cell + cell / 2 + 2));
    }
    this.tex = new CanvasTexture(cv);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    geo.setAttribute("glyph", new BufferAttribute(this.glyph, 1));
    geo.setAttribute("late", new BufferAttribute(this.late, 1));
    geo.setDrawRange(0, 0);
    this.points = new Points(
      geo,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { atlas: { value: this.tex }, px: { value: 1 }, ok: { value: new Color(FLOW) }, slow: { value: new Color(AMBER) } },
        vertexShader: `attribute float glyph; attribute float late; uniform float px; varying float vG; varying float vL; void main(){ vG = glyph; vL = late; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = 26. * px * (10./-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform sampler2D atlas; uniform vec3 ok, slow; varying float vG; varying float vL; void main(){ vec2 cell = vec2(mod(vG, ${CELLS}.), floor(vG / ${CELLS}.)); vec2 uv = vec2((cell.x + gl_PointCoord.x) / ${CELLS}., 1. - (cell.y + gl_PointCoord.y) / ${CELLS}.); float a = texture2D(atlas, uv).a; if (a < .05) discard; gl_FragColor = vec4(mix(ok, slow, vL), a * .85); }`,
      }),
    );
    this.points.frustumCulled = false;
  }

  /** Spread up to `count` sigils over the flowing runs, by length. */
  lay(runs: { pts: Vector3[]; late: boolean }[], count: number): void {
    this.runs = runs.map((r) => {
      const cum = [0];
      for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1]! + r.pts[i]!.distanceTo(r.pts[i - 1]!));
      return { pts: r.pts, cum, len: cum[cum.length - 1]! };
    });
    const total = this.runs.reduce((a, r) => a + r.len, 0);
    this.on = [];
    const n = Math.min(MAX_SIGILS, count);
    if (total > 0)
      this.runs.forEach((r, i) => {
        if (!r.len) return;
        const share = Math.max(1, Math.round((r.len / total) * n));
        for (let j = 0; j < share && this.on.length < n; j++) {
          const k = this.on.length;
          this.on.push({ run: i, d: ((j + ((i * 7) % 5) / 5) / share) * r.len, v: runs[i]!.late ? 0.35 : 0.9 + ((k * 37) % 10) / 25 });
          this.glyph[k] = (k * 5 + i * 3) % GLYPHS.length;
          this.late[k] = runs[i]!.late ? 1 : 0;
        }
      });
    this.points.geometry.setDrawRange(0, this.on.length);
    this.points.geometry.attributes.glyph!.needsUpdate = true;
    this.points.geometry.attributes.late!.needsUpdate = true;
    this.place(0);
  }

  /** Carry each one along its run; with reduced motion they hold still. */
  step(dt: number, px: number): void {
    this.points.material.uniforms.px!.value = px;
    if (!this.reduce && dt > 0) this.place(dt);
  }

  private place(dt: number): void {
    this.on.forEach((m, i) => {
      const r = this.runs[m.run]!;
      m.d = (m.d + m.v * dt) % r.len;
      let k = 1;
      while (k < r.cum.length - 1 && r.cum[k]! < m.d) k++;
      const a = r.pts[k - 1]!;
      const b = r.pts[k]!;
      const seg = r.cum[k]! - r.cum[k - 1]!;
      this.tmp.copy(a).lerp(b, seg ? (m.d - r.cum[k - 1]!) / seg : 0);
      this.pos.set([this.tmp.x, this.tmp.y + R + 0.16, this.tmp.z], i * 3);
    });
    this.points.geometry.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.tex.dispose();
  }
}
