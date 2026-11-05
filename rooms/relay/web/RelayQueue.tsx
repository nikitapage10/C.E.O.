import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import type { Exchange } from "../data/thread.ts";
import { ease, waveLook, waveRows, waveSpan, wavePoint, waveU, type Box, type WaveRow } from "../data/wave.ts";
import "./queue.css";

/**
 * Relay's queue on the wave (#803; Nikita, 2026-11-05: "that animation on the left side of the central line, so you
 * would be able to see what's coming up next"). Left of the line, the next exchanges ride a slow wave toward it, the
 * one in focus sitting on the line itself; a tap on one puts it in focus, as J and K do. On a phone the wave lies flat
 * above the entry and runs toward the line from the right. It replaces the rail (#765).
 *
 * Drawing only: the queue, the focus and goTo come from RelayThread, the geometry from ./wave.ts (RelayThread's sigil
 * field draws its glyphs along the same curve). Rows glide on requestAnimationFrame, writing transforms and opacity
 * straight to the DOM, so the wave never re-renders React. Reduced motion: no drift and no glide, the rows sit still
 * along the curve. Every name and line is wrapped in <Private> for Hide, and the wave exists only with the signed-in
 * queue.
 */

const media = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;

export function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => media(q));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener?.("change", f);
    return () => m.removeEventListener?.("change", f);
  }, [q]);
  return on;
}

/** Seconds on the clock the sigil field uses too, so the glyphs ride the same wave as the rows. */
export const waveClock = () => (typeof performance === "undefined" ? 0 : performance.now() / 1000);

function Face({ r, hidden }: { r: WaveRow; hidden: boolean }) {
  const srcs = hidden ? [] : [r.photo ? `/api/relay?photo=${r.photo}` : "", r.logo ? `/api/email?logo=${r.logo}` : ""].filter(Boolean);
  const [bad, setBad] = useState(0);
  const src = srcs[bad];
  return (
    <span className="rq-face" aria-hidden="true">
      {src ? <img src={src} alt="" width={30} height={30} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad((b) => b + 1)} /> : hidden ? "·" : r.initial}
    </span>
  );
}

export function RelayQueue({ queue, cur, now, hidden, goTo, navRef, narrow, still }: { queue: readonly Exchange[]; cur: string | null; now: number; hidden: boolean; goTo: (key: string) => void; navRef: RefObject<HTMLElement | null>; narrow: boolean; still: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [len, setLen] = useState(480);
  const span = waveSpan(len, narrow);
  const rows = useMemo(() => waveRows(queue, cur, now, span), [queue, cur, now, span]);
  const at = Math.max(0, queue.findIndex((x) => x.key === cur));
  const more = Math.max(0, queue.length - (at + span + 1));

  // Where each row is along the wave (eased toward its place), kept across renders by key.
  const pos = useRef(new Map<string, number>());
  const live = useRef({ rows, span, narrow, still });
  live.current = { rows, span, narrow, still };
  const raf = useRef(0);
  const last = useRef(0);

  // The wave's length: the box's width (or, on a phone, the strip's).
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const fit = () => setLen(nav.clientWidth - (narrow ? 0 : 190));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [navRef, narrow]);

  const draw = useCallback(
    (t: number, dt: number): boolean => {
      const nav = navRef.current;
      const list = listRef.current;
      if (!nav || !list) return false;
      const { rows: rs, span: n, narrow: flat, still: calm } = live.current;
      const box: Box = { x: 0, y: 0, w: nav.clientWidth, h: nav.clientHeight };
      let moving = false;
      const items = list.children;
      for (let i = 0; i < items.length && i < rs.length; i++) {
        const r = rs[i]!;
        const to = waveU(r.k, n);
        const was = pos.current.get(r.key) ?? (r.k > 0 ? to + 0.18 : to);
        const u = calm ? to : ease(was, to, dt);
        if (u !== to) moving = true;
        pos.current.set(r.key, u);
        const [x, y] = wavePoint(u, calm ? 0 : t, box, flat);
        const { scale, alpha } = waveLook(u);
        const el = (items[i] as HTMLElement).firstElementChild as HTMLElement | null;
        if (!el) continue;
        el.style.transform = flat ? `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -15px) scale(${scale.toFixed(3)})` : `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(calc(-100% + 15px), -50%) scale(${scale.toFixed(3)})`;
        el.style.opacity = alpha.toFixed(3);
      }
      for (const k of [...pos.current.keys()]) if (!rs.some((r) => r.key === k)) pos.current.delete(k);
      if (moreRef.current) {
        const [x, y] = wavePoint(1, calm ? 0 : t, box, flat);
        moreRef.current.style.transform = flat ? `translate3d(${x.toFixed(1)}px, ${(y + 30).toFixed(1)}px, 0) translateX(-50%)` : `translate3d(${(x - 15).toFixed(1)}px, ${(y + 34).toFixed(1)}px, 0) translateX(-100%)`;
      }
      return moving;
    },
    [navRef],
  );

  // The drift: one loop while there is motion; with reduced motion, one still frame per change.
  useEffect(() => {
    if (still) {
      draw(0, 1);
      return;
    }
    const tick = (time: number) => {
      const dt = last.current ? Math.min(0.05, (time - last.current) / 1000) : 1 / 60;
      last.current = time;
      draw(time / 1000, dt);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      last.current = 0;
    };
  }, [draw, still]);
  // A new focus or queue places the rows at once before paint (they then glide from where they were).
  useLayoutEffect(() => {
    draw(still ? 0 : waveClock(), 0);
  }, [draw, rows, len, narrow, still]);

  if (rows.length < 2 && !more) return null;

  return (
    <nav className="rq" ref={navRef} aria-label="Up next" data-narrow={narrow || undefined} data-still={still || undefined}>
      <ol className="rq-list" ref={listRef}>
        {rows.map((r) => {
          const past = r.k < 0;
          const on = r.k === 0;
          return (
            <li key={r.key} className="rq-item" data-cur={on || undefined} data-past={past || undefined} data-line={r.line} aria-hidden={past || undefined}>
              <button type="button" className="rq-row" tabIndex={past || on ? -1 : 0} aria-current={on || undefined} aria-label={`${on ? "On screen" : "Next"}: ${hidden ? "someone" : r.who}, ${r.line === "email" ? "email" : "text"}, ${r.age}`} onClick={() => !past && !on && goTo(r.key)}>
                <Face r={r} hidden={hidden} />
                <span className="rq-words" aria-hidden="true">
                  <span className="rq-top">
                    <Private as="b">{r.who}</Private>
                    <em>{r.age}</em>
                  </span>
                  {r.gist && <Private className="rq-gist">{r.gist}</Private>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {more > 0 && (
        <span className="rq-more" ref={moreRef}>
          +{more.toLocaleString()} after these
        </span>
      )}
    </nav>
  );
}
