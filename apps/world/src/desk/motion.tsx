import { useEffect, useState } from "react";

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
