import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { clock } from "../clock.ts";
import { useCatchup } from "../kernel/catchup.ts";
import { playbackOf, useChronicle, type Playback } from "../chronicle.ts";
import { readingTime, useWorld } from "../store.ts";

/** How long the Lattice settles (agents walk to their posts) before the last hour's lines start. */
const SETTLE_MS = 6_000;

/**
 * The living Lattice, on open (docs/WORLD.md): load the saved world, take on how relationships have moved while
 * nobody was looking, and let the agents carry on where they left off: the latest hour's conversations play out as
 * speech, its builders say their piece about what shipped, and the Kernel's PA pins the hour's summary until it
 * is read (#54). Renders nothing.
 */
export function WorldDirector() {
  useEffect(() => {
    let live = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(() => live && fn(), ms));

    void useChronicle
      .getState()
      .load()
      .then((feed) => {
        if (!live || !feed) return;
        const changed = feed.relationships.filter((r) => r.since);
        if (changed.length) useCast.getState().adoptWorld(changed.map(({ a, b, kind, note }) => ({ a, b, kind, note })));
        const latest = feed.recent.at(-1);
        if (!latest) return;
        later(() => {
          const world = useWorld.getState();
          useCatchup.getState().arrive(latest.step, latest.summary, clock.sim);
          play(playbackOf(latest, (id) => id in useWorld.getState().lattice.agents, world.focus), later);
        }, SETTLE_MS);
      });

    return () => {
      live = false;
      for (const t of timers) clearTimeout(t);
    };
  }, []);
  return null;
}

/** Each line in turn, the next one waiting until the last has mostly been read; speakers turn to whom they're talking to. */
function play(lines: Playback[], later: (fn: () => void, ms: number) => void) {
  let at = 0;
  for (const line of lines) {
    later(() => {
      const world = useWorld.getState();
      if (line.to) world.override(line.who, "face", readingTime(line.text) + 1500, line.to);
      world.say(line.who, line.text);
    }, at);
    at += readingTime(line.text) * 0.8;
  }
}
