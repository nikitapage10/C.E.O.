import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./viz.tsx";

/**
 * A split-flap readout (#387) for the Exchange's moving figures: a fixed row of cells, each one turning through the
 * characters between what it showed and what it shows now, left to right, when the figure changes. The cells are
 * decoration over the plain value (screen readers get `text` once); with reduced motion they simply show it.
 */

/** The order a cell turns through, like the drum of a real flap: blank, digits, then the signs. */
const DRUM = " 0123456789%+−.▲▼·¢$";
/** At most this many intermediate flaps per cell, so a turnover stays under half a second. */
const MAX_STEPS = 6;
const STEP_MS = 46;
const STAGGER_MS = 38;

/** The characters a cell passes through going from `a` to `b` (both ends included). */
export function flapPath(a: string, b: string): string[] {
  if (a === b) return [b];
  const i = DRUM.indexOf(a);
  const j = DRUM.indexOf(b);
  if (i < 0 || j < 0) return [a, b];
  const out: string[] = [a];
  let k = i;
  while (k !== j && out.length < MAX_STEPS) {
    k = (k + 1) % DRUM.length;
    out.push(DRUM[k]!);
  }
  if (out[out.length - 1] !== b) out.push(b);
  return out;
}

/** Right-aligns `text` in `n` cells (a longer text keeps every character). */
export const padCells = (text: string, n: number) => Array.from(text.length >= n ? text : " ".repeat(n - text.length) + text);

export function Flap({ text, cells, className = "" }: { text: string; cells?: number; className?: string }) {
  const target = padCells(text, cells ?? text.length);
  const reduced = useReducedMotion();
  // First showing turns in from blank cells, the way a board wakes; with reduced motion it just shows.
  const [shown, setShown] = useState<string[]>(() => (reduced ? target : target.map(() => " ")));
  const [turn, setTurn] = useState<number[]>(() => target.map(() => 0));
  const prev = useRef<string[]>(reduced ? target : target.map(() => " "));
  const key = target.join("");

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (reduced || from.join("") === key) {
      setShown(target);
      return;
    }
    const paths = target.map((ch, i) => flapPath(from[i] ?? " ", ch));
    const timers: number[] = [];
    paths.forEach((p, i) => {
      p.slice(1).forEach((ch, s) => {
        timers.push(
          window.setTimeout(
            () => {
              setShown((cur) => {
                const next = cur.length === target.length ? [...cur] : [...target];
                next[i] = ch;
                return next;
              });
              setTurn((cur) => {
                const next = cur.length === target.length ? [...cur] : target.map(() => 0);
                next[i] = (next[i] ?? 0) + 1;
                return next;
              });
            },
            i * STAGGER_MS + (s + 1) * STEP_MS,
          ),
        );
      });
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
    // `key` is the target's identity; `target` itself is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);

  const cellsNow = shown.length === target.length ? shown : target;
  return (
    <span className={`xc-flaps ${className}`.trim()}>
      <span className="wv-sr">{text}</span>
      <span className="xc-flaps-row" aria-hidden="true">
        {cellsNow.map((ch, i) => (
          <span key={i} className={`xc-flap${ch === " " ? " is-blank" : ""}`}>
            <span key={turn[i] ?? 0} className="xc-flap-ch">
              {ch === " " ? " " : ch}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
