import { useCallback, useEffect, useRef, type RefObject } from "react";
import { springAt, SPRING_MS, stepFrom, stopsOf, swipeSteps, WheelGate, wheelPx } from "../data/snap.ts";

/**
 * The codex's snapping (#1161, Nikita: "as I initiate the scroll, it kind of bounces into place for the next text or
 * email"). Display only. One wheel, trackpad or touch gesture moves to the next or previous entry and settles there on
 * a short spring with a slight overshoot (../data/snap.ts); free drifting between entries is gone. A long trackpad
 * fling still advances one entry (a few for a big one). Under reduced motion it is a plain snap, no bounce. The line
 * (`also`) hands its wheel to the same gate. A gesture that can't go further, or that belongs to something inside
 * that can scroll (a text box), is left to the browser. Returns `to(top)`, the spring for keys and taps on the line.
 */
export function useSnapScroll(pagesRef: RefObject<HTMLElement | null>, also: RefObject<HTMLElement | null>, lineOn = false) {
  const anim = useRef<{ from: number; to: number; t0: number; raf: number; set: number } | null>(null);
  const gate = useRef(new WheelGate());

  const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stop = useCallback(() => {
    if (anim.current) cancelAnimationFrame(anim.current.raf);
    anim.current = null;
  }, []);

  /** Springs the codex to `top` (a plain snap when motion is reduced). */
  const to = useCallback(
    (top: number) => {
      const root = pagesRef.current;
      if (!root) return;
      stop();
      const max = root.scrollHeight - root.clientHeight;
      const dest = Math.max(0, Math.min(max, top));
      const from = root.scrollTop;
      if (calm() || Math.abs(dest - from) < 1 || typeof requestAnimationFrame === "undefined") {
        root.scrollTo({ top: dest, behavior: "instant" });
        return;
      }
      const a = { from, to: dest, t0: performance.now(), raf: 0, set: from };
      anim.current = a;
      const tick = (now: number) => {
        if (anim.current !== a) return;
        // Something else moved the codex (a drag on the scrollbar, a jump): let go.
        if (Math.abs(root.scrollTop - a.set) > 2) return void (anim.current = null);
        const t = now - a.t0;
        const y = springAt(a.from, a.to, t);
        root.scrollTop = y;
        a.set = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, y));
        if (t >= SPRING_MS) {
          root.scrollTop = a.to;
          anim.current = null;
          return;
        }
        a.raf = requestAnimationFrame(tick);
      };
      a.raf = requestAnimationFrame(tick);
    },
    [pagesRef, stop],
  );

  useEffect(() => {
    const root = pagesRef.current;
    if (!root) return;
    const stops = () => {
      const tops = [...root.querySelectorAll<HTMLElement>(".cx-entry[data-key]")].map((e) => e.offsetTop);
      return stopsOf(tops, root.clientHeight, root.scrollHeight - root.clientHeight);
    };
    /** Moves `steps` from where it is going (the spring's target while one runs). Returns false when there is nowhere to go. */
    const step = (steps: number): boolean => {
      const s = stops();
      const at = anim.current?.to ?? root.scrollTop;
      const dest = stepFrom(s, at, steps);
      if (Math.abs(dest - at) < 1) return false;
      to(dest);
      return true;
    };
    /** Whether something inside can take this scroll itself (a text box, a list). */
    const inner = (target: EventTarget | null, dir: number) => {
      for (let el = target instanceof HTMLElement ? target : null; el && el !== root; el = el.parentElement) {
        if (el.tagName === "TEXTAREA" || el.isContentEditable) {
          if (el.scrollHeight > el.clientHeight + 1) return true;
          continue;
        }
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
          if (dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
        }
      }
      return false;
    };

    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const dy = wheelPx(e.deltaY, e.deltaMode, root.clientHeight);
      if (!dy || inner(e.target, dy)) return;
      const n = gate.current.feed(performance.now(), dy);
      if (n) {
        // Nowhere to go (the first or last stop): the page beside it may take the scroll.
        if (!step(n)) {
          gate.current.reset();
          return;
        }
      } else if (!gate.current.busy) {
        const s = stops();
        const at = anim.current?.to ?? root.scrollTop;
        if (Math.abs(stepFrom(s, at, Math.sign(dy)) - at) < 1) return;
      }
      e.preventDefault();
    };

    let touch: { y: number; t: number; mine: boolean | null; target: EventTarget | null } | null = null;
    const start = (e: TouchEvent) => {
      const p = e.touches[0];
      touch = e.touches.length === 1 && p ? { y: p.clientY, t: performance.now(), mine: null, target: e.target } : null;
    };
    const move = (e: TouchEvent) => {
      const p = e.touches[0];
      if (!touch || !p) return;
      const dy = p.clientY - touch.y;
      if (touch.mine === null && Math.abs(dy) > 6) {
        const dir = dy < 0 ? 1 : -1;
        const s = stops();
        const at = anim.current?.to ?? root.scrollTop;
        touch.mine = !inner(touch.target, dir) && Math.abs(stepFrom(s, at, dir) - at) >= 1;
      }
      if (touch.mine && e.cancelable) e.preventDefault();
    };
    const end = (e: TouchEvent) => {
      const t = touch;
      touch = null;
      const p = e.changedTouches[0];
      if (!t || !t.mine || !p) return;
      const n = swipeSteps(p.clientY - t.y, performance.now() - t.t, root.clientHeight);
      if (n) step(n);
    };
    const drop = () => (touch = null);

    // Arrow keys and Page Up/Down on the codex itself take the same steps (J, K, W and S go through goTo).
    const key = (e: KeyboardEvent) => {
      if (e.target !== root || e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = e.key === "ArrowDown" || e.key === "PageDown" ? 1 : e.key === "ArrowUp" || e.key === "PageUp" ? -1 : 0;
      if (dir && step(dir)) e.preventDefault();
    };

    const ex = also.current;
    root.addEventListener("wheel", wheel, { passive: false });
    ex?.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    root.addEventListener("touchend", end, { passive: true });
    root.addEventListener("touchcancel", drop, { passive: true });
    root.addEventListener("keydown", key);
    return () => {
      root.removeEventListener("wheel", wheel);
      ex?.removeEventListener("wheel", wheel);
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", drop);
      root.removeEventListener("keydown", key);
      stop();
    };
  }, [pagesRef, also, lineOn, to, stop]);

  return to;
}
