import { ROOM_IDS, type RoomId } from "@ceo/core";
import { Suspense, useEffect, useRef, useState } from "react";
import { bootMarks, markBoot, useBoot } from "./boot.ts";
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

function useSpeechTicker(shown: boolean) {
  useEffect(() => {
    if (!shown) return;
    const id = setInterval(pumpSpeech, 300);
    return () => clearInterval(id);
  }, [shown]);
}

/** Hidden behind the Desk (main.tsx), the canvas stops drawing; shown again, a room link still opens its room. */
function useShown(shown: boolean) {
  const first = useRef(true);
  useEffect(() => {
    useBoot.setState({ shown });
    if (first.current) {
      first.current = false;
      return;
    }
    const room = roomLink();
    if (shown && room) useWorld.getState().setFocus(room);
  }, [shown]);
}

const roomLink = () => {
  const room = new URLSearchParams(window.location.search).get("room");
  return room && (ROOM_IDS as readonly string[]).includes(room) ? (room as RoomId) : null;
};

/**
 * `/lattice?room=relay` opens straight on a room (links from the Desk), and loads that room first. The fetching
 * starts here, as the Lattice mounts, before the scene renders (scene/streaming.ts).
 */
function useRoomLink() {
  useState(() => {
    markBoot("lattice");
    bootStreaming(roomLink());
    return null;
  });
  useEffect(() => {
    const room = roomLink();
    if (room) useWorld.getState().setFocus(room);
  }, []);
}

export function App({ shown = true }: { shown?: boolean }) {
  useDebugApi();
  useRoomLink();
  useShown(shown);
  useSpeechTicker(shown);
  return (
    <AppGuard>
      <div className="stage">
        {/* Anything that suspends here waits in place; it never blanks the page back to the boot screen. */}
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </div>
      {/* Off screen, the HUD and the directors (and their keys and timers) go; the world itself waits. */}
      {shown && (
        <Suspense fallback={null}>
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
