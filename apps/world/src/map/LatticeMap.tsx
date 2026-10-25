import { ROOMS, ROOM_IDS, pendingApprovals, type RoomId } from "@ceo/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { submindOf } from "../../../../packages/simulator/src/subminds.ts";
import { useCast } from "../cast/castStore.ts";
import { clock } from "../clock.ts";
import { useFlow, type FlowLayoutFn } from "../desk/flow/index.ts";
import { reducedMotion } from "../desk/wvCanvas.ts";
import { feedLines, formatClock, type FeedLine } from "../hud/format.ts";
import { navigate } from "../route.ts";
import { pumpSimulator, useWorld } from "../store.ts";
import { loadWorld3D } from "./load3d.ts";
import { crewPoint, roomSummary, stateLine, type Names, type RoomSummary } from "./mapModel.ts";
import { GOLD, above, anchorId, makeStage, nodeOf, ringIn, rgbOf, spokeId, type Ring, type StageState } from "./mapStage.ts";
import { goToView } from "./view.ts";
import "./map.css";

/**
 * The Lattice's map (#332, redrawn in Today's language in #433): what "Enter the Lattice" opens on. The ring seen from
 * above, in the flow kit's particle lines: the ten rooms as their subminds' figures in their own colours, Skippy at the
 * centre on the Kernel, each room's light stream to him a line of particles. A live room's line carries its real work
 * and runs a packet into the Kernel whenever it does something (the words rise off its figure); a room the simulator
 * still plays is a waiting line. The crew are motes where the simulator has them, riding the streams between rooms.
 * No three.js, no models: it shows at once. A room picked here loads that room alone in 3D (World3D.tsx); "Whole
 * Lattice" loads the full ring.
 */

const shortName = (room: RoomId) => ROOMS[room].name.replace(/^The /, "");
const index = (room: RoomId) => String(ROOM_IDS.indexOf(room) + 1).padStart(2, "0");

/** What the map has on screen, for window.__ceo.map() (the browser tests and the console). */
const info = { on: false, rooms: 0, hovered: null as RoomId | null };
let onStage: StageState | null = null;
export const mapDebug = () => {
  const now = clock.sim;
  const positions = Object.fromEntries(Object.values(useWorld.getState().lattice.agents).map((rt) => {
    const p = crewPoint(rt, now);
    return [rt.agent.id, [p.x, p.z]];
  }));
  return { ...info, crew: onStage?.drawn.length ?? 0, frames: onStage?.frames ?? 0, positions };
};

function names(): Names {
  const profiles = useCast.getState().cast.profiles;
  return { name: (id) => profiles[id]?.name, accent: (id) => profiles[id]?.look.accent };
}

/** Re-renders every `ms`: the type reads the world on a beat, not on every event. */
function useBeat(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** The 3D world's code, fetched ahead once there's a hint it's wanted (a hover), or after a quiet spell on the map. */
function warm3D(room?: RoomId) {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  void loadWorld3D()
    .then((m) => room && m.prefetchRoom(room))
    .catch(() => {});
}

/** A room hovered this long has its models fetched ahead of the click (#416); a pointer sweeping past fetches nothing. */
const DWELL_MS = 120;
let dwell: ReturnType<typeof setTimeout> | undefined;
function warmRoom(room: RoomId | null) {
  clearTimeout(dwell);
  if (!room) return;
  warm3D();
  dwell = setTimeout(() => warm3D(room), DWELL_MS);
}

const enter = (room: RoomId) => goToView({ kind: "room", room });
const whole = () => goToView({ kind: "ring", room: null });

/**
 * Lattice time and the simulator, stepped while the map is up (Scene.tsx does it in 3D): by the stage's own frames,
 * so the crew move smoothly, and by a slow beat when no frame is drawn (reduced motion, or the ring scrolled away on a
 * phone). Stops with the tab hidden, as a frame loop would.
 */
function useHeartbeat(active: boolean, onStill: () => void) {
  const last = useRef(0);
  const tick = useCallback(() => {
    const now = performance.now();
    const dt = Math.min(now - last.current, 100);
    last.current = now;
    if (dt <= 0) return;
    clock.sim += dt * useWorld.getState().timeScale;
    pumpSimulator();
  }, []);
  const still = useRef(onStill);
  useEffect(() => {
    still.current = onStill;
  });
  useEffect(() => {
    if (!active) return;
    last.current = performance.now();
    let n = 0;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") {
        last.current = performance.now();
        return;
      }
      if (performance.now() - last.current < 150) return;
      tick();
      // Reduced motion: a still frame of where everyone is, once a second.
      if (reducedMotion() && ++n % 5 === 0) still.current();
    }, 200);
    return () => clearInterval(id);
  }, [active, tick]);
  return tick;
}

function useLatticeTime() {
  const [time, setTime] = useState(() => formatClock(clock.sim));
  useEffect(() => {
    const id = setInterval(() => setTime(formatClock(clock.sim)), 500);
    return () => clearInterval(id);
  }, []);
  return time;
}

/** A real agent's line, in neutral words for the words that rise off its room (the map is public). */
function riseWords(l: FeedLine): string | null {
  const who = l.who ? `${l.who} ` : "";
  switch (l.kind) {
    case "done":
      return `${who}finished`;
    case "fail":
      return `${who}hit a snag`;
    case "task":
      return `${who}started`;
    case "approval":
      return `${who}asks you`;
    case "resolved":
      return "decided";
    default:
      return null;
  }
}

/** The state of a room in a few words: the italic line under its name. */
function roomSay(s: RoomSummary): string {
  if (s.waiting) return `${s.waiting} ${s.waiting === 1 ? "asks" : "ask"} you`;
  if (s.running) return `${s.running} running`;
  return "quiet";
}

function RoomName({ s, g, on, onHover }: { s: RoomSummary; g: Ring; on: boolean; onHover: (r: RoomId | null) => void }) {
  const [x, y] = nodeOf(g, s.room);
  const up = above(s.room);
  return (
    <button
      type="button"
      className={`lmap-room${up ? " is-above" : ""}${on ? " is-on" : ""}${s.live ? " is-live" : ""}${s.waiting ? " is-hot" : ""}`}
      style={{ left: x, top: up ? y - g.lab : y + g.lab, "--rc": rgbOf(s.room) } as React.CSSProperties}
      data-map-room={s.room}
      onMouseEnter={() => onHover(s.room)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(s.room)}
      onBlur={() => onHover(null)}
      onClick={() => enter(s.room)}
      aria-label={`${ROOMS[s.room].name}, ${s.live ? "live" : "simulated"}: ${stateLine(s)}. Step inside in 3D`}
    >
      {g.phone ? (
        <span className="lmap-room__idx fl-num">{index(s.room)}</span>
      ) : (
        <>
          <span className="lmap-room__name">{shortName(s.room)}</span>
          <span className="lmap-room__say">{roomSay(s)}</span>
          <span className="lmap-room__meta">
            {s.here} here · {s.live ? <b>live</b> : "simulated"}
          </span>
        </>
      )}
    </button>
  );
}

function RoomPanel({ s }: { s: RoomSummary }) {
  const def = ROOMS[s.room];
  const mind = submindOf(s.room);
  return (
    <section className="lmap-panel fl-panel" style={{ "--fl-accent": rgbOf(s.room) } as React.CSSProperties} aria-label={`${def.name}, now`}>
      <p className="fl-eyb">
        <span>{index(s.room)}</span>
        <i />
        {s.live ? "Live · real work" : "Simulated for now"}
      </p>
      <h2 className="fl-h2">{def.name}</h2>
      <p className="lmap-panel__mind">Skippy, the {mind.job}</p>
      <p className="lmap-panel__work">{def.workstream}</p>
      <dl className="fl-ledger lmap-panel__ledger">
        <div>
          <dt>Here</dt>
          <dd>{s.here}</dd>
        </div>
        <div>
          <dt>Running</dt>
          <dd>{s.running}</dd>
        </div>
        <div className={s.waiting ? "is-hot" : ""}>
          <dt>Asks you</dt>
          <dd>{s.waiting}</dd>
        </div>
      </dl>
      <ul className="lmap-crew">
        {s.crew.length === 0 && <li className="lmap-crew__empty">Nobody in right now.</li>}
        {s.crew.map((m) => (
          <li key={m.id} className={m.busy ? "is-busy" : ""}>
            <i style={{ "--dot": m.rgb } as React.CSSProperties} />
            <b>{m.name}</b>
            <span>{m.what}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="fl-btn is-pri lmap-go" onClick={() => enter(s.room)}>
        Step inside <span aria-hidden="true">→</span>
      </button>
      <p className="lmap-go__note">This room alone, in 3D</p>
    </section>
  );
}

/** The headline: what waits on Nikita, else what's under way, in plain words. */
function Headline({ waiting, running }: { waiting: number; running: number }) {
  if (waiting)
    return (
      <>
        {waiting} {waiting === 1 ? "ask waits" : "asks wait"} <em>on you.</em>
      </>
    );
  if (running)
    return (
      <>
        {running} {running === 1 ? "job" : "jobs"} <em>under way.</em>
      </>
    );
  return (
    <>
      The ring is <em>quiet.</em>
    </>
  );
}

export function LatticeMap({ active }: { active: boolean }) {
  const stage = useRef<HTMLElement>(null);
  const ringEl = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; phone: boolean } | null>(null);
  const [hover, setHover] = useState<RoomId | null>(null);
  const [pinned, setPinned] = useState<RoomId | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const time = useLatticeTime();
  useBeat(700);

  const world = useWorld.getState();
  const now = clock.sim;
  const n = names();
  const summaries = ROOM_IDS.map((r) => roomSummary(world.lattice, r, now, n));

  // The stage's own state, changed in place; the frame reads it, React never draws it.
  const S = useRef<StageState>({ g: null, rooms: new Map(), hover: null, tick: () => {}, drawn: [], frames: 0 }).current;
  const st = useMemo(() => makeStage(S), [S]);
  useEffect(() => {
    S.rooms = new Map(summaries.map((s) => [s.room, s]));
  });

  // The lines change only when a room's kind, crew count or running work does: re-laid then, never per frame.
  const shape = summaries.map((s) => `${s.live ? 1 : 0}.${s.here}.${s.running}.${s.waiting}`).join("|");
  const layout = useCallback<FlowLayoutFn>(
    ({ W, rel }) => {
      const el = ringEl.current;
      const b = el ? rel(el) : { x: 0, y: 0, w: W, h: W };
      S.g = ringIn(b, W < 760);
      return st.lines(S.g);
    },
    // `shape` is the rooms' state the lines are drawn from (S.rooms, set on each beat).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st, S, shape],
  );
  const { cv, field } = useFlow(layout, { accent: GOLD, ground: true, backing: 1_100_000, overlay: (c, t, dt) => st.overlay(c, t, dt) });
  const tick = useHeartbeat(active, () => field.relayout());
  useEffect(() => {
    S.tick = tick;
  }, [S, tick]);

  const onHover = useCallback(
    (r: RoomId | null) => {
      S.hover = r;
      info.hovered = r;
      setHover(r);
      if (r) setPinned(r);
      field.setFocus(r ? spokeId(r) : null);
      warmRoom(r);
    },
    [S, field],
  );

  // Nothing to focus on the map; the directors' notices read the Lattice-wide view.
  useEffect(() => {
    useWorld.getState().setFocus(null);
    info.on = true;
    info.rooms = ROOM_IDS.length;
    onStage = S;
    return () => {
      info.on = false;
      onStage = null;
    };
  }, [S]);

  // The ring's box, for the names round it (the canvas reads the same box in its layout).
  useLayoutEffect(() => {
    const el = ringEl.current;
    const host = stage.current;
    if (!el || !host) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight, phone: host.clientWidth < 760 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // The 3D code, ahead, after a quiet spell (a hover fetches it at once).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(warm3D, 4000);
    return () => clearTimeout(t);
  }, [active]);

  // A real agent did something: a packet runs its room's line into the Kernel and the words rise off its figure.
  const live = feedLines(world.lattice, 6, n.name, null, true);
  const head = live[0]?.id ?? "";
  const seen = useRef<string | null>(null);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });
  useEffect(() => {
    if (seen.current === null || !seen.current) {
      seen.current = head;
      return;
    }
    if (head === seen.current) return;
    const fresh: FeedLine[] = [];
    for (const l of liveRef.current) {
      if (l.id === seen.current) break;
      fresh.push(l);
    }
    seen.current = head;
    for (const l of fresh.reverse()) {
      if (!l.room) continue;
      field.pulse(spokeId(l.room));
      const w = riseWords(l);
      if (w) field.rise(w, { at: anchorId(l.room), rgb: rgbOf(l.room) });
    }
  }, [head, field]);

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

  /** A pointer event in canvas px, unless it is on the page's own buttons and links. */
  const at = (e: React.MouseEvent) => {
    const el = cv.current;
    if (!el || (e.target as Element).closest("button,a,.lmap-side")) return null;
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onMove = (e: React.PointerEvent) => {
    const p = at(e);
    if (!p) return;
    const who = st.crewAt(p[0], p[1]);
    const room = who?.room ?? st.roomAt(p[0], p[1]);
    if (room !== S.hover) onHover(room);
    setTip((t) => (who ? (t?.id === who.id && Math.abs(t.x - who.x) < 1 && Math.abs(t.y - who.y) < 1 ? t : { id: who.id, x: who.x, y: who.y }) : null));
    e.currentTarget.classList.toggle("is-pointing", !!room);
  };
  const onClick = (e: React.MouseEvent) => {
    const p = at(e);
    if (!p) return;
    const room = st.crewAt(p[0], p[1])?.room ?? st.roomAt(p[0], p[1]);
    if (room) enter(room);
  };
  const onLeave = () => {
    onHover(null);
    setTip(null);
  };

  // Until a room is pointed at, the panel holds the busiest live room (real work first).
  const busiest = [...summaries].sort((a, b) => Number(b.live) - Number(a.live) || b.waiting - a.waiting || b.running - a.running || b.here - a.here)[0]!;
  const shown = summaries.find((s) => s.room === (hover ?? pinned)) ?? busiest;
  const crew = Object.keys(world.lattice.agents).length;
  const running = summaries.reduce((a, s) => a + s.running, 0);
  const waiting = pendingApprovals(world.lattice, true).length;
  const liveRooms = summaries.filter((s) => s.live).length;
  const skippy = world.kernelLog[0];
  const tipRt = tip ? world.lattice.agents[tip.id] : undefined;
  const tipSummary = tipRt ? summaries.find((s) => s.room === tipRt.place.room)?.crew.find((m) => m.id === tip!.id) : undefined;
  const g = box ? ringIn({ x: 0, y: 0, w: box.w, h: box.h }, box.phone) : null;

  return (
    <div className="lmap fl-root" data-map="on">
      <header className="lmap-top">
        <a
          className="lmap-mark"
          href="/"
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            navigate("today");
          }}
        >
          <img src={`${import.meta.env.BASE_URL}tide/syntherion-sigil.webp`} alt="" />
          <b>C.E.O.</b>
          <span className="lmap-top__back">
            <span aria-hidden="true">←</span> Desk
          </span>
        </a>
        <span className="lmap-top__right">
          <span className="lmap-top__k">Lattice time</span>
          <span className="lmap-top__time fl-num">{time}</span>
          <span className={`lmap-count${waiting ? " is-hot" : ""}`} title="Waiting on the C.E.O.">
            {waiting}
          </span>
        </span>
      </header>

      <div className="fl-page lmap-page">
        <section className="fl-stage lmap-stage" ref={stage} onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick}>
          {active && <canvas ref={cv} className="fl-cv" role="img" aria-label={`The Lattice from above: ten rooms round the Kernel, ${crew} crew, ${liveRooms} rooms running real work.`} />}

          <div className="lmap-intro">
            <p className="fl-eyb">
              <span>The Lattice</span>
              <i />
              Ten rooms, one ring
            </p>
            <h1 className="fl-h1">
              <Headline waiting={waiting} running={running} />
            </h1>
            {skippy && <p className="fl-say lmap-say">{skippy.text}</p>}
            <dl className="fl-ledger lmap-ledger">
              <div>
                <dt>Crew</dt>
                <dd>{crew}</dd>
              </div>
              <div>
                <dt>Running</dt>
                <dd>{running}</dd>
              </div>
              <div className={waiting ? "is-hot" : ""}>
                <dt>Waiting on you</dt>
                <dd>{waiting}</dd>
              </div>
              <div>
                <dt>Rooms live</dt>
                <dd>
                  {liveRooms} <small>of {ROOM_IDS.length}</small>
                </dd>
              </div>
            </dl>
            <div className="lmap-acts">
              <button type="button" className="fl-btn is-pri" onClick={whole} data-map-whole>
                Whole Lattice in 3D
              </button>
              <span className="lmap-keys">
                <kbd>1</kbd>–<kbd>0</kbd> a room · <kbd>L</kbd> the ring
              </span>
            </div>
            <div className="lmap-line">
              <p className="fl-k">
                <span>On the line</span> · real agents
              </p>
              <ol>
                {live.length === 0 && <li className="fl-wait">No real agent has said anything yet.</li>}
                {live.slice(0, 4).map((l) => (
                  <li key={l.id} style={{ "--rc": l.room ? rgbOf(l.room) : GOLD } as React.CSSProperties}>
                    {l.who && <b>{l.who}</b>} {l.text}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="lmap-ring" ref={ringEl}>
            {g && (
              <>
                <p className="lmap-kernel" style={{ left: g.cx, top: g.cy + g.kr * 1.2 }}>
                  <em>Skippy</em>
                  <span>the Kernel</span>
                </p>
                {summaries.map((s) => (
                  <RoomName key={s.room} s={s} g={g} on={hover === s.room} onHover={onHover} />
                ))}
              </>
            )}
          </div>

          <aside className="lmap-side">
            <RoomPanel s={shown} />
          </aside>

          {tip && tipRt && (
            <div className="lmap-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
              <b>{n.name?.(tip.id) ?? tipRt.agent.name}</b>
              <span>{tipSummary?.what ?? ""}</span>
            </div>
          )}
        </section>

        {/* On a phone the rooms are a list under the ring. */}
        <ol className="lmap-list fl-below" aria-label="Rooms">
          {summaries.map((s) => (
            <li key={s.room} style={{ "--rc": rgbOf(s.room) } as React.CSSProperties} className={s.live ? "is-live" : ""}>
              <button type="button" onClick={() => enter(s.room)} data-map-list={s.room}>
                <span className="lmap-list__idx fl-num">{index(s.room)}</span>
                <span className="lmap-list__name">{shortName(s.room)}</span>
                <span className="lmap-list__say">{roomSay(s)}</span>
                <span className="lmap-list__meta">
                  {s.here} here · {s.live ? "live" : "simulated"}
                  {s.crew[0] && ` · ${s.crew[0].name}, ${s.crew[0].what}`}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
