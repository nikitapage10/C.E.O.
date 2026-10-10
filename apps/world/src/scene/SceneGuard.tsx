import { Component, type ReactNode, useEffect, useState } from "react";
import { create } from "zustand";

/**
 * Keeps the Lattice on screen when something in it breaks. A render error or a lost WebGL context used to
 * leave a dead canvas until reload; now the scene rebuilds itself and says what happened, briefly, so the
 * C.E.O. can tell us.
 */
interface GuardStore {
  /** Bumped to remount the whole canvas. */
  generation: number;
  /** What went wrong last, for the note on screen. */
  note: { text: string; at: number } | null;
  rebuild: (why: string) => void;
}

export const useGuard = create<GuardStore>((set, get) => ({
  generation: 0,
  note: null,
  rebuild: (why) => {
    console.error(`[lattice] rebuilding the scene: ${why}`);
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.lastFailure = why;
    set({ generation: get().generation + 1, note: { text: why, at: Date.now() } });
  },
}));

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    // Rebuild on the next tick, so React finishes unwinding first.
    setTimeout(() => useGuard.getState().rebuild(msg.split("\n")[0] ?? "render error"), 0);
    console.error(msg);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Wraps the canvas: a fresh one (new key) after any crash. */
export function SceneGuard({ children }: { children: ReactNode }) {
  const generation = useGuard((s) => s.generation);
  return <Boundary key={generation}>{children}</Boundary>;
}

/**
 * Watches the canvas for a lost GPU context (the browser drops it when memory runs short, or the driver
 * resets). If it isn't restored quickly, rebuild.
 */
export function watchContext(canvas: HTMLCanvasElement) {
  // A canvas that's been replaced loses its context on purpose when it's torn down; only the current one counts.
  const generation = useGuard.getState().generation;
  const current = () => useGuard.getState().generation === generation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  canvas.addEventListener("webglcontextlost", (e) => {
    if (!current()) return;
    e.preventDefault(); // Ask the browser to give it back.
    timer = setTimeout(() => current() && useGuard.getState().rebuild("the graphics context was lost"), 2500);
  });
  canvas.addEventListener("webglcontextrestored", () => {
    clearTimeout(timer);
    if (current()) useGuard.getState().rebuild("the graphics context was lost and came back");
  });
}

/** A small line over the stage while the scene rebuilds. */
export function GuardNote() {
  const note = useGuard((s) => s.note);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => tick((n) => n + 1), 8000);
    return () => clearTimeout(id);
  }, [note]);
  if (!note || Date.now() - note.at > 8000) return null;
  return (
    <div className="guard-note tracked" role="status">
      The Lattice blinked and rebuilt itself · {note.text}
    </div>
  );
}

/**
 * An error thrown every frame (inside the render loop, outside React) freezes the picture without unmounting
 * anything. Three of them in two seconds counts as a crash.
 */
export function watchLoopErrors() {
  let recent: number[] = [];
  const onError = (e: ErrorEvent) => {
    const now = performance.now();
    recent = [...recent.filter((t) => now - t < 2000), now];
    if (recent.length >= 3) {
      recent = [];
      useGuard.getState().rebuild(e.message || "the scene stopped drawing");
    }
  };
  window.addEventListener("error", onError);
  return () => window.removeEventListener("error", onError);
}
