import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { PLACES, placeOf, stepPlace, WT_SILVER, WT_SILVER_RGB, type PlaceId } from "../data/warTable.ts";
import type { PlaceState, WarTable as Scene } from "./warTableScene.ts";
import { LegendSigils } from "./LegendSigils.tsx";
import "./wartable.css";
import "./legend.css";

/**
 * The war table (#826): the Archive's page as a campaign table that fills the screen. Each of the Archive's features is
 * a place on its chart (data/warTable.ts), a miniature in the 3D (warTableScene.ts) with a pin over it; pointing at a
 * place wakes its wire and its sigils, and clicking it opens the feature in a panel beside the table (a sheet on a
 * phone). The legend under the table lists the same places as plain buttons, for the keyboard and small screens.
 *
 * The 3D loads with three.js in its own chunk once the page has painted. Until then, and without WebGL, the chart is
 * drawn flat with every pin in place, so the page is whole at once.
 */

type GL = "idle" | "loading" | "on" | "off";
const PHONE_Q = "(max-width: 760px)";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_Q).matches;

export interface WarTableProps {
  head: ReactNode;
  /** Each place's feature, as it opens in the panel. */
  panels: Record<PlaceId, ReactNode>;
  /** A short live line under each pin ("6 hours today"). */
  notes: Record<PlaceId, string>;
  states: Record<PlaceId, PlaceState>;
  open: PlaceId | null;
  onOpen: (id: PlaceId | null) => void;
}

export function WarTable({ head, panels, notes, states, open, onOpen }: WarTableProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const scene = useRef<Scene | null>(null);
  const pins = useRef(new Map<PlaceId, HTMLElement>());
  const [gl, setGl] = useState<GL>("idle");
  const [hot, setHot] = useState<PlaceId | null>(null);
  useRoomReady(gl === "on" || gl === "off");
  // On a phone the sheet is lifted to the Desk's root, so it stands over the page's footer as a sheet should.
  const [port, setPort] = useState<Element | null>(null);
  useEffect(() => {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(PHONE_Q) : null;
    const on = () => setPort(mq?.matches ? (host.current?.closest(".desk") ?? null) : null);
    on();
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  const live = useRef({ onOpen, states });
  live.current = { onOpen, states };

  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return;
    let dead = false;
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./warTableScene.ts")
        .then(async (m) => {
          if (!m.canDraw3D()) return !dead && setGl("off");
          const s = await m.createWarTable(el, cv, {
            phone: isPhone(),
            reduce: reducedMotion(),
            onPlace: (id, x, y, visible) => {
              const pin = pins.current.get(id);
              if (!pin) return;
              pin.style.setProperty("--gx", `${Math.round(x)}px`);
              pin.style.setProperty("--gy", `${Math.round(y)}px`);
              // Never under Ask Skippy and the room's mic, at the frame's bottom right.
              const r = el.getBoundingClientRect();
              const underDock = r.left + x > window.innerWidth - 260 && r.top + y > window.innerHeight - 130;
              pin.classList.toggle("is-away", !visible || underDock);
            },
            onHover: (id) => setHot(id),
            onPick: (id) => live.current.onOpen(id),
          });
          if (dead) return s.dispose();
          scene.current = s;
          s.setStates(live.current.states);
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idle = typeof w.requestIdleCallback === "function" ? w.requestIdleCallback(start, { timeout: 900 }) : window.setTimeout(start, 200);
    return () => {
      dead = true;
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const stateSig = JSON.stringify(states);
  useEffect(() => {
    scene.current?.setStates(live.current.states);
  }, [stateSig, gl]);
  useEffect(() => {
    scene.current?.setHover(hot);
  }, [hot, gl]);
  // On a phone the sheet stands under the Desk's bar: its top is where the page starts.
  useEffect(() => {
    if (!open || !sheet.current) return;
    const hall = host.current?.closest(".wt-hall");
    if (hall) sheet.current.style.setProperty("--wt-top", `${Math.max(0, Math.round(hall.getBoundingClientRect().top + window.scrollY))}px`);
  }, [open]);
  // The panel covers the table's right on a wide screen: the view slides over to keep the place in sight.
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const cover = open && !isPhone() ? (sheet.current?.offsetWidth ?? 0) : 0;
    s.setOpen(open, cover);
    if (open) sheet.current?.scrollTo({ top: 0 });
  }, [open, gl]);

  // Escape closes; the arrow keys walk the places while one is open.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") live.current.onOpen(null);
      else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) live.current.onOpen(stepPlace(open, e.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  const cur = open ? placeOf(open) : null;
  const panel = (
    <aside ref={sheet} className={`wt-sheet${cur ? " is-open" : ""}`} aria-label={cur ? cur.name : undefined} aria-hidden={!cur} inert={!cur}>
      {cur && (
        <>
          <header className="wt-sheet-head">
            <div>
              <p className="wt-k">
                {cur.model} <i /> {notes[cur.id]}
              </p>
              <h2>{cur.name}</h2>
              <p className="wt-what">{cur.what}</p>
            </div>
            <div className="wt-sheet-nav">
              <button type="button" onClick={() => onOpen(stepPlace(cur.id, -1))} aria-label="The place before">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M10 3L5 8l5 5" />
                </svg>
              </button>
              <button type="button" onClick={() => onOpen(stepPlace(cur.id, 1))} aria-label="The place after">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </button>
              <button type="button" className="wt-x" onClick={() => onOpen(null)} aria-label="Back to the table">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </header>
          <div className="wt-sheet-body" key={cur.id}>
            {panels[cur.id]}
          </div>
        </>
      )}
    </aside>
  );
  return (
    <>
      <div className={`wt-hall${open ? " is-open" : ""}`}>
        <div className="wt-stage">
          <header className="wt-head">{head}</header>
          <div className="wt-view" ref={host} data-gl={gl}>
            <canvas ref={canvas} className="wt-gl" aria-hidden="true" />
            <div className="wt-flat" aria-hidden="true">
              <i />
            </div>
            {PLACES.map((p) => (
              <button
                key={p.id}
                type="button"
                ref={(b) => {
                  if (b) pins.current.set(p.id, b);
                  else pins.current.delete(p.id);
                }}
                className={`wt-pin${hot === p.id ? " is-hot" : ""}${open === p.id ? " is-on" : ""}${p.id === "tide" ? " is-wire" : ""}`}
                style={
                  {
                    "--fx": `${((p.x + 8) / 16) * 84 + 8}%`,
                    "--fy": `${((p.z + 5) / 10) * 70 + 18}%`,
                  } as React.CSSProperties
                }
                onClick={() => onOpen(open === p.id ? null : p.id)}
                onPointerEnter={() => setHot(p.id)}
                onPointerLeave={() => setHot((h) => (h === p.id ? null : h))}
                aria-label={`${p.name}: ${notes[p.id]}`}
                aria-expanded={open === p.id}
              >
                <b>{p.name}</b>
                <small>{notes[p.id]}</small>
              </button>
            ))}
          </div>
          <p className="wt-hint" aria-hidden="true">
            {gl === "on" ? "Point at a place to wake it · drag or A/D to swivel · W/S to lean in" : ""}
          </p>
        </div>
        <nav className="wt-legend" aria-label="The places on the table">
          <LegendSigils />
          {PLACES.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`${open === p.id ? "is-on" : ""}${hot === p.id ? " is-hot" : ""}`}
              onClick={() => onOpen(open === p.id ? null : p.id)}
              onPointerEnter={() => setHot(p.id)}
              onPointerLeave={() => setHot((h) => (h === p.id ? null : h))}
              aria-pressed={open === p.id}
            >
              <span className="wt-n">{String(i + 1).padStart(2, "0")}</span>
              <b>{p.name}</b>
              <small>{notes[p.id]}</small>
            </button>
          ))}
        </nav>
      </div>
      {port
        ? createPortal(
            <div className="chron wv-page fl-page ax wt wt-port" data-room="archive" style={TONE}>
              {panel}
            </div>,
            port,
          )
        : panel}
    </>
  );
}

const TONE = { "--tone": WT_SILVER, "--fl-accent": WT_SILVER_RGB } as CSSProperties;
