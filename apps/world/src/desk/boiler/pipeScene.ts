import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
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
import { gaugeOf, MAP_LINES, PLANNED_LABEL, PLANNED_PIPES, STATIONS, type LineDef, type MapPt, type StationState } from "./pipes.ts";

/**
 * The Boiler Room's pipe map in three.js (#732), ported from the approved B4 demo (concepts 2026-11-04, board/r2/pipes.js):
 * a blueprint sheet, the riveted boiler with its flickering firebox at the heart, one brass pipe per line with flanges,
 * elbows and a colour band, and a station (a junction, a gauge, sometimes a valve) per integration. Healthy stretches
 * carry soft flow pulses; a late one flows slow and amber; a shut one has a coral valve and a dry pipe; a leak cracks,
 * steams and drips coral with its gauge in the red. Loaded lazily by BoilerMap.tsx (three is a shared chunk with the
 * Haven and the Iris). With reduced motion nothing moves: the flow, the steam and the fire hold still.
 */

const CORAL = "#ff6f61";
const AMBER = "#e8b84a";
const FLOW = "#ffd9a0";
const R = 0.15;
const H = 0.32;
const ELB = 0.55;
const SEGS = 8;
const NS = 220;
const ND = 14;
const MAX_GLOWS = 3;

const W = (x: number, y: number, h = 0) => new Vector3((x - 480) / 40, h, (y - 330) / 40);

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

interface Gauge {
  cv: HTMLCanvasElement;
  tex: CanvasTexture;
  g: Group;
  v: number;
  to: number;
  drawn: number;
}

interface Line {
  def: LineDef;
  path: CurvePath<Vector3>;
  len: number;
  flow: ShaderMaterial;
}

interface Station {
  id: string;
  name: string;
  line: Line;
  u: number;
  pos: Vector3;
  body: Mesh<CylinderGeometry, MeshStandardMaterial>;
  gauge: Gauge;
  wheel: Group;
  wheelMats: MeshStandardMaterial[];
  crack: Group;
  crackAt: Vector3;
  sleeve: Mesh;
  label: HTMLDivElement;
  state: StationState;
}

export interface PipeSceneOpts {
  reduce: boolean;
  /** A tap on a station. */
  onPick: (id: string) => void;
}

export class PipeScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private cam = new PerspectiveCamera(32, 1, 0.1, 200);
  private lbls: HTMLDivElement;
  private labels: { d: HTMLDivElement; pos: Vector3 }[] = [];
  private lines: Line[] = [];
  private stations: Station[] = [];
  private gauges: Gauge[] = [];
  private boilerGauge: Gauge;
  private fire: PointLight;
  private door: Mesh<CircleGeometry, MeshBasicMaterial>;
  private glows: PointLight[] = [];
  private steamGeo = new BufferGeometry();
  private steamPos = new Float32Array(NS * 3);
  private steamVel = new Float32Array(NS * 3);
  private steamAge = new Float32Array(NS);
  private steamLife = new Float32Array(NS);
  private steamFrom = new Int16Array(NS);
  private steamU = { px: { value: 1 }, on: { value: 0 } };
  private dripGeo = new BufferGeometry();
  private dripPos = new Float32Array(ND * 3);
  private dripVy = new Float32Array(ND);
  private drips: Points;
  private leaks: Station[] = [];
  private focus = new Vector3(0, 0, 0.6);
  private look = new Vector3(0, 0, 0.6);
  private home = new Vector3(0, 0, 0.6);
  private wantFocus = false;
  private raf = 0;
  private last = performance.now();
  private T = 0;
  private visible = true;
  private dirty = 4;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private tmp = new Vector3();
  private disposables: { dispose: () => void }[] = [];

  constructor(
    private host: HTMLElement,
    private opts: PipeSceneOpts,
  ) {
    const canvas = document.createElement("canvas");
    canvas.className = "bp-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.append(canvas);
    this.lbls = document.createElement("div");
    this.lbls.className = "bp-lbls";
    this.lbls.setAttribute("aria-hidden", "true");
    host.append(this.lbls);

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
      new PlaneGeometry(60, 40),
      new ShaderMaterial({
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `varying vec2 vP; void main(){ vec2 g = abs(fract(vP)-.5); float l = 1.-smoothstep(.0,.03,min(g.x,g.y)); vec2 g4 = abs(fract(vP*.25)-.5); float L = 1.-smoothstep(.0,.012,min(g4.x,g4.y));
          float v = 1.-smoothstep(8.,22.,length(vP)); vec3 c = vec3(.043,.051,.066) + vec3(.03,.036,.05)*l*v + vec3(.05,.06,.08)*L*v; gl_FragColor = vec4(c,1.); }`,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const brass = new MeshStandardMaterial({ color: 0xb48a50, metalness: 0.85, roughness: 0.32 });
    const iron = new MeshStandardMaterial({ color: 0x24262b, metalness: 0.7, roughness: 0.5 });
    const up = new Vector3(0, 1, 0);
    const q = new Quaternion();

    const flangeG = new CylinderGeometry(R * 1.55, R * 1.55, 0.09, 20);
    const bandG = new CylinderGeometry(R * 1.08, R * 1.08, 0.16, 20);
    const boltG = new SphereGeometry(0.022, 6, 4);
    const bands = new Map<string, MeshStandardMaterial>();
    const addFlange = (pos: Vector3, tan: Vector3, colour: string | null) => {
      const g = new Group();
      g.position.copy(pos);
      g.quaternion.copy(q.setFromUnitVectors(up, tan));
      g.add(new Mesh(flangeG, brass));
      for (let k = 0; k < 6; k++) {
        const b = new Mesh(boltG, iron);
        const a = (k / 6) * Math.PI * 2;
        b.position.set(Math.cos(a) * R * 1.3, 0.05, Math.sin(a) * R * 1.3);
        g.add(b);
      }
      if (colour) {
        let m = bands.get(colour);
        if (!m) bands.set(colour, (m = new MeshStandardMaterial({ color: colour, metalness: 0.2, roughness: 0.6 })));
        const band = new Mesh(bandG, m);
        band.position.y = 0.2;
        g.add(band);
      }
      scene.add(g);
    };

    // ---- the boiler ----
    const boiler = new Group();
    boiler.position.copy(W(480, 330));
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

    const valveWheel = (r: number, mat: MeshStandardMaterial) => {
      const g = new Group();
      g.add(new Mesh(new TorusGeometry(r, 0.03, 8, 30), mat));
      for (let k = 0; k < 4; k++) {
        const s = new Mesh(new BoxGeometry(r * 2, 0.025, 0.025), mat);
        s.rotation.z = (k * Math.PI) / 4;
        g.add(s);
      }
      g.add(new Mesh(new SphereGeometry(0.05, 10, 8), mat));
      return g;
    };

    // The gauges: a dial drawn on a canvas, needle included, redrawn only when the reading moves.
    const gaugeG = new CylinderGeometry(0.27, 0.27, 0.07, 32);
    const makeGauge = (pos: Vector3, value: number, big = false): Gauge => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 160;
      const tex = new CanvasTexture(cv);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      const face = new MeshBasicMaterial({ map: tex });
      const m = new Mesh(gaugeG, [brass, face, brass]);
      const g = new Group();
      g.add(m);
      g.position.copy(pos);
      g.scale.setScalar(big ? 1.5 : 1);
      scene.add(g);
      const stem = new Mesh(new CylinderGeometry(0.035, 0.035, pos.y - H, 8), brass);
      stem.position.set(pos.x, (pos.y + H) / 2, pos.z);
      scene.add(stem);
      const gg: Gauge = { cv, tex, g, v: value, to: value, drawn: -1 };
      this.gauges.push(gg);
      drawGauge(gg, 0);
      return gg;
    };
    this.boilerGauge = makeGauge(W(480, 330, 2.55).add(new Vector3(-0.5, 0, 0.35)), 0.55, true);
    this.boilerGauge.g.rotation.x = 0.5;

    // ---- the lines ----
    const label = (txt: string, pos: Vector3, cls: string) => {
      const d = document.createElement("div");
      d.className = `bp-lb ${cls}`;
      d.textContent = txt;
      this.lbls.append(d);
      this.labels.push({ d, pos });
      return d;
    };
    label("The boiler", W(480, 330, 3.2), "is-boiler");
    const coral = new Color(CORAL);
    const shardG = new BoxGeometry(0.05, 0.03, 0.16);
    const sleeveG = new CylinderGeometry(R * 1.12, R * 1.12, 0.5, 14, 1, true);
    const puddleG = new CircleGeometry(0.6, 32);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    for (const def of MAP_LINES) {
      const path = pathOf(def.pts);
      const len = path.getLength();
      const steps = Math.ceil(len * 14);
      scene.add(new Mesh(new TubeGeometry(path, steps, R, 14, false), brass));
      const flow = flowMat(len);
      scene.add(new Mesh(new TubeGeometry(path, steps, R * 1.05, 14, false), flow));
      const line: Line = { def, path, len, flow };
      this.lines.push(line);
      const n = Math.max(2, Math.round(len / 2.2));
      for (let k = 0; k <= n; k++) {
        if (def.spur && k === 0) continue;
        const u = Math.min(0.999, Math.max(0.001, k / n));
        addFlange(path.getPointAt(u), path.getTangentAt(u), k % 2 ? def.c : null);
      }
      if (def.valve) {
        const w = valveWheel(0.22, brass);
        w.position.copy(path.getPointAt(0.04)).add(new Vector3(0, 0.3, 0));
        w.rotation.x = -Math.PI / 2;
        scene.add(w);
      }
      if (def.named) label(def.name, path.getPointAt(def.nameAt ?? 0.55).clone().add(new Vector3(0, 0, 0.55)), "is-line").style.color = def.c;
    }

    for (const sd of STATIONS) {
      const line = this.lines.find((l) => l.def.id === sd.line)!;
      // A station sits on its line at the point nearest its map position.
      const target = W(sd.at[0], sd.at[1], H);
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k <= 600; k++) {
        const dd = line.path.getPointAt(k / 600).distanceToSquared(target);
        if (dd < bd) {
          bd = dd;
          best = k / 600;
        }
      }
      const pos = line.path.getPointAt(best);
      const body = new Mesh(new CylinderGeometry(0.27, 0.27, 0.5, 20), new MeshStandardMaterial({ color: 0x5f6b78, metalness: 0.8, roughness: 0.35, emissive: coral, emissiveIntensity: 0 }));
      body.position.copy(pos);
      body.userData.st = sd.id;
      scene.add(body);
      const gauge = makeGauge(pos.clone().add(new Vector3(0, 0.62, 0)), gaugeOf(sd.id, "ok"));
      gauge.g.rotation.x = 0.35;
      const wm = new MeshStandardMaterial({ color: CORAL, metalness: 0.5, roughness: 0.4, emissive: coral, emissiveIntensity: 0.4 });
      const wheel = valveWheel(0.26, wm);
      wheel.position.copy(pos).add(new Vector3(0.45, 0.1, 0));
      wheel.rotation.y = Math.PI / 2;
      wheel.visible = false;
      scene.add(wheel);
      // The crack sits just upstream of the station, on its own stretch.
      const cu = Math.max(0.01, best - 0.7 / line.len);
      const crackAt = line.path.getPointAt(cu);
      const crack = new Group();
      const shardMat = new MeshStandardMaterial({ color: 0x3a2320, emissive: coral, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.5 });
      const shards = new Group();
      shards.position.copy(crackAt);
      shards.quaternion.copy(new Quaternion().setFromUnitVectors(up, line.path.getTangentAt(cu)));
      for (let k = 0; k < 7; k++) {
        const s = new Mesh(shardG, shardMat);
        const a = (k / 7) * Math.PI * 2;
        s.position.set(Math.cos(a) * R * 1.05, (rnd() - 0.5) * 0.12, Math.sin(a) * R * 1.05);
        s.rotation.set(rnd(), rnd(), rnd());
        shards.add(s);
      }
      crack.add(shards);
      const sleeve = new Mesh(sleeveG, new MeshStandardMaterial({ color: 0xb4614c, metalness: 0.6, roughness: 0.4, emissive: coral, emissiveIntensity: 0.6 }));
      sleeve.position.copy(crackAt);
      sleeve.quaternion.copy(shards.quaternion);
      crack.add(sleeve);
      const puddle = new Mesh(puddleG, new MeshBasicMaterial({ color: CORAL, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false }));
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(crackAt.x + 0.2, 0.01, crackAt.z);
      crack.add(puddle);
      crack.visible = false;
      scene.add(crack);
      const lb = label(sd.name, pos.clone().add(new Vector3(0, 1.05, 0)), "is-ok");
      this.stations.push({ id: sd.id, name: sd.name, line, u: best, pos, body, gauge, wheel, wheelMats: [wm], crack, crackAt, sleeve, label: lb, state: "ok" });
    }

    // Planned pipes: ghost outlines.
    for (const pts of PLANNED_PIPES) scene.add(new Mesh(new TubeGeometry(pathOf(pts), 40, R * 0.8, 10, false), new MeshBasicMaterial({ color: 0x2a303a, wireframe: true, transparent: true, opacity: 0.35 })));
    label(PLANNED_LABEL.text, W(PLANNED_LABEL.at[0], PLANNED_LABEL.at[1], 0.6), "is-planned");

    // The crack glows: a small pool of lights, so the shader never recompiles as leaks come and go.
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
        vertexShader: `attribute float age; uniform float px; varying float vA; void main(){ vA = age; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = (14. + age*70.) * px * (10./-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying float vA; uniform float on; void main(){ float d = length(gl_PointCoord-.5); if(d>.5) discard; float a = (1.-d*2.); a *= a; vec3 c = mix(vec3(1.,.55,.48), vec3(.86,.88,.92), smoothstep(.0,.35,vA)); gl_FragColor = vec4(c, a*.42*(1.-vA)*smoothstep(0.,.08,vA)*on); }`,
      }),
    );
    steam.frustumCulled = false;
    scene.add(steam);
    this.dripGeo.setAttribute("position", new BufferAttribute(this.dripPos, 3));
    this.drips = new Points(this.dripGeo, new PointsMaterial({ color: 0xffb0a6, size: 0.07, transparent: true, opacity: 0.85 }));
    this.drips.frustumCulled = false;
    this.drips.visible = false;
    scene.add(this.drips);

    canvas.addEventListener("click", this.onClick);
    this.ro = new ResizeObserver(() => this.size());
    this.ro.observe(host);
    this.io = new IntersectionObserver(([e]) => {
      this.visible = !!e?.isIntersecting;
      if (this.visible) this.dirty = 4;
    });
    this.io.observe(host);
    document.addEventListener("visibilitychange", this.onVis);
    this.size();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The stations' states, and the one the panel is on (the camera leans toward it). */
  set(states: Record<string, StationState>, focus: string | null): void {
    const coral = new Color(CORAL);
    const amber = new Color(AMBER);
    for (const s of this.stations) {
      const st = states[s.id] ?? "dry";
      s.state = st;
      s.gauge.to = gaugeOf(s.id, st);
      if (this.opts.reduce) s.gauge.v = s.gauge.to;
      s.wheel.visible = st === "shut";
      s.crack.visible = st === "leak";
      s.body.material.emissive.copy(st === "late" ? amber : coral);
      s.body.material.emissiveIntensity = st === "leak" || st === "shut" ? 0.45 : st === "late" ? 0.35 : 0;
      s.body.material.color.setHex(st === "dry" ? 0x3a4049 : 0x5f6b78);
      s.label.className = `bp-lb is-${st}${focus === s.id ? " is-sel" : ""}`;
    }
    // Each line's flow, stretch by stretch: a stretch runs to its station and carries that station's state.
    for (const line of this.lines) {
      const mine = this.stations.filter((s) => s.line === line).sort((a, b) => a.u - b.u);
      const ends = new Array<number>(SEGS).fill(2);
      const modes = new Array<number>(SEGS).fill(0);
      mine.slice(0, SEGS).forEach((s, i) => {
        ends[i] = i === mine.length - 1 ? 2 : s.u;
        modes[i] = s.state === "ok" ? 1 : s.state === "late" ? 2 : 0;
      });
      line.flow.uniforms.ends!.value = ends;
      line.flow.uniforms.modes!.value = modes;
    }
    this.leaks = this.stations.filter((s) => s.state === "leak");
    this.glows.forEach((l, i) => {
      const s = this.leaks[i];
      l.intensity = 0;
      if (s) l.position.copy(s.crackAt).add(new Vector3(0, 0.5, 0));
    });
    this.steamU.on.value = this.leaks.length ? 1 : 0;
    this.drips.visible = this.leaks.length > 0;
    for (let i = 0; i < NS; i++) this.respawn(i, Math.random());
    for (let i = 0; i < ND; i++) {
      const s = this.leaks[i % Math.max(1, this.leaks.length)];
      if (s) this.dripPos.set([s.crackAt.x + (Math.random() - 0.5) * 0.2, Math.random() * H, s.crackAt.z + (Math.random() - 0.5) * 0.1], i * 3);
      this.dripVy[i] = 0;
    }
    this.steamGeo.attributes.position!.needsUpdate = true;
    this.steamGeo.attributes.age!.needsUpdate = true;
    this.dripGeo.attributes.position!.needsUpdate = true;
    const faulty = this.stations.some((s) => s.state === "leak" || s.state === "shut" || s.state === "late");
    this.boilerGauge.to = faulty ? 0.62 : 0.5;
    const f = focus ? this.stations.find((s) => s.id === focus) : null;
    this.wantFocus = !!f;
    if (f) this.focus.copy(f.pos);
    if (this.opts.reduce) this.look.copy(this.target());
    this.dirty = 4;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVis);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    const seen = new Set<unknown>();
    const free = (x: { dispose?: () => void } | null | undefined) => {
      if (x && !seen.has(x) && typeof x.dispose === "function") {
        seen.add(x);
        x.dispose();
      }
    };
    this.scene.traverse((o: Object3D) => {
      const m = o as Mesh;
      free(m.geometry);
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as (Material | undefined)[];
      for (const mat of mats) {
        if (!mat) continue;
        free((mat as Material & { map?: Texture | null }).map);
        free(mat);
      }
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.lbls.remove();
  }

  private onVis = () => {
    if (!document.hidden) this.dirty = 4;
  };

  private ray = new Raycaster();
  private mouse = new Vector2();
  private onClick = (e: MouseEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.cam);
    const targets: Object3D[] = this.stations.flatMap((s) => [s.body, s.gauge.g]);
    const hit = this.ray.intersectObjects(targets, true)[0];
    if (!hit) return;
    let o: Object3D | null = hit.object;
    while (o && !o.userData.st) o = o.parent;
    const id = (o?.userData.st as string | undefined) ?? this.stations.find((s) => s.gauge.g === hit.object.parent || s.gauge.g === hit.object)?.id;
    if (id) this.opts.onPick(id);
  };

  private respawn(i: number, age = 0) {
    const s = this.leaks.length ? this.leaks[i % this.leaks.length] : null;
    const at = s ? s.crackAt : this.home;
    this.steamFrom[i] = s ? i % this.leaks.length : -1;
    this.steamPos.set([at.x + (Math.random() - 0.5) * 0.1, at.y + 0.1 + age * 1.2, at.z + (Math.random() - 0.5) * 0.1], i * 3);
    this.steamVel.set([0.35 + Math.random() * 0.5, 0.9 + Math.random() * 0.8, (Math.random() - 0.5) * 0.5], i * 3);
    this.steamAge[i] = age;
    this.steamLife[i] = 1.6 + Math.random() * 1.4;
  }

  private size() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.steamU.px.value = this.renderer.getPixelRatio();
    this.dirty = 4;
  }

  private phone() {
    return this.host.clientWidth < 600;
  }

  private target(): Vector3 {
    const ph = this.phone();
    return this.tmp.copy(this.wantFocus ? this.focus : this.home).multiplyScalar(ph ? 0.12 : 0.1).add(this.home.clone().multiplyScalar(0.9));
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const reduce = this.opts.reduce;
    if (!this.visible || document.hidden || (reduce && this.dirty <= 0)) {
      this.last = now;
      return;
    }
    const dt = reduce ? 0 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.T += dt;
    const T = this.T;
    if (this.dirty > 0) this.dirty--;
    const k = reduce ? 1 : 1 - Math.pow(0.05, dt);

    for (const l of this.lines) l.flow.uniforms.t!.value = T;
    // The leaks: shaking gauges, flickering cracks, steam and drips.
    this.glows.forEach((l, i) => (l.intensity = this.leaks[i] ? (reduce ? 3 : 2.5 + Math.random() * 1.2) : 0));
    for (const s of this.leaks) {
      (s.sleeve.material as MeshStandardMaterial).emissiveIntensity = reduce ? 0.6 : 0.5 + 0.25 * Math.sin(T * 5);
      s.body.material.emissiveIntensity = reduce ? 0.45 : 0.35 + 0.2 * Math.sin(T * 3);
    }
    if (!reduce) {
      for (const s of this.stations) {
        if (s.state === "shut") s.body.material.emissiveIntensity = 0.35 + 0.2 * Math.sin(T * 3);
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
          this.dripPos[i * 3 + 1] = H - 0.12;
          this.dripVy[i] = -Math.random() * 0.5;
        }
      }
      this.dripGeo.attributes.position!.needsUpdate = true;
    }
    // The gauges: a leak's needle shakes in the red, a late one wavers.
    for (const g of this.gauges) {
      g.v += (g.to - g.v) * k * 0.6;
      const s = this.stations.find((x) => x.gauge === g);
      const jitter = reduce || !s ? 0 : s.state === "leak" ? Math.sin(T * 23) * 0.025 + Math.sin(T * 7) * 0.02 : s.state === "late" ? Math.sin(T * 3) * 0.01 : 0;
      if (Math.abs(g.v + jitter - g.drawn) > 0.004) drawGauge(g, jitter);
    }
    // The firebox flickers.
    this.fire.intensity = reduce ? 5.4 : 5 + Math.sin(T * 9) * 0.8 + Math.random() * 0.8;
    this.door.material.color.setHSL(0.06 + (reduce ? 0.005 : Math.random() * 0.01), 1, reduce ? 0.5 : 0.5 + Math.sin(T * 6) * 0.04);

    // The camera: a slow drift over the sheet, easing toward the fault the panel is on. On a phone the map turns so
    // its lines run top to bottom.
    const ph = this.phone();
    const cam = this.cam;
    this.look.lerp(this.target(), reduce ? 1 : k * 0.3);
    const tn = 2 * Math.tan((cam.fov * Math.PI) / 360);
    const sway = reduce ? 0 : Math.sin(T * 0.1) * 0.12;
    if (ph) {
      const d2 = Math.max(15 / (tn * cam.aspect), 25.5 / tn);
      cam.position.set(this.look.x + d2 * 0.5, d2 * 0.86, this.look.z + Math.sin(sway) * d2 * 0.4);
    } else {
      const dist = Math.max(23.5 / (tn * cam.aspect), 14 / tn) * 1.08;
      cam.position.set(this.look.x + Math.sin(sway) * dist * 0.5, dist * 0.84, this.look.z + dist * 0.55);
    }
    cam.lookAt(this.look);
    this.renderer.render(this.scene, cam);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const v = new Vector3();
    for (const l of this.labels) {
      v.copy(l.pos).project(cam);
      l.d.style.transform = `translate(${((v.x + 1) / 2) * w}px,${((1 - v.y) / 2) * h}px) translate(-50%,-100%)`;
    }
  };
}

function pathOf(pts: readonly MapPt[]): CurvePath<Vector3> {
  const P = pts.map(([x, y]) => W(x, y, H));
  const path = new CurvePath<Vector3>();
  let from = P[0]!;
  for (let i = 1; i < P.length; i++) {
    const a = P[i]!;
    const b = P[i + 1];
    if (!b) {
      path.add(new LineCurve3(from, a));
      break;
    }
    const inA = a.clone().sub(from).normalize();
    const outB = b.clone().sub(a).normalize();
    const p1 = a.clone().addScaledVector(inA, -ELB);
    const p2 = a.clone().addScaledVector(outB, ELB);
    path.add(new LineCurve3(from, p1));
    path.add(new QuadraticBezierCurve3(p1, a, p2));
    from = p2;
  }
  return path;
}

/** The flow inside a pipe: pulses that run outward from the boiler, stretch by stretch (mode 0 dry, 1 flowing, 2 slow amber). */
function flowMat(len: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { t: { value: 0 }, len: { value: len }, ends: { value: new Array<number>(SEGS).fill(2) }, modes: { value: new Array<number>(SEGS).fill(1) }, col: { value: new Color(FLOW) }, late: { value: new Color(AMBER) } },
    vertexShader: `varying vec2 vU; varying float vN; void main(){ vU = uv; vN = normal.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vU; varying float vN; uniform float t,len; uniform float ends[${SEGS}]; uniform float modes[${SEGS}]; uniform vec3 col, late;
      void main(){
        float m = 0.;
        for (int i = ${SEGS - 1}; i >= 0; i--) { if (vU.x <= ends[i]) m = modes[i]; }
        if (m < .5) discard;
        bool slow = m > 1.5;
        float speed = slow ? .35 : 1.2;
        float d = vU.x*len; float s = fract(d*.55 - t*speed*.55); float p = smoothstep(0.,.18,s)*smoothstep(.55,.18,s);
        float top = smoothstep(.15,.95,vN); vec3 c = slow ? late : col;
        gl_FragColor = vec4(c*(.35+p*1.4), (.10+p*.55)*top); }`,
  });
}

function drawGauge(gg: Gauge, jitter: number) {
  const c = gg.cv.getContext("2d");
  if (!c) return;
  const s = gg.cv.width;
  const m = s / 2;
  const r = s * 0.458;
  c.clearRect(0, 0, s, s);
  c.fillStyle = "#e9e2d0";
  c.beginPath();
  c.arc(m, m, r + 4, 0, 7);
  c.fill();
  const A = (v: number) => Math.PI * 0.75 + v * Math.PI * 1.5;
  const arc = (a: number, b: number, col: string) => {
    c.strokeStyle = col;
    c.lineWidth = s * 0.0625;
    c.beginPath();
    c.arc(m, m, r - s * 0.0625, A(a), A(b));
    c.stroke();
  };
  arc(0.25, 0.65, "#4caf7d");
  arc(0.65, 0.8, "#d9a63a");
  arc(0.8, 1, "#e0574b");
  c.strokeStyle = "#2a2a2a";
  for (let k = 0; k <= 10; k++) {
    const a = A(k / 10);
    const inner = r - (k % 5 ? s * 0.104 : s * 0.146);
    c.lineWidth = k % 5 ? 2 : 4;
    c.beginPath();
    c.moveTo(m + Math.cos(a) * (r - 4), m + Math.sin(a) * (r - 4));
    c.lineTo(m + Math.cos(a) * inner, m + Math.sin(a) * inner);
    c.stroke();
  }
  const a = A(Math.max(0, Math.min(1, gg.v + jitter)));
  c.strokeStyle = "#b8221a";
  c.lineWidth = 5;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(m - Math.cos(a) * 12, m - Math.sin(a) * 12);
  c.lineTo(m + Math.cos(a) * (r - 12), m + Math.sin(a) * (r - 12));
  c.stroke();
  c.fillStyle = "#222";
  c.beginPath();
  c.arc(m, m, 8, 0, 7);
  c.fill();
  c.strokeStyle = "#8a6b3e";
  c.lineWidth = 7;
  c.beginPath();
  c.arc(m, m, r + 4, 0, 7);
  c.stroke();
  gg.tex.needsUpdate = true;
  gg.drawn = gg.v + jitter;
}
