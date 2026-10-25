import { useEffect, useMemo, useRef } from "react";
import { reducedMotion, useViz } from "../wvCanvas.ts";
import { makeFlowField, type FlowField, type FlowLayoutFn, type FlowOpts } from "./field.ts";

export interface UseFlowOpts extends FlowOpts {
  /** The line pointed at changed (null when none): light its row, show its label. */
  onHover?: (id: string | null) => void;
  /** A line was clicked or tapped. */
  onPick?: (id: string) => void;
  /** How near the pointer must be to a line, px (default 12). */
  tol?: number;
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
