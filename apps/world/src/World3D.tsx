import { useEffect, useLayoutEffect, useState } from "react";
import { Suspense } from "react";
import { useBoot } from "./boot.ts";
import { AchievementDirector } from "./achievements/AchievementDirector.tsx";
import { DeckDirector } from "./club/DeckDirector.tsx";
import { EyesHud } from "./eyes/EyesHud.tsx";
import { brogu, enterEyes, useEyes } from "./eyes/eyes.ts";
import { GlitchDirector } from "./glitches/GlitchDirector.tsx";
import { GlitchOverlay } from "./glitches/GlitchOverlay.tsx";
import { AgentStudio } from "./hud/AgentStudio.tsx";
import { Hud } from "./hud/Hud.tsx";
import { Loader } from "./hud/Loader.tsx";
import { goToView, type LatticeView } from "./map/view.ts";
import { Scene } from "./scene/Scene.tsx";
import { bootStreaming, endStreaming, loadRoom, streamedIn } from "./scene/streaming.ts";
import { SocialDirector } from "./social/SocialDirector.tsx";
import { useWorld } from "./store.ts";
import { VeilDirector } from "./veil/VeilDirector.tsx";
import { WeaveCanvas } from "./weave/WeaveCanvas.tsx";

type View3D = Exclude<LatticeView, { kind: "map" }>;

/** The 3D world on screen now; a new one (another room, or the whole ring) takes over from the last. */
let current = 0;

/**
 * Builds what the view needs before the scene renders: one room on its own (`/lattice?room=relay`, #332), or the whole
 * ring, opened on a room or on the overview. Runs in render, ahead of the scene's first frame, so the scene never
 * starts on the whole ring for a room that will be alone.
 */
function useBuild(view: View3D) {
  const [token] = useState(() => {
    const token = ++current;
    // A fresh world: nothing compiled or drawn yet, its own loading screen, its own streaming.
    useBoot.setState({ sceneReady: false, drawing: false });
    endStreaming();
    bootStreaming(view.room, view.kind === "room");
    return token;
  });
  // Let the streaming go with the world, so nothing more is fetched for it from the map. Deferred a tick: StrictMode
  // (dev) runs the cleanup and the effect again straight away, and that is not a real unmount.
  useEffect(() => {
    let alive = true;
    return () => {
      alive = false;
      setTimeout(() => !alive && current === token && endStreaming(), 0);
    };
  }, [token]);
  // In view: the room, from the first frame. (The ring's overview has nothing in focus.)
  useLayoutEffect(() => {
    useWorld.getState().setFocus(view.room);
    if (view.kind === "ring" && view.room) void loadRoom(view.room);
  }, [view.kind, view.room]);
  // On its own, a room's "back" is the map and its neighbours are views of their own: Esc, S, the Lattice button and
  // a click on another room's name all land here as a change of focus.
  useEffect(() => {
    if (view.kind !== "room") return;
    return useWorld.subscribe((s, prev) => {
      if (s.focus === prev.focus || s.focus === view.room) return;
      goToView(s.focus ? { kind: "room", room: s.focus } : { kind: "map" });
    });
  }, [view.kind, view.room]);
}

/**
 * The Lattice in 3D (#332): one room, or the whole ring. Its own download: the map (map/LatticeMap.tsx) shows with
 * none of it, and this loads when a room is picked. `active` is false while the Lattice waits behind the Desk.
 */
/** The 3D world's part of window.__ceo (App.tsx has the rest). */
function useDebugApi() {
  useEffect(() => {
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    Object.assign(api, {
      // Every room streamed in and compiled (scene/streaming.ts; one room on its own: that room): loading is done.
      streamedIn,
      // Brogu's eyes: in and out, and where he is (room-local x, z, yaw).
      eyes: {
        enter: enterEyes,
        leave: () => useEyes.getState().leave(),
        state: () => ({ ...useEyes.getState(), brogu: { x: brogu.x, z: brogu.z, yaw: brogu.yaw, pitch: brogu.pitch } }),
        /** Put him somewhere (room-local) and point his eyes, without walking there. */
        pose: (p: { x?: number; z?: number; yaw?: number; pitch?: number }) => Object.assign(brogu, p),
      },
    });
  }, []);
}

export function World3D({ view, active }: { view: View3D; active: boolean }) {
  useBuild(view);
  useDebugApi();
  return (
    <>
      <div className="stage">
        {/* Anything that suspends here waits in place; it never blanks the page back to the boot screen. */}
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </div>
      {/* Behind the Desk none of this runs: no timers, no key or pointer listeners, nothing announced. */}
      {active && (
        <Suspense fallback={null}>
          <WeaveCanvas />
          <Hud />
          <EyesHud />
          <GlitchOverlay />
          <AgentStudio />
          <GlitchDirector />
          <SocialDirector />
          <DeckDirector />
          <VeilDirector />
          <AchievementDirector />
        </Suspense>
      )}
      <Loader />
    </>
  );
}
