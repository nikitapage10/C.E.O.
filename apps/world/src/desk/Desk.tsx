import "./roomHooks.ts";
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { startFoundry } from "../foundry.ts";
import { keepLattice, warmLattice } from "../latticeWarm.ts";
import { navigate, renamedPath, usePathname } from "../route.ts";
import { useSystems } from "../systems.ts";
import { startWorldClock } from "../worldClock.ts";
import { useAwaySince } from "./awaySince.ts";
import { useHide } from "./hide.ts";
import { DeskNav, KEY_ORDER } from "./DeskNav.tsx";
import { DeskSky } from "./DeskSky.tsx";
import { startDeskTiming } from "./deskBeacon.ts";
import { useDeskData } from "./deskData.ts";
import { useNow } from "./motion.tsx";
import { startDeskWorker } from "./pings.ts";
import { PAGE_LOADERS, pageName, type DeskPage, type PageProps } from "./roomPages.ts";
import { startDeskAuth } from "./signin.ts";
import { systemsTitle } from "./SystemsNav.tsx";
import { useSkippy } from "./skippy/index.ts";
import { loadTodayMore, Today } from "./Today.tsx";
import { HologramCall } from "./hologram/HologramCall.tsx";
import { VoiceDock } from "./roomvoice/RoomMic.tsx";
import { RoomLoader } from "@ceo/engine/web/RoomLoader.tsx";
import { RoomMounted } from "@ceo/engine/web/roomReady.ts";
import { keptAfter, SCENE_ROOMS } from "./keptRooms.ts";
import { canWarm, warmRotunda } from "./rotunda/warm.ts";
import "./desk.css";
import "./chronicle.css";
import "./weave.css";
import "./wv.css";

// Today is in the first load; every other page loads the first time it is opened (and is fetched in the idle time
// after the first paint, so switching stays instant). The pages' loaders come from the room manifests (roomPages.ts).
const loaders = {
  ...PAGE_LOADERS,
  // Not pages, but kept out of the first load the same way: Skippy's open dialogue and the rest of Today.
  skippy: () => import("./skippy/SkippyDialog.tsx"),
  more: loadTodayMore,
};
const PAGES: Partial<Record<DeskPage, ComponentType<PageProps>>> = Object.fromEntries(Object.entries(PAGE_LOADERS).map(([id, load]) => [id, lazy(load)]));
const SkippyChat = lazy(() => loaders.skippy().then((m) => ({ default: m.SkippyChat })));

// The rooms' 3D scenes (#759): Today's Rotunda and the Haven's house, with the shared three.js chunk they pull in.
const scenes = [() => import("./rotunda/rotundaScene.ts"), () => import("./haven/house.ts")];

const idle = (run: () => void, timeout: number) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout });
  else setTimeout(run, Math.min(timeout, 2000));
};

/**
 * Fetch the other pages, then the 3D scenes, once the browser is idle after first paint (never before it, so the first
 * load is unchanged). Failures are ignored: opening the page retries.
 */
function prefetchTabs() {
  idle(() => {
    Object.values(loaders).forEach((load) => void load().catch(() => {}));
    idle(() => scenes.forEach((load) => void load().catch(() => {})), 8000);
  }, 5000);
}

/** A room with a 3D scene holds its cover until the scene's first frame, up to this long (#759); the rest, 4 s. */
const SCENE_CAP_MS = 7000;

/** Each page's colour, as its manifest names it (rooms/<id>/room.ts `accent`): the room loader's motes wear it. */
const accentOf = (route: DeskPage) => (route === "today" ? "--ice" : `--room-${route}`);

/**
 * The Desk: the Lattice's control room as a flat, fast page, where the C.E.O. acts on what the agents bring in.
 * Same world as the 3D Lattice (its colours, its stills, its cast) but it never loads it; "Enter the Lattice"
 * fetches that on demand. It shows only real work: the Foundry from GitHub now, Relay and the rooms once the hub
 * on the MacBook is connected.
 */

/** The tab's title: the page's name (its manifest's), the Senate's in full, the Boiler Room's by its subpage. */
const titleOf = (route: DeskPage, pathname: string) => (route === "boiler" ? systemsTitle(pathname) : route === "today" ? "The Senate · C.E.O." : `${pageName(route)} · C.E.O.`);

export function Desk({ route }: { route: DeskPage }) {
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
    document.title = titleOf(route, pathname);
  }, [route, pathname]);

  // The rooms kept mounted (#759, keptRooms.ts): the one on screen and the last scene rooms visited, hidden and paused.
  const [kept, setKept] = useState<DeskPage[]>([route]);
  if (kept[0] !== route) setKept(keptAfter(kept, route, keepLattice()));

  // Today, warmed while the Desk is idle on another room (rotunda/warm.ts): the likeliest next room opens quickly.
  const todayKept = kept.includes("today");
  useEffect(() => {
    if (todayKept || !canWarm()) return;
    let gone = false;
    const t = window.setTimeout(() => idle(() => !gone && void warmRotunda(), 6000), 3000);
    return () => {
      gone = true;
      window.clearTimeout(t);
    };
  }, [todayKept]);

  const owed = data.owed.length + data.actions.filter((a) => a.when === "now").length;
  const connected = hub !== "off";

  const page = (r: DeskPage) => {
    const Page = PAGES[r];
    return Page ? <Page data={data} now={now} connected={connected} awaySince={awaySince} /> : <Today data={data} now={now} connected={connected} awaySince={awaySince} />;
  };

  return (
    <div className="desk" data-route={route} data-hide={hide || undefined}>
      <DeskSky />
      <DeskNav route={route} owed={owed} now={now} />

      {/* The room loader (#752, @ceo/engine): covers the page while its code, scene and first data come in, then fades.
          Pages hold it with useRoomReady; RoomMounted tells it the page's code has mounted. A kept room (#759) stays
          mounted, hidden and inert, with no cover, until it is back on screen. */}
      {[...kept].sort((a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b)).map((r) => (
        <RoomLoader key={r} room={r} name={pageName(r)} accent={accentOf(r)} shown={r === route} cap={SCENE_ROOMS.has(r) ? SCENE_CAP_MS : undefined}>
          <main className="desk__main" hidden={r !== route} inert={r !== route} data-room={r === "today" ? undefined : r}>
            <Suspense fallback={null}>
              {page(r)}
              <RoomMounted />
            </Suspense>
          </main>
        </RoomLoader>
      ))}

      {/* Skippy's dialogue (#224), on every page: the bar's button, Today's avatar and the Ask line all open it. Focus goes
          back to whichever of them opened it. */}
      {skippyOpen && (
        <Suspense fallback={null}>
          <SkippyChat returnFocus={skippyOpener} />
        </Suspense>
      )}

      {/* Talk's hologram (#481): Skippy projected while a call is on; nothing of it loads before the tap. */}
      <HologramCall route={route} />

      {/* The rooms' voice (#638): Ask Skippy bottom right, and the room mic to the room's submind on every room's page. */}
      <VoiceDock route={route} />

      <footer className="desk__foot">
        <span>Command Everything, Obviously</span>
        <span className="desk__foot-rule" aria-hidden="true" />
        <span>Ilyr · the Syntherion Lattice</span>
      </footer>
    </div>
  );
}
