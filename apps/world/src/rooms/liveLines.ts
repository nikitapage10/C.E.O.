import { useEffect, useRef } from "react";
import { useWorld } from "../store.ts";

/** How often a room's lead reads its live numbers out loud: every two to four minutes. */
const MIN_MS = 120_000;
const SPREAD_MS = 120_000;

/**
 * A live room's submind now and then says a line made from the real numbers (the Bookie on the odds, the Commentator
 * on the matchup), while it is in its own room. `line` returns null until the feed has something to say. Public
 * numbers only: the lines are built in liveBoards.ts and never carry money.
 */
export function useLiveLines(agentId: string, line: () => string | null) {
  const make = useRef(line);
  make.current = line;
  useEffect(() => {
    let timer = 0;
    const next = (ms: number) => {
      timer = window.setTimeout(() => {
        const w = useWorld.getState();
        const me = w.lattice.agents[agentId];
        const home = me?.agent.home.room;
        const text = me && home && me.place.room === home && document.visibilityState === "visible" ? make.current() : null;
        if (text) w.say(agentId, text);
        next(MIN_MS + Math.random() * SPREAD_MS);
      }, ms);
    };
    next(20_000 + Math.random() * 40_000);
    return () => window.clearTimeout(timer);
  }, [agentId]);
}
