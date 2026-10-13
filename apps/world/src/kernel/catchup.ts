import { create } from "zustand";

/**
 * "While you were away" (#54): the world step's summary, pinned on the Kernel's PA as one calm line with a Read
 * button until it is read. The world's own announcements show beside it rather than replacing it. Once read, the same
 * step's catch-up doesn't pin again (the last read step is remembered in this browser); Signals keeps the full text.
 */

export const CATCHUP_READ_KEY = "ceo.catchup.readStep";

export interface Catchup {
  step: number;
  text: string;
  /** Sim-clock time it arrived, for Signals. */
  ts: number;
  read: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

/** The last world step whose catch-up was read here, or null (never, or storage unavailable). */
export function lastReadStep(storage: Store | null = local()): number | null {
  try {
    const raw = storage?.getItem(CATCHUP_READ_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function rememberRead(step: number, storage: Store | null = local()): void {
  try {
    storage?.setItem(CATCHUP_READ_KEY, String(step));
  } catch {
    // Private windows and blocked storage: it pins again next time, which is harmless.
  }
}

/** Whether a step's catch-up still needs reading. */
export const needsReading = (step: number, lastRead: number | null): boolean => lastRead !== step;

interface CatchupStore {
  catchup: Catchup | null;
  /** Take on a step's catch-up: pinned unless that step was already read here. */
  arrive: (step: number, text: string, ts: number) => void;
  /** Tapped Read: unpin it and remember the step. */
  read: () => void;
}

export const useCatchup = create<CatchupStore>((set, get) => ({
  catchup: null,
  arrive: (step, text, ts) => set({ catchup: { step, text, ts, read: !needsReading(step, lastReadStep()) } }),
  read: () => {
    const c = get().catchup;
    if (!c || c.read) return;
    rememberRead(c.step);
    set({ catchup: { ...c, read: true } });
  },
}));

/** The catch-up to pin on the PA, if any. */
export const pinned = (c: Catchup | null): Catchup | null => (c && !c.read ? c : null);
