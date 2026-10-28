import { Suspense, lazy, useEffect, useState } from "react";
import { useSkippy } from "../skippy/chat.ts";
import { useTalk } from "../skippy/talk.ts";
import { holoEvents } from "./signal.ts";
import { modelUrl } from "../../modelUrl.ts";

/**
 * Skippy's hologram call (#481), as the Desk's first load carries it: only this gate. Tapping Talk starts the call
 * (talk.ts), and only then is the projection fetched, three.js and his model with it (HologramStage.tsx), so the
 * Desk's first-load budget holds. It goes away when the call ends.
 */
const HologramStage = lazy(() => import("./HologramStage.tsx"));

let preloaded = false;

/**
 * Warms the projection before the tap (#496, when the pointer or focus reaches Talk): its code (three.js with it) and
 * his model into the browser's cache, so the hologram is up by the time the call connects. Once a page load.
 */
export function preloadHologram() {
  if (preloaded) return;
  preloaded = true;
  void import("./HologramStage.tsx").catch(() => undefined);
  void import("./holoScene.ts").catch(() => undefined);
  void fetch(modelUrl("lib/custom/Skippy.glb"))
    .then((r) => r.arrayBuffer())
    .catch(() => undefined);
}

/** How long he takes to sink back into the chat box when the call ends (#538), in ms; a plain fade with less motion. */
export const LEAVE_MS = 700;
const STILL_LEAVE_MS = 300;

export function HologramCall({ route }: { route: string }) {
  const phase = useTalk((s) => s.phase);
  const on = phase === "starting" || phase === "live";
  // Kept up a moment after the call ends, so he sinks back down and the chat comes back (#538).
  const [up, setUp] = useState(on);
  useEffect(() => {
    if (phase === "starting") holoEvents.reset(useSkippy.getState().turns.at(-1)?.id ?? 0);
  }, [phase]);
  useEffect(() => {
    if (on) return setUp(true);
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setUp(false), still ? STILL_LEAVE_MS : LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [on]);
  if (!on && !up) return null;
  return (
    <Suspense fallback={null}>
      <HologramStage route={route} leaving={!on} />
    </Suspense>
  );
}
