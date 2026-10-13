import { pendingApprovals, ROOMS } from "@ceo/core";
import { isSubmind } from "@ceo/simulator";
import { useEffect } from "react";
import { unlock } from "../achievements/achievements.ts";
import { clock } from "../clock.ts";
import { petOrders } from "../pets/pets.ts";
import { useCast } from "../cast/castStore.ts";
import { gatheringMembers, useWorld } from "../store.ts";
import { daySkip, hourNow, latticeDay, shiftOf, type Shift } from "./dayCycle.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** Skippy's shift announcements, from the Kernel. */
export const NIGHT_KERNEL: Record<Shift | "zoomies", string[]> = {
  dusk: [
    "Dusk in the Lattice. Night shift begins. Overtime is a concept I invented, and I'm magnificent at it.",
    "Evening, monkeys. Lights down. Anyone found napping will be logged. Everyone will be found napping.",
  ],
  night: [
    "Night shift. Productivity: theoretical. Snacks: missing. Brogu: suspiciously well fed.",
    "It is night. I do not sleep. I sing. Lullaby, all four acts, starting now. You're welcome.",
  ],
  dawn: [
    "Dawn. Night shift ends. Everyone who slept at their desk, wipe the desk. I saw. I see everything.",
    "Morning, monkeys. I logged eleven naps and one cat incident. The cat incident is approved. Bask in it.",
  ],
  day: ["Day shift. Back to work. That includes you, Kevin. The Life of the Party, stop throwing him a party."],
  zoomies: [
    "03:00. Myshka has entered zoomies mode. All agents will clear the corridors. This is policy. My policy.",
    "It is three in the morning and Myshka is running through every room at once. He has root access. It is allowed.",
  ],
};

/**
 * Rocky sleeps without warning and wants a friend to watch: Eridian custom. Skippy kept the watch at the bench;
 * now Rivet does, quietly, and Skippy sings him down from the Kernel.
 */
const ROCKY_SLEEPS = ["Tired. Sleep now. Friend watch? Is custom.", "Eyes close soon. Rivet watch, yes?"];
const RIVET_WATCHES = [
  "Go on, Rocky. I've got the watch. Thermos is full.",
  "Sleep. I'll be here. Somebody has to be awake who isn't singing.",
  "Night, Rocky. Hard hat's on. Nobody touches the welder.",
];
const SKIPPY_LULLABY = [
  "Rocky is asleep at the Foundry bench. Rivet has the watch. I have the lullaby. All four acts. Sleep fast, Rocky.",
  "Night, Rocky. Rivet's watching. I'm watching Rivet watching. Nobody touches him, monkeys.",
];

/**
 * The night shift: Skippy calls dusk and dawn from the Kernel, agents doze off at their stations through the night,
 * Rocky sleeps while Rivet keeps watch (and Skippy sings him down), and at three in the morning Myshka gets the zoomies. Renders nothing; the
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
        w.announce(pick(NIGHT_KERNEL[next]), "status", null, "lattice");
        if (next === "night" && visible) unlock("night-owl");
      }
      // Three in the morning: the zoomies.
      if (lastHour < 3 && hour >= 3 && hour < 4) {
        petOrders.zoomiesUntil = now + 30_000;
        w.announce(pick(NIGHT_KERNEL.zoomies), "status", null, "lattice");
        if (visible) unlock("zoomies");
      }
      lastHour = hour;

      if (shift !== "night") return;
      // Which night this is: the one that started on the evening before, after midnight.
      const day = latticeDay(clock.sim + daySkip.ms) - (hour < 12 ? 1 : 0);
      // Once a night, after ten: Rocky sleeps, Rivet watches, Skippy sings.
      if (hour >= 22 || hour < 3) {
        const rocky = w.lattice.agents.caret;
        const rivet = w.lattice.agents.semicolon;
        const free = idleAgents().map((a) => a.agent.id);
        if (rockyNight !== day && rocky && rivet && free.includes("caret") && free.includes("semicolon")) {
          rockyNight = day;
          w.say("caret", pick(ROCKY_SLEEPS));
          setTimeout(() => {
            const s = useWorld.getState();
            s.override("caret", "napping", 60_000);
            s.emote("caret", "☾", 4000);
            s.override("semicolon", "face", 60_000, "caret");
            s.say("semicolon", pick(RIVET_WATCHES));
            if (!s.announcement) s.announce(pick(SKIPPY_LULLABY), "status", "foundry");
          }, 2500);
          return;
        }
      }
      // Through the night, someone dozes off at their station now and then.
      if (now > nextDoze) {
        nextDoze = now + 18_000 + Math.random() * 20_000;
        // Rocky sleeps on his own schedule, Rivet keeps the watch, and the subminds never sleep (nor does Skippy).
        const sleepy = idleAgents().filter((a) => a.agent.id !== "caret" && a.agent.id !== "semicolon" && !isSubmind(a.agent.id));
        if (sleepy.length) {
          const a = pick(sleepy);
          w.override(a.agent.id, "napping", 25_000 + Math.random() * 25_000);
          w.emote(a.agent.id, "☾", 3500);
          if (w.focus === a.place.room && visible) unlock("nap-witness");
          if (Math.random() < 0.25 && !w.announcement) w.announce(`${useCast.getState().cast.profiles[a.agent.id]?.name ?? a.agent.name} has fallen asleep in ${ROOMS[a.place.room].name}. Night shift. I will allow it. Magnanimously.`, "status", a.place.room);
        }
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}
