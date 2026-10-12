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
  /** Rebuilt three times in half a minute: stop trying and show the error instead. */
  stuck: string | null;
  rebuild: (why: string) => void;
}

const recentRebuilds: number[] = [];

/** Keep the last failure where a reload can still find it. */
export function rememberCrash(text: string) {
  try {
    localStorage.setItem(
      "ceo.lastCrash",
      JSON.stringify({ text, at: new Date().toISOString() }),
    );
  } catch {
    // Private window: the panel still shows it.
  }
}

export const useGuard = create<GuardStore>((set, get) => ({
  generation: 0,
  note: null,
  stuck: null,
  rebuild: (why) => {
    if (get().stuck) return;
    console.error(`[lattice] rebuilding the scene: ${why}`);
    rememberCrash(why);
    const api = ((
      window as unknown as { __ceo?: Record<string, unknown> }
    ).__ceo ??= {});
    api.lastFailure = why;
    const now = performance.now();
    while (recentRebuilds.length && now - recentRebuilds[0]! > 30_000)
      recentRebuilds.shift();
    recentRebuilds.push(now);
    if (recentRebuilds.length >= 3) set({ stuck: why });
    else
      set({
        generation: get().generation + 1,
        note: { text: why, at: Date.now() },
      });
  },
}));

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    const msg = describe(error);
    // Rebuild on the next tick, so React finishes unwinding first.
    setTimeout(() => useGuard.getState().rebuild(msg), 0);
    console.error(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** An error's message and the first few lines of where it came from. */
export function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const where = (error.stack ?? "")
    .split("\n")
    .filter((l) => l.trim().startsWith("at "))
    .slice(0, 4)
    .map((l) => l.trim());
  return [error.message, ...where].join("\n");
}

/** Wraps the canvas: a fresh one (new key) after any crash. */
export function SceneGuard({ children }: { children: ReactNode }) {
  const generation = useGuard((s) => s.generation);
  const stuck = useGuard((s) => s.stuck);
  if (stuck) return <CrashPanel text={stuck} />;
  return <Boundary key={generation}>{children}</Boundary>;
}

/** What's left on screen when the Lattice can't recover: the error, readable and copyable, and a way back. */
export function CrashPanel({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="crash-panel" role="alert">
      <div className="crash-panel__title tracked">The Lattice fell over</div>
      <p>Send this to Claude and it can be fixed:</p>
      <pre>{text}</pre>
      <div className="crash-panel__buttons">
        <button
          className="smoky"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="smoky" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

/** Around the whole Lattice: anything that breaks outside the canvas shows the panel, not a black page. */
export class AppGuard extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: describe(error) };
  }
  componentDidCatch(error: unknown) {
    rememberCrash(describe(error));
    console.error(error);
  }
  render() {
    return this.state.error ? (
      <CrashPanel text={this.state.error} />
    ) : (
      this.props.children
    );
  }
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
    timer = setTimeout(
      () =>
        current() &&
        useGuard.getState().rebuild("the graphics context was lost"),
      2500,
    );
  });
  canvas.addEventListener("webglcontextrestored", () => {
    clearTimeout(timer);
    if (current())
      useGuard
        .getState()
        .rebuild("the graphics context was lost and came back");
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
      The Lattice blinked and rebuilt itself · {note.text.split("\n")[0]}
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
      useGuard.getState().rebuild(e.error ? describe(e.error) : e.message || "the scene stopped drawing");
    }
  };
  window.addEventListener("error", onError);
  return () => window.removeEventListener("error", onError);
}
