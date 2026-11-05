import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import type { Exchange } from "../data/thread.ts";
import { ease, LINE, lineLayout, scrollPlace, waveRows, type LineOpts, type WaveRow } from "../data/wave.ts";
import "./queue.css";

/**
 * Relay's queue on the line (#803, reshaped in #869). Nikita, 2026-11-05: "all the little, like the C, the U, the D,
 * and F should all be on the line... if I put my mouse over those little circles or even on the text on the left-hand
 * side, it kind of like magnifies in this like blurry light magnification kind of way... like the glass in the new
 * Apple stuff". Every owed thread's circle sits on the line in the queue's order, its name and gist a small label left
 * of it; the pointer (or the scroll, with nothing hovering) is a magnifier: the nearest row largest
 * and its neighbours scaled along a bell curve, as a dock does. Scrolling the codex moves the rows up the line; the
 * ones scrolled past close up toward the top and fade, but stay. A tap on one puts it in focus and opens its composer.
 * On a phone the line lies flat above the entry; a drag along it magnifies, and letting go there opens that one.
 *
 * Drawing only: the queue, the focus and goTo come from RelayThread, the geometry from ../data/wave.ts. Rows move on
 * requestAnimationFrame only while something changes, writing transforms and opacity straight to the DOM, so the line
 * never re-renders React. Reduced motion: no easing, the rows jump to their places. Every name and line is wrapped in
 * <Private> for Hide, and the line exists only with the signed-in queue.
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

/** The circle's radius on the line, px, before magnifying. */
const R = 10;
/** A phone's flat line: how far down the strip it runs. */
const FLAT_Y = 24;

function Face({ r, hidden }: { r: WaveRow; hidden: boolean }) {
  const srcs = hidden ? [] : [r.photo ? `/api/relay?photo=${r.photo}` : "", r.logo ? `/api/email?logo=${r.logo}` : ""].filter(Boolean);
  const [bad, setBad] = useState(0);
  const src = srcs[bad];
  return (
    <span className="rq-face" aria-hidden="true">
      {src ? <img src={src} alt="" width={20} height={20} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad((b) => b + 1)} /> : hidden ? "·" : r.initial}
    </span>
  );
}

export function RelayQueue({ queue, cur, now, hidden, goTo, navRef, pagesRef, narrow, still }: { queue: readonly Exchange[]; cur: string | null; now: number; hidden: boolean; goTo: (key: string) => void; navRef: RefObject<HTMLElement | null>; pagesRef: RefObject<HTMLElement | null>; narrow: boolean; still: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const rows = useMemo(() => waveRows(queue, cur, now), [queue, cur, now]);
  const at = Math.max(0, queue.findIndex((x) => x.key === cur));

  /** Live values the frame reads: the rows, where the scroll stands (p, in queue places), the magnifier, the pointer. */
  const live = useRef({ rows, at, narrow, still });
  live.current = { rows, at, narrow, still };
  const m = useRef({ p: at, pTo: at, f: 0, fTo: 0, hover: false, drag: null as null | { x: number; moved: boolean } });
  const raf = useRef(0);
  const last = useRef(0);

  const geometry = useCallback((): { w: number; h: number; o: LineOpts } | null => {
    const nav = navRef.current;
    if (!nav) return null;
    const w = nav.clientWidth;
    const h = nav.clientHeight;
    const half = (live.current.narrow ? w : h) / 2 - (live.current.narrow ? 20 : 14);
    return { w, h, o: { ...LINE, half: Math.max(40, half), gap: live.current.narrow ? 40 : LINE.gap, sigma: live.current.narrow ? 34 : LINE.sigma, mag: live.current.narrow ? 0.55 : LINE.mag } };
  }, [navRef]);

  /** One frame: ease the scroll place and the magnifier, place every row. True while still moving. */
  const draw = useCallback(
    (dt: number): boolean => {
      const g = geometry();
      const list = listRef.current;
      if (!g || !list) return false;
      const { rows: rs, narrow: flat, still: calm } = live.current;
      const s = m.current;
      s.p = calm || dt === 0 ? s.pTo : ease(s.p, s.pTo, dt, 14, 0.002);
      s.f = calm ? s.fTo : ease(s.f, s.fTo, dt, 16, 0.2);
      const first = live.current.at + (rs[0]?.k ?? 0);
      const placed = lineLayout(rs.length, s.p - first, s.f, g.o);
      const items = list.children;
      for (let i = 0; i < items.length && i < placed.length; i++) {
        const q = placed[i]!;
        const li = items[i] as HTMLElement;
        const el = li.firstElementChild as HTMLElement | null;
        if (!el) continue;
        const x = flat ? g.w / 2 + q.at : g.w;
        const y = flat ? FLAT_Y : g.h / 2 + q.at;
        // The warped glass: on its rim a row squashes along the line and leans away (rotate about the line's cross axis).
        const sc = q.scale.toFixed(3), sq = q.squash.toFixed(3), tl = q.tilt.toFixed(1);
        el.style.transform = flat
          ? `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -${R}px) perspective(420px) rotateY(${tl}deg) scale(${sq}, ${sc})`
          : `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(calc(-100% + ${R}px), -50%) perspective(420px) rotateX(${(-q.tilt).toFixed(1)}deg) scale(${sc}, ${sq})`;
        el.style.opacity = q.alpha.toFixed(3);
        el.style.zIndex = String(Math.round(q.lens * 100));
        const words = el.lastElementChild as HTMLElement | null;
        // On a phone only the magnified one is named: the flat line has no room for every label.
        if (words) words.style.opacity = (flat ? Math.max(0, Math.min(1, q.lens * 2.2 - 1.2)) : q.label / Math.max(0.01, q.alpha)).toFixed(3);
      }
      return s.p !== s.pTo || s.f !== s.fTo;
    },
    [geometry],
  );

  /** Wakes the frame loop until everything settles. */
  const kick = useCallback(() => {
    if (raf.current) return;
    const tick = (time: number) => {
      const dt = last.current ? Math.min(0.05, (time - last.current) / 1000) : 1 / 60;
      last.current = time;
      if (draw(dt)) raf.current = requestAnimationFrame(tick);
      else {
        raf.current = 0;
        last.current = 0;
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, [draw]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // The scroll: where the codex stands, as a fractional place in the queue, so the rows move up the line with it.
  useEffect(() => {
    const pages = pagesRef.current;
    if (!pages) return;
    const read = () => {
      const tops = [...pages.querySelectorAll<HTMLElement>(".cx-entry[data-key]")].map((e) => e.offsetTop);
      m.current.pTo = tops.length === queue.length ? scrollPlace(pages.scrollTop, tops) : live.current.at;
      kick();
    };
    read();
    pages.addEventListener("scroll", read, { passive: true });
    return () => pages.removeEventListener("scroll", read);
  }, [pagesRef, queue, kick]);

  // A new focus or queue, a resize: place the rows at once before paint.
  useLayoutEffect(() => {
    if (!pagesRef.current?.querySelector(".cx-entry[data-key]")) m.current.pTo = at;
    draw(0);
    kick();
  }, [draw, kick, rows, at, narrow, still, pagesRef]);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw(0));
    ro.observe(nav);
    return () => ro.disconnect();
  }, [navRef, draw]);

  // The wheel over the line scrolls the codex beside it.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || narrow) return;
    const wheel = (e: WheelEvent) => {
      const pages = pagesRef.current;
      if (!pages) return;
      e.preventDefault();
      pages.scrollBy({ top: e.deltaY });
    };
    nav.addEventListener("wheel", wheel, { passive: false });
    return () => nav.removeEventListener("wheel", wheel);
  }, [navRef, pagesRef, narrow]);

  /** Where the pointer is along the line, from its centre. */
  const along = (e: { clientX: number; clientY: number }) => {
    const r = navRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return narrow ? e.clientX - (r.left + r.width / 2) : e.clientY - (r.top + r.height / 2);
  };
  /** The row nearest the magnifier now. */
  const nearest = (): string | null => {
    const g = geometry();
    const { rows: rs } = live.current;
    if (!g || !rs.length) return null;
    const placed = lineLayout(rs.length, m.current.p - (live.current.at + rs[0]!.k), m.current.f, g.o);
    let best = 0;
    placed.forEach((q, i) => {
      if (q.lens > placed[best]!.lens) best = i;
    });
    return rs[best]!.key;
  };

  if (rows.length < 2) return null;

  return (
    <nav
      className="rq"
      ref={navRef}
      aria-label="Up next"
      data-narrow={narrow || undefined}
      data-still={still || undefined}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" && !m.current.drag) return;
        if (m.current.drag && Math.abs(e.clientX - m.current.drag.x) > 6) m.current.drag.moved = true;
        m.current.hover = true;
        m.current.fTo = along(e);
        kick();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        m.current.hover = false;
        m.current.fTo = 0;
        kick();
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        m.current.drag = { x: e.clientX, moved: false };
        m.current.fTo = along(e);
        kick();
      }}
      onPointerUp={() => {
        const d = m.current.drag;
        m.current.drag = null;
        if (d?.moved) {
          const k = nearest();
          if (k) goTo(k);
        }
        m.current.hover = false;
        m.current.fTo = 0;
        kick();
      }}
      onPointerCancel={() => {
        m.current.drag = null;
        m.current.hover = false;
        m.current.fTo = 0;
        kick();
      }}
    >
      <ol className="rq-list" ref={listRef}>
        {rows.map((r) => {
          const on = r.k === 0;
          return (
            <li key={r.key} className="rq-item" data-cur={on || undefined} data-past={r.k < 0 || undefined} data-settled={r.settled || undefined} data-line={r.line}>
              <button
                type="button"
                className="rq-row"
                tabIndex={on ? -1 : 0}
                aria-current={on || undefined}
                aria-label={`${on ? "On screen" : r.k < 0 ? "Earlier" : "Next"}: ${hidden ? "someone" : r.who}, ${r.line === "email" ? "email" : "text"}, ${r.age}${r.settled ? ", no reply needed" : ""}`}
                onFocus={(e) => {
                  if (!e.currentTarget.matches(":focus-visible")) return;
                  const b = e.currentTarget.getBoundingClientRect();
                  m.current.fTo = along({ clientX: b.right - R, clientY: b.top + b.height / 2 });
                  kick();
                }}
                onBlur={() => {
                  if (m.current.hover) return;
                  m.current.fTo = 0;
                  kick();
                }}
                onClick={() => {
                  if (m.current.drag?.moved) return;
                  goTo(r.key);
                }}
              >
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
    </nav>
  );
}
