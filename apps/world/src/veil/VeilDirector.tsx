import { useEffect } from "react";
import { useWorld } from "../store.ts";
import { VEIL, VEIL_KERNEL, VEIL_LINES, veilCostumeFor } from "./veil.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/**
 * The Hallowed Veil: the Kernel (and Counsel.exe) say their piece once, and now and then someone in the room
 * you're watching explains their costume. Renders nothing; only runs in October.
 */
export function VeilDirector() {
  useEffect(() => {
    if (!VEIL) return;
    const notice = setTimeout(() => useWorld.getState().announce(pick(VEIL_KERNEL), "status", null), 24_000);
    let chatter: ReturnType<typeof setTimeout>;
    const next = () => {
      chatter = setTimeout(
        () => {
          const s = useWorld.getState();
          const here = Object.values(s.lattice.agents).filter((a) => a.place.room === s.focus && !s.costumes[a.agent.id]);
          const who = here.length ? pick(here) : null;
          const costume = who ? veilCostumeFor(who.agent.id) : null;
          if (who && costume && document.visibilityState === "visible") s.say(who.agent.id, pick(VEIL_LINES[costume]));
          next();
        },
        70_000 + Math.random() * 60_000,
      );
    };
    next();
    return () => {
      clearTimeout(notice);
      clearTimeout(chatter);
    };
  }, []);
  return null;
}
