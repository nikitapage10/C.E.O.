import { ROOM_IDS, type RoomId } from "@ceo/core";
import { Suspense, useEffect, useLayoutEffect, useState } from "react";
import { bootMarks, markBoot, useBoot } from "./boot.ts";
import { holdDeck } from "./club/deck.ts";
import { holdSound } from "./glitches/sound.ts";
import { loadRoom, streamedIn } from "./scene/streaming.ts";
import { AppGuard } from "./scene/SceneGuard.tsx";
import { bootStreaming } from "./scene/streaming.ts";
import { agentPositions, clock } from "./clock.ts";
import { GatheringDirector } from "./gatherings/GatheringDirector.tsx";
import { GlitchDirector } from "./glitches/GlitchDirector.tsx";
import { GlitchOverlay } from "./glitches/GlitchOverlay.tsx";
import { AgentStudio } from "./hud/AgentStudio.tsx";
import { Hud } from "./hud/Hud.tsx";
import { Loader } from "./hud/Loader.tsx";
import { EyesHud } from "./eyes/EyesHud.tsx";
import { brogu, enterEyes, useEyes } from "./eyes/eyes.ts";
import { KernelDirector } from "./kernel/KernelDirector.tsx";
import { SocialDirector } from "./social/SocialDirector.tsx";
import { Scene } from "./scene/Scene.tsx";
import { useCast } from "./cast/castStore.ts";
import { AchievementDirector } from "./achievements/AchievementDirector.tsx";
import { DeckDirector } from "./club/DeckDirector.tsx";
import { NightDirector } from "./night/NightDirector.tsx";
import { FoundryDirector } from "./rooms/FoundryDirector.tsx";
import { VeilDirector } from "./veil/VeilDirector.tsx";
import { WorldDirector } from "./world/WorldDirector.tsx";
import { WeaveCanvas } from "./weave/WeaveCanvas.tsx";
import { pumpSpeech, useWorld } from "./store.ts";
import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "./styles.css";

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
      store: useWorld,
      cast: () => useCast.getState().cast,
      openStudio: (id: string | null) => useCast.getState().openStudio(id),
      boot: () => ({ ...bootMarks }),
      // Every room streamed in and compiled (scene/streaming.ts): the page has stopped loading.
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

function useSpeechTicker(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(pumpSpeech, 300);
    return () => clearInterval(id);
  }, [active]);
}

/**
 * On screen or behind the Desk (#373). Behind it the canvas stops drawing (Scene.tsx), the simulator stops with it
 * (it ticks in the frame loop), the HUD and directors unmount and the sound holds; back on screen it all picks up
 * where it was, with nothing to load or compile again.
 */
function useActive(active: boolean) {
  useLayoutEffect(() => {
    useBoot.setState({ active, ...(active && { visited: true }) });
    holdDeck(!active);
    holdSound(!active);
  }, [active]);
}

const roomLink = () => {
  const room = new URLSearchParams(window.location.search).get("room");
  return room && (ROOM_IDS as readonly string[]).includes(room) ? (room as RoomId) : null;
};

/**
 * `/lattice?room=relay` opens straight on a room (links from the Desk), and loads that room first. The fetching
 * starts here, as the Lattice mounts, before the scene renders (scene/streaming.ts).
 */
function useRoomLink(active: boolean) {
  useState(() => {
    markBoot("lattice");
    bootStreaming(roomLink());
    return null;
  });
  // Each arrival, not just the first: kept mounted behind the Desk (#373), the Lattice is entered many times.
  useEffect(() => {
    if (!active) return;
    const room = roomLink();
    if (!room) return;
    // Its models first, ahead of anything still streaming for the rest of the ring.
    void loadRoom(room);
    useWorld.getState().setFocus(room);
  }, [active]);
}

/**
 * The Lattice. `active` is false while it waits behind the Desk (main.tsx): warmed in the background before its first
 * visit, or kept after one, so entering it is instant.
 */
export function App({ active = true }: { active?: boolean }) {
  useActive(active);
  useDebugApi();
  useRoomLink(active);
  useSpeechTicker(active);
  return (
    <AppGuard>
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
        <KernelDirector />
        <GatheringDirector />
        <NightDirector />
        <FoundryDirector />
        <DeckDirector />
        <VeilDirector />
        <AchievementDirector />
        <WorldDirector />
      </Suspense>
      )}
      <Loader />
    </AppGuard>
  );
}
