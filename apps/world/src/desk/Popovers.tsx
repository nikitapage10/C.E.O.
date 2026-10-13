import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placePopover, type Placement } from "./popover.ts";

/**
 * Pop-over cards that explain the thing under the pointer (issue #80, shared since #90): the Systems page's How it
 * connects, and every item on Security and Compliance. A scope holds at most one open card. An item opens it on
 * hover (after a short delay), on keyboard focus, or on a tap; a tap or click pins it until Escape, a tap elsewhere,
 * or another tap on the item. The card is a `role="tooltip"` the item names with `aria-describedby`, portalled to
 * the Desk's root (the page beneath animates in with a transform, which would trap a fixed card), and placed by
 * placePopover so it never leaves the screen. Reduced motion drops its entrance (desk.css).
 */

const OPEN_DELAY = 90;
const CLOSE_DELAY = 160;

interface Open {
  id: string;
  /** Opened by a tap or a click, so it stays until dismissed rather than closing when the pointer leaves. */
  pinned: boolean;
}

interface Scope {
  prefix: string;
  open: Open | null;
  host: HTMLElement | null;
  anchors: Map<string, HTMLElement>;
  setOpen: React.Dispatch<React.SetStateAction<Open | null>>;
  hoverIn: (id: string) => void;
  hoverOut: () => void;
  cancel: () => void;
}

const PopContext = createContext<Scope | null>(null);

/** Marks the items and cards of every scope, so a press on any of them isn't a press "elsewhere". */
const ANCHOR_ATTR = "data-pop";
const INSIDE = `[${ANCHOR_ATTR}], .pop-card`;

/** One set of pop-overs: at most one is open at a time. `prefix` keeps the cards' element ids unique on the page. */
export function PopScope({ prefix, children }: { prefix: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setHost(ref.current?.closest<HTMLElement>(".desk") ?? document.body);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  }, []);
  const cancel = useCallback(() => window.clearTimeout(timer.current), []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Escape closes and hands focus back; a press anywhere but an item or a card closes a pinned one.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        const a = anchors.current.get(open.id);
        if (a && !a.contains(document.activeElement)) a.focus({ preventScroll: true });
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(INSIDE)) return;
      setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const hoverIn = useCallback(
    (id: string) => {
      if (open?.pinned && open.id !== id) return;
      later(() => setOpen((o) => (o?.pinned ? o : { id, pinned: false })), open ? 0 : OPEN_DELAY);
    },
    [open, later],
  );
  const hoverOut = useCallback(() => later(() => setOpen((o) => (o?.pinned ? o : null)), CLOSE_DELAY), [later]);

  const scope = useMemo<Scope>(
    () => ({
      prefix,
      open,
      host,
      anchors: anchors.current,
      setOpen,
      hoverIn,
      hoverOut,
      cancel,
    }),
    [prefix, open, host, hoverIn, hoverOut, cancel],
  );

  return (
    <PopContext.Provider value={scope}>
      <div className="pop-scope" ref={ref}>
        {children}
      </div>
    </PopContext.Provider>
  );
}

/** True when this focus came from the keyboard (a tap or click focuses too, and opens through the click instead). */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

export interface PopOptions {
  /**
   * Whether a click or tap pins the card. Off for an item whose click already does something, such as a summary
   * that opens its details: it still explains itself on hover and keyboard focus.
   */
  pin?: boolean;
}

/** Props for the item that explains itself, and its card. Spread `anchor` on the item and render `card(...)` beside it. */
export function usePop(id: string, { pin = true }: PopOptions = {}) {
  const scope = useContext(PopContext);
  if (!scope) throw new Error("usePop needs a PopScope");
  const { prefix, open, host, anchors, setOpen, hoverIn, hoverOut, cancel } = scope;
  const tipId = `${prefix}-tip-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const isOpen = open?.id === id;

  // The card is portalled but may sit inside the item in React's tree, so React bubbles its events to the item: only
  // events from the item's own DOM count.
  const own = (e: React.SyntheticEvent<HTMLElement>) => e.target instanceof Node && e.currentTarget.contains(e.target);

  const anchor = {
    ref: (el: HTMLElement | null) => {
      if (el) anchors.set(id, el);
      else if (anchors.get(id)) anchors.delete(id);
    },
    [ANCHOR_ATTR]: id,
    "aria-describedby": tipId,
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => e.pointerType === "mouse" && own(e) && hoverIn(id),
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => e.pointerType === "mouse" && own(e) && hoverOut(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || !keyboardFocus(e.currentTarget)) return;
      cancel();
      setOpen((o) => (o?.id === id ? o : { id, pinned: false }));
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      if (!own(e) || (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) return;
      setOpen((o) => (o?.id === id && !o.pinned ? null : o));
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (!pin || !own(e)) return;
      // A link inside the item does its own thing.
      const link = (e.target as Element).closest?.("a");
      if (link && link !== e.currentTarget && e.currentTarget.contains(link)) return;
      cancel();
      setOpen((o) => (o?.id === id && o.pinned ? null : { id, pinned: true }));
    },
  };

  const card = (children: React.ReactNode, { className = "", style }: { className?: string; style?: React.CSSProperties } = {}) =>
    host
      ? createPortal(
          <PopCard id={tipId} open={isOpen} anchor={isOpen ? (anchors.get(id) ?? null) : null} onEnter={cancel} onLeave={hoverOut} className={className} style={style}>
            {children}
          </PopCard>,
          host,
        )
      : null;

  return { anchor, open: isOpen, card };
}

function PopCard({
  id,
  open,
  anchor,
  onEnter,
  onLeave,
  className,
  style,
  children,
}: {
  id: string;
  open: boolean;
  anchor: HTMLElement | null;
  onEnter: () => void;
  onLeave: () => void;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const pop = ref.current;
      if (!pop) return;
      const a = anchor.getBoundingClientRect();
      setPlace(
        placePopover(
          a,
          { width: pop.offsetWidth, height: pop.offsetHeight },
          {
            width: document.documentElement.clientWidth,
            height: window.innerHeight,
          },
        ),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchor]);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      hidden={!open}
      className={`pop-card conn-pop ${className} ${place ? `is-placed conn-pop--${place.side}` : ""}`}
      style={
        {
          ...style,
          "--arrow": place ? `${place.arrow}px` : "50%",
          left: place?.left ?? 0,
          top: place?.top ?? 0,
        } as React.CSSProperties
      }
      onPointerEnter={(e) => e.pointerType === "mouse" && onEnter()}
      onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()}
    >
      {children}
    </div>
  );
}
