import { ROOMS, ROOM_IDS, type RoomId } from "@ceo/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { eyesInput, eyesTap, enterEyes, useEyes, type EyesNote } from "./eyes.ts";

/**
 * Brogu's eyes, on screen: a glass over the scene that turns drags into looking and taps into walking, the
 * room's name and a way out, the stream's destinations when he's at its foot, and on phones a thumb stick.
 */

const shortName = (room: RoomId) => ROOMS[room].name.replace(/^The /, "");
const MOVE_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
/** A press that moves less than this, and lets go quickly, is a tap (walk there), not a look. */
const TAP_PX = 8;
const TAP_MS = 350;

const NOTES: Record<Exclude<EyesNote, null>, string> = {
  edge: "That's the edge, and a long way down to the mirror. Rooms only meet by the light stream at the back.",
  gate: "",
  "tap-far": "Too far for small legs. Tap somewhere on this floor.",
};

const coarse = () =>
  typeof matchMedia === "function" && (matchMedia("(pointer: coarse)").matches || matchMedia("(max-width: 760px)").matches);

/** The keys, while his eyes are on: walk, turn, toddle faster, ride, leave. B goes in and out. */
function useEyesKeys() {
  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const eyes = useEyes.getState();
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        if (eyes.active) eyes.leave();
        else enterEyes();
        return;
      }
      if (!eyes.active) return;
      if (k === "escape") {
        e.preventDefault();
        eyes.leave();
        return;
      }
      if (k === "shift") eyesInput.run = true;
      if (MOVE_KEYS.has(k)) {
        e.preventDefault();
        eyesInput.keys.add(k);
      }
      // At the stream's foot: a room's number rides to it (the same numbers as the room keys outside).
      if (eyes.atGate && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const to = ROOM_IDS[Number(e.key) - 1];
        if (to && to !== eyes.room) eyes.ride(to);
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "shift") eyesInput.run = false;
      eyesInput.keys.delete(k);
    };
    const clear = () => {
      eyesInput.keys.clear();
      eyesInput.run = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);
}

/** The glass over the scene: drag to look, tap to walk there. */
function Glass({ touch }: { touch: boolean }) {
  const press = useRef<{ id: number; x: number; y: number; lastX: number; lastY: number; moved: number; at: number } | null>(null);
  const sens = touch ? 0.0065 : 0.0042;
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (press.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: 0, at: performance.now() };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);
    // A mouse turns his head the way it moves, as in any game; a finger drags the world round, as on any map.
    const dir = touch ? -1 : 1;
    eyesInput.look.yaw -= dx * sens * dir;
    eyesInput.look.pitch -= dy * sens * dir;
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.moved < TAP_PX && performance.now() - p.at < TAP_MS) {
      const r = e.currentTarget.getBoundingClientRect();
      eyesTap.at?.(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    }
  };
  return (
    <div
      className="eyes__glass"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => (press.current = null)}
      onContextMenu={(e) => e.preventDefault()}
      data-eyes="glass"
    />
  );
}

/** The thumb stick, bottom left on phones. Pushed all the way, he toddles faster. */
function Stick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const id = useRef<number | null>(null);
  const set = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = base.current!.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (e.clientX - (r.left + radius)) / radius;
    let y = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    eyesInput.stick.x = x;
    eyesInput.stick.y = -y;
    setKnob([x, y]);
  };
  const end = () => {
    id.current = null;
    eyesInput.stick.x = eyesInput.stick.y = 0;
    setKnob([0, 0]);
  };
  useEffect(() => end, []);
  return (
    <div
      ref={base}
      className="eyes__stick"
      aria-label="Walk"
      data-eyes="stick"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        id.current = e.pointerId;
        set(e);
      }}
      onPointerMove={(e) => id.current === e.pointerId && set(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <i style={{ transform: `translate(${knob[0] * 34}px, ${knob[1] * 34}px)` }} />
    </div>
  );
}

/** The stream's foot: where it can take him. */
function GatePanel({ room }: { room: RoomId }) {
  const ride = useEyes((s) => s.ride);
  return (
    <section className="eyes__gate" aria-label="Ride the light stream" data-eyes="gate">
      <p className="eyebrow">The light stream · ride it to</p>
      <div className="eyes__rooms">
        {ROOM_IDS.map((id, i) =>
          id === room ? null : (
            <button key={id} className="smoky" onClick={() => ride(id)} data-room={id}>
              <span className="eyes__key">{i + 1}</span> {shortName(id)}
            </button>
          ),
        )}
      </div>
    </section>
  );
}

export function EyesHud() {
  useEyesKeys();
  const active = useEyes((s) => s.active);
  const room = useEyes((s) => s.room);
  const atGate = useEyes((s) => s.atGate);
  const riding = useEyes((s) => s.riding);
  const note = useEyes((s) => s.note);
  const leave = useEyes((s) => s.leave);
  const [touch, setTouch] = useState(coarse);

  useEffect(() => {
    const on = () => setTouch(coarse());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => useEyes.setState({ note: null }), 3600);
    return () => clearTimeout(t);
  }, [note]);

  if (!active || !room) return null;
  return (
    <div className="eyes" data-eyes="on">
      <Glass touch={touch} />
      <header className="eyes__bar">
        <div>
          <p className="eyebrow">Brogu's eyes</p>
          <h2 className="eyes__room">{riding ? `To ${shortName(riding)}` : ROOMS[room].name}</h2>
        </div>
        <button className="smoky eyes__leave" onClick={leave} data-eyes="leave">
          Leave{touch ? "" : " · Esc"}
        </button>
      </header>
      <i className="eyes__reticle" aria-hidden="true" />
      {riding ? (
        <p className="eyes__note" role="status">
          Riding the light stream to {ROOMS[riding].name}. Arms and ears inside.
        </p>
      ) : atGate ? (
        <GatePanel room={room} />
      ) : (
        note && note !== "gate" && (
          <p className="eyes__note" role="status">
            {NOTES[note]}
          </p>
        )
      )}
      <p className="eyes__hint tracked faint">
        {touch
          ? "Stick walks · drag to look · tap the floor to toddle there · the ring of light at the back rides to other rooms"
          : "WASD walk · Q E turn · Shift toddles faster · drag to look · click the floor to toddle there · the ring of light at the back rides to other rooms"}
      </p>
      {touch && !riding && <Stick />}
    </div>
  );
}
