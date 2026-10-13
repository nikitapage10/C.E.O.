import { SUBMINDS, SUBMIND_CONDUCT } from "@ceo/simulator";
import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { clock, talkSteps } from "../clock.ts";
import { gatheringMembers, useWorld } from "../store.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** How often each submind picks someone new to direct (real ms). */
const EVERY = [3500, 6500] as const;
/** How far a submind drifts about its post (metres), and how long it holds a spot. */
const DRIFT = 0.4;
const DRIFT_HOLD = [3000, 6000] as const;
/** Chance a direction comes with a remark. */
const REMARK = 0.18;
const WORKING = new Set(["working", "typing", "carrying"]);

/**
 * Skippy's subminds lead the rooms from their conductor's posts (docs/SKIPPY.md). While one is up at its podium
 * it drifts a little about the corner, turns to whoever is working and conducts at them (the admiral can's baton
 * beat, "waiting"), and now and then has a word. The swoop down to check on someone up close is in the submind's
 * own routine (submindConduct). Renders nothing.
 */
export function SubmindDirector() {
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const nameOf = (id: string) => useCast.getState().cast.profiles[id]?.name ?? useWorld.getState().lattice.agents[id]?.agent.name ?? id;

    for (const m of SUBMINDS) {
      let nextDrift = 0;
      const tick = () => {
        timers.push(setTimeout(tick, EVERY[0] + Math.random() * (EVERY[1] - EVERY[0])));
        if (document.visibilityState !== "visible") return;
        const w = useWorld.getState();
        const me = w.lattice.agents[m.id];
        if (!me || me.place.room !== m.room || me.place.station !== "post") return;
        if (me.motion && clock.sim < me.motion.startTs + me.motion.duration) return;
        const now = performance.now();
        if (gatheringMembers(w).has(m.id) || (w.overrides[m.id]?.until ?? 0) > now) return;

        // A little drift about the podium, so it's never a statue.
        if (now > nextDrift) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * DRIFT;
          const hold = DRIFT_HOLD[0] + Math.random() * (DRIFT_HOLD[1] - DRIFT_HOLD[0]);
          talkSteps.set(m.id, { x: Math.cos(a) * r, z: Math.sin(a) * r, until: now + hold });
          nextDrift = now + hold;
        }

        // Direct whoever is working (or anyone in the room, when nobody is).
        const here = Object.values(w.lattice.agents).filter((a) => a.place.room === m.room && a.agent.id !== m.id);
        const busy = here.filter((a) => WORKING.has(a.activity));
        const pool = busy.length ? busy : here;
        if (!pool.length) return;
        const target = pick(pool).agent.id;
        const hold = 3000 + Math.random() * 2500;
        w.override(m.id, "face", hold, target, busy.length ? "waiting" : "staring");
        if (Math.random() < REMARK && !((w.speech[m.id]?.until ?? 0) > now)) {
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
