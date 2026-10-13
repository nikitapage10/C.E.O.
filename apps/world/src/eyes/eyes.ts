import { ROOM_IDS, type RoomId, type Route } from "@ceo/core";
import { create } from "zustand";
import { useCast } from "../cast/castStore.ts";
import { release } from "../scene/streaming.ts";
import { useWorld } from "../store.ts";
import { entryPoint, roomInView, type Pose } from "./walk.ts";

/**
 * Brogu's eyes (#47): Nikita takes the little guy and walks him round the Lattice in first person. This is the mode's
 * state. React reads the store (is it on, which room, is he at the stream); the per-frame things (where he is,
 * where he's looking, which keys are down) live in plain objects, written every frame without re-rendering.
 */

/** What the HUD says under the crosshair, for a moment. */
export type EyesNote = "edge" | "gate" | "tap-far" | null;

interface EyesStore {
  active: boolean;
  /** The room he's in (or riding the stream toward). */
  room: RoomId | null;
  /** At the foot of the light stream, where he can ride it to another room. */
  atGate: boolean;
  /** Riding the stream to this room. */
  riding: RoomId | null;
  note: EyesNote;
  enter: (room: RoomId) => void;
  leave: () => void;
  ride: (to: RoomId) => void;
}

/** Where he is, in his room's local frame, and where he's looking. */
export const brogu: Pose & {
  pitch: number;
  /** Seconds walked, for the head bob. */
  phase: number;
  /** Metres a second right now. */
  speed: number;
  /** Tap-to-walk: the spot he's heading for, local. */
  target: [number, number] | null;
  /** The stream ride under way, and when it started (performance.now). */
  route: Route | null;
  routeStart: number;
} = { x: 0, z: 0, yaw: 0, pitch: 0, phase: 0, speed: 0, target: null, route: null, routeStart: 0 };

/** What the controls are asking for: keys, the on-screen stick, and look drags not yet applied. */
export const eyesInput = {
  keys: new Set<string>(),
  /** The stick, -1..1 on each axis (x right, y ahead). */
  stick: { x: 0, y: 0 },
  look: { yaw: 0, pitch: 0 },
  run: false,
};

/** Set from inside the canvas: turns a tap on screen (normalised device coordinates) into a spot to walk to. */
export const eyesTap: { at: ((x: number, y: number) => void) | null } = { at: null };

/** Set from inside the canvas: where the camera is, to tell which room the overview is looking at. */
export const eyesView: { camera: (() => [number, number]) | null } = { camera: null };

/**
 * Into Brogu's eyes, in the room Nikita is looking at: the room in focus, or from the overview, the room nearest
 * the camera. He doesn't walk over from wherever he was; he's simply there.
 */
export function enterEyes() {
  const focus = useWorld.getState().focus;
  const cam = eyesView.camera?.();
  useEyes.getState().enter(focus ?? (cam ? roomInView(cam[0], cam[1]) : ROOM_IDS[0]));
}

export const useEyes = create<EyesStore>((set, get) => ({
  active: false,
  room: null,
  atGate: false,
  riding: null,
  note: null,
  enter: (room) => {
    // Every room's models and pets may be needed now: he can walk anywhere (scene/streaming.ts).
    release();
    const start = entryPoint(room);
    Object.assign(brogu, start, { pitch: 0.06, phase: 0, speed: 0, target: null, route: null });
    eyesInput.keys.clear();
    eyesInput.stick.x = eyesInput.stick.y = 0;
    const world = useWorld.getState();
    if (useCast.getState().studio) useCast.getState().openStudio(null);
    if (world.selectedAgent) world.selectAgent(null);
    if (world.focus !== room) world.setFocus(room);
    set({ active: true, room, atGate: false, riding: null, note: null });
  },
  leave: () => {
    if (!get().active) return;
    brogu.route = null;
    brogu.target = null;
    set({ active: false, atGate: false, riding: null, note: null });
  },
  ride: (to) => {
    const { room, riding, active } = get();
    if (!active || !room || riding || to === room) return;
    set({ riding: to, atGate: false, note: null });
  },
}));
