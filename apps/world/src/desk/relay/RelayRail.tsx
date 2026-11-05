import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react";
import { Private } from "../Private.tsx";
import { dockOffsets, dockScales, railAt, railIndex, railOf, railRowH, railStep, type RailRow } from "./rail.ts";
import type { Exchange } from "./thread.ts";
import "./rail.css";

/**
 * Relay's rail (#765): every exchange in the Thread's queue as one compact timeline down the left edge, in the order the
 * codex scrolls through them, the one in focus marked. Idle it is a column of ticks and faces; as the pointer moves
 * along it the items near the pointer grow on a bell curve, like the macOS Dock, and the grown ones show who and a
 * one-line preview. A click (or Enter) puts that exchange in focus, exactly as J and K do.
 *
 * Drawing only: the queue, the focus and goTo come from RelayThread. The wave runs on requestAnimationFrame and writes
 * transforms and opacity straight to the rows, so hovering never re-renders React or touches layout. Reduced motion:
 * no wave, the row under the pointer is simply highlighted. On a phone the rail is a thin scrubber at the left edge:
 * drag along it and the same wave follows the finger; let go and the codex jumps there. Every name and preview is
 * wrapped in <Private> for Hide, and the rail only exists while the signed-in queue does.
 */

const media = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;

function useMedia(q: string): boolean {
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

function Face({ r, hidden }: { r: RailRow; hidden: boolean }) {
  const srcs = hidden ? [] : [r.photo ? `/api/relay?photo=${r.photo}` : "", r.logo ? `/api/email?logo=${r.logo}` : ""].filter(Boolean);
  const [bad, setBad] = useState(0);
  const src = srcs[bad];
  return (
    <span className="rr-face" aria-hidden="true">
      {src ? <img src={src} alt="" width={28} height={28} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad((b) => b + 1)} /> : hidden ? "·" : r.initial}
    </span>
  );
}

export function RelayRail({ queue, cur, now, hidden, goTo, scroller }: { queue: readonly Exchange[]; cur: string | null; now: number; hidden: boolean; goTo: (key: string) => void; scroller?: RefObject<HTMLElement | null> }) {
  const rows = useMemo(() => railOf(queue, cur, now), [queue, cur, now]);
  const n = rows.length;
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const narrow = useMedia("(max-width: 760px)");
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(20);
  const [focusI, setFocusI] = useState(-1);
  const curI = railIndex(rows, cur);
  const tabI = focusI >= 0 && focusI < n ? focusI : curI >= 0 ? curI : 0;

  // The wave: where the pointer is (target), where the drawn wave is (at, eased toward it), and how far in it is (amp).
  const wave = useRef({ target: null as number | null, at: null as number | null, amp: 0, ampTo: 0, raf: 0, last: 0, scrub: false, swallow: false });
  const live = useRef({ n, h, reduced });
  live.current = { n, h, reduced };

  // Rows fit the rail's height (6 px each at the least, so even a long queue fits without a scrollbar).
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const fit = () => setH(railRowH(nav.clientHeight, Math.max(1, n), 6, narrow ? 22 : 26));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [n, narrow]);

  const draw = useCallback(() => {
    const list = listRef.current;
    const w = wave.current;
    const { n: count, h: rowH, reduced: still } = live.current;
    if (!list) return;
    const items = list.children;
    const scales = still ? Array.from({ length: count }, () => 1) : dockScales(count, w.at, w.amp);
    const offs = still ? scales.map(() => 0) : dockOffsets(scales, rowH, w.at);
    const hot = w.at === null ? -1 : Math.round(w.at);
    for (let i = 0; i < items.length && i < count; i++) {
      const el = items[i] as HTMLElement;
      const s = scales[i]!;
      const row = el.firstElementChild as HTMLElement | null;
      if (!row) continue;
      row.style.transform = s === 1 && offs[i] === 0 ? "" : `translate3d(0, ${offs[i]!.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
      // Words show as an item grows: none at rest, all of them near the top of the wave.
      const words = still ? (i === hot && w.amp > 0.5 ? 1 : 0) : Math.max(0, Math.min(1, ((s - 1) / 0.8) * 1.8 - 0.35));
      row.style.setProperty("--rr-w", words.toFixed(3));
      el.toggleAttribute("data-hot", i === hot && w.amp > 0.5);
    }
    if (veilRef.current) veilRef.current.style.opacity = w.amp.toFixed(3);
  }, []);

  const tick = useCallback(
    (time: number) => {
      const w = wave.current;
      const dt = w.last ? Math.min(0.05, (time - w.last) / 1000) : 1 / 60;
      w.last = time;
      const still = live.current.reduced;
      w.amp = still ? w.ampTo : w.amp + (w.ampTo - w.amp) * Math.min(1, dt * 9);
      if (w.target !== null) w.at = w.at === null || still ? w.target : w.at + (w.target - w.at) * Math.min(1, dt * 18);
      const settled = Math.abs(w.amp - w.ampTo) < 0.002 && (w.target === null || w.at === null || Math.abs(w.at - w.target) < 0.002);
      if (settled) {
        w.amp = w.ampTo;
        if (w.target !== null) w.at = w.target;
        if (w.ampTo === 0) {
          w.at = null;
          w.target = null;
          navRef.current?.removeAttribute("data-on");
        }
      }
      draw();
      w.raf = settled ? 0 : requestAnimationFrame(tick);
      if (settled) w.last = 0;
    },
    [draw],
  );

  const kick = useCallback(() => {
    const w = wave.current;
    if (!w.raf) w.raf = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => () => cancelAnimationFrame(wave.current.raf), []);
  // A queue that changed (a Done, a new text) redraws at rest.
  useLayoutEffect(() => draw(), [draw, n, h, reduced]);

  const aim = (at: number | null) => {
    const w = wave.current;
    w.target = at;
    w.ampTo = at === null ? 0 : 1;
    if (at !== null) navRef.current?.setAttribute("data-on", "");
    kick();
  };

  const atY = (clientY: number) => {
    const list = listRef.current;
    if (!list) return null;
    return railAt(clientY - list.getBoundingClientRect().top, h, n);
  };

  const onMove = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" || e.pointerType === "pen" || wave.current.scrub) aim(atY(e.clientY));
  };
  const onDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== "touch") return;
    wave.current.scrub = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    aim(atY(e.clientY));
  };
  const onUp = (e: ReactPointerEvent) => {
    const w = wave.current;
    if (!w.scrub) return;
    w.scrub = false;
    const at = atY(e.clientY);
    const r = at === null ? undefined : rows[Math.round(at)];
    // The finger's release is the jump; the click the browser sends after it is not a second one.
    w.swallow = true;
    window.setTimeout(() => (w.swallow = false), 400);
    aim(null);
    if (r) goTo(r.key);
  };
  const onCancel = () => {
    wave.current.scrub = false;
    aim(null);
  };

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const from = focusI >= 0 ? focusI : curI;
    const to = k === "ArrowDown" || k === "j" ? railStep(from, 1, n) : k === "ArrowUp" || k === "k" ? railStep(from, -1, n) : k === "Home" ? (n ? 0 : null) : k === "End" ? (n ? n - 1 : null) : undefined;
    if (to === undefined) return;
    // The page's own J and K move the codex; inside the rail they only move along it until Enter.
    e.preventDefault();
    e.stopPropagation();
    if (to === null) return;
    setFocusI(to);
    listRef.current?.querySelectorAll<HTMLButtonElement>(".rr-row")[to]?.focus({ preventScroll: true });
    aim(to);
  };

  const onWheel = (e: ReactWheelEvent) => {
    scroller?.current?.scrollBy({ top: e.deltaY });
  };

  if (!n) return null;

  return (
    <nav
      className="rr"
      ref={navRef}
      aria-label="Everything waiting, in order"
      data-narrow={narrow || undefined}
      data-still={reduced || undefined}
      style={{ "--rr-h": `${h}px` } as CSSProperties}
      onPointerMove={onMove}
      onPointerLeave={() => !wave.current.scrub && aim(null)}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onWheel={onWheel}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocusI(-1);
          aim(null);
        }
      }}
    >
      <div className="rr-veil" ref={veilRef} aria-hidden="true" />
      <ol className="rr-list" ref={listRef} onKeyDown={onKey}>
        {rows.map((r, i) => (
          <li key={r.key} className="rr-item" data-cur={r.cur || undefined} data-line={r.line}>
            <button
              type="button"
              className="rr-row"
              tabIndex={i === tabI ? 0 : -1}
              aria-current={r.cur || undefined}
              aria-label={`${hidden ? "Someone" : r.who}, ${r.line === "email" ? "email" : "text"}, ${r.age}${r.cur ? ", on screen" : ""}`}
              onFocus={() => setFocusI(i)}
              onClick={() => {
                if (wave.current.swallow) return;
                goTo(r.key);
              }}
            >
              <span className="rr-tick" aria-hidden="true" />
              <Face r={r} hidden={hidden} />
              <span className="rr-words" aria-hidden="true">
                <Private as="b">{r.who}</Private>
                <Private className="rr-pre">{r.preview}</Private>
              </span>
              <em className="rr-age" aria-hidden="true">
                {r.age}
              </em>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
