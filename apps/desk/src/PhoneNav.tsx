import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import { navigateTo, usePathname, type RoomRoute } from "../../world/src/route.ts";
import { sectionOf } from "@ceo/engine/web/sections.ts";
import { sigilOf, sigilPath } from "@ceo/engine/sigils/roomSigils.ts";
import { AccountMenu, KEY_ORDER, LatticeMark, pathOf, ROOM_TABS } from "./DeskNav.tsx";
import { link } from "./nav.ts";
import { phoneShelf } from "./phoneShelf.ts";
import { pageName, pageSections, type DeskPage } from "./roomPages.ts";
import { HandsFreeLive } from "./roomvoice/RoomMic.tsx";
import { TabFan } from "./TabFan.tsx";
import { askSkippy } from "./skippy/callFirst.ts";
import "./phonenav.css";

/**
 * The Desk on a phone (#1045, Nikita 2026-11-12: "it should look different on mobile than it does on desktop"): its own
 * frame, not the desktop bar made small. At the top a slim fixed bar: the mark (to the Senate), the room you're in with
 * its tab, which opens the Rooms sheet, and the account and the Lattice on the right. At the bottom a fixed bar of the
 * pages used most, thumb height: the Senate, the Haven, Skippy in the middle, Relay, and Rooms (or the room you're in,
 * when it's another), which opens every page and the room's own tabs in a sheet (shut by the scrim, the X, Escape or
 * a swipe down). Tapping a room with tabs (the Haven) fans its tabs out over its slot instead of going in (#1118, TabFan.tsx). Neither bar scrolls, wraps or moves under a held finger (`touch-action: none`), and the page under
 * them is the one thing that scrolls.
 */

const accentOf = (id: DeskPage) => (id === "today" ? "var(--ice)" : `var(--room-${id})`);
const lineOf = (id: DeskPage) => (id in ROOM_TABS ? ROOM_TABS[id as RoomRoute].line : id === "today" ? "What needs you, and the Council" : id === "relay" ? "Messages, calls and the codex" : id === "foundry" ? "The coding crew and what ships" : "");

function Sigil({ id }: { id: DeskPage }) {
  return (
    <svg className="ph-sigil" viewBox="0 0 48 48" aria-hidden="true" style={{ color: accentOf(id) }}>
      <path d={sigilPath(sigilOf(id))} />
    </svg>
  );
}

/** The Rooms sheet: the room's own tabs first (when it has some), then every page, then the Lattice. */
function RoomsSheet({ route, room = route, pathname, onClose }: { route: DeskPage; room?: DeskPage; pathname: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // Whose tabs lead the sheet: the room you're in, or another room's (the sheet's `room`).
  const sections = pageSections(room);
  const current = sections.length && room === route ? sectionOf(sections, pathname).id : null;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('[aria-current="page"], a')?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("keydown", esc);
      opener?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  const go = (path: string) => (e: ReactMouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onClose();
    navigateTo(path + (path.startsWith("/lattice") ? "" : window.location.search));
  };
  // Swipe down to shut it (#1049): a drag that starts with the list at its top pulls the sheet down with the finger;
  // let go past a quarter of its height (or flicked) and it shuts, short of that it springs back.
  const drag = useRef<{ y: number; t: number; dy: number; on: boolean } | null>(null);
  const onTouchStart = (e: ReactTouchEvent) => {
    const el = box.current;
    drag.current = el && el.scrollTop <= 0 && e.touches.length === 1 ? { y: e.touches[0]!.clientY, t: performance.now(), dy: 0, on: false } : null;
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const d = drag.current, el = box.current;
    if (!d || !el) return;
    const dy = e.touches[0]!.clientY - d.y;
    if (!d.on && (dy < 6 || el.scrollTop > 0)) {
      if (dy < 0 || el.scrollTop > 0) drag.current = null;
      return;
    }
    d.on = true;
    d.dy = Math.max(0, dy);
    el.style.transition = "none";
    el.style.transform = `translateY(${d.dy}px)`;
  };
  const onTouchEnd = () => {
    const d = drag.current, el = box.current;
    drag.current = null;
    if (!d?.on || !el) return;
    const fast = d.dy / Math.max(1, performance.now() - d.t) > 0.6;
    if (d.dy > el.offsetHeight / 4 || (fast && d.dy > 40)) return onClose();
    el.style.transition = "transform 0.2s var(--wv-ease)";
    el.style.transform = "";
  };
  return (
    <div className="ph-sheetw">
      <div className="ph-scrim" onClick={onClose} aria-hidden="true" />
      <div className="ph-sheet" role="dialog" aria-modal="true" aria-label="Rooms" ref={box} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div className="ph-grab" aria-hidden="true" />
        <div className="ph-sheetHead">
          <p>Rooms</p>
          <button type="button" className="ph-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {sections.length > 0 && (
          <nav className="ph-secs" aria-label={`${pageName(room)} tabs`} style={{ ["--rc" as string]: accentOf(room) }}>
            {sections.map((s) => (
              <a key={s.id} href={s.path} aria-current={current === s.id ? "page" : undefined} onClick={go(s.path)}>
                <span>{s.label}</span>
                <small>{s.hint}</small>
              </a>
            ))}
          </nav>
        )}
        <nav className="ph-rooms" aria-label="Every room">
          {KEY_ORDER.map((id) => (
            <a key={id} href={pathOf(id)} aria-current={route === id ? "page" : undefined} onClick={go(pathOf(id))} style={{ ["--rc" as string]: accentOf(id) }}>
              <Sigil id={id} />
              <span>{pageName(id)}</span>
              <small>{lineOf(id)}</small>
            </a>
          ))}
        </nav>
        <a className="ph-lat" href="/lattice" onClick={go("/lattice")}>
          Enter the Lattice
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </div>
  );
}

export function PhoneNav({ route, owed }: { route: DeskPage; owed: number }) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);
  // A room with tabs opens them as a fan over its slot on a tap (#1118); iOS keeps the long press for itself.
  const [fan, setFan] = useState<DeskPage | null>(null);
  const [fanX, setFanX] = useState(0);
  const closeFan = useCallback(() => setFan(null), []);
  const closeSheet = useCallback(() => setSheet(false), []);
  // A move to another page or tab shuts the sheet and starts the new one at its top: on a phone a room is a long
  // column, and the Desk's one scroller would otherwise open it where the last one was left.
  useEffect(() => {
    setSheet(false);
    setFan(null);
    document.querySelector(".desk")?.scrollTo?.({ top: 0 });
  }, [pathname, route]);
  // The safe areas (the notch, the home bar) reach the Desk only with viewport-fit=cover; set while the phone frame is up.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const was = meta.content;
    if (!/viewport-fit/.test(was)) meta.content = `${was}, viewport-fit=cover`;
    return () => void (meta.content = was);
  }, []);

  const sections = pageSections(route);
  const section = sections.length ? sectionOf(sections, pathname) : null;
  const { pinned, other } = phoneShelf(route);
  const slot = (id: DeskPage) => (
    <a
      key={id}
      className={fan === id ? "ph-slot is-fan" : "ph-slot"}
      href={pathOf(id)}
      aria-current={route === id ? "page" : undefined}
      {...(pageSections(id).length > 0 && { "aria-haspopup": "menu" as const, "aria-expanded": fan === id })}
      onClick={(e) => {
        if (!pageSections(id).length || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return link(id)(e);
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setFanX(r.left + r.width / 2);
        setFan((f) => (f === id ? null : id));
      }}
      style={{ ["--rc" as string]: accentOf(id) }}
    >
      <Sigil id={id} />
      <span>{id === "today" ? "Senate" : pageName(id)}</span>
      {id === "today" && owed > 0 && (
        <b className="ph-n" aria-label={`${owed} need you`}>
          {owed}
        </b>
      )}
    </a>
  );

  return (
    <>
      <header className="wv-nav ph-top" style={{ ["--rc" as string]: accentOf(route) }}>
        <a className="ph-logo" href="/" onClick={link("today")} aria-label="C.E.O., the Desk: the Senate">
          <LatticeMark />
        </a>
        <button type="button" className="ph-title" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet} style={{ ["--rc" as string]: accentOf(route) }}>
          <b>{route === "today" ? "The Senate" : pageName(route)}</b>
          {section && section.id !== sections[0]?.id && <small>{section.label}</small>}
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ph-r">
          <HandsFreeLive />
          <AccountMenu />
          <a className="wv-navbtn ph-latb" href="/lattice" onClick={link("lattice")} aria-label="Enter the Lattice">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </header>
      <div className="ph-spacer" aria-hidden="true" />
      <nav className="ph-bar" aria-label="Desk">
        {slot(pinned[0])}
        {slot(pinned[1])}
        <button type="button" className="ph-slot ph-ask desk__skippy" onClick={askSkippy} aria-controls="skippy-chat" title="Call Skippy (end the call to type instead)">
          <i aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M3.8 7.6C5.9 4.7 8.7 3.4 12 3.4s6.1 1.3 8.2 4.2c-2.5-.8-5.2-1.1-8.2-1.1s-5.7.3-8.2 1.1z" fill="currentColor" />
              <rect x="7.4" y="8.2" width="9.2" height="12.6" rx="2.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="10.3" cy="14.4" r="1" fill="currentColor" />
              <circle cx="13.7" cy="14.4" r="1" fill="currentColor" />
            </svg>
          </i>
          <span>Skippy</span>
        </button>
        {slot(pinned[2])}
        <button type="button" className="ph-slot ph-more" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet} aria-current={other ? "page" : undefined} style={other ? { ["--rc" as string]: accentOf(other) } : undefined}>
          {other ? (
            <Sigil id={other} />
          ) : (
            <svg className="ph-sigil" viewBox="0 0 48 48" aria-hidden="true">
              <path d="M10 10h11v11H10zM27 10h11v11H27zM10 27h11v11H10zM27 27h11v11H27z" />
            </svg>
          )}
          <span>{other ? pageName(other) : "Rooms"}</span>
        </button>
      </nav>
      {fan && <TabFan sections={pageSections(fan)} pathname={pathname} accent={accentOf(fan)} x={fanX} onClose={closeFan} />}
      {sheet && <RoomsSheet route={route} pathname={pathname} onClose={closeSheet} />}
    </>
  );
}
