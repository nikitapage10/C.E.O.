import { Suspense, lazy, useEffect } from "react";
import { useSkippy } from "../skippy/chat.ts";
import { useTalk } from "../skippy/talk.ts";
import { holoEvents } from "./signal.ts";

/**
 * Skippy's hologram call (#481), as the Desk's first load carries it: only this gate. Tapping Talk starts the call
 * (talk.ts), and only then is the projection fetched, three.js and his model with it (HologramStage.tsx), so the
 * Desk's first-load budget holds. It goes away when the call ends.
 */
const HologramStage = lazy(() => import("./HologramStage.tsx"));

export function HologramCall({ route }: { route: string }) {
  const phase = useTalk((s) => s.phase);
  const on = phase === "starting" || phase === "live";
  useEffect(() => {
    if (phase === "starting") holoEvents.reset(useSkippy.getState().turns.at(-1)?.id ?? 0);
  }, [phase]);
  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <HologramStage route={route} />
    </Suspense>
  );
}
