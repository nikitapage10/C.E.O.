import { ROOM_IDS, type RoomId } from "@ceo/core";
import { useEffect } from "react";
import { agentPositions, clock } from "./clock.ts";
import { GatheringDirector } from "./gatherings/GatheringDirector.tsx";
import { GlitchDirector } from "./glitches/GlitchDirector.tsx";
import { GlitchOverlay } from "./glitches/GlitchOverlay.tsx";
import { AgentStudio } from "./hud/AgentStudio.tsx";
import { Hud } from "./hud/Hud.tsx";
import { Loader } from "./hud/Loader.tsx";
import { KernelDirector } from "./kernel/KernelDirector.tsx";
import { SocialDirector } from "./social/SocialDirector.tsx";
import { Scene } from "./scene/Scene.tsx";
import { useCast } from "./cast/castStore.ts";
import { AchievementDirector } from "./achievements/AchievementDirector.tsx";
import { DeckDirector } from "./club/DeckDirector.tsx";
import { NightDirector } from "./night/NightDirector.tsx";
import { VeilDirector } from "./veil/VeilDirector.tsx";
import { pumpSpeech, useWorld } from "./store.ts";
import "./styles.css";

/** window.__ceo: a small debug surface for the console and the e2e tests. */
function useDebugApi() {
  useEffect(() => {
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    Object.assign(api, {
      state: () => useWorld.getState().lattice,
      time: () => clock.sim,
      positions: () => Object.fromEntries([...agentPositions].map(([id, v]) => [id, [v.x, v.y, v.z]])),
      focus: (room: Parameters<ReturnType<typeof useWorld.getState>["setFocus"]>[0]) => useWorld.getState().setFocus(room),
      activeGlitch: () => useWorld.getState().activeGlitch,
      store: useWorld,
      cast: () => useCast.getState().cast,
      openStudio: (id: string | null) => useCast.getState().openStudio(id),
    });
  }, []);
}

function useSpeechTicker() {
  useEffect(() => {
    const id = setInterval(pumpSpeech, 300);
    return () => clearInterval(id);
  }, []);
}

/** `/lattice?room=relay` opens straight on a room (links from the Desk). */
function useRoomLink() {
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room && (ROOM_IDS as readonly string[]).includes(room)) useWorld.getState().setFocus(room as RoomId);
  }, []);
}

export function App() {
  useDebugApi();
  useRoomLink();
  useSpeechTicker();
  return (
    <>
      <div className="stage">
        <Scene />
      </div>
      <Hud />
      <GlitchOverlay />
      <AgentStudio />
      <GlitchDirector />
      <SocialDirector />
      <KernelDirector />
      <GatheringDirector />
      <NightDirector />
      <DeckDirector />
      <VeilDirector />
      <AchievementDirector />
      <Loader />
    </>
  );
}
