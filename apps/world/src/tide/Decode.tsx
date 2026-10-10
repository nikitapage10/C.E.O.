import { useEffect, useMemo, useState } from "react";
import { GLYPH_ASPECT } from "./alphabet.ts";

/**
 * The Tide's script and its Decode effect, ported from The Tide (src/components/glyphs) so the Lattice speaks
 * the same visual language: a label arrives as glyph pairs in the Tide's script, holds a beat, then each glyph
 * resolves into its English letter, in a different order. Screen readers get the English; reduced motion
 * shows it at once. Glyph images live in /public/tide/glyphs (copied from The Tide's brand assets).
 */

const GAP = 0.08;
const ROLL = 4;
const HOLD = 8;

export function hasGlyph(ch: string) {
  return /^[A-Za-z0-9]$/.test(ch);
}

function Mask({ name, aspect }: { name: string; aspect: number }) {
  const url = `url(${import.meta.env.BASE_URL}tide/glyphs/${name}.webp)`;
  return (
    <span
      style={{
        display: "block",
        height: "100%",
        aspectRatio: String(aspect),
        backgroundColor: "currentColor",
        maskImage: url,
        WebkitMaskImage: url,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}

/** One character in the script: its geometric glyph followed by its flowing glyph. */
export function TideGlyph({ ch, className }: { ch: string; className?: string }) {
  const k = ch.toLowerCase();
  const a = GLYPH_ASPECT[`${k}-a`] ?? 0.5;
  const b = GLYPH_ASPECT[`${k}-b`] ?? 0.5;
  const pair = a + b + GAP;
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "flex",
        gap: `calc(var(--glyph-h, 1.3em) * ${GAP})`,
        height: `min(var(--glyph-h, 1.3em), calc(var(--glyph-w, 1.25em) / ${pair.toFixed(3)}))`,
      }}
    >
      <Mask name={`${k}-a`} aspect={a} />
      <Mask name={`${k}-b`} aspect={b} />
    </span>
  );
}

/** A whole word or line written in the script (no decoding), e.g. for the coordinate box. */
export function TideScript({ text }: { text: string }) {
  return (
    <span className="tide-script" aria-label={text}>
      {[...text].map((ch, i) => (hasGlyph(ch) ? <TideGlyph key={i} ch={ch} /> : <span key={i}>{ch === " " ? " " : ch}</span>))}
    </span>
  );
}

const rnd = (n: number, k: number) => (((n * 2654435761) ^ (k * 2246822519)) >>> 0) / 4294967296;
function rankBy(n: number, key: (i: number) => number) {
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => key(a) - key(b));
  const rank = new Array<number>(n);
  idx.forEach((i, r) => (rank[i] = r));
  return rank;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Decodes `text` every time it changes. */
export function Decode({ text, tick = 28, delay = 0 }: { text: string; tick?: number; delay?: number }) {
  const n = text.length;
  const total = n * 2 + ROLL + HOLD;
  const [step, setStep] = useState(reduced() ? total : -1);
  useEffect(() => {
    if (reduced()) return;
    // Driven by a timer, not animation frames: when the 3D scene is busy, rAF can starve and leave a title
    // half-decoded. A final timeout guarantees it always lands on readable English.
    let timer = 0;
    const t0 = performance.now() + delay;
    const tickFn = () => {
      const s = Math.min(total, Math.floor((performance.now() - t0) / tick));
      setStep(s < 0 ? -1 : s);
      if (s < total) timer = window.setTimeout(tickFn, tick);
    };
    timer = window.setTimeout(tickFn, delay);
    const done = window.setTimeout(() => setStep(total), delay + total * tick + 400);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(done);
      setStep(-1);
    };
  }, [text, tick, delay, total]);

  const { arrive, settle } = useMemo(
    () => ({ arrive: rankBy(n, (i) => rnd(i + 1, n * 7 + 1)), settle: rankBy(n, (i) => rnd(i + 1, n * 13 + 5)) }),
    [n],
  );

  return (
    <span className="decode">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {[...text].map((ch, i) => {
          const typed = step >= arrive[i]! + 1;
          const done = step >= n + ROLL + HOLD + settle[i]!;
          if (!hasGlyph(ch)) return <span key={i} className={typed ? "" : "decode-hidden"}>{ch}</span>;
          return (
            <span key={i} className="decode-cell">
              <span className={`decode-letter ${done ? "decode-on" : ""}`}>{ch}</span>
              {typed && !done && <TideGlyph ch={ch} className="decode-glyph" />}
            </span>
          );
        })}
      </span>
    </span>
  );
}
