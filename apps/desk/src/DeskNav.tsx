import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { loadLattice, navigateTo, NAV_ORDER, usePathname, type Route, type RoomRoute } from "../../world/src/route.ts";
import { sectionOf, type RoomSection } from "@ceo/engine/web/sections.ts";
import { mountainHour, PART } from "./ilyrTime.ts";
import { link } from "./nav.ts";
import { pageName, pageSections, type DeskPage } from "./roomPages.ts";
import { DeskSignIn } from "@ceo/engine/web/SignIn.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { useHide } from "@ceo/engine/web/hide.ts";
import { HandsFreeLive } from "./roomvoice/RoomMic.tsx";

/**
 * The Desk's bar, in the Weave's own language (Nikita, 2026-10-22): the Lattice C and the wordmark (#640), then every page as a plain word
 * with a thread under the one you're on: the Senate (once Today, #775), the Foundry, Relay and each room, all in the bar, no menu (Nikita,
 * 05:15Z). On a phone the words scroll sideways. On the right, Ilyr's hour on a small ring, Hands-free (#638), the way into
 * the Lattice, and the account button: sign in, sign out, this device's list and the Site lock (Nikita, 05:30Z).
 * Keys 1 to 9 open them in order, 0 the tenth. The order is route.ts NAV_ORDER, by what actually works (Nikita,
 * 2026-11-04 07:06Z), the Boiler Room last, far right. Ask Skippy moved to the bottom right of every page (#638,
 * roomvoice/RoomMic.tsx). Since the Iris (#666) the bar keeps only the pages, the account button and the way into the
 * Lattice: Ilyr's clock, Hide and Hands-free moved to the Boiler Room's Settings (/boiler/controls), and while
 * Hands-free is on the bar shows who it is listening for, with a tap to stop it. A room with tabs (its manifest's
 * `sections`, from its nav.ts) gets a drop-down of them (#871): pointed at with a mouse, or the small caret beside its
 * name tapped or opened from the keyboard; each tab is its own link (/haven/kitchen, /boiler/controls).
 */

/** Each room tab's line, shown when pointed at. The pages' names come from their manifests (roomPages.ts, `pageName`). */
export const ROOM_TABS: Record<RoomRoute, { line: string }> = {
  boiler: { line: "Every connection, security and the house" },
  archive: { line: "The day as a story, and the Tide" },
  spire: { line: "Invoices and the idea scout" },
  exchange: { line: "Markets, research and money" },
  green: { line: "The fantasy league" },
  workshop: { line: "From a prompt to a print" },
  studio: { line: "Short videos that explain the internet" },
  annex: { line: "Pop-ups: short-run projects, election night first" },
  haven: { line: "Home and health: the house, the pets, the kitchen" },
};

/** Every page in the bar's order (route.ts NAV_ORDER): keys 1 to 9, then 0, open the first ten. */
export const KEY_ORDER: Exclude<Route, "lattice">[] = [...NAV_ORDER];
export const labelOf = pageName;

export const pathOf = (id: Exclude<Route, "lattice">) => (id === "today" ? "/" : `/${id}`);

/**
 * The C.E.O. mark (#640): the Lattice C. A pointy-top hexagon of silver lines and nodes, open on the right so it reads
 * as a C, its mouth running in to one gold core. The same geometry as the icons in scripts/desk-icons.mjs (radius 20
 * on a 48 grid); here the C itself is drawn a touch heavier than the inner lattice so it holds at header size.
 */
const MARK_C = "M41.32 14L24 4L6.68 14L6.68 34L24 44L41.32 34M41.32 14L24 24L41.32 34";
const MARK_LATTICE =
  "M24 4L24 44M6.68 14L24 24M6.68 24L24 24M6.68 34L24 24M15.34 9L32.66 19M32.66 9L15.34 19M15.34 39L32.66 29M32.66 39L15.34 29M15.34 19L15.34 29";
const MARK_NODES: [number, number][] = [
  [24, 4],
  [6.68, 14],
  [6.68, 24],
  [6.68, 34],
  [24, 44],
  [41.32, 14],
  [41.32, 34],
  [24, 14],
  [24, 34],
];

export function LatticeMark() {
  return (
    <svg className="wv-mark" viewBox="3 1 42 46" aria-hidden="true">
      <defs>
        <radialGradient id="wv-mark-core">
          <stop offset="0" stopColor="#e8cf9c" stopOpacity="0.85" />
          <stop offset="0.45" stopColor="#e8cf9c" stopOpacity="0.22" />
          <stop offset="1" stopColor="#e8cf9c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path className="wv-mark__lattice" d={MARK_LATTICE} />
      <path className="wv-mark__c" d={MARK_C} />
      <g className="wv-mark__nodes">
        {MARK_NODES.map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r="1.85" />
        ))}
      </g>
      <circle className="wv-mark__halo" cx="24" cy="24" r="10" fill="url(#wv-mark-core)" />
      <circle className="wv-mark__ring" cx="24" cy="24" r="3.9" />
      <circle className="wv-mark__core" cx="24" cy="24" r="2.5" />
    </svg>
  );
}

export function IlyrClock({ now }: { now: number }) {
  const h = mountainHour(now);
  const hour = Math.floor(h) || 24;
  const C = 2 * Math.PI * 12;
  const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
  const d = new Date(now);
  return (
    <div className="wv-clock" title="Ilyr's hour, on the Mountain clock the world keeps">
      <svg viewBox="0 0 30 30" aria-hidden="true">
        <circle cx="15" cy="15" r="12" fill="none" stroke="rgba(236,238,243,.14)" strokeWidth="1.5" />
        <circle cx="15" cy="15" r="12" fill="none" stroke="#ffdcaa" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={`${((h / 24) * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 15 15)" />
        <circle cx={15 + Math.cos(a) * 12} cy={15 + Math.sin(a) * 12} r="2" fill="#ffdcaa" />
      </svg>
      <p>
        <b>Ilyr, {PART(h).toLowerCase()}</b>hour {hour} of 24
      </p>
      <p className="wv-now">
        <b>{d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</b>
        {d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
      </p>
    </div>
  );
}

/** Sign-in, sign-out and the Site lock behind one button at the top right (Nikita, 2026-10-22 05:30Z). */
function AccountMenu() {
  const auth = useDeskAuth((s) => s.auth);
  const hidden = useHide((s) => s.on);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (auth.status === "off") return null;
  const signedIn = auth.status === "in";
  const label = signedIn ? "Signed in" : auth.status === "checking" ? "Checking" : "Sign in";
  return (
    <div className="wv-acct" ref={box}>
      <button type="button" className="wv-navbtn wv-acct__btn" data-in={signedIn || undefined} aria-expanded={open} aria-controls="wv-acct-menu" onClick={() => setOpen(!open)} title={signedIn ? `Signed in${auth.device && !hidden ? ` on ${auth.device}` : ""}: sign out, devices and the Site lock` : "Sign in with your passkey"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {signedIn ? (
            <path d="M7 11V8a5 5 0 0 1 9.6-1.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          ) : (
            <path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          )}
          <rect x="5" y="11" width="14" height="10" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="16" r="1.4" fill="currentColor" />
        </svg>
        <span>{label}</span>
      </button>
      {open && (
        <div className="wv-acct__menu" id="wv-acct-menu" role="dialog" aria-label="Sign-in and site lock">
          <DeskSignIn />
        </div>
      )}
    </div>
  );
}

/** Where an open drop-down sits, under its room's name in the bar, and how it was opened (a pointer's hover closes on leaving). */
interface Drop {
  id: DeskPage;
  left: number;
  top: number;
  pinned: boolean;
  focus: boolean;
}

/** A room's drop-down (#871): one link per tab, the one you're on marked in gold. Arrow keys move, Escape closes. */
function RoomDrop({ drop, sections, current, label, onClose, onHover }: { drop: Drop; sections: readonly RoomSection[]; current: string | null; label: string; onClose: (back: boolean) => void; onHover: (on: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  // Kept inside the window on a phone: shifted left when it would run off the right edge.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.left = `${drop.left}px`;
    const over = el.getBoundingClientRect().right - (window.innerWidth - 8);
    if (over > 0) el.style.left = `${Math.max(8, drop.left - over)}px`;
    if (drop.focus) el.querySelector<HTMLElement>("a")?.focus();
  }, [drop]);
  const keys = (e: ReactKeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>("a") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (at + 1) % items.length : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      items[to]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    }
  };
  const go = (path: string) => (e: ReactMouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onClose(false);
    navigateTo(path + window.location.search);
  };
  return (
    <div
      className="wv-drop"
      id={`wv-drop-${drop.id}`}
      ref={box}
      style={{ top: drop.top }}
      onKeyDown={keys}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onHover(false)}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !box.current?.contains(to) && !(to as HTMLElement).closest?.(`[data-drop="${drop.id}"]`)) onClose(false);
      }}
    >
      <nav aria-label={`${label} tabs`}>
        {sections.map((s) => (
          <a key={s.id} href={s.path} aria-current={current === s.id ? "page" : undefined} onClick={go(s.path)}>
            <span>{s.label}</span>
            <small>{s.hint}</small>
          </a>
        ))}
      </nav>
    </div>
  );
}

export function DeskNav({ route, owed }: { route: Exclude<Route, "lattice">; owed: number; now?: number }) {
  const tabs = useRef<HTMLElement>(null);
  const head = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const pages: { id: Exclude<Route, "lattice">; label: string; sections: readonly RoomSection[] }[] = KEY_ORDER.map((id) => ({ id, label: labelOf(id), sections: pageSections(id) }));

  // The open drop-down (#871), placed under its room's name; a hover's waits a moment before closing, so the pointer
  // can cross to it.
  const [drop, setDrop] = useState<Drop | null>(null);
  const shut = useRef(0);
  const hold = () => window.clearTimeout(shut.current);
  const later = () => {
    hold();
    shut.current = window.setTimeout(() => setDrop((d) => (d && !d.pinned ? null : d)), 180);
  };
  const openAt = (id: DeskPage, at: HTMLElement, how: { pinned: boolean; focus: boolean }) => {
    hold();
    const h = head.current?.getBoundingClientRect();
    const r = at.getBoundingClientRect();
    if (!h) return;
    setDrop({ id, left: Math.round(r.left - h.left), top: Math.round(r.bottom - h.top), ...how });
  };
  const close = (back: boolean) => {
    hold();
    if (back && drop) head.current?.querySelector<HTMLElement>(`[data-drop="${drop.id}"] .wv-tabcaret`)?.focus();
    setDrop(null);
  };
  // Shut on a move, a tap elsewhere, Escape, the bar scrolling sideways or the window resizing.
  useEffect(() => setDrop(null), [pathname]);
  useEffect(() => {
    if (!drop) return;
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".wv-drop") && !t?.closest?.(`[data-drop="${drop.id}"]`)) setDrop(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDrop(null);
    const off = () => setDrop(null);
    const row = tabs.current;
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", off);
    row?.addEventListener("scroll", off, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", off);
      row?.removeEventListener("scroll", off);
    };
  }, [drop]);
  useEffect(() => () => window.clearTimeout(shut.current), []);

  // On a phone the row scrolls: keep the page you're on in view. Asked in the next frame, once the new page has mounted,
  // and only when the row overflows (#417): scrollIntoView lays the whole page out on the spot, and in the commit it
  // did that before the page's own canvases had measured, so a page switch laid out twice.
  useEffect(() => {
    const row = tabs.current;
    if (!row) return;
    const id = requestAnimationFrame(() => {
      if (row.scrollWidth <= row.clientWidth) return;
      row.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(id);
  }, [route]);

  return (
    <header className="wv-nav" ref={head}>
      <a className="wv-logo" href="/" onClick={link("today")} aria-label="C.E.O., the Desk: Today">
        <LatticeMark />
        <span>C.E.O.</span>
      </a>
      <nav className="wv-tabs desk__tabs" aria-label="Desk" ref={tabs}>
        {pages.map((t, i) => {
          const tab = (
            <a key={t.id} className="wv-tab" href={pathOf(t.id)} aria-current={route === t.id ? "page" : undefined} onClick={link(t.id)} title={`${t.id in ROOM_TABS ? ROOM_TABS[t.id as RoomRoute].line : t.label}${i < 10 ? ` (${(i + 1) % 10})` : ""}`} data-room={t.id === "today" ? undefined : t.id}>
              {t.label}
              {t.id === "today" && owed > 0 && (
                <b className="wv-tab-n" title="Things that need you">
                  {owed}
                </b>
              )}
            </a>
          );
          if (!t.sections.length) return tab;
          const isOpen = drop?.id === t.id;
          return (
            <div key={t.id} className="wv-tabw" data-drop={t.id} data-open={isOpen || undefined} onPointerEnter={(e) => e.pointerType === "mouse" && openAt(t.id, e.currentTarget, { pinned: false, focus: false })} onPointerLeave={(e) => e.pointerType === "mouse" && later()}>
              {tab}
              <button
                type="button"
                className="wv-tabcaret"
                aria-expanded={isOpen}
                aria-controls={isOpen ? `wv-drop-${t.id}` : undefined}
                aria-label={`${t.label} tabs`}
                onClick={(e) => (isOpen && drop.pinned ? close(false) : openAt(t.id, e.currentTarget.parentElement!, { pinned: true, focus: e.detail === 0 }))}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    close(false);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    openAt(t.id, e.currentTarget.parentElement!, { pinned: true, focus: true });
                  }
                }}
              >
                <svg viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </nav>
      {drop && (
        <RoomDrop
          drop={drop}
          sections={pageSections(drop.id)}
          current={route === drop.id ? sectionOf(pageSections(drop.id), pathname).id : null}
          label={labelOf(drop.id)}
          onClose={close}
          onHover={(on) => (on ? hold() : later())}
        />
      )}
      <div className="wv-navr">
        <HandsFreeLive />
        <AccountMenu />
        <a className="wv-navbtn wv-navlat" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()} title="Enter the Lattice">
          <span>Lattice</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </header>
  );
}
