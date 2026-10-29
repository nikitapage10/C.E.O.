import { lazy, Suspense, useEffect, useRef } from "react";
import { startFoundry } from "../foundry.ts";
import { warmLattice } from "../latticeWarm.ts";
import { navigate, renamedPath, usePathname, type Route } from "../route.ts";
import { useSystems } from "../systems.ts";
import { startWorldClock } from "../worldClock.ts";
import { useAwaySince } from "./awaySince.ts";
import { useHide } from "./hide.ts";
import { DeskNav, KEY_ORDER, ROOM_TABS } from "./DeskNav.tsx";
import { DeskSky } from "./DeskSky.tsx";
import { startDeskTiming } from "./deskBeacon.ts";
import { useDeskData } from "./deskData.ts";
import { useNow } from "./motion.tsx";
import { startDeskWorker } from "./pings.ts";
import { startDeskAuth } from "./signin.ts";
import { systemsTitle } from "./SystemsNav.tsx";
import { useSkippy } from "./skippy/index.ts";
import { loadTodayMore, Today } from "./Today.tsx";
import { HologramCall } from "./hologram/HologramCall.tsx";
import "./desk.css";
import "./chronicle.css";
import "./weave.css";
import "./wv.css";

// Today is in the first load; every other page loads the first time it is opened (and is fetched in the idle time
// after the first paint, so switching stays instant).
const loaders = {
  relay: () => import("./Relay.tsx"),
  foundry: () => import("./FoundryPage.tsx"),
  boiler: () => import("./SystemsHub.tsx"),
  archive: () => import("./Archive.tsx"),
  spire: () => import("./rooms/Spire.tsx"),
  exchange: () => import("./rooms/Exchange.tsx"),
  green: () => import("./rooms/Green.tsx"),
  workshop: () => import("./rooms/Workshop.tsx"),
  studio: () => import("./rooms/Studio.tsx"),
  // Not pages, but kept out of the first load the same way: Skippy's open dialogue and the rest of Today.
  skippy: () => import("./skippy/SkippyDialog.tsx"),
  more: loadTodayMore,
};
const Relay = lazy(() => loaders.relay().then((m) => ({ default: m.Relay })));
const FoundryPage = lazy(() => loaders.foundry().then((m) => ({ default: m.FoundryPage })));
const BoilerRoom = lazy(() => loaders.boiler().then((m) => ({ default: m.SystemsHub })));
const Archive = lazy(() => loaders.archive().then((m) => ({ default: m.Archive })));
const Spire = lazy(() => loaders.spire().then((m) => ({ default: m.Spire })));
const Exchange = lazy(() => loaders.exchange().then((m) => ({ default: m.Exchange })));
const Green = lazy(() => loaders.green().then((m) => ({ default: m.Green })));
const Workshop = lazy(() => loaders.workshop().then((m) => ({ default: m.Workshop })));
const Studio = lazy(() => loaders.studio().then((m) => ({ default: m.Studio })));
const SkippyChat = lazy(() => loaders.skippy().then((m) => ({ default: m.SkippyChat })));

/** Fetch the other pages once the browser is idle after first paint. Failures are ignored: opening the page retries. */
function prefetchTabs() {
  const run = () => Object.values(loaders).forEach((load) => void load().catch(() => {}));
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

/** What shows for the moment a page's code is on its way: one thread drawing itself, no spinner. */
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

const TITLES: Partial<Record<DeskTab, string>> = { relay: "Relay", foundry: "Foundry", archive: "Archive", spire: "Spire", exchange: "Exchange", green: "Green", workshop: "Workshop", studio: "Studio" };

export function Desk({ route }: { route: DeskTab }) {
  const awaySince = useAwaySince();
  const data = useDeskData(awaySince);
  const now = useNow(30_000);
  const hub = useSystems((s) => s.links.find((l) => l.id === "hub")?.state ?? "off");

  // The old addresses (/systems, /chronicle) open the renamed rooms; the bar shows the new one.
  useEffect(() => {
    const p = renamedPath(window.location.pathname);
    if (p) window.history.replaceState(null, "", p + window.location.search);
  }, []);

  useEffect(() => {
    startDeskTiming();
    startFoundry();
    startWorldClock();
    startDeskAuth();
    // The Desk as a home-screen app, and its pings (#135).
    void startDeskWorker();
    prefetchTabs();
    // The Lattice's models, into this browser's cache once the Desk is idle (#327).
    warmLattice();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]")) return;
      // Shift+H: Hide, the same as the bar's eye.
      if (e.shiftKey && (e.key === "H" || e.key === "h")) {
        useHide.getState().toggle();
        return;
      }
      // 1 to 9 open the first nine pages; 0 the tenth.
      const to = /^[0-9]$/.test(e.key) ? KEY_ORDER[e.key === "0" ? 9 : Number(e.key) - 1] : undefined;
      if (to) navigate(to, window.location.search);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const skippyOpen = useSkippy((s) => s.open);
  const hide = useHide((s) => s.on);
  const skippyOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const remember = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".desk__skippy, .skp-avatar, .skp-ask button");
      if (el) skippyOpener.current = el as HTMLElement;
    };
    document.addEventListener("click", remember, true);
    return () => document.removeEventListener("click", remember, true);
  }, []);

  const pathname = usePathname();
  useEffect(() => {
    document.title = route === "boiler" ? systemsTitle(pathname) : TITLES[route] ? `${TITLES[route]} · C.E.O.` : "C.E.O. — Desk";
  }, [route, pathname]);

  const owed = data.owed.length + data.actions.filter((a) => a.when === "now").length;
  const connected = hub !== "off";

  return (
    <div className="desk" data-route={route} data-hide={hide || undefined}>
      <DeskSky />
      <DeskNav route={route} owed={owed} now={now} />

      <main className="desk__main" key={route} data-room={route in ROOM_TABS || route === "foundry" || route === "relay" ? route : undefined}>
        <Suspense fallback={<TabLoading />}>
          {route === "relay" ? (
            <Relay data={data} now={now} connected={connected} />
          ) : route === "foundry" ? (
            <FoundryPage now={now} />
          ) : route === "archive" ? (
            <Archive now={now} awaySince={awaySince} />
          ) : route === "boiler" ? (
            <BoilerRoom now={now} />
          ) : route === "spire" ? (
            <Spire />
          ) : route === "exchange" ? (
            <Exchange />
          ) : route === "green" ? (
            <Green />
          ) : route === "workshop" ? (
            <Workshop />
          ) : route === "studio" ? (
            <Studio />
          ) : (
            <Today data={data} now={now} connected={connected} awaySince={awaySince} />
          )}
        </Suspense>
      </main>

      {/* Skippy's dialogue (#224), on every page: the bar's button, Today's avatar and the Ask line all open it. Focus goes
          back to whichever of them opened it. */}
      {skippyOpen && (
        <Suspense fallback={null}>
          <SkippyChat returnFocus={skippyOpener} />
        </Suspense>
      )}

      {/* Talk's hologram (#481): Skippy projected while a call is on; nothing of it loads before the tap. */}
      <HologramCall route={route} />

      <footer className="desk__foot">
        <span>Command Everything, Obviously</span>
        <span className="desk__foot-rule" aria-hidden="true" />
        <span>Ilyr · the Syntherion Lattice</span>
      </footer>
    </div>
  );
}
