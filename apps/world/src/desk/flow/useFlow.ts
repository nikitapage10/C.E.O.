import { useEffect, useMemo, useRef } from "react";
import type { RoomId } from "../../chronicle.ts";
import { reducedMotion, useViz } from "../wvCanvas.ts";
import { makeFlowField, type FlowField, type FlowLayoutFn, type FlowOpts } from "./field.ts";
import { useTempo } from "./useTempo.ts";

export interface UseFlowOpts extends FlowOpts {
  /** The line pointed at changed (null when none): light its row, show its label. */
  onHover?: (id: string | null) => void;
  /** A line was clicked or tapped. */
  onPick?: (id: string) => void;
  /** How near the pointer must be to a line, px (default 12). */
  tol?: number;
  /**
   * The room whose real activity moves the lines (#262): its tempo scales every line's speed, density, brightness and
   * spread, and the page's largest field carries a small legend saying what drives it. Read from the route when left
   * out (so every room page gets it through the kit); `null` keeps the page's own look and shows no legend.
   */
  room?: RoomId | null;
}

/** The fields on the page, so only the largest stage carries the legend. */
const mounted = new Map<FlowField, () => void>();
let legendOwner: FlowField | null = null;
const holders = new WeakMap<FlowField, HTMLElement>();
const areaOf = (F: FlowField) => {
  const h = holders.get(F);
  return h ? h.clientWidth * h.clientHeight : 0;
};
function electLegend() {
  let best: FlowField | null = null;
  for (const F of mounted.keys()) if (!best || areaOf(F) > areaOf(best)) best = F;
  if (best === legendOwner) return;
  legendOwner = best;
  for (const sync of mounted.values()) sync();
}

/**
 * A page's flow field (#428). Pass a layout memoised on the page's real data (useCallback): the field is re-laid when
 * it changes, on resize and on `field.relayout()`, never per frame. Put `cv` on a <canvas className="fl-cv"> inside a
 * positioned host and spread `bind` on that host for hover and pick (the canvas itself takes no pointer events, so
 * the page's DOM over it stays clickable). The options are read once, on mount.
 */
export function useFlow(layout: FlowLayoutFn, o: UseFlowOpts = {}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const opts = useRef(o);
  opts.current = o;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const field: FlowField = useMemo(() => makeFlowField(layout, o), []);
  const V = useViz(cv, field.spec);
  useEffect(() => {
    field.layout = layout;
    V.current?.relayout();
  }, [field, layout, V]);

  // The room's real activity (#262): the tempo goes straight into the field; the legend is the kit's own small line,
  // laid into the stage beside the canvas so every page shows it the same way without drawing it itself.
  const { tempo, legend } = useTempo(o.room);
  useEffect(() => field.setTempo(tempo), [field, tempo]);
  const legendText = useRef(legend);
  legendText.current = legend;
  const tag = useRef<HTMLParagraphElement | null>(null);
  const sync = useRef(() => {});
  sync.current = () => {
    const host = cv.current?.parentElement;
    const text = legendText.current;
    const show = !!host && !!text && legendOwner === field;
    if (!show) {
      tag.current?.remove();
      return;
    }
    if (!tag.current) {
      const p = document.createElement("p");
      p.className = "fl-drive";
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      p.append(dot, document.createElement("span"));
      tag.current = p;
    }
    const p = tag.current;
    if (p.parentElement !== host) host.appendChild(p);
    p.querySelector("span")!.textContent = text;
    p.dataset.level = String(Math.round(tempo.level * 10));
    p.classList.toggle("is-idle", tempo.idle);
    p.style.setProperty("--fl-tempo", String(tempo.level));
    p.title = "What moves these lines: the room's real activity right now";
  };
  useEffect(() => {
    const host = cv.current?.parentElement;
    if (host) holders.set(field, host);
    mounted.set(field, () => sync.current());
    electLegend();
    sync.current();
    return () => {
      mounted.delete(field);
      tag.current?.remove();
      if (legendOwner === field) legendOwner = null;
      electLegend();
    };
  }, [field]);
  useEffect(() => sync.current(), [legend, tempo]);

  const bind = useMemo(() => {
    const point = (e: React.PointerEvent | React.MouseEvent) => {
      const el = cv.current;
      if (!el) return null;
      // Read at the event, not in a frame.
      const r = el.getBoundingClientRect();
      return field.hit(e.clientX - r.left, e.clientY - r.top, opts.current.tol ?? 12);
    };
    const hover = (id: string | null) => {
      if (field.hot === id) return;
      field.hot = id;
      opts.current.onHover?.(id);
      if (reducedMotion()) field.relayout();
    };
    return {
      onPointerMove: (e: React.PointerEvent) => hover(point(e)?.id ?? null),
      onPointerLeave: () => hover(null),
      onClick: (e: React.MouseEvent) => {
        const h = point(e);
        if (h) opts.current.onPick?.(h.id);
      },
    };
  }, [field]);

  return { cv, field, bind };
}
