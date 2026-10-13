import type { AgentEvent, AgentEventBody } from "@ceo/core";
import type { ScriptId } from "@ceo/simulator";
import { useEffect } from "react";
import { clock } from "../clock.ts";
import { CREW, assignCrew, crewFor, crewWork, startFoundry, useFoundry, visibleUpkeep, type Crate, type CrateState, type CrewId, type FoundryData } from "../foundry.ts";
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

/**
 * Which routine each crew member should be on for the crate they hold. Rusty with nothing in hand stays at the
 * upkeep from the latest tick until the next one (`keepingUpkeep`): the real job takes a minute every six hours,
 * but in the room he is seen working it through, unless a fix, the ideas board or a break pulls him off.
 */
export function routineFor(who: CrewId, crate: Crate | null, openIdeas: number, keepingUpkeep = false, quiet: { checksRunning?: boolean; handingUp?: boolean } = {}): ScriptId {
  if (!crate) {
    // Quiet time still shows what each one is for: Rivet on watch at the alarm post (leaning in while the checks run,
    // or carrying a new job up to Rocky), Rocky over the plan at his drafting table.
    if (who === "semicolon") return quiet.handingUp ? "foundryHandUp" : quiet.checksRunning ? "foundryWatchClose" : "foundryWatch";
    if (who === "caret") return "foundryDrafting";
    return openIdeas > 0 ? "foundryIdeas" : keepingUpkeep ? "foundryUpkeep" : "foundryIdle";
  }
  // A new job on its way up to Rocky: he waits at his table until Rivet brings the crate over.
  if (who === "caret" && quiet.handingUp && crate.state === "working") return "foundryDrafting";
  if (crate.state === "stuck") return "foundryStuck";
  if (crate.state === "ready") return "foundryReady";
  if (crate.kind === "upkeep") return "foundryUpkeep";
  if (crate.kind === "idea") return "foundryIdeas";
  // Rocky takes his jobs at the drafting table, where they're handed up to him.
  return who === "caret" ? "foundryBuilding" : "foundryFixing";
}

/** How long Rivet takes to carry a new job from the intake up to Rocky's table; then he takes the crate. */
const HAND_UP_MS = 15_000;

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
    /** The crates Rocky held at the last look, so a new one can be seen being handed up to him. */
    let rockyHeld = new Set<number>();
    /** Until when Rivet is carrying a job up to Rocky. */
    let handUpUntil = 0;
    let handUpTimer: number | null = null;

    const apply = (data: FoundryData) => {
      const events: AgentEvent[] = [];
      const by = assignCrew(data.crates);
      const rocky = new Set([...by].filter(([, who]) => who === "caret").map(([n]) => n));
      if (!first && [...rocky].some((n) => !rockyHeld.has(n))) {
        handUpUntil = Date.now() + HAND_UP_MS;
        if (handUpTimer !== null) clearTimeout(handUpTimer);
        handUpTimer = window.setTimeout(() => {
          handUpTimer = null;
          place(useFoundry.getState().data);
        }, HAND_UP_MS + 100);
      }
      rockyHeld = rocky;
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
          events.push(live({ type: "task.started", taskId, agentId: by.get(c.number) ?? crewFor(c), title: `#${c.number} ${c.title}`, room: "foundry" }));
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

      place(data);
    };

    /** Put each crew member on the routine for what they hold. */
    const place = (data: FoundryData) => {
      const work = crewWork(data.crates);
      const openIdeas = data.crates.filter((c) => c.kind === "idea" && c.state === "queued").length;
      const keeping = visibleUpkeep(data.crates) !== null;
      // Only a free Rivet carries the job up; when she has her own, Rocky just takes it at his table.
      const quiet = { checksRunning: data.checks.state === "running", handingUp: Date.now() < handUpUntil && !work.semicolon };
      for (const who of Object.keys(CREW) as CrewId[]) simulator.setScript(who, routineFor(who, work[who], openIdeas, who === "tessellate" && keeping, quiet), clock.sim);
    };

    if (useFoundry.getState().connected) apply(useFoundry.getState().data);
    const unsubscribe = useFoundry.subscribe((s, prev) => {
      if (s.data !== prev.data) apply(s.data);
    });
    // An upkeep tick passing changes what Rusty is seen at even when GitHub hasn't changed.
    const tick = setInterval(() => {
      if (useFoundry.getState().connected) place(useFoundry.getState().data);
    }, 60_000);
    return () => {
      unsubscribe();
      clearInterval(tick);
      if (handUpTimer !== null) clearTimeout(handUpTimer);
    };
  }, []);
  return null;
}
