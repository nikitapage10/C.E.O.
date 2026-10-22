import { create } from "zustand";

/**
 * Hide, for showing the Desk to someone (Nikita, 2026-10-22 05:36Z): one toggle at the top right masks every personal
 * value (money, messages and the people in them, devices, the house) while the layout, the buttons and the shapes of
 * the charts stay, so the app can be shown without what's in it. The `.desk` root carries `data-hide` and CSS (wv.css,
 * "Hide") veils anything marked private: wrap a value in `<Private>`, or spread `usePrivate()` on an element whose
 * whole content is personal. Remembered per device in localStorage.
 */

export const HIDE_KEY = "desk.hide";

/** What this device last chose; off when nothing is stored or storage is blocked. */
export function readHide(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHide(on: boolean) {
  try {
    if (on) window.localStorage.setItem(HIDE_KEY, "1");
    else window.localStorage.removeItem(HIDE_KEY);
  } catch {
    /* storage blocked: the choice lasts this visit only */
  }
}

interface HideState {
  on: boolean;
  set: (on: boolean) => void;
  toggle: () => void;
}

export const useHide = create<HideState>((set, get) => ({
  on: typeof window === "undefined" ? false : readHide(),
  set: (on) => {
    writeHide(on);
    set({ on });
  },
  toggle: () => get().set(!get().on),
}));

/** What a screen reader hears in place of a hidden value. */
export const HIDDEN_LABEL = "hidden";

/**
 * The attributes that mark an element's whole content as private: the CSS veil, and while Hide is on, the real value
 * kept from screen readers. `block` blurs the element (charts, cards, pictures) instead of laying the thread veil over
 * its text.
 */
export function privateAttrs(on: boolean, block = false) {
  return {
    "data-private": block ? "block" : "",
    "aria-hidden": on ? (true as const) : undefined,
  };
}

/** `privateAttrs` for the current Hide state. */
export function usePrivate(block = false) {
  return privateAttrs(useHide((s) => s.on), block);
}

/** A label that names a person or holds a value: the plain words while hidden, the real ones otherwise. */
export function useMasked() {
  const on = useHide((s) => s.on);
  return (real: string, hidden = HIDDEN_LABEL) => (on ? hidden : real);
}
