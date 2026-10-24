import {
  PAD_RADIUS,
  RING_RADIUS,
  ROOMS,
  ROOM_HALF_D,
  ROOM_HALF_W,
  ROOM_IDS,
  KERNEL_PORT_RADIUS,
  padWorld,
  pendingApprovals,
  roomAngle,
  roomToWorld,
  streamCurve,
  worldToRoom,
  type RoomId,
} from "@ceo/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCast } from "../cast/castStore.ts";
import { clock } from "../clock.ts";
import { RC, TAU, WHITE, dots, frac, knot, reducedMotion, ring, spr } from "../desk/wvCanvas.ts";
import { feedLines, formatClock } from "../hud/format.ts";
import { navigate } from "../route.ts";
import { pumpSimulator, useWorld } from "../store.ts";
import { loadWorld3D } from "./load3d.ts";
import { crewPoint, hexToRgb, roomSummary, stateLine, type Names, type RoomSummary } from "./mapModel.ts";
import { goToView } from "./view.ts";
import "./map.css";

/**
 * The Lattice's map (#332): what "Enter the Lattice" opens on. The ring seen from straight above, drawn in the Desk's
 * dots and threads: each room's floor plate with its stations, the light streams to the Kernel, and the crew as dots,
 * walking their rounds and riding the streams between rooms, from the same simulator and live feeds the 3D world
 * runs on. No three.js, no models, no shaders: it shows at once. A room picked here loads that room alone in 3D
 * (World3D.tsx); "Whole Lattice" loads the full ring.
 */

const rgbOf = (room: RoomId) => RC[room] ?? WHITE;
const shortName = (room: RoomId) => ROOMS[room].name.replace(/^The /, "");
const index = (room: RoomId) => String(ROOM_IDS.indexOf(room) + 1).padStart(2, "0");
/** The ring's outer reach, in world units: a room's far corner. */
const OUTER = RING_RADIUS + Math.hypot(ROOM_HALF_W, ROOM_HALF_D);

/** What the map has on screen, for window.__ceo.map() (the browser tests and the console). */
const info = { on: false, crew: 0, rooms: 0, frames: 0, hovered: null as RoomId | null };
export const mapDebug = () => {
  const now = clock.sim;
  const positions = Object.fromEntries(Object.values(useWorld.getState().lattice.agents).map((rt) => {
    const p = crewPoint(rt, now);
    return [rt.agent.id, [p.x, p.z]];
  }));
  return { ...info, positions };
};

interface Geom {
  W: number;
  H: number;
  cx: number;
  cy: number;
  /** Pixels per world unit. */
  s: number;
  /** Narrow (a phone): no labels round the ring, the rooms listed underneath. */
  compact: boolean;
  dpr: number;
}

/** Where each room's label sits, outside the ring on its bearing, clear of the plate. */
function labelAt(g: Geom, room: RoomId): [number, number] {
  const a = roomAngle(room);
  const sx = Math.sin(a);
  const cz = Math.cos(a);
  if (g.compact) {
    const [x, , z] = roomToWorld(room, 0, 0, 0);
    return [g.cx + x * g.s, g.cy + z * g.s];
  }
  const r = (RING_RADIUS + ROOM_HALF_D + 2) * g.s + 18 + 74 * Math.abs(sx) + 26 * Math.abs(cz);
  return [g.cx + sx * r, g.cy + cz * r];
}

function geometry(el: HTMLElement): Geom {
  const W = el.clientWidth;
  const H = el.clientHeight;
  const compact = W < 640;
  const mx = compact ? 6 : 150;
  const my = compact ? 6 : 64;
  const s = Math.max(1, Math.min(W / 2 - mx, H / 2 - my) / OUTER);
  return { W, H, cx: W / 2, cy: H / 2, s, compact, dpr: Math.min(window.devicePixelRatio || 1, 2) };
}

interface Drawn {
  id: string;
  x: number;
  y: number;
  room: RoomId;
}

/** The stream from each room's gate to the Kernel, on the floor plan. */
const STREAMS = Object.fromEntries(ROOM_IDS.map((r) => [r, streamCurve(r, 18).map(([x, , z]) => [x, z] as const)])) as Record<RoomId, (readonly [number, number])[]>;
/** Each room's plate corners and its stations, in world x/z. */
const PLATES = Object.fromEntries(
  ROOM_IDS.map((r) => {
    const corner = (x: number, z: number) => {
      const [wx, , wz] = roomToWorld(r, x, 0, z);
      return [wx, wz] as const;
    };
    return [
      r,
      {
        corners: [corner(-ROOM_HALF_W, -ROOM_HALF_D), corner(ROOM_HALF_W, -ROOM_HALF_D), corner(ROOM_HALF_W, ROOM_HALF_D), corner(-ROOM_HALF_W, ROOM_HALF_D)],
        inner: [corner(-ROOM_HALF_W + 0.7, -ROOM_HALF_D + 0.7), corner(ROOM_HALF_W - 0.7, -ROOM_HALF_D + 0.7), corner(ROOM_HALF_W - 0.7, ROOM_HALF_D - 0.7), corner(-ROOM_HALF_W + 0.7, ROOM_HALF_D - 0.7)],
        stations: ROOMS[r].stations.map((st) => corner(st.x, st.z)),
        front: corner(0, ROOM_HALF_D),
        pad: (() => {
          const [x, , z] = padWorld(r);
          return [x, z] as const;
        })(),
      },
    ];
  }),
) as Record<RoomId, { corners: (readonly [number, number])[]; inner: (readonly [number, number])[]; stations: (readonly [number, number])[]; front: readonly [number, number]; pad: readonly [number, number] }>;

/** The room under a point of the map (world x/z), if any. */
function roomAtPoint(wx: number, wz: number): RoomId | null {
  for (const r of ROOM_IDS) {
    const [lx, lz] = worldToRoom(r, wx, wz);
    if (Math.abs(lx) <= ROOM_HALF_W && Math.abs(lz) <= ROOM_HALF_D) return r;
  }
  return null;
}

function names(): Names {
  const profiles = useCast.getState().cast.profiles;
  return { name: (id) => profiles[id]?.name, accent: (id) => profiles[id]?.look.accent };
}

/** One frame of the map. */
function draw(c: CanvasRenderingContext2D, g: Geom, t: number, hover: RoomId | null, moving: boolean, trails: Map<string, [number, number][]>, out: Drawn[]) {
  const { cx, cy, s } = g;
  const P = (x: number, z: number): [number, number] => [cx + x * s, cy + z * s];
  c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  c.clearRect(0, 0, g.W, g.H);

  // The instrument rings and their bearings, like the 3D floor's (scene/Environment.tsx, FloorRings).
  ring(c, cx, cy, 14 * s, WHITE, 0.1, [1, 5]);
  ring(c, cx, cy, (RING_RADIUS + ROOM_HALF_D + 4) * s, WHITE, 0.07, [1, 6]);
  ring(c, cx, cy, (RING_RADIUS - ROOM_HALF_D - 5) * s, WHITE, 0.05);
  c.strokeStyle = `rgba(${WHITE},0.12)`;
  c.lineWidth = 1;
  c.beginPath();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU;
    const r0 = (RING_RADIUS + ROOM_HALF_D + 4) * s;
    const r1 = r0 + (i % 6 === 0 ? 7 : 3);
    c.moveTo(cx + Math.sin(a) * r0, cy + Math.cos(a) * r0);
    c.lineTo(cx + Math.sin(a) * r1, cy + Math.cos(a) * r1);
  }
  c.stroke();

  // The light streams, gate to Kernel, a mote riding each.
  for (const [i, r] of ROOM_IDS.entries()) {
    const pts = STREAMS[r];
    const rgb = rgbOf(r);
    const on = hover === r;
    c.strokeStyle = `rgba(${rgb},${on ? 0.6 : 0.26})`;
    c.setLineDash([1.2, 4]);
    c.beginPath();
    pts.forEach(([x, z], k) => {
      const [px, py] = P(x, z);
      if (k) c.lineTo(px, py);
      else c.moveTo(px, py);
    });
    c.stroke();
    c.setLineDash([]);
    if (moving) {
      const u = frac(t * 0.09 + i * 0.37);
      const f = u * (pts.length - 1);
      const k = Math.floor(f);
      const a = pts[k]!;
      const b = pts[Math.min(k + 1, pts.length - 1)]!;
      const [px, py] = P(a[0] + (b[0] - a[0]) * (f - k), a[1] + (b[1] - a[1]) * (f - k));
      c.globalAlpha = 0.55 * Math.sin(Math.PI * u);
      c.drawImage(spr(rgb), px - 4, py - 4, 8, 8);
      c.globalAlpha = 1;
    }
  }

  // The Kernel, where Skippy floats, and the ring of ports the streams arrive at.
  ring(c, cx, cy, KERNEL_PORT_RADIUS * s, WHITE, 0.3);
  knot(c, cx, cy, Math.max(0.7, Math.min(1.5, s / 7)), moving ? t : 0, WHITE, 0.9);

  // The rooms: a plate, an inner hairline, the stations as dots, the pad where travellers beam in and out.
  for (const r of ROOM_IDS) {
    const plate = PLATES[r];
    const rgb = rgbOf(r);
    const on = hover === r;
    c.beginPath();
    plate.corners.forEach(([x, z], k) => {
      const [px, py] = P(x, z);
      if (k) c.lineTo(px, py);
      else c.moveTo(px, py);
    });
    c.closePath();
    c.fillStyle = `rgba(${rgb},${on ? 0.12 : 0.04})`;
    c.fill();
    c.strokeStyle = `rgba(${rgb},${on ? 0.95 : 0.5})`;
    c.lineWidth = on ? 1.4 : 1;
    c.stroke();
    c.beginPath();
    plate.inner.forEach(([x, z], k) => {
      const [px, py] = P(x, z);
      if (k) c.lineTo(px, py);
      else c.moveTo(px, py);
    });
    c.closePath();
    c.strokeStyle = `rgba(${rgb},${on ? 0.3 : 0.12})`;
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = `rgba(${WHITE},${on ? 0.5 : 0.26})`;
    for (const [x, z] of plate.stations) {
      const [px, py] = P(x, z);
      c.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
    }
    const [qx, qy] = P(plate.pad[0], plate.pad[1]);
    ring(c, qx, qy, Math.max(2.5, PAD_RADIUS * s), rgb, on ? 0.9 : 0.5, [1.5, 1.5]);
    // The Tide's leader, from the plate's front edge to its label.
    if (!g.compact) {
      const [fx, fy] = P(plate.front[0], plate.front[1]);
      const [lx, ly] = labelAt(g, r);
      const dx = lx - fx;
      const dy = ly - fy;
      const l = Math.hypot(dx, dy) || 1;
      dots(c, fx + (dx / l) * 4, fy + (dy / l) * 4, lx - (dx / l) * 30, ly - (dy / l) * 18, 3, on ? 0.7 : 0.3, rgb);
    }
  }

  // The crew: a dot each, in their own colour; a ring round whoever is on a job; a fading trail behind anyone moving.
  const { lattice, selectedAgent } = useWorld.getState();
  const n = names();
  const r0 = Math.max(1.8, Math.min(3, s * 0.27));
  out.length = 0;
  for (const rt of Object.values(lattice.agents)) {
    const p = crewPoint(rt, clock.sim);
    const [x, y] = P(p.x, p.z);
    const rgb = hexToRgb(n.accent?.(rt.agent.id) ?? "#eceef3");
    const trail = trails.get(rt.agent.id) ?? [];
    if (p.kind !== "still" && moving) {
      trail.push([x, y]);
      if (trail.length > 14) trail.shift();
    } else if (trail.length) trail.shift();
    trails.set(rt.agent.id, trail);
    for (const [k, [tx, ty]] of trail.entries()) {
      c.globalAlpha = ((k + 1) / trail.length) * (p.kind === "stream" ? 0.5 : 0.3);
      c.drawImage(spr(rgb), tx - 3, ty - 3, 6, 6);
    }
    const lit = hover === p.room || p.kind === "stream" || selectedAgent === rt.agent.id;
    c.globalAlpha = lit ? 1 : 0.85;
    const g2 = r0 * (p.kind === "stream" ? 5 : lit ? 4.6 : 3.8);
    c.drawImage(spr(rgb), x - g2, y - g2, g2 * 2, g2 * 2);
    c.globalAlpha = 1;
    c.fillStyle = `rgba(${WHITE},0.95)`;
    c.beginPath();
    c.arc(x, y, r0 * (p.kind === "stream" ? 0.8 : 1), 0, TAU);
    c.fill();
    const task = rt.taskId ? lattice.tasks[rt.taskId] : undefined;
    if (task?.status === "running") ring(c, x, y, r0 * 2.6, rgb, 0.75);
    if (selectedAgent === rt.agent.id) ring(c, x, y, r0 * 4, WHITE, 0.8);
    out.push({ id: rt.agent.id, x, y, room: p.room });
  }
  info.crew = out.length;
  info.frames++;
}

/** Re-renders every `ms`: the panels read the world on a beat, not on every event. */
function useBeat(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** The 3D world's code, fetched ahead once there's a hint it's wanted (a hover), or after a quiet spell on the map. */
function warm3D() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  void loadWorld3D().catch(() => {});
}

const enter = (room: RoomId) => goToView({ kind: "room", room });
const whole = () => goToView({ kind: "ring", room: null });

function RoomLabel({ g, s, on, onHover }: { g: Geom; s: RoomSummary; on: boolean; onHover: (r: RoomId | null) => void }) {
  const [x, y] = labelAt(g, s.room);
  const style = { left: x, top: y, "--lm-rgb": rgbOf(s.room) } as React.CSSProperties;
  return (
    <button
      className={`lmap-label ${on ? "on" : ""} ${g.compact ? "lmap-label--pin" : ""}`}
      style={style}
      data-map-room={s.room}
      onMouseEnter={() => onHover(s.room)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(s.room)}
      onBlur={() => onHover(null)}
      onClick={() => enter(s.room)}
      aria-label={`${ROOMS[s.room].name}: ${stateLine(s)}. Step inside in 3D`}
    >
      <span className="lmap-label__idx">{index(s.room)}</span>
      {!g.compact && (
        <>
          <span className="lmap-label__name">
            {shortName(s.room)}
            {s.live && <i className="lmap-live" title="Played by real work" />}
          </span>
          <span className="lmap-label__state">{stateLine(s)}</span>
        </>
      )}
    </button>
  );
}

function RoomPanel({ s }: { s: RoomSummary }) {
  const def = ROOMS[s.room];
  return (
    <section className="lmap-panel" style={{ "--lm-rgb": rgbOf(s.room) } as React.CSSProperties} aria-label={`${def.name}, now`}>
      <p className="lmap-eyebrow">
        {index(s.room)} / {shortName(s.room)} · {s.live ? "live" : "simulated"}
      </p>
      <h2 className="lmap-panel__name">{def.name}</h2>
      <p className="lmap-panel__work">{def.workstream}</p>
      <dl className="lmap-figs">
        <div>
          <dt>Here</dt>
          <dd>{s.here}</dd>
        </div>
        <div>
          <dt>Running</dt>
          <dd>{s.running}</dd>
        </div>
        <div>
          <dt>Waiting on you</dt>
          <dd className={s.waiting ? "hot" : ""}>{s.waiting}</dd>
        </div>
      </dl>
      <ul className="lmap-crew">
        {s.crew.length === 0 && <li className="lmap-crew__empty">Nobody in right now.</li>}
        {s.crew.map((m) => (
          <li key={m.id} className={m.busy ? "busy" : ""}>
            <i style={{ "--lm-dot": m.rgb } as React.CSSProperties} />
            <b>{m.name}</b>
            <span>{m.what}</span>
          </li>
        ))}
      </ul>
      <button className="lmap-go" onClick={() => enter(s.room)}>
        <span>
          Step inside <span aria-hidden="true">→</span>
        </span>
        <small>this room alone, in 3D</small>
      </button>
    </section>
  );
}

function useLatticeTime() {
  const [time, setTime] = useState(() => formatClock(clock.sim));
  useEffect(() => {
    const id = setInterval(() => setTime(formatClock(clock.sim)), 500);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function LatticeMap({ active }: { active: boolean }) {
  const chart = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [g, setG] = useState<Geom | null>(null);
  const [hover, setHover] = useState<RoomId | null>(null);
  const [pinned, setPinned] = useState<RoomId | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverRef = useRef<RoomId | null>(null);
  const drawn = useRef<Drawn[]>([]);
  const trails = useRef(new Map<string, [number, number][]>());
  const time = useLatticeTime();
  useBeat(700);

  const onHover = useCallback((r: RoomId | null) => {
    hoverRef.current = r;
    info.hovered = r;
    setHover(r);
    if (r) {
      setPinned(r);
      warm3D();
    }
  }, []);

  // Nothing to focus on the map; the directors' notices read the Lattice-wide view.
  useEffect(() => {
    useWorld.getState().setFocus(null);
    info.on = true;
    info.rooms = ROOM_IDS.length;
    return () => {
      info.on = false;
    };
  }, []);

  useEffect(() => {
    const el = chart.current;
    if (!el) return;
    const measure = () => setG(geometry(el));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The 3D code, ahead, after a quiet spell (a hover fetches it at once).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(warm3D, 4000);
    return () => clearTimeout(t);
  }, [active]);

  // The heartbeat: Lattice time and the simulator run here while the map is up (Scene.tsx's does it in 3D), and the
  // map draws at about 40 frames a second; with reduced motion, one still frame a second and no motes or trails.
  useEffect(() => {
    const cv = canvas.current;
    if (!active || !g || !cv) return;
    cv.width = Math.round(g.W * g.dpr);
    cv.height = Math.round(g.H * g.dpr);
    const c = cv.getContext("2d");
    if (!c) return;
    const still = reducedMotion();
    let raf = 0;
    let last = performance.now();
    let lastDraw = -Infinity;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      clock.sim += dt * 1000 * useWorld.getState().timeScale;
      pumpSimulator();
      if (now - lastDraw < (still ? 1000 : 24)) return;
      lastDraw = now;
      draw(c, g, now / 1000, hoverRef.current, !still, trails.current, drawn.current);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, g]);

  // Keys: 1 to 9 and 0 step into a room, L opens the whole Lattice.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (/^[0-9]$/.test(e.key)) {
        const room = ROOM_IDS[e.key === "0" ? 9 : Number(e.key) - 1];
        if (room) enter(room);
      } else if (e.key.toLowerCase() === "l") whole();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const at = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const crewAt = (x: number, y: number) => {
    let best: Drawn | null = null;
    let d = 10 * 10;
    for (const p of drawn.current) {
      const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dd < d) {
        d = dd;
        best = p;
      }
    }
    return best;
  };
  const onMove = (e: React.PointerEvent) => {
    if (!g) return;
    const [x, y] = at(e);
    const who = crewAt(x, y);
    const room = who?.room ?? roomAtPoint((x - g.cx) / g.s, (y - g.cy) / g.s);
    if (room !== hoverRef.current) onHover(room);
    setTip((t) => (who ? (t?.id === who.id && Math.abs(t.x - who.x) < 1 && Math.abs(t.y - who.y) < 1 ? t : { id: who.id, x: who.x, y: who.y }) : null));
    canvas.current!.style.cursor = room ? "pointer" : "";
  };
  const onClick = (e: React.MouseEvent) => {
    if (!g) return;
    const [x, y] = at(e);
    const room = crewAt(x, y)?.room ?? roomAtPoint((x - g.cx) / g.s, (y - g.cy) / g.s);
    if (room) enter(room);
  };

  const world = useWorld.getState();
  const now = clock.sim;
  const n = names();
  const summaries = ROOM_IDS.map((r) => roomSummary(world.lattice, r, now, n));
  const busiest = [...summaries].sort((a, b) => b.running + b.waiting * 2 - (a.running + a.waiting * 2) || b.here - a.here)[0]!;
  const shown = summaries.find((s) => s.room === (hover ?? pinned)) ?? busiest;
  const crew = Object.keys(world.lattice.agents).length;
  const running = summaries.reduce((a, s) => a + s.running, 0);
  const waiting = pendingApprovals(world.lattice, true).length;
  const live = summaries.filter((s) => s.live).length;
  const signals = feedLines(world.lattice, 5, n.name, null, true);
  const skippy = world.kernelLog[0];
  const tipRt = tip ? world.lattice.agents[tip.id] : undefined;
  const tipSummary = tipRt ? summaries.find((s) => s.room === tipRt.place.room)?.crew.find((m) => m.id === tip!.id) : undefined;

  return (
    <div className="lmap" data-map="on">
      <header className="lmap-top">
        <span className="lmap-mark">
          <img src={`${import.meta.env.BASE_URL}tide/syntherion-sigil.webp`} alt="" />
          <b>C.E.O.</b>
        </span>
        <span className="lmap-top__rule" aria-hidden="true" />
        <span className="lmap-top__where">The Lattice · map</span>
        <span className="lmap-top__right">
          <a
            className="lmap-top__desk"
            href="/"
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              navigate("today");
            }}
          >
            Desk
          </a>
          <span className="lmap-faint">Lattice time</span>
          <span>{time}</span>
          <span className={`lmap-count ${waiting ? "hot" : ""}`} title="Waiting on the C.E.O.">
            {waiting}
          </span>
        </span>
      </header>

      <section className="lmap-title">
        <p className="lmap-eyebrow">00 / Map · ten rooms, one ring</p>
        <h1 className="lmap-display">The Lattice</h1>
        <p className="lmap-sub">Seen from above, as it is right now. Pick a room to step inside it in 3D.</p>
        <dl className="lmap-totals">
          <div>
            <dt>Crew</dt>
            <dd>{crew}</dd>
          </div>
          <div>
            <dt>Running</dt>
            <dd>{running}</dd>
          </div>
          <div>
            <dt>Waiting on you</dt>
            <dd className={waiting ? "hot" : ""}>{waiting}</dd>
          </div>
          <div>
            <dt>Live rooms</dt>
            <dd>{live}</dd>
          </div>
        </dl>
        {skippy && (
          <p className="lmap-skippy">
            <span className="lmap-eyebrow">Skippy · Kernel</span>
            {skippy.text}
          </p>
        )}
        <div className="lmap-signals">
          <p className="lmap-eyebrow">Signals · real agents</p>
          <ol>
            {signals.length === 0 && <li className="lmap-faint">No real agents on the line yet.</li>}
            {signals.map((l) => (
              <li key={l.id}>
                {l.who && <b>{l.who}</b>} {l.text}
              </li>
            ))}
          </ol>
        </div>
        <button className="lmap-whole" onClick={whole} data-map-whole>
          <span>Whole Lattice</span>
          <small>all ten rooms in 3D · the heaviest view</small>
        </button>
        <p className="lmap-keys lmap-faint">1–9, 0 · step into a room · L · whole Lattice</p>
      </section>

      <div className="lmap-chart" ref={chart}>
        <canvas
          ref={canvas}
          className="lmap-canvas"
          role="img"
          aria-label={`The Lattice from above: ten rooms round the Kernel, ${crew} crew.`}
          onPointerMove={onMove}
          onPointerLeave={() => {
            onHover(null);
            setTip(null);
          }}
          onClick={onClick}
          style={g ? { width: g.W, height: g.H } : undefined}
        />
        {g && (
          <div className="lmap-kernel" style={{ left: g.cx, top: g.cy + Math.max(18, 9 * g.s) }} aria-hidden="true">
            Kernel
          </div>
        )}
        {g && summaries.map((s) => <RoomLabel key={s.room} g={g} s={s} on={hover === s.room} onHover={onHover} />)}
        {tip && tipRt && (
          <div className="lmap-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
            <b>{n.name?.(tip.id) ?? tipRt.agent.name}</b>
            <span>{tipSummary?.what ?? ""}</span>
          </div>
        )}
      </div>

      <aside className="lmap-side">
        <RoomPanel s={shown} />
      </aside>

      {/* On a phone the rooms are a list under the ring. */}
      <ol className="lmap-list" aria-label="Rooms">
        {summaries.map((s) => (
          <li key={s.room} style={{ "--lm-rgb": rgbOf(s.room) } as React.CSSProperties}>
            <button onClick={() => enter(s.room)} data-map-list={s.room}>
              <span className="lmap-list__idx">{index(s.room)}</span>
              <span className="lmap-list__name">
                {shortName(s.room)}
                {s.live && <i className="lmap-live" title="Played by real work" />}
              </span>
              <span className="lmap-list__state">{stateLine(s)}</span>
              {s.crew[0] && (
                <span className="lmap-list__doing">
                  {s.crew[0].name} · {s.crew[0].what}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
