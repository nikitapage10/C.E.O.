import { createContext, useCallback, useContext, useLayoutEffect, useRef } from "react";

/**
 * When a room is ready (#752): the room loader (RoomLoader.tsx) covers a page until its chunk has loaded and every
 * gate the page opened is open, then lets the first frame draw and fades away. A room opens a gate with one line:
 *
 *   useRoomReady(status !== "idle");          // ready once its first data is in
 *   const ready = useRoomReady(false);        // or by hand, e.g. from a scene's first frame: ready()
 *
 * A page that opens no gate is ready as soon as its code has mounted. A gate that never opens is let go after the
 * loader's cap (CAP_MS), so nothing hangs. Gates opened after the loader has gone change nothing.
 */

/** The most a page is covered, from the moment it is opened. */
export const CAP_MS = 4000;

export class ReadyGate {
  private gates = new Map<number, boolean>();
  private next = 0;
  private mounted = false;
  private done = false;
  constructor(private readonly onReady: () => void) {}

  /** A new gate, closed. */
  add(): number {
    const id = ++this.next;
    if (!this.done) this.gates.set(id, false);
    return id;
  }

  set(id: number, open: boolean) {
    if (!this.gates.has(id)) return;
    this.gates.set(id, open);
    this.check();
  }

  /** The page's code has mounted: every gate its first render opens has been counted. */
  mount() {
    this.mounted = true;
    this.check();
  }

  get ready() {
    return this.done;
  }

  private check() {
    if (this.done || !this.mounted) return;
    for (const open of this.gates.values()) if (!open) return;
    this.done = true;
    this.onReady();
  }
}

export const RoomReadyContext = createContext<ReadyGate | null>(null);

/**
 * Hold the room loader until `ready` is true. Returns a function that opens the gate by hand (for a callback, such as
 * a scene's first frame); once opened that way it stays open. Outside a room loader it does nothing.
 */
export function useRoomReady(ready = true): () => void {
  const gate = useContext(RoomReadyContext);
  const id = useRef(0);
  const forced = useRef(false);
  // Counted in a layout effect, so the gate exists before the loader's own mount check (RoomMounted) runs. Kept for
  // the page's life: dropping it on cleanup would read as "ready" in StrictMode's second pass.
  useLayoutEffect(() => {
    if (!gate) return;
    if (!id.current) id.current = gate.add();
    gate.set(id.current, ready || forced.current);
  }, [gate, ready]);
  return useCallback(() => {
    forced.current = true;
    if (gate && id.current) gate.set(id.current, true);
  }, [gate]);
}

/**
 * Give the main thread back for a moment (#784), between the slices of a long build (a scene's textures, a big parse),
 * so input and frames get a turn. `scheduler.yield()` where the browser has it, which resumes ahead of other work;
 * otherwise a macrotask.
 */
export function yieldNow(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return typeof s?.yield === "function" ? s.yield() : new Promise((r) => setTimeout(r, 0));
}

/** Placed after the page inside its Suspense: it mounts once the page's chunk has loaded and rendered. */
export function RoomMounted(): null {
  const gate = useContext(RoomReadyContext);
  useLayoutEffect(() => gate?.mount(), [gate]);
  return null;
}
