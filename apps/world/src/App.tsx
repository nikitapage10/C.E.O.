import { useEffect } from "react";
import { agentPositions, clock } from "./clock.ts";
import { GlitchDirector } from "./glitches/GlitchDirector.tsx";
import { GlitchOverlay } from "./glitches/GlitchOverlay.tsx";
import { AgentStudio } from "./hud/AgentStudio.tsx";
import { Hud } from "./hud/Hud.tsx";
import { SocialDirector } from "./social/SocialDirector.tsx";
import { Scene } from "./scene/Scene.tsx";
import { useCast } from "./cast/castStore.ts";
import { useWorld } from "./store.ts";

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

export function App() {
  useDebugApi();
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
    </>
  );
}
