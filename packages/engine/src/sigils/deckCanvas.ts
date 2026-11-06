import { useEffect, type RefObject } from "react";
import { reducedMotion } from "./wvCanvas.ts";

/**
 * The loop under a room's console (#932): the 2D canvas a room draws its own look on, behind what sits under its 3D
 * hero (the Foundry's gold wire and rising runes, #922, was the first). The room hands in what to draw; this keeps the
 * rules every one of them follows: sized to the canvas's box at up to 1.5x, drawn only while on screen and the tab is
 * visible, 30 frames a second, and under reduced motion drawn once and held still. Plain canvas, no three.js, so it
 * costs a page nothing to load.
 */

export interface DeckFrame {
  c: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Seconds since the first frame, and since the last. */
  t: number;
  dt: number;
  /** True on the first frame after a resize: a room re-seeds what depends on the size. */
  sized: boolean;
  phone: boolean;
}

/** The glyphs the nanites are drawn from (undone.ts SIGIL_GLYPHS, kept here so the page needn't load three.js). */
export const DECK_GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴"];
export const DECK_FONT = `"Noto Sans Runic","Geist Mono Variable",monospace`;

export function useDeckCanvas(ref: RefObject<HTMLCanvasElement | null>, draw: (f: DeckFrame) => void) {
  useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    const reduce = reducedMotion();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let sized = true;
    let T = 0;
    const frame = (dt: number) => {
      T += dt;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      draw({ c, w, h, t: T, dt, sized, phone: w < 760 });
      sized = false;
    };
    const size = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      sized = true;
    };
    size();
    frame(0);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => (size(), frame(0))) : null;
    ro?.observe(cv);
    if (reduce) return () => ro?.disconnect();
    let on = true;
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((en) => (on = en[en.length - 1]!.isIntersecting)) : null;
    io?.observe(cv);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!on || document.visibilityState === "hidden") {
        last = now;
        return;
      }
      if (now - last < 1000 / 30 - 2) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      frame(dt);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
    };
    // The room's draw is fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
