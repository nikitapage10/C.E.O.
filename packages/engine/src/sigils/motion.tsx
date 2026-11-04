import { useEffect, useRef, useState } from "react";

/** The Desk's own small motion helpers, so it never reaches into the Lattice's code. */

export const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Date.now(), refreshed every `ms`. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const GLYPHS = "ΛΞΣΠΦΨΩ∆◇⌁⋄∴/\\<>+=~#";

/**
 * The Tide's script resolving into English: each letter flickers through glyphs, then settles, left to right.
 * Spaces stay put. With reduced motion it is just the text.
 */
export function useDecode(text: string, { delay = 0, speed = 34 }: { delay?: number; speed?: number } = {}): string {
  const [out, setOut] = useState(() => (reducedMotion() ? text : scramble(text, 0)));
  useEffect(() => {
    if (reducedMotion()) {
      setOut(text);
      return;
    }
    let frame = 0;
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (t: number) => {
      const settled = Math.max(0, Math.floor((t - start) / speed));
      frame++;
      if (settled >= text.length) {
        setOut(text);
        return;
      }
      if (frame % 2 === 0) setOut(scramble(text, settled));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, delay, speed]);
  return out;
}

function scramble(text: string, settled: number): string {
  let s = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    s += i < settled || c === " " || c === "·" ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
  }
  return s;
}

/** A title that decodes in. */
export function Decode({ text, delay, speed }: { text: string; delay?: number; speed?: number }) {
  const shown = useDecode(text, { delay, speed });
  return <>{shown}</>;
}

/** The Desk's daily opening (Nikita, 2026-10-22): the first open of the day plays it in full, later opens settle. */
const OPENING_KEY = "desk.opening";
let openingThisLoad: "first" | "settle" | null = null;
export function dailyOpening(now = Date.now()): "first" | "settle" {
  if (openingThisLoad) return "settle";
  const today = new Date(now).toDateString();
  let seen: string | null;
  try {
    seen = window.localStorage.getItem(OPENING_KEY);
    window.localStorage.setItem(OPENING_KEY, today);
  } catch {
    /* storage blocked: every open settles quickly */
    seen = today;
  }
  openingThisLoad = seen === today || reducedMotion() ? "settle" : "first";
  return openingThisLoad;
}

/** A number that eases up to its value (about 0.7 s); the value itself with reduced motion. */
export function CountUp({ value, ms = 700 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const from = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      setShown(Math.round(from + (value - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{shown}</>;
}

/** An element's width, kept current: for the SVG strips that draw at true size. */
export function useWidth<T extends HTMLElement>(fallback = 800): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
