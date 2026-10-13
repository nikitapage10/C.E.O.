import { ROOM_IDS } from "@ceo/core";
import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { deck } from "../club/deck.ts";
import { useWorld } from "../store.ts";
import { ACHIEVEMENT_BY_ID, unlock, useAchievements } from "./achievements.ts";

const ROOMS_KEY = "ceo.rooms-visited.v1";

function visited(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ROOMS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Watches the C.E.O. watching the Lattice, and has the Kernel hand out achievements for it. Each unlock is read
 * out over the PA. Renders nothing.
 */
export function AchievementDirector() {
  useEffect(() => {
    const rooms = visited();
    let drops = deck.drops;

    const announceUnlocks = useAchievements.subscribe((s, prev) => {
      if (!s.latest || s.latest === prev.latest) return;
      const a = ACHIEVEMENT_BY_ID[s.latest.id];
      if (!a) return;
      useWorld.getState().announce(`Achievement unlocked for the C.E.O.: ${a.title}. ${a.line} Reward: one loot box.`, "praise", null, "lattice");
    });

    const watchWorld = useWorld.subscribe((s, prev) => {
      if (s.focus && s.focus !== prev.focus) {
        rooms.add(s.focus);
        try {
          localStorage.setItem(ROOMS_KEY, JSON.stringify([...rooms]));
        } catch {
          // Counted for this visit only.
        }
        if (ROOM_IDS.every((r) => rooms.has(r))) unlock("grand-tour");
      }
      if (s.activeGlitch && !prev.activeGlitch) unlock("memory");
      if (s.gatherings.some((g) => g.id === "costume-party") && !prev.gatherings.some((g) => g.id === "costume-party")) unlock("hallowed");
    });
    const watchStudio = useCast.subscribe((s) => {
      if (s.studio !== null) unlock("stylist");
    });

    const poll = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const s = useWorld.getState();
      if (deck.drops !== drops) {
        drops = deck.drops;
        if (s.focus === "breakroom") unlock("the-drop");
      }
      if (s.focus) {
        const now = performance.now();
        const napping = Object.values(s.lattice.agents).some(
          (a) => a.place.room === s.focus && (a.activity === "napping" || (s.overrides[a.agent.id]?.mode === "napping" && s.overrides[a.agent.id]!.until > now)),
        );
        if (napping) unlock("nap-witness");
      }
    }, 1500);

    const hello = setTimeout(() => unlock("clocked-in"), 9000);

    return () => {
      announceUnlocks();
      watchWorld();
      watchStudio();
      clearInterval(poll);
      clearTimeout(hello);
    };
  }, []);
  return null;
}
