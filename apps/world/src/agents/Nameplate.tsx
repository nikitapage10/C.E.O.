import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { create } from "zustand";
import { CREW, crewJob, useFoundry, waitingTurn, type CrewId } from "../foundry.ts";
import { useWorld } from "../store.ts";
import { declutterPlates, settleLevel, stepsForward, type PlateBox, type PlateLevel, type Rect } from "./declutter.ts";
import { bubbleRects } from "./SpeechBubble.tsx";
import { crateCard, recordCard, type TaskCard } from "./taskCard.ts";
import { taskLine, type TaskIcon, type TaskLine } from "./taskLine.ts";

/** Small line icons for the task line, drawn on a 16-unit grid in the agent's colour. */
const ICON: Record<TaskIcon, React.ReactNode> = {
  work: (
    <>
      <path d="M2.5 13.5 8.6 7.4" />
      <path d="m7 5 2.6-2.6 4 4L11 9z" />
    </>
  ),
  write: (
    <>
      <path d="m3 13 .9-3.4 7-7 2.5 2.5-7 7z" />
      <path d="m9.4 4.1 2.5 2.5" />
    </>
  ),
  carry: (
    <>
      <path d="M2.5 5.2 8 2.5l5.5 2.7v5.6L8 13.5l-5.5-2.7z" />
      <path d="M2.5 5.2 8 8l5.5-2.8M8 8v5.5" />
    </>
  ),
  walk: (
    <>
      <path d="M2.5 8h9.5" />
      <path d="M9 4.5 12.5 8 9 11.5" />
    </>
  ),
  wait: (
    <>
      <path d="M4.5 2.5h7M4.5 13.5h7" />
      <path d="M5.5 2.5V4L8 8l2.5-4V2.5M5.5 13.5V12L8 8l2.5 4v1.5" />
    </>
  ),
  rest: (
    <>
      <path d="M3 6.5h8v3.5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
      <path d="M11 7.5h1a1.5 1.5 0 0 1 0 3h-1M6 2.5v2M8.5 2.5v2" />
    </>
  ),
  look: (
    <>
      <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  nap: <path d="M12.8 10.2A5.5 5.5 0 0 1 5.8 3.2a5.5 5.5 0 1 0 7 7z" />,
  stuck: (
    <>
      <path d="M8 2.5 14 13H2z" />
      <path d="M8 6.5v3M8 11.2v.2" />
    </>
  ),
  cheer: <path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8l4.8-1.4z" />,
  music: (
    <>
      <path d="M6 12V3.6l7-1.4v8.3" />
      <circle cx="4.4" cy="12" r="1.6" />
      <circle cx="11.4" cy="10.5" r="1.6" />
    </>
  ),
  game: (
    <>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2" />
      <path d="M5.6 5.6h.1M10.4 10.4h.1M8 8h.1" />
    </>
  ),
  read: (
    <>
      <path d="M8 4.5C6.6 3.2 4.4 3 2.5 3.4v9c1.9-.4 4.1-.2 5.5 1.1 1.4-1.3 3.6-1.5 5.5-1.1v-9C11.6 3 9.4 3.2 8 4.5z" />
      <path d="M8 4.5v9" />
    </>
  ),
  post: (
    <>
      <rect x="2" y="3.8" width="12" height="8.4" rx="1" />
      <path d="m2.5 4.5 5.5 4.3 5.5-4.3" />
    </>
  ),
};

/** Camera distance (world units) where the task line starts to fade, and where it is gone. The name stays. */
const FADE_FROM = 34;
const FADE_TO = 46;
/** How long the card waits after the pointer leaves before it closes, so the pointer can cross to it. */
const CLOSE_MS = 180;
/** An open card's layer: over every plate, tag and bubble in the scene. */
const OPEN_Z = "90";

const at = new Vector3();

/** Every plate on screen, refreshed every MEASURE_MS, so plates that bunch up can step back (declutter.ts). */
const plates = new Map<string, PlateBox & { at: number }>();
const MEASURE_MS = 120;
/** A plate that stepped back waits this long in clear air before it shows more again, so it doesn't flicker (ms). */
const SETTLE_MS = 600;
let plateSeq = 0;

function relRect(r: DOMRect, c: DOMRect): Rect {
  return { left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, bottom: r.bottom - c.top };
}

/** The card over the task line: the real job behind it, or a note that a demo room's work is a drill. */
function TaskCardView({ card, accent }: { card: TaskCard; accent: string }) {
  if (card.kind !== "real")
    return (
      <div className="taskcard__body">
        <div className="taskcard__title">{card.title}</div>
        {card.kind === "drill" ? <div className="taskcard__note">A drill — this room isn't live yet</div> : <div className="taskcard__note">Live, straight from the room</div>}
      </div>
    );
  return (
    <div className="taskcard__body">
      <div className="taskcard__head">
        <span className="taskcard__num" style={{ color: accent }}>
          #{card.number}
        </span>
        <span className="taskcard__status">{card.status}</span>
      </div>
      <div className="taskcard__title">{card.title}</div>
      {card.pitch && <p className="taskcard__pitch">{card.pitch}</p>}
      <div className="taskcard__foot">
        <span>
          {card.builder}
          {card.hands && <em> · {card.hands}'s hands</em>}
        </span>
        <a href={card.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          Open issue ↗
        </a>
      </div>
    </div>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Whose task card is open, so the agent's speech bubble waits and doesn't swap the plate (and the card) away. */
export const useTaskCard = create<{ open: string | null }>(() => ({ open: null }));

/** Pass a wheel turn over the plate on to the scene, so zooming isn't stopped by a label under the pointer. */
function passWheel(e: React.WheelEvent) {
  const canvas = document.querySelector("canvas");
  if (canvas) canvas.dispatchEvent(new WheelEvent("wheel", e.nativeEvent));
}

/**
 * A name plate in the scene: the name, the task line under it (fading as the camera pulls back), and, when there is
 * more to say, a card that opens above the plate on hover or a tap and closes on mouse-out, a tap elsewhere or Esc.
 * The card opens upwards, so it never covers the agent below; closed, nothing of it is in the page.
 */
export function Plate({ y, name, accent, line, card, owner }: { y: number; name: string; accent: string; line: TaskLine | null; card: TaskCard | null; owner?: string }) {
  const anchor = useRef<Group>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const shown = useRef(-1);
  const closeTimer = useRef<number | null>(null);
  const lastPointer = useRef("mouse");
  const nameRef = useRef<HTMLSpanElement>(null);
  const [key] = useState(() => `plate-${++plateSeq}`);
  const crowd = useRef<{ level: PlateLevel; crowdedAt: number; next: number }>({ level: "full", crowdedAt: 0, next: 0 });
  const [open, setOpen] = useState(false);
  const isOpen = open && card !== null;
  useEffect(
    () => () => {
      plates.delete(key);
    },
    [key],
  );

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_MS);
  };
  useEffect(() => cancelClose, []);

  // Open, the plate's layer goes over every other plate (and stays there; see the frame loop). Closed, it goes back.
  useEffect(() => {
    const host = plateRef.current?.parentElement?.parentElement;
    if (!isOpen || !host) return;
    const was = host.style.zIndex;
    host.style.zIndex = OPEN_Z;
    return () => {
      host.style.zIndex = was;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !owner) return;
    useTaskCard.setState({ open: owner });
    return () => {
      if (useTaskCard.getState().open === owner) useTaskCard.setState({ open: null });
    };
  }, [isOpen, owner]);

  // Open: a tap or click outside the plate, or Esc, closes it.
  useEffect(() => {
    if (!isOpen) return;
    const down = (e: PointerEvent) => {
      if (!plateRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Esc closes the card and nothing else: it doesn't also back the camera out of the room.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [isOpen]);

  useFrame(({ camera, gl }) => {
    // Open, keep the plate's layer over the others: the scene restacks plates every frame their agent moves.
    if (isOpen) {
      const host = plateRef.current?.parentElement?.parentElement;
      if (host && host.style.zIndex !== OPEN_Z) host.style.zIndex = OPEN_Z;
    }
    if (!anchor.current) return;
    anchor.current.getWorldPosition(at);
    const d = camera.position.distanceTo(at);
    const el = lineRef.current;
    if (el) {
      const o = Math.min(1, Math.max(0, (FADE_TO - d) / (FADE_TO - FADE_FROM)));
      const q = Math.round(o * 20) / 20;
      if (q !== shown.current) {
        shown.current = q;
        el.style.opacity = String(q);
        el.style.visibility = q === 0 ? "hidden" : "";
        if (q === 0) setOpen(false);
      }
    }
    declutter(d, gl.domElement);
  });

  /** Now and then, measure this plate and step it back (or forward) against the plates and bubbles around it. */
  function declutter(depth: number, canvas: HTMLElement) {
    const now = performance.now();
    const c = crowd.current;
    const plate = plateRef.current;
    if (now < c.next || !plate || !nameRef.current) return;
    c.next = now + MEASURE_MS;
    const name = nameRef.current.getBoundingClientRect();
    if (!name.width) {
      plates.delete(key);
      return;
    }
    const box = canvas.getBoundingClientRect();
    const line = lineRef.current && shown.current > 0.05 ? relRect(lineRef.current.getBoundingClientRect(), box) : null;
    plates.set(key, { id: key, depth, name: relRect(name, box), line, pinned: isOpen, at: now });
    for (const [k, p] of plates) if (now - p.at > MEASURE_MS * 4) plates.delete(k);
    const want = declutterPlates([...plates.values()], [...bubbleRects.values()])[key] ?? "full";
    if (!stepsForward(c.level, want)) c.crowdedAt = now;
    const level = settleLevel(c.level, want, c.crowdedAt, now, SETTLE_MS);
    if (level === c.level) return;
    c.level = level;
    // A data attribute, not a class: React owns className and would wipe it on the next render.
    if (level === "full") delete plate.dataset.crowd;
    else plate.dataset.crowd = level;
  }

  const hover = card
    ? {
        onPointerEnter: (e: React.PointerEvent) => {
          lastPointer.current = e.pointerType;
          if (e.pointerType !== "mouse") return;
          cancelClose();
          setOpen(true);
        },
        onPointerLeave: (e: React.PointerEvent) => {
          if (e.pointerType === "mouse") closeSoon();
        },
        // The scene listens on the same layer as the plates: keep the pointer over a line or card from hovering
        // or picking the agent behind it (which would swap the plate for the agent's tag).
        onPointerMove: stop,
        onPointerUp: stop,
        onWheel: passWheel,
      }
    : {};

  return (
    <group ref={anchor} position={[0, y, 0]}>
      <Html center distanceFactor={16} zIndexRange={[25, 0]}>
        <div ref={plateRef} className="nameplate">
          {isOpen && card && (
            <div className="taskcard" role="dialog" aria-label={`What ${name} is working on`} {...hover} onPointerDown={stop} onClick={stop} style={{ borderTopColor: accent }}>
              <TaskCardView card={card} accent={accent} />
            </div>
          )}
          <span ref={nameRef} className="nameplate__name">
            <span style={{ color: accent }}>●</span> {name}
          </span>
          {line && (
            <div
              ref={lineRef}
              className={`nameplate__task${card ? " nameplate__task--more" : ""}${isOpen ? " is-open" : ""}`}
              data-icon={line.icon}
              {...(card
                ? {
                    ...hover,
                    role: "button",
                    tabIndex: 0,
                    "aria-expanded": isOpen,
                    onPointerDown: (e: React.PointerEvent) => {
                      e.stopPropagation();
                      lastPointer.current = e.pointerType;
                    },
                    // A tap (touch or pen) toggles the card; a mouse opens it by hovering.
                    onClick: (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (lastPointer.current !== "mouse") setOpen((o) => !o);
                      else setOpen(true);
                    },
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen((o) => !o);
                      }
                    },
                  }
                : {})}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" style={{ color: accent }}>
                {ICON[line.icon]}
              </svg>
              <span>{line.text}</span>
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

/**
 * The plate over an agent in a room: their name, and under it what they are doing right now (a task line with
 * an icon; see taskLine.ts), with a card of the detail on hover. The Foundry crew's lines come from the real
 * job each one holds (`crewJob`), so a line that would only say where they stand names the work instead; everyone
 * else's from the task the Lattice has them on.
 */
export function Nameplate({ id, name, accent, y }: { id: string; name: string; accent: string; y: number }) {
  const rt = useWorld((s) => s.lattice.agents[id]);
  const task = useWorld((s) => (rt?.taskId ? s.lattice.tasks[rt.taskId] : undefined));
  const crew = id in CREW ? (id as CrewId) : null;
  const crates = useFoundry((s) => (crew && s.connected ? s.data.crates : null));
  const crate = crew && crates ? crewJob(crates, crew) : null;

  const lineTask = crate ? { title: `#${crate.number} ${crate.title}`, status: "running", number: crate.number, short: crate.short } : task;
  const line = rt ? taskLine({ activity: rt.activity, place: rt.place, prop: rt.prop, task: lineTask }) : null;
  const card = crate && crew && crates ? crateCard(crate, crew, { waiting: waitingTurn(crates).has(crate.number) }) : recordCard(task);

  return <Plate y={y} name={name} accent={accent} line={line} card={card} owner={id} />;
}
