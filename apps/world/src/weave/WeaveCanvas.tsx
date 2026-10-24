import { useEffect, useRef } from "react";
import { reducedMotion } from "../desk/wvCanvas.ts";
import { feedLines } from "../hud/format.ts";
import { useWorld } from "../store.ts";
import { addPulse, weaveBus } from "./bus.ts";
import "./weave.css";

/**
 * The Weave's canvas over the Lattice (#374): a plain 2D canvas between the world and the HUD, drawn by the scene's
 * own frame (WeaveProbe), so it moves exactly with the camera and stops whenever the scene stops. It also listens for
 * real signals: each new line on the real agents' feed sends a thread from its room to the Signals panel. Nothing here
 * is made up; the demo's chatter never sends one (the feed it reads is the real agents' only).
 */
export function WeaveCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    weaveBus.canvas = ref.current;
    // For the console and the browser tests: what the Weave has drawn.
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.weave = () => ({ canvas: !!weaveBus.canvas, frames: weaveBus.frames, drawn: weaveBus.drawn, ms: Math.round(weaveBus.ms * 1000) / 1000, pulses: weaveBus.pulses.length });
    weaveBus.pulses.length = 0;
    // Reduced motion: no threads fly (the probe draws nothing either).
    if (reducedMotion()) return () => void (weaveBus.canvas = null);
    // What's already on the feed when the Lattice opens is history: only what arrives from here on flies.
    let seen = new Set<string>();
    let last: unknown = null;
    const look = (first: boolean) => {
      const s = useWorld.getState();
      if (s.lattice === last) return;
      last = s.lattice;
      const lines = feedLines(s.lattice, 6, undefined, null, true);
      for (const l of lines) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        // In a room the Signals panel lists that room's lines only, so only those fly to it.
        if (!first && l.room && (!s.focus || s.focus === l.room)) addPulse({ id: l.id, room: l.room, born: performance.now() });
      }
      if (seen.size > 400) seen = new Set(lines.map((l) => l.id));
    };
    look(true);
    const off = useWorld.subscribe(() => look(false));
    return () => {
      off();
      weaveBus.canvas = null;
      weaveBus.pulses.length = 0;
    };
  }, []);
  return <canvas ref={ref} className="lw-canvas" aria-hidden="true" />;
}
