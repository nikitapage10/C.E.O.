import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useRoomShown } from "@ceo/engine/web/roomReady.ts";
import { useEmail } from "../data/email.ts";
import { useTexts } from "../data/texts.ts";
import type { Mast } from "./mast.ts";

/**
 * Relay's mast (#933): a very faint relay tower far behind the Thread (mast.ts, lazy loaded with three.js once the page
 * is on screen and idle, so it never slows the first paint, nor the Desk's while Relay is kept out of sight, #934). It
 * pulses only when the page's own counts rise: texts owed or unread, mail that needs Nikita. Counts only, never who or
 * what. Without WebGL there is simply no mast.
 */

type GL = "idle" | "loading" | "on" | "off";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;

/** What is waiting, as one count (null until a line has reported). */
function useWaitingCount(): number | null {
  const texts = useTexts((s) => (s.status && s.status.hub !== "off" && s.status.hub !== "wiped" ? s.status.owed + (s.status.unread ?? 0) : null));
  const mail = useEmail((s) => (s.status && s.status.gmail === "connected" ? s.status.needsYou : null));
  return texts === null && mail === null ? null : (texts ?? 0) + (mail ?? 0);
}

export function RelayMast() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Mast | null>(null);
  const [gl, setGl] = useState<GL>("idle");
  const count = useWaitingCount();
  const seen = useRef<number | null>(null);
  // Kept mounted out of sight (#934), Relay loads no mast until it is first shown; hidden, the scene's observer pauses it.
  const onScreen = useRoomShown();
  const [wanted, setWanted] = useState(onScreen);
  if (onScreen && !wanted) setWanted(true);

  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!wanted || !cv || !el) return;
    let dead = false;
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./mast.ts")
        .then((m) => {
          if (!m.canDraw3D()) throw new Error("no WebGL");
          return m.createMast(el, cv, { phone: isPhone(), reduce: reducedMotion() });
        })
        .then((s) => {
          if (dead) return s.dispose();
          scene.current = s;
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const viaIdle = typeof w.requestIdleCallback === "function";
    const idle = viaIdle ? w.requestIdleCallback!(start, { timeout: 1500 }) : window.setTimeout(start, 400);
    return () => {
      dead = true;
      if (viaIdle) w.cancelIdleCallback?.(idle);
      else window.clearTimeout(idle);
      scene.current?.dispose();
      scene.current = null;
    };
  }, [wanted]);

  // A pulse when the count rises past what this page has already seen (not on the first read, not when it falls).
  useEffect(() => {
    if (count === null) return;
    if (seen.current !== null && count > seen.current) scene.current?.pulse();
    seen.current = count;
  }, [count]);

  return (
    <div ref={host} className="cx-mast" data-gl={gl} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
