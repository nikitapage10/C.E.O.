import { useEffect, useRef } from "react";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useRoomShown } from "@ceo/engine/web/roomReady.ts";
import { createField } from "./field.ts";

/** At most this many frames a second: the field drifts slowly, so 24 is plenty. */
const FPS = 24;

/**
 * Relay's background field (#950, ./field.ts): a fixed canvas behind the whole page. It runs only while Relay is on
 * screen (kept mounted out of sight since #934, it stays still), the tab is visible and the page itself is in view;
 * reduced motion draws one still frame. Nothing in it knows who or what: it is decoration only.
 */
export function RelayField() {
  const cv = useRef<HTMLCanvasElement>(null);
  const shown = useRoomShown();

  useEffect(() => {
    const el = cv.current;
    if (!el || !shown) return;
    const phone = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;
    const field = createField(el, { phone });
    if (!field) return;
    const still = reducedMotion();
    let raf = 0;
    let last = 0;
    let inView = true;
    const t0 = performance.now();
    const size = () => {
      field.resize(window.innerWidth, window.innerHeight, Math.min(phone ? 1.5 : 2, window.devicePixelRatio || 1));
      field.frame(still ? 12 : (performance.now() - t0) / 1000);
    };
    const tick = (now: number) => {
      raf = 0;
      if (document.visibilityState === "hidden" || !inView) return;
      if (now - last >= 1000 / FPS - 2) {
        last = now;
        field.frame((now - t0) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!still && !raf && document.visibilityState !== "hidden" && inView) raf = requestAnimationFrame(tick);
    };
    size();
    // The page's own box: scrolled away (the Codex below fills the screen), the field rests.
    const page = el.closest(".cx");
    const io = page && typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((list) => {
      inView = list.some((e) => e.isIntersecting);
      wake();
    }) : null;
    if (page) io?.observe(page.querySelector(".cx-stage") ?? page);
    window.addEventListener("resize", size);
    document.addEventListener("visibilitychange", wake);
    wake();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [shown]);

  return <canvas ref={cv} className="cx-field" aria-hidden="true" />;
}
