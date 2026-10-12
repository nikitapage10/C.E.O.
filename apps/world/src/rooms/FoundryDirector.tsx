import type { AgentEvent, AgentEventBody } from "@ceo/core";
import type { ScriptId } from "@ceo/simulator";
import { useEffect } from "react";
import { clock } from "../clock.ts";
import { CREW, crewFor, crewWork, startFoundry, useFoundry, type Crate, type CrateState, type CrewId, type FoundryData } from "../foundry.ts";
import { simulator, useWorld } from "../store.ts";

/**
 * The Foundry is played by real work: the Foundry thread in Claude Code keeps its queue as GitHub issues, and
 * this director turns them into the room. Each crew member's routine follows the crate they hold (fixing,
 * waiting at the dock, slumped by the furnace, at the bench, pinning ideas), and every real step lands in the
 * feed as a live task, so the Lattice-wide view shows it too. The furnace glows with the real checks on main.
 * Renders nothing.
 */

let counter = 0;
const live = (body: AgentEventBody): AgentEvent => ({ ...body, id: `foundry-${++counter}`, ts: clock.sim, source: "claude-code" }) as AgentEvent;

/** Which routine each crew member should be on for the crate they hold. */
export function routineFor(who: CrewId, crate: Crate | null, openIdeas: number): ScriptId {
  if (!crate) return who === "tessellate" && openIdeas > 0 ? "foundryIdeas" : "foundryIdle";
  if (crate.state === "stuck") return "foundryStuck";
  if (crate.state === "ready") return "foundryReady";
  if (crate.kind === "upkeep") return "foundryUpkeep";
  if (crate.kind === "idea") return "foundryIdeas";
  return "foundryFixing";
}

const NOTE: Partial<Record<CrateState, string>> = {
  working: "On it",
  ready: "Checked and waiting for your OK",
};

export function FoundryDirector() {
  useEffect(() => {
    startFoundry();
    /** The last state seen for each crate, so only changes make events. */
    const seen = new Map<number, CrateState>();
    let checksAt: number | null = null;
    let first = true;

    const apply = (data: FoundryData) => {
      const events: AgentEvent[] = [];
      for (const c of data.crates) {
        const before = seen.get(c.number);
        if (before === c.state) continue;
        seen.set(c.number, c.state);
        // Crates that shipped before the page opened stay out of the feed.
        if (first && c.state === "shipped") continue;
        if (c.kind === "idea" && c.state === "queued") continue;
        const taskId = `gh-${c.number}`;
        if (!before || before === "queued") {
          if (c.state === "queued") continue;
          events.push(live({ type: "task.started", taskId, agentId: crewFor(c), title: `#${c.number} ${c.title}`, room: "foundry" }));
        }
        if (c.state === "shipped") events.push(live({ type: "task.completed", taskId, outcome: "success", note: "Shipped to main" }));
        else if (c.state === "stuck") events.push(live({ type: "task.completed", taskId, outcome: "failure", note: "Stuck after every rung: needs you" }));
        else if (NOTE[c.state]) events.push(live({ type: "task.progress", taskId, progress: c.state === "ready" ? 0.95 : 0.4, note: NOTE[c.state] }));
      }
      // The furnace: a short live task for each new result of the checks on main.
      const { checks } = data;
      if ((checks.state === "pass" || checks.state === "fail") && checks.at !== checksAt) {
        checksAt = checks.at;
        const taskId = `checks-${checks.at}`;
        events.push(live({ type: "task.started", taskId, agentId: "semicolon", title: "Checks on main", room: "foundry" }));
        events.push(live({ type: "task.completed", taskId, outcome: checks.state === "pass" ? "success" : "failure", note: checks.state === "pass" ? "All green" : "Red: a fix is on its way" }));
      }
      first = false;
      if (events.length) useWorld.getState().dispatch(events);

      const work = crewWork(data.crates);
      const openIdeas = data.crates.filter((c) => c.kind === "idea" && c.state === "queued").length;
      for (const who of Object.keys(CREW) as CrewId[]) simulator.setScript(who, routineFor(who, work[who], openIdeas), clock.sim);
    };

    if (useFoundry.getState().connected) apply(useFoundry.getState().data);
    return useFoundry.subscribe((s, prev) => {
      if (s.data !== prev.data) apply(s.data);
    });
  }, []);
  return null;
}
