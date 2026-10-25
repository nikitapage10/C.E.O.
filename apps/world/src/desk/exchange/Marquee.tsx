import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tapeItems, tapeSeconds, type TapeItem } from "./floor.ts";
import type { PmBoard, PmStatus } from "./polymarket.ts";
import { useReducedMotion } from "./viz.tsx";

/**
 * The Exchange's marquee (#430): one slim band of Polymarket's live odds running along the top of the floor, in the
 * kit's type between two lit hairlines. Real markets only (the world-moving ones first, then the busiest), each its
 * name, its odds and the day's move; until Polymarket answers it says so and stands still.
 * Smooth by construction: the run is one CSS transform on its own composited layer (two copies, translated by half),
 * its length measured once per read, never per frame. It holds on hover or focus, stops while the tab is hidden or the
 * band is off screen, and under reduced motion it stands still and scrolls by hand instead.
 */

function Run({ items, copy }: { items: TapeItem[]; copy: boolean }) {
  return (
    <ul className="xc-tape-run" aria-hidden={copy || undefined}>
      {items.map((m) => {
        const inner = (
          <>
            <span className="xc-tape-name">{m.name}</span>
            <b className="xc-tape-odds fl-num">{m.odds}</b>
            {m.move && <span className={`xc-tape-move is-${m.tone}`}>{m.move}</span>}
          </>
        );
        return (
          <li key={m.id}>
            {m.url ? (
              <a href={m.url} target="_blank" rel="noopener noreferrer nofollow" tabIndex={copy ? -1 : undefined}>
                {inner}
              </a>
            ) : (
              <span>{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Marquee({ board, status }: { board: PmBoard | null; status: PmStatus }) {
  const items = tapeItems(board);
  const key = items.map((i) => `${i.id}:${i.odds}:${i.move}`).join("|");
  const host = useRef<HTMLDivElement>(null);
  const run = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [secs, setSecs] = useState(60);
  const [off, setOff] = useState(false);

  // One measure per read (and on resize): the run's own width sets its duration, so the pace stays the same.
  useLayoutEffect(() => {
    const el = run.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const measure = () => setSecs(tapeSeconds(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key]);

  // Stop when the band is off screen or the tab is hidden: nothing runs that nobody sees.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let seen = true;
    const sync = () => setOff(!seen || document.visibilityState !== "visible");
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((es) => {
      seen = es.some((e) => e.isIntersecting);
      sync();
    });
    io?.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const moving = items.length > 2 && !reduced;
  return (
    <div ref={host} className={`xc-tape${moving ? " is-moving" : ""}${off ? " is-off" : ""}`} role="region" aria-label="Polymarket's live odds, the day's move beside each">
      <span className="xc-tape-k" aria-hidden="true">
        Live odds
      </span>
      {items.length ? (
        <div className="xc-tape-view">
          <div ref={run} className="xc-tape-track" style={{ "--xc-tape-s": `${secs}s` } as React.CSSProperties}>
            <Run items={items} copy={false} />
            {moving && <Run items={items} copy />}
          </div>
        </div>
      ) : (
        <p className="xc-tape-wait">{status === "failed" ? "Polymarket isn't answering. The odds run here once it does." : status === "off" ? "Polymarket isn't connected here." : "Reading Polymarket's odds…"}</p>
      )}
    </div>
  );
}
