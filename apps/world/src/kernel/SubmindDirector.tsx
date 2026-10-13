import { SUBMINDS, SUBMIND_COMMAND, SUBMIND_CONDUCT } from "@ceo/simulator";
import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { clock, talkSteps } from "../clock.ts";
import { gatheringMembers, simulator, useWorld } from "../store.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** How often each submind picks someone new to direct (real ms). */
const EVERY = [3500, 6500] as const;
/** How far a submind drifts about the command spot while it's out giving an order (metres), and how long it holds a spot. */
const DRIFT = 0.6;
const DRIFT_HOLD = [2500, 4500] as const;
/** Chance a direction from the podium comes with a remark, and an order out in the room with a word. */
const REMARK = 0.15;
const ORDER = 0.8;
const WORKING = new Set(["working", "typing", "carrying"]);

/**
 * Skippy's subminds lead the rooms (docs/SKIPPY.md). Each sits on its command podium in the room's back-right corner,
 * turning to whoever is working and conducting at them from there (the admiral can's baton beat, "waiting"), with
 * the odd remark. When work starts in the room the simulator flies it out over the middle to give the order
 * (Simulator.command): out there it turns to whoever the order is for, barks it, and drifts a little while it
 * conducts, then glides home. The swoop down to check on someone up close is in its own routine (submindConduct).
 * Renders nothing.
 */
export function SubmindDirector() {
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const nameOf = (id: string) => useCast.getState().cast.profiles[id]?.name ?? useWorld.getState().lattice.agents[id]?.agent.name ?? id;

    for (const m of SUBMINDS) {
      let nextDrift = 0;
      /** The station it last had its word at, so it speaks once per visit (an order, or a check-in up close). */
      let spokeAt: string | null = null;
      const tick = () => {
        timers.push(setTimeout(tick, EVERY[0] + Math.random() * (EVERY[1] - EVERY[0])));
        if (document.visibilityState !== "visible") return;
        const w = useWorld.getState();
        const me = w.lattice.agents[m.id];
        if (!me || me.place.room !== m.room) return;
        if (me.motion && clock.sim < me.motion.startTs + me.motion.duration) return;
        const now = performance.now();
        if (gatheringMembers(w).has(m.id) || (w.overrides[m.id]?.until ?? 0) > now) return;
        const station = me.place.station;
        const here = Object.values(w.lattice.agents).filter((a) => a.place.room === m.room && a.agent.id !== m.id);
        const busy = here.filter((a) => WORKING.has(a.activity));
        const quiet = !((w.speech[m.id]?.until ?? 0) > now);

        if (station === "command") {
          // Out over the middle of the room giving an order: turn to whoever it's for and say it, once; then
          // conduct at the room, drifting a little, until the simulator brings it home.
          if (now > nextDrift) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * DRIFT;
            const hold = DRIFT_HOLD[0] + Math.random() * (DRIFT_HOLD[1] - DRIFT_HOLD[0]);
            talkSteps.set(m.id, { x: Math.cos(a) * r, z: Math.sin(a) * r, until: now + hold });
            nextDrift = now + hold;
          }
          const wanted = simulator.commandTarget(m.id);
          const target = (wanted && here.find((a) => a.agent.id === wanted)) || (busy.length ? pick(busy) : here.length ? pick(here) : null);
          if (!target) return;
          w.override(m.id, "face", 3500 + Math.random() * 1500, target.agent.id, "waiting");
          if (spokeAt === station) return;
          spokeAt = station;
          const lines = SUBMIND_COMMAND[m.id];
          if (lines && quiet && Math.random() < ORDER) w.say(m.id, pick(lines).replaceAll("{other}", nameOf(target.agent.id)));
          return;
        }
        // Anywhere but the command spot it holds still (on the podium it sits on the coaster).
        if (nextDrift) talkSteps.delete(m.id);
        nextDrift = 0;

        if (station !== "post") {
          // Down on the floor checking on someone up close: turn to whoever is at that station and have a word, once.
          if (spokeAt === station) return;
          spokeAt = station;
          const there = here.find((a) => a.place.station === station);
          if (!there) return;
          w.override(m.id, "face", 4500, there.agent.id, "idle");
          const lines = SUBMIND_CONDUCT[m.id];
          if (lines && quiet) w.say(m.id, pick(lines).replaceAll("{other}", nameOf(there.agent.id)));
          return;
        }
        spokeAt = null;

        // On the podium: direct whoever is working (or anyone in the room, when nobody is) from the corner.
        const pool = busy.length ? busy : here;
        if (!pool.length) return;
        const target = pick(pool).agent.id;
        const hold = 3000 + Math.random() * 2500;
        w.override(m.id, "face", hold, target, busy.length ? "waiting" : "staring");
        if (Math.random() < REMARK && quiet) {
          const lines = SUBMIND_CONDUCT[m.id];
          if (lines) w.say(m.id, pick(lines).replaceAll("{other}", nameOf(target)));
        }
      };
      timers.push(setTimeout(tick, 2000 + Math.random() * 5000));
    }
    return () => timers.forEach(clearTimeout);
  }, []);
  return null;
}
