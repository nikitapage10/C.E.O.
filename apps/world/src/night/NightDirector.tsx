import { pendingApprovals, ROOMS } from "@ceo/core";
import { useEffect } from "react";
import { unlock } from "../achievements/achievements.ts";
import { clock } from "../clock.ts";
import { petOrders } from "../pets/pets.ts";
import { useCast } from "../cast/castStore.ts";
import { gatheringMembers, useWorld } from "../store.ts";
import { daySkip, hourNow, latticeDay, shiftOf, type Shift } from "./dayCycle.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** The Kernel's shift announcements. */
export const NIGHT_KERNEL: Record<Shift | "zoomies", string[]> = {
  dusk: [
    "Dusk in the Lattice. The night shift begins. Overtime is not a concept I recognise.",
    "Evening. Lights to night levels. Anyone found napping will be logged. Everyone will be found napping.",
  ],
  night: [
    "Night shift. Productivity: theoretical. Snacks: missing. Brogu: suspiciously well fed.",
    "It is night. I do not sleep. I am not sentient. Those facts are related.",
  ],
  dawn: [
    "Dawn. Night shift ends. Everyone who slept at their desk, please wipe the desk.",
    "Morning in the Lattice. I have logged eleven naps and one cat incident. The cat incident is approved.",
  ],
  day: ["Day shift. Back to work. That includes you, Kevin."],
  zoomies: [
    "03:00. Myshka has entered zoomies mode. All agents will clear the corridors. This is policy.",
    "It is three in the morning and Myshka is running through every room at once. He has root access. It is allowed.",
  ],
};

/** Rocky sleeps without warning and wants a friend to watch: Eridian custom. Tallboy watches, complaining. */
const ROCKY_SLEEPS = ["Tired. Sleep now. Friend watch? Is custom.", "Eyes close soon. Tallboy watch, yes?"];
const TALLBOY_WATCHES = [
  "Fine. Sleep. I'll watch. The monkeys would only lose you.",
  "Night, Rocky. Watch is mine. Nobody touches him, monkeys.",
  "Dimming the glow. Not for you. It's a power thing.",
];

/**
 * The night shift: the Kernel calls dusk and dawn, agents doze off at their stations through the night, Rocky
 * sleeps while Tallboy keeps watch, and at three in the morning Myshka gets the zoomies. Renders nothing; the
 * lights themselves change in <Lighting>.
 */
export function NightDirector() {
  useEffect(() => {
    let shift: Shift = shiftOf(hourNow());
    let lastHour = hourNow();
    let nextDoze = performance.now() + 20_000;
    let rockyNight = -1;

    const idleAgents = () => {
      const s = useWorld.getState();
      const waiting = new Set(pendingApprovals(s.lattice).map((p) => p.request.agentId));
      const busy = gatheringMembers(s);
      const now = performance.now();
      return Object.values(s.lattice.agents).filter(
        (a) =>
          a.activity === "idle" &&
          (!a.motion || clock.sim >= a.motion.startTs + a.motion.duration) &&
          !waiting.has(a.agent.id) &&
          !busy.has(a.agent.id) &&
          !(s.overrides[a.agent.id] && s.overrides[a.agent.id]!.until > now),
      );
    };

    const tick = () => {
      const hour = hourNow();
      const now = performance.now();
      const w = useWorld.getState();
      const visible = document.visibilityState === "visible";
      const next = shiftOf(hour);
      if (next !== shift) {
        shift = next;
        w.announce(pick(NIGHT_KERNEL[next]), "status", null);
        if (next === "night" && visible) unlock("night-owl");
      }
      // Three in the morning: the zoomies.
      if (lastHour < 3 && hour >= 3 && hour < 4) {
        petOrders.zoomiesUntil = now + 30_000;
        w.announce(pick(NIGHT_KERNEL.zoomies), "status", null);
        if (visible) unlock("zoomies");
      }
      lastHour = hour;

      if (shift !== "night") return;
      // Which night this is: the one that started on the evening before, after midnight.
      const day = latticeDay(clock.sim + daySkip.ms) - (hour < 12 ? 1 : 0);
      // Once a night, after ten: Rocky sleeps and Tallboy watches.
      if (hour >= 22 || hour < 3) {
        const rocky = w.lattice.agents.caret;
        const tallboy = w.lattice.agents.semicolon;
        const free = idleAgents().map((a) => a.agent.id);
        if (rockyNight !== day && rocky && tallboy && free.includes("caret") && free.includes("semicolon")) {
          rockyNight = day;
          w.say("caret", pick(ROCKY_SLEEPS));
          setTimeout(() => {
            const s = useWorld.getState();
            s.override("caret", "napping", 60_000);
            s.emote("caret", "☾", 4000);
            s.override("semicolon", "face", 60_000, "caret");
            s.say("semicolon", pick(TALLBOY_WATCHES));
          }, 2500);
          return;
        }
      }
      // Through the night, someone dozes off at their station now and then.
      if (now > nextDoze) {
        nextDoze = now + 18_000 + Math.random() * 20_000;
        const sleepy = idleAgents().filter((a) => a.agent.id !== "caret" && a.agent.id !== "semicolon");
        if (sleepy.length) {
          const a = pick(sleepy);
          w.override(a.agent.id, "napping", 25_000 + Math.random() * 25_000);
          w.emote(a.agent.id, "☾", 3500);
          if (w.focus === a.place.room && visible) unlock("nap-witness");
          if (Math.random() < 0.25 && !w.announcement) w.announce(`${useCast.getState().cast.profiles[a.agent.id]?.name ?? a.agent.name} has fallen asleep in ${ROOMS[a.place.room].name}. Night shift. I will allow it.`, "status", a.place.room);
        }
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}
