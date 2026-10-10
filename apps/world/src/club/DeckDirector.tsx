import { useEffect } from "react";
import { unlock } from "../achievements/achievements.ts";
import { useCast } from "../cast/castStore.ts";
import { gatheringControl } from "../gatherings/GatheringDirector.tsx";
import { gatheringIn, useWorld } from "../store.ts";
import { deck, onDeckChange } from "./deck.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

export const DECK_KERNEL = [
  "A signal from beyond the Veil has reached the Break Room decks: \"{title}\". Kevin is playing it. Noise complaint filed by me, to me.",
  "The C.E.O. has sent down a track: \"{title}\". Tomorrowlattice is open. I am not invited. I would not go.",
];

/**
 * While the C.E.O.'s track plays, Tomorrowlattice stays open: if nobody is on the decks, a club night starts
 * (Kevin first in line to host), and it starts again when one ends. Renders nothing.
 */
export function DeckDirector() {
  useEffect(() => {
    const off = onDeckChange(() => {
      if (!deck.playing) return;
      const w = useWorld.getState();
      unlock("guest-dj");
      w.setFocus("breakroom");
      const dj = useCast.getState().cast.profiles.kevin?.name ?? "Kevin";
      w.announce(pick(DECK_KERNEL).replace("{title}", deck.title).replace("Kevin", dj), "status", "breakroom");
      if (!gatheringIn(w, "breakroom")) gatheringControl.start("club-night");
    });
    const keepOpen = setInterval(() => {
      const w = useWorld.getState();
      if (deck.playing && !gatheringIn(w, "breakroom")) gatheringControl.start("club-night");
    }, 6000);
    return () => {
      off();
      clearInterval(keepOpen);
    };
  }, []);
  return null;
}
