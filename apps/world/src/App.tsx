import { Suspense, lazy, useEffect, useLayoutEffect, useState } from "react";
import { bootMarks, markBoot, useBoot } from "./boot.ts";
import { holdDeck } from "./club/deck.ts";
import { holdSound } from "./glitches/sound.ts";
import { AppGuard } from "./scene/SceneGuard.tsx";
import { agentPositions, clock } from "./clock.ts";
import { GatheringDirector } from "./gatherings/GatheringDirector.tsx";
import { KernelDirector } from "./kernel/KernelDirector.tsx";
import { useCast } from "./cast/castStore.ts";
import { LatticeMap, mapDebug } from "./map/LatticeMap.tsx";
import { loadWorld3D } from "./map/load3d.ts";
import { useLatticeView, viewKey, type LatticeView } from "./map/view.ts";
import { NightDirector } from "./night/NightDirector.tsx";
import { FoundryDirector } from "./rooms/FoundryDirector.tsx";
import { WorldDirector } from "./world/WorldDirector.tsx";
import type { Step } from "@ceo/simulator";
import { pumpSpeech, simulator, useWorld } from "./store.ts";
import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "./styles.css";

/** The 3D world, one room or the whole ring (#332): its own download, fetched when a room is picked on the map. */
const World3D = lazy(() => loadWorld3D().then((m) => ({ default: m.World3D })));

/** window.__ceo: a small debug surface for the console and the e2e tests. */
function useDebugApi() {
  useEffect(() => {
    const api = ((
      window as unknown as { __ceo?: Record<string, unknown> }
    ).__ceo ??= {});
    Object.assign(api, {
      state: () => useWorld.getState().lattice,
      time: () => clock.sim,
      positions: () =>
        Object.fromEntries(
          [...agentPositions].map(([id, v]) => [id, [v.x, v.y, v.z]]),
        ),
      focus: (
        room: Parameters<ReturnType<typeof useWorld.getState>["setFocus"]>[0],
      ) => useWorld.getState().setFocus(room),
      activeGlitch: () => useWorld.getState().activeGlitch,
      // Hand a demo agent steps right now, through the simulator as a gathering does (an approval to answer, for the
      // browser tests: on a software renderer the demo's own come too late to wait for, #454).
      assign: (id: string, steps: Step[]) => simulator.assign(id, steps, clock.sim),
      // The 3D world's own (World3D.tsx) take over once it has loaded: nothing streams on the map.
      streamedIn: () => false,
      store: useWorld,
      cast: () => useCast.getState().cast,
      openStudio: (id: string | null) => useCast.getState().openStudio(id),
      boot: () => ({ ...bootMarks }),
      // The 2D map (#332): what it shows, when it's on screen.
      map: mapDebug,
    });
  }, []);
}

function useSpeechTicker(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(pumpSpeech, 300);
    return () => clearInterval(id);
  }, [active]);
}

/**
 * On screen or behind the Desk (#373). Behind it the canvas stops drawing (Scene.tsx), the simulator stops with it
 * (it ticks in the frame loop, or the map's), the HUD and directors unmount and the sound holds; back on screen it all
 * picks up where it was, with nothing to load or compile again.
 */
function useActive(active: boolean) {
  useLayoutEffect(() => {
    useBoot.setState({ active, ...(active && { visited: true }) });
    holdDeck(!active);
    holdSound(!active);
  }, [active]);
}

/**
 * The view on screen, one step behind the address when it changes from one 3D view to another: the old world unmounts
 * (and lets its GPU memory go) in one commit, the new one mounts in the next, so the two never share a frame.
 */
function useShownView(view: LatticeView): LatticeView | null {
  const key = viewKey(view);
  const [shown, setShown] = useState(key);
  useEffect(() => setShown(key), [key]);
  return shown === key || view.kind === "map" ? view : null;
}

/**
 * The Lattice (#332). It opens on the map: the ring in 2D, live, with nothing 3D loaded. A room picked there loads that
 * room alone in 3D; "Whole Lattice" loads the full ring, as it was before. The directors that feed the world (real
 * work, the saved world, Skippy's calls, gatherings, the night shift) run in every view, so the map is as alive as the
 * rooms. `active` is false while it waits behind the Desk (main.tsx), kept after a visit so coming back is instant.
 */
export function App({ active = true }: { active?: boolean }) {
  useState(() => markBoot("lattice"));
  useActive(active);
  useDebugApi();
  useSpeechTicker(active);
  const view = useShownView(useLatticeView());
  return (
    <AppGuard>
      {view?.kind === "map" && <LatticeMap active={active} />}
      {view && view.kind !== "map" && (
        <Suspense fallback={active ? <div className="lmap-wait" role="status">Stepping inside…</div> : null}>
          <World3D key={viewKey(view)} view={view} active={active} />
        </Suspense>
      )}
      {active && (
        <>
          <KernelDirector />
          <GatheringDirector />
          <NightDirector />
          <FoundryDirector />
          <WorldDirector />
        </>
      )}
    </AppGuard>
  );
}
