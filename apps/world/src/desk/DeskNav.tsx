import { useEffect, useRef, useState } from "react";
import { loadLattice, ROOM_ROUTES, type Route, type RoomRoute } from "../route.ts";
import { mountainHour, PART } from "./ilyrTime.ts";
import { link } from "./nav.ts";
import { DeskSignIn } from "./SignIn.tsx";
import { useDeskAuth } from "./signin.ts";
import { useSkippy } from "./skippy/chat.ts";

/**
 * The Desk's bar, in the Weave's own language (Nikita, 2026-10-22): the woven wordmark, then every page as a plain word
 * with a thread under the one you're on: Today, the Foundry, Relay and each room, all in the bar, no menu (Nikita,
 * 05:15Z). On a phone the words scroll sideways. On the right, Ilyr's hour on a small ring, Skippy and the way into the
 * Lattice, both quiet, and the account button: sign in, sign out, this device's list and the Site lock (Nikita, 05:30Z).
 * Keys 1 to 9 open them in order. The Boiler Room comes last (Nikita, 05:35Z).
 */

export const MAIN_TABS: { id: Exclude<Route, "lattice" | RoomRoute>; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "foundry", label: "Foundry" },
  { id: "relay", label: "Relay" },
];

export const ROOM_TABS: Record<RoomRoute, { label: string; line: string }> = {
  boiler: { label: "Boiler Room", line: "Every connection, security and the house" },
  archive: { label: "Archive", line: "The day as a story, and the Tide" },
  spire: { label: "Spire", line: "Invoices and the idea scout" },
  exchange: { label: "Exchange", line: "Markets, research and money" },
  green: { label: "Green", line: "The fantasy league" },
  workshop: { label: "Workshop", line: "From a prompt to a print" },
};

/** Every page in key order: 1 Today, 2 Foundry, 3 Relay, then the rooms. */
export const KEY_ORDER: Exclude<Route, "lattice">[] = [...MAIN_TABS.map((t) => t.id), ...ROOM_ROUTES];

export const pathOf = (id: Exclude<Route, "lattice">) => (id === "today" ? "/" : `/${id}`);

/** The woven mark: one thread looped through itself, its two ends in the Foundry's and Relay's colours. */
export function WovenMark() {
  return (
    <svg className="wv-mark" viewBox="0 0 30 22" aria-hidden="true">
      <defs>
        <linearGradient id="wv-mark-g" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e4985e" />
          <stop offset="0.55" stopColor="#ffdcaa" />
          <stop offset="1" stopColor="#7d9fe2" />
        </linearGradient>
      </defs>
      <path className="wv-mark__under" d="M2 17C9 17 10 4 15.5 4C20.5 4 20.5 13 15 13C10 13 11.5 6 28 6" />
      <path className="wv-mark__t" d="M2 17C9 17 10 4 15.5 4C20.5 4 20.5 13 15 13C10 13 11.5 6 28 6" stroke="url(#wv-mark-g)" />
      <path className="wv-mark__gap" d="M12.1 9.6 13.2 7.4" />
      <circle cx="15" cy="13" r="1.5" fill="#ffdcaa" />
    </svg>
  );
}

function IlyrClock({ now }: { now: number }) {
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
      <button type="button" className="wv-navbtn wv-acct__btn" data-in={signedIn || undefined} aria-expanded={open} aria-controls="wv-acct-menu" onClick={() => setOpen(!open)} title={signedIn ? `Signed in${auth.device ? ` on ${auth.device}` : ""}: sign out, devices and the Site lock` : "Sign in with your passkey"}>
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

export function DeskNav({ route, owed, now }: { route: Exclude<Route, "lattice">; owed: number; now: number }) {
  const tabs = useRef<HTMLElement>(null);
  const skippyOpen = useSkippy((s) => s.open);
  const setSkippy = useSkippy((s) => s.setOpen);
  const pages: { id: Exclude<Route, "lattice">; label: string }[] = [...MAIN_TABS, ...ROOM_ROUTES.map((id) => ({ id, label: ROOM_TABS[id].label }))];

  // On a phone the row scrolls: keep the page you're on in view.
  useEffect(() => {
    const el = tabs.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [route]);

  return (
    <header className="wv-nav">
      <a className="wv-logo" href="/" onClick={link("today")} aria-label="C.E.O., the Desk: Today">
        <WovenMark />
        <span>C.E.O.</span>
      </a>
      <nav className="wv-tabs desk__tabs" aria-label="Desk" ref={tabs}>
        {pages.map((t, i) => (
          <a key={t.id} className="wv-tab" href={pathOf(t.id)} aria-current={route === t.id ? "page" : undefined} onClick={link(t.id)} title={t.id in ROOM_TABS ? `${ROOM_TABS[t.id as RoomRoute].line} (${i + 1})` : `${t.label} (${i + 1})`} data-room={t.id === "today" ? undefined : t.id}>
            {t.label}
            {t.id === "today" && owed > 0 && (
              <b className="wv-tab-n" title="Things that need you">
                {owed}
              </b>
            )}
          </a>
        ))}
      </nav>
      <div className="wv-navr">
        <IlyrClock now={now} />
        <AccountMenu />
        <button type="button" className="wv-navbtn desk__skippy" onClick={() => setSkippy(!skippyOpen)} aria-expanded={skippyOpen} aria-controls="skippy-chat" title="Ask Skippy">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.8 7.6C5.9 4.7 8.7 3.4 12 3.4s6.1 1.3 8.2 4.2c-2.5-.8-5.2-1.1-8.2-1.1s-5.7.3-8.2 1.1z" fill="currentColor" />
            <rect x="7.4" y="8.2" width="9.2" height="12.6" rx="2.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="10.3" cy="14.4" r="1" fill="currentColor" />
            <circle cx="13.7" cy="14.4" r="1" fill="currentColor" />
          </svg>
          <span>Ask Skippy</span>
        </button>
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
