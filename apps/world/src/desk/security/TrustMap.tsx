import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placePopover, type Placement } from "../popover.ts";
import { BOUNDARIES, ZONES, partsOf, type Boundary, type ZoneId } from "./model.ts";
import { Rich } from "./parts.tsx";

/**
 * The trust boundaries from docs/THREAT-MODEL.md as a map: the zones the data passes through and the eight
 * boundaries between them. Pick a boundary (hover, focus or tap) to see what crosses it and the controls on it. The
 * map is for wide screens; the row of boundary buttons and the detail carry the same facts everywhere. On the map the
 * detail also floats at the mouse (or beside the focused chip), since the one below the map can be off screen.
 */

/** Where the floating detail points: the mouse, or the chip for keyboard and touch. */
type Tip = { left: number; top: number; width: number; height: number };
const at = (x: number, y: number): Tip => ({ left: x - 6, top: y - 6, width: 12, height: 12 });
const around = (el: Element): Tip => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

const BOX: Record<ZoneId, { x: number; y: number; w: number; h: number }> = {
  public: { x: 20, y: 30, w: 220, h: 120 },
  browser: { x: 20, y: 175, w: 220, h: 90 },
  relay: { x: 20, y: 290, w: 220, h: 90 },
  vercel: { x: 330, y: 30, w: 280, h: 350 },
  github: { x: 700, y: 30, w: 280, h: 110 },
  builder: { x: 700, y: 180, w: 280, h: 80 },
  claude: { x: 700, y: 285, w: 280, h: 98 },
};

/** Each boundary's line and where its chip sits. */
const EDGE: Record<string, { d: string; cx: number; cy: number }> = {
  TB1: { d: "M240 220 L330 220", cx: 285, cy: 220 },
  TB2: { d: "M610 340 L700 340", cx: 655, cy: 340 },
  TB3: { d: "M610 85 L700 85", cx: 655, cy: 85 },
  TB4: { d: "M240 60 C 380 -24, 560 -24, 700 60", cx: 470, cy: -3 },
  TB5: { d: "M840 140 L840 180", cx: 840, cy: 160 },
  TB6: { d: "M240 110 L330 110", cx: 285, cy: 110 },
  TB7: { d: "M240 335 L330 335", cx: 285, cy: 335 },
  // Actions (in GitHub, top right) out to Gemini in the model APIs' box (bottom right), round the right of the column.
  TB8: { d: "M980 115 C 1040 115, 1040 345, 980 345", cx: 1025, cy: 230 },
};

export function TrustMap() {
  const [picked, setPicked] = useState<string>("TB1");
  const [tip, setTip] = useState<Tip | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const b = BOUNDARIES.find((x) => x.id === picked) ?? BOUNDARIES[0]!;

  // Like the Desk's pop-over cards (#80): the floating detail lives at the Desk's root, out of the page's transform.
  useEffect(() => {
    setHost(rootRef.current?.closest<HTMLElement>(".desk") ?? document.body);
  }, []);

  // Escape, a press elsewhere, or scrolling puts it away.
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => !(e.target as Element | null)?.closest?.(".tmap__chip") && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [tip]);

  return (
    <div className="tmap" ref={rootRef}>
      <svg className="tmap__svg" viewBox="0 -34 1060 424" role="group" aria-label="Trust boundaries: the zones C.E.O.'s data passes through and the eight boundaries between them">
        <defs>
          <marker id="tmap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="tmap__head" />
          </marker>
        </defs>
        {(Object.keys(BOX) as ZoneId[]).map((id) => (
          <Zone key={id} id={id} active={b.from === id || b.to === id} />
        ))}
        {BOUNDARIES.map((x) => {
          const e = EDGE[x.id]!;
          const on = x.id === b.id;
          return (
            <g key={x.id} className={`tmap__edge ${on ? "is-on" : ""} ${x.planned ? "is-planned" : ""}`}>
              <path d={e.d} markerEnd="url(#tmap-arrow)" />
              <g
                className="tmap__chip"
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${x.id}: ${x.name}`}
                onPointerEnter={(ev) => {
                  setPicked(x.id);
                  if (ev.pointerType === "mouse") setTip(at(ev.clientX, ev.clientY));
                }}
                onPointerMove={(ev) => ev.pointerType === "mouse" && setTip(at(ev.clientX, ev.clientY))}
                onPointerLeave={(ev) => ev.pointerType === "mouse" && setTip(null)}
                onFocus={(ev) => {
                  setPicked(x.id);
                  setTip(around(ev.currentTarget));
                }}
                onBlur={() => setTip(null)}
                onClick={(ev) => {
                  setPicked(x.id);
                  setTip((ev.nativeEvent as PointerEvent).pointerType === "mouse" ? at(ev.clientX, ev.clientY) : around(ev.currentTarget));
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    setPicked(x.id);
                    setTip(around(ev.currentTarget));
                  }
                }}
              >
                <rect x={e.cx - 27} y={e.cy - 12} width="54" height="24" rx="12" />
                <text x={e.cx} y={e.cy + 4} textAnchor="middle">
                  {x.id}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      <div className="tmap__picker" role="group" aria-label="Pick a trust boundary">
        {BOUNDARIES.map((x) => (
          <button key={x.id} type="button" className={`tmap__pick ${x.id === b.id ? "is-on" : ""} ${x.planned ? "is-planned" : ""}`} aria-pressed={x.id === b.id} onClick={() => setPicked(x.id)}>
            <b>{x.id}</b> {x.name}
          </button>
        ))}
      </div>

      <BoundaryDetail b={b} />
      {host && tip && createPortal(<FloatingDetail b={b} tip={tip} />, host)}
    </div>
  );
}

/** The same detail, floating at the mouse; the one under the map stays for screen readers and phones. */
function FloatingDetail({ b, tip }: { b: Boundary; tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlace(placePopover(tip, { width: el.offsetWidth, height: el.offsetHeight }, { width: document.documentElement.clientWidth, height: window.innerHeight }));
  }, [tip, b]);
  return (
    <div ref={ref} className={`tmap__float ${place ? "is-placed" : ""}`} aria-hidden="true" style={{ left: place?.left ?? 0, top: place?.top ?? 0 }}>
      <BoundaryDetail b={b} live={false} />
    </div>
  );
}

function Zone({ id, active }: { id: ZoneId; active: boolean }) {
  const z = ZONES[id];
  const r = BOX[id];
  return (
    <g className={`tmap__zone tmap__zone--${id} ${active ? "is-active" : ""} ${z.planned ? "is-planned" : ""}`}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="6" />
      <text className="tmap__zname" x={r.x + 14} y={r.y + 24}>
        {z.name}
      </text>
      <text className="tmap__ztrust" x={r.x + 14} y={r.y + 41}>
        {z.trust.toUpperCase()}
      </text>
      {z.holds.map((h, i) => (
        <text key={h} className="tmap__zhold" x={r.x + 14} y={r.y + 62 + i * 18}>
          {h}
        </text>
      ))}
    </g>
  );
}

function BoundaryDetail({ b, live = true }: { b: Boundary; live?: boolean }) {
  const controls = partsOf(b.controls);
  return (
    <div className={`tmap__detail ${b.planned ? "is-planned" : ""}`} aria-live={live ? "polite" : undefined}>
      <p className="tmap__route">
        <span>{ZONES[b.from].name}</span>
        <i aria-hidden="true">→</i>
        <span>{ZONES[b.to].name}</span>
      </p>
      <h3 className="tmap__title">
        <b>{b.id}</b> {b.name}
      </h3>
      <dl className="tmap__facts">
        <div>
          <dt>What crosses</dt>
          <dd>{b.crosses}</dd>
        </div>
        <div>
          <dt>{controls.length === 1 ? "Control" : `${controls.length} controls`}</dt>
          <dd>
            <ul className="chips">
              {controls.map((c) => (
                <li key={c}>
                  <Rich text={c} />
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </div>
  );
}
