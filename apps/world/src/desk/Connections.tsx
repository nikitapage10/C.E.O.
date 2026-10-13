import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CONNECTIONS, type Connection } from "./connections.ts";
import { DESK_ROOMS } from "./deskData.ts";
import { placePopover, type Placement } from "./popover.ts";
import { Pill } from "./ui.tsx";

/**
 * The Systems page's "How it connects" (issue #69), kept quiet at a glance (issue #80): each link shows only its name
 * and what it serves, and the rest (its kind, how it's called, how it signs in, how often) pops up on hover, on
 * keyboard focus, or on a tap. A tap pins the card; tapping elsewhere or Escape closes it.
 */

/** The ones in use first, then Relay's planned ones. */
const LIST = [...CONNECTIONS].sort((a, b) => (a.status === b.status ? 0 : a.status === "live" ? -1 : 1));

const OPEN_DELAY = 90;
const CLOSE_DELAY = 160;

interface Open {
  id: string;
  /** Opened by a tap or a click, so it stays until dismissed rather than closing when the pointer leaves. */
  pinned: boolean;
}

const tipId = (id: string) => `conn-tip-${id}`;

export function Connections() {
  const sectionRef = useRef<HTMLElement>(null);
  const anchors = useRef(new Map<string, HTMLButtonElement>());
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // The cards live at the Desk's root: the page beneath it animates in with a transform, which would trap a
  // fixed-position card inside it.
  useEffect(() => {
    setHost(sectionRef.current?.closest<HTMLElement>(".desk") ?? document.body);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  }, []);
  const cancel = useCallback(() => window.clearTimeout(timer.current), []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Escape closes; a press anywhere but an item or its card closes a pinned one.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        anchors.current.get(open.id)?.focus({ preventScroll: true });
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".conn__item, .conn-pop")) return;
      setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const hoverIn = (id: string) => {
    if (open?.pinned && open.id !== id) return;
    later(() => setOpen((o) => (o?.pinned ? o : { id, pinned: false })), open ? 0 : OPEN_DELAY);
  };
  const hoverOut = () => later(() => setOpen((o) => (o?.pinned ? o : null)), CLOSE_DELAY);

  return (
    <section className="conn" aria-label="How it connects" ref={sectionRef}>
      <header className="section-head">
        <h2>How it connects</h2>
        <span className="panel__hint">Hover or tap a link for how it's called</span>
      </header>
      <ul className="conn__grid">
        {LIST.map((c) => {
          const isOpen = open?.id === c.id;
          return (
            <li key={c.id} className={`conn__item conn__item--${c.status}`} style={{ "--tone": DESK_ROOMS[c.room].accent } as React.CSSProperties}>
              <button
                type="button"
                className={`conn__chip ${isOpen ? "is-open" : ""}`}
                ref={(el) => {
                  if (el) anchors.current.set(c.id, el);
                  else anchors.current.delete(c.id);
                }}
                aria-expanded={isOpen}
                aria-describedby={tipId(c.id)}
                onPointerEnter={(e) => e.pointerType === "mouse" && hoverIn(c.id)}
                onPointerLeave={(e) => e.pointerType === "mouse" && hoverOut()}
                onFocus={() => {
                  cancel();
                  setOpen((o) => (o?.id === c.id ? o : { id: c.id, pinned: false }));
                }}
                onBlur={(e) => {
                  if (e.relatedTarget instanceof Element && e.relatedTarget.closest(".conn__item")) return;
                  setOpen((o) => (o?.id === c.id && !o.pinned ? null : o));
                }}
                onClick={() => {
                  cancel();
                  setOpen((o) => (o?.id === c.id && o.pinned ? null : { id: c.id, pinned: true }));
                }}
              >
                <span className="conn__serves">{c.serves}</span>
                <span className="conn__name">{c.name}</span>
                <span className={`conn__dot conn__dot--${c.status}`} aria-label={c.status === "live" ? "In use" : "Planned"} role="img" />
              </button>
            </li>
          );
        })}
      </ul>
      {host &&
        createPortal(
          LIST.map((c) => (
            <ConnectionCard
              key={c.id}
              c={c}
              open={open?.id === c.id}
              anchor={open?.id === c.id ? (anchors.current.get(c.id) ?? null) : null}
              onEnter={cancel}
              onLeave={hoverOut}
            />
          )),
          host,
        )}
    </section>
  );
}

function ConnectionCard({ c, open, anchor, onEnter, onLeave }: { c: Connection; open: boolean; anchor: HTMLElement | null; onEnter: () => void; onLeave: () => void }) {
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
      setPlace(placePopover(a, { width: pop.offsetWidth, height: pop.offsetHeight }, { width: document.documentElement.clientWidth, height: window.innerHeight }));
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
      id={tipId(c.id)}
      role="tooltip"
      hidden={!open}
      className={`conn-pop conn-pop--${c.status} ${place ? `is-placed conn-pop--${place.side}` : ""}`}
      style={
        {
          "--tone": DESK_ROOMS[c.room].accent,
          "--arrow": place ? `${place.arrow}px` : "50%",
          left: place?.left ?? 0,
          top: place?.top ?? 0,
        } as React.CSSProperties
      }
      onPointerEnter={(e) => e.pointerType === "mouse" && onEnter()}
      onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()}
    >
      <div className="conn-pop__top">
        <span className="conn-pop__name">{c.name}</span>
        <Pill tone={c.status === "live" ? "ok" : "off"}>{c.status === "live" ? "In use" : "Planned"}</Pill>
      </div>
      <ul className="conn__kinds" aria-label="Kind">
        {c.kinds.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
      <p className="conn-pop__how">{c.how}</p>
      <dl className="conn-pop__facts">
        <div>
          <dt>Signs in</dt>
          <dd>{c.auth}</dd>
        </div>
        <div>
          <dt>How often</dt>
          <dd>{c.when}</dd>
        </div>
      </dl>
    </div>
  );
}
