/**
 * One speech recognition at a time across the Desk (#1094). On a phone the browser gives the microphone to one
 * recognition only, and an old one that was never let go (a mic tapped on one page, then the page changed, or a
 * stop whose end arrived after the next start) kept it: the next press started a recognition that heard nothing.
 *
 * So every recognition is claimed when it starts, which ends whichever other one still holds the mic, and ended
 * through here, which waits for the browser's own end (or END_WAIT_MS at most) before the next one may start.
 *
 * Pure apart from the timers; the tests drive it with fakes.
 */

/** The slice of a recognition the gate needs. */
export interface Held {
  onend: (() => void) | null;
  stop(): void;
  abort(): void;
}

/** The longest the next recognition waits for the last one's end. */
export const END_WAIT_MS = 900;

let live: Held | null = null;
let ending = 0;
let ended: Promise<void> = Promise.resolve();

/** Ends a recognition (stop keeps its last words; abort drops them) and resolves once the browser says it's over. */
export function letGo(r: Held, how: "stop" | "abort" = "abort"): Promise<void> {
  if (live === r) live = null;
  const before = r.onend;
  ending++;
  const over = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ending--;
      resolve();
    };
    const t = setTimeout(finish, END_WAIT_MS);
    r.onend = () => {
      clearTimeout(t);
      try {
        before?.();
      } finally {
        finish();
      }
    };
  });
  try {
    if (how === "stop") r.stop();
    else r.abort();
  } catch {
    /* already over */
  }
  ended = Promise.all([ended, over]).then(() => undefined);
  return over;
}

/** A recognition is starting: any other one still holding the mic is let go first. */
export function claim(r: Held): void {
  if (live && live !== r) void letGo(live);
  live = r;
}

/** A recognition ended on its own: it no longer holds the mic. */
export function released(r: Held): void {
  if (live === r) live = null;
}

/** Whether a recognition is still winding down (the next start should wait for `micFree`). */
export const micBusy = (): boolean => ending > 0;

/** Resolves once every recognition let go has ended. */
export const micFree = (): Promise<void> => ended;

/** For tests: forget everything. */
export function resetMicGate(): void {
  live = null;
  ending = 0;
  ended = Promise.resolve();
}
