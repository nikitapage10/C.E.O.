import { lazy, Suspense, useEffect } from "react";
import { startFoundry } from "../foundry.ts";
import { loadLattice, navigate, usePathname, type Route } from "../route.ts";
import { useSystems, type LinkState } from "../systems.ts";
import { startWorldClock } from "../worldClock.ts";
import { useAwaySince } from "./awaySince.ts";
import { useDeskData } from "./deskData.ts";
import { useNow } from "./motion.tsx";
import { link } from "./nav.ts";
import { startDeskWorker } from "./pings.ts";
import { startDeskAuth } from "./signin.ts";
import { systemsTitle } from "./SystemsNav.tsx";
import { SkippyCan } from "./SkippySlot.tsx";
import { ASK_SKIPPY_EVENT, Today } from "./Today.tsx";
import "./desk.css";
import "./chronicle.css";
import "./weave.css";

// Today is in the first load; every other tab loads the first time it is opened (and is fetched in the idle time
// after the first paint, so switching stays instant).
const loaders = {
  relay: () => import("./Relay.tsx"),
  foundry: () => import("./FoundryPage.tsx"),
  systems: () => import("./SystemsHub.tsx"),
  chronicle: () => import("./Chronicle.tsx"),
};
const Relay = lazy(() => loaders.relay().then((m) => ({ default: m.Relay })));
const FoundryPage = lazy(() => loaders.foundry().then((m) => ({ default: m.FoundryPage })));
const SystemsHub = lazy(() => loaders.systems().then((m) => ({ default: m.SystemsHub })));
const Chronicle = lazy(() => loaders.chronicle().then((m) => ({ default: m.Chronicle })));

/** Fetch the other tabs once the browser is idle after first paint. Failures are ignored: opening the tab retries. */
function prefetchTabs() {
  const run = () => Object.values(loaders).forEach((load) => void load().catch(() => {}));
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

/** What shows for the moment a tab's code is on its way: a quiet glass panel, no spinner. */
function TabLoading() {
  return <div className="desk__loading" role="status" aria-label="Loading" />;
}

/**
 * The Desk: the Lattice's control room as a flat, fast page, where the C.E.O. acts on what the agents bring in.
 * Same world as the 3D Lattice (its colours, its stills, its cast) but it never loads it; "Enter the Lattice"
 * fetches that on demand. It shows only real work: the Foundry from GitHub now, Relay and the rooms once the hub
 * on the MacBook is connected.
 */

type DeskTab = Exclude<Route, "lattice">;

/** The tabs, each with the colour of the room it belongs to (Today is Skippy's own warm light). */
const TABS: { id: DeskTab; label: string; colour: string }[] = [
  { id: "today", label: "Today", colour: "var(--amber)" },
  { id: "relay", label: "Relay", colour: "var(--room-relay)" },
  { id: "foundry", label: "Foundry", colour: "var(--room-foundry)" },
  { id: "systems", label: "Systems", colour: "var(--room-boiler)" },
  { id: "chronicle", label: "Chronicle", colour: "var(--room-archive)" },
];

/** The can in the bar: Skippy's Ask box lives on Today, so it goes there and brings the box into view. */
function askSkippy() {
  if (window.location.pathname !== "/") navigate("today", window.location.search);
  window.setTimeout(() => window.dispatchEvent(new Event(ASK_SKIPPY_EVENT)), 60);
}

/**
 * The sky behind every Desk page: the void, three slow glows in room colours, a few long threads drifting across it
 * and a fine dust of stars. CSS and one static SVG only; the motion is transforms, so it costs the CPU next to
 * nothing, and it holds still with reduced motion.
 */
function WeaveSky() {
  return (
    <div className="desk__sky" aria-hidden="true">
      <span className="desk__glow desk__glow--a" />
      <span className="desk__glow desk__glow--b" />
      <span className="desk__glow desk__glow--c" />
      <svg className="desk__weave" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <path d="M-100 220C300 120 520 420 860 300S1380 80 1700 200" style={{ stroke: "var(--room-foundry)" }} />
        <path d="M-100 300C260 260 600 520 940 380S1400 200 1700 330" style={{ stroke: "var(--room-relay)" }} />
        <path d="M-100 520C340 600 620 360 980 520S1420 700 1700 560" style={{ stroke: "var(--room-archive)" }} />
        <path d="M-100 700C300 640 700 860 1020 720S1460 600 1700 760" style={{ stroke: "var(--room-exchange)" }} />
        <path d="M-100 860C380 820 640 960 1000 880S1500 820 1700 920" style={{ stroke: "var(--room-breakroom)" }} />
      </svg>
      <span className="desk__stars" />
    </div>
  );
}


const HUB_LINE: Record<LinkState, string> = {
  off: "Not connected to your hub yet. Once the MacBook is set up, Relay's work shows up here.",
  ok: "",
  slow: "The hub is answering slowly. Lists may lag a little.",
  down: "The hub is down. What you see is from before it stopped.",
};

const HUB_PILL: Record<LinkState, string> = { off: "Hub offline", ok: "Hub live", slow: "Hub slow", down: "Hub down" };

export function Desk({ route }: { route: DeskTab }) {
  const awaySince = useAwaySince();
  const data = useDeskData(awaySince);
  const now = useNow(30_000);
  const hub = useSystems((s) => s.links.find((l) => l.id === "hub")?.state ?? "off");

  useEffect(() => {
    startFoundry();
    startWorldClock();
    startDeskAuth();
    // The Desk as a home-screen app, and its pings (#135).
    void startDeskWorker();
    prefetchTabs();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("input, textarea")) return;
      const i = Number(e.key) - 1;
      if (TABS[i]) navigate(TABS[i].id, window.location.search);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pathname = usePathname();
  useEffect(() => {
    document.title = route === "relay" ? "Relay · C.E.O." : route === "foundry" ? "Foundry · C.E.O." : route === "systems" ? systemsTitle(pathname) : route === "chronicle" ? "Chronicle · C.E.O." : "C.E.O. — Desk";
  }, [route, pathname]);

  const owed = data.owed.length + data.actions.filter((a) => a.when === "now").length;
  const connected = hub !== "off";

  return (
    <div className="desk" data-route={route}>
      <WeaveSky />

      <header className="desk__bar">
        <div className="desk__bar-row">
          <a className="desk__mark" href="/" onClick={link("today")} aria-label="C.E.O. Desk, Today">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <defs>
                <linearGradient id="desk-mark" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#f0a05a" />
                  <stop offset="0.5" stopColor="#a493f0" />
                  <stop offset="1" stopColor="#74dcb4" />
                </linearGradient>
              </defs>
              <path d="M4 20c6-10 12-10 16 0s10 10 16 0" />
              <path d="M4 20c6 10 12 10 16 0s10-10 16 0" />
              <circle cx="20" cy="20" r="2.6" />
            </svg>
            <span>
              C.E.O.<small>Desk</small>
            </span>
          </a>
          <nav className="desk__tabs" aria-label="Desk">
            {TABS.map((t, i) => (
              <a
                key={t.id}
                href={t.id === "today" ? "/" : `/${t.id}`}
                className={route === t.id ? "on" : ""}
                aria-current={route === t.id ? "page" : undefined}
                onClick={link(t.id)}
                title={`${t.label} (${i + 1})`}
                style={{ "--c": t.colour } as React.CSSProperties}
              >
                <i aria-hidden="true" />
                {t.label}
                {t.id === "today" && owed > 0 && (
                  <span className="desk__count" title="Things that need you">
                    {owed}
                  </span>
                )}
              </a>
            ))}
          </nav>
          <div className="desk__right">
            <span className={`desk__hub desk__hub--${hub}`} title={`Hub: ${HUB_PILL[hub]}`}>
              <i aria-hidden="true" />
              <span>{HUB_PILL[hub]}</span>
            </span>
            <button type="button" className="desk__skippy" onClick={askSkippy} title="Ask Skippy" aria-label="Ask Skippy">
              <SkippyCan size={30} />
              <span>Ask Skippy</span>
            </button>
            <a className="desk__enter" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()}>
              <img src="/desk/lattice.webp" alt="" aria-hidden="true" decoding="async" />
              <span>Enter the Lattice</span>
              <i aria-hidden="true">→</i>
            </a>
          </div>
        </div>
      </header>

      {hub !== "ok" && (
        <p className={`desk__notice desk__notice--${hub}`} role="status">
          <span className="desk__notice-text">{HUB_LINE[hub]}</span>
        </p>
      )}

      <main className="desk__main" key={route}>
        <Suspense fallback={<TabLoading />}>
          {route === "relay" ? (
            <Relay data={data} now={now} connected={connected} />
          ) : route === "foundry" ? (
            <FoundryPage now={now} />
          ) : route === "chronicle" ? (
            <Chronicle now={now} awaySince={awaySince} />
          ) : route === "systems" ? (
            <SystemsHub now={now} />
          ) : (
            <Today data={data} now={now} connected={connected} awaySince={awaySince} />
          )}
        </Suspense>
      </main>

      <footer className="desk__foot">
        <span>Command Everything, Obviously</span>
        <span className="desk__foot-rule" aria-hidden="true" />
        <span>Ilyr · the Syntherion Lattice</span>
      </footer>
    </div>
  );
}
