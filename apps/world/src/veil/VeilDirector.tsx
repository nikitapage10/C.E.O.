import { VEIL_COUNTDOWN_QUIPS, VEIL_EVE_QUIPS } from "@ceo/simulator";
import { useEffect } from "react";
import { useWorld } from "../store.ts";
import { nightsPhrase, VEIL, VEIL_KERNEL, VEIL_LINES, veilCostumeFor, veilCountdownNights } from "./veil.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/**
 * With `?veil=on` everyone is in costume all visit: the Kernel (and Counsel.exe) say their piece once, and now
 * and then someone in the room you're watching explains their costume. Renders nothing. (The costume party
 * itself is a gathering; see gatherings.ts.)
 */
export function VeilDirector() {
  // The week before Halloween: now and then someone in the Break Room (the Life of the Party, if it's in) counts
  // down the nights, while you're watching the room or the whole Lattice.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(
        () => {
          const nights = veilCountdownNights(new Date());
          const s = useWorld.getState();
          if (nights !== null && (s.focus === "breakroom" || s.focus === null) && document.visibilityState === "visible") {
            const here = Object.values(s.lattice.agents).filter((a) => a.place.room === "breakroom");
            const who = here.find((a) => a.agent.id === "fizz") ?? (here.length ? pick(here) : null);
            const line = nights === 0 ? pick(VEIL_EVE_QUIPS) : pick(VEIL_COUNTDOWN_QUIPS).replace("{nights}", nightsPhrase(nights));
            if (who) s.say(who.agent.id, line);
          }
          next();
        },
        90_000 + Math.random() * 90_000,
      );
    };
    next();
    return () => clearTimeout(t);
  }, []);
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
