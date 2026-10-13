import { ROOMS, pendingApprovals, type AgentEvent, type RoomId } from "@ceo/core";
import { SKIPPY_QUIPS, isSubmind } from "@ceo/simulator";
import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { clock } from "../clock.ts";
import { useWorld, type AnnouncementTone } from "../store.ts";
import { KERNEL, SKIPPY_HELLO } from "./lines.ts";
import { SubmindDirector } from "./SubmindDirector.tsx";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
/** Skippy speaks at most this often (real ms), so it runs the place without drowning it. */
const MIN_GAP = 11_000;
const STATUS_EVERY = [55_000, 85_000] as const;

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/**
 * Skippy, the Magnificent runs the Lattice from the Kernel: he hands out work, calls out failures and sends help, nags about approvals,
 * notices naps and glitches, and broadcasts status. Theatrical, fond of the monkeys, denies it. Renders nothing.
 */
export function KernelDirector() {
  useEffect(() => {
    let lastSpoke = -Infinity;
    let lastFeedId: string | undefined;
    let lastBacklogNag = 0;
    const seenNaps = new Map<string, number>();

    const name = (id: string) => useCast.getState().cast.profiles[id]?.name ?? useWorld.getState().lattice.agents[id]?.agent.name ?? id;
    /** Someone else in the room to send in as help (a friend if possible). */
    const helperFor = (id: string, room: RoomId) => {
      const { lattice } = useWorld.getState();
      const { cast } = useCast.getState();
      // The room's submind stays at its post conducting; it sends someone rather than going itself.
      const here = Object.values(lattice.agents)
        .filter((a) => a.place.room === room && a.agent.id !== id && !isSubmind(a.agent.id))
        .map((a) => a.agent.id);
      const friends = cast.relationships
        .filter((r) => (r.a === id || r.b === id) && ["friend", "best-friend", "mentor", "partner", "sibling"].includes(r.kind))
        .map((r) => (r.a === id ? r.b : r.a))
        .filter((o) => here.includes(o));
      const choice = friends[0] ?? here[0];
      return choice ? { id: choice, name: name(choice) } : null;
    };

    const say = (text: string, tone: AnnouncementTone, room: RoomId | null, force = false) => {
      const now = performance.now();
      if (!force && now - lastSpoke < MIN_GAP) return false;
      lastSpoke = now;
      useWorld.getState().announce(text, tone, room);
      return true;
    };

    /** React to what just happened, by priority: failures, approvals, assignments, praise. */
    const react = (events: AgentEvent[]) => {
      const { lattice } = useWorld.getState();
      for (const e of events) {
        if (e.type === "task.completed") {
          const t = lattice.tasks[e.taskId];
          if (!t) continue;
          if (e.outcome === "failure" && Math.random() < 0.7) {
            const help = helperFor(t.agentId, t.room);
            const text = fill(pick(KERNEL.fail), { agent: name(t.agentId), title: t.title, other: help?.name ?? "Anyone" });
            if (say(text, "scold", t.room) && help) {
              // The Kernel actually sends someone over.
              useWorld.getState().override(help.id, "face", 6000, t.agentId);
            }
            return;
          }
          if (e.outcome === "success" && Math.random() < 0.12) {
            if (say(fill(pick(KERNEL.success), { agent: name(t.agentId), title: t.title }), "praise", t.room)) return;
          }
        } else if (e.type === "approval.requested" && Math.random() < 0.45) {
          const r = e.approval;
          if (say(fill(pick(KERNEL.approval), { agent: name(r.agentId), summary: r.summary }), "nag", r.room)) return;
        } else if (e.type === "approval.resolved") {
          const r = lattice.approvals[e.approvalId]?.request;
          if (r && Math.random() < 0.5) {
            const lines = e.decision === "approved" ? KERNEL.approved : KERNEL.denied;
            if (say(fill(pick(lines), { agent: name(r.agentId) }), e.decision === "approved" ? "praise" : "scold", r.room, true)) return;
          }
        } else if (e.type === "task.started" && Math.random() < 0.22) {
          if (say(fill(pick(KERNEL.assign), { agent: name(e.agentId), title: e.title }), "assign", e.room)) return;
        }
      }
    };

    const unsub = useWorld.subscribe((s, prev) => {
      if (s.lattice === prev.lattice) return;
      const fresh: AgentEvent[] = [];
      for (const e of s.lattice.feed) {
        if (e.id === lastFeedId) break;
        fresh.push(e);
      }
      lastFeedId = s.lattice.feed[0]?.id;
      if (fresh.length && fresh.length < 40) react(fresh.reverse());
      // Glitches get an official non-explanation.
      if (s.activeGlitch && s.activeGlitch !== prev.activeGlitch && s.activeGlitch.id !== "counsel-memo" && Math.random() < 0.4) {
        const room = s.activeGlitch.room;
        setTimeout(() => say(fill(pick(KERNEL.glitch), { room: room ? ROOMS[room].name : "the Lattice" }), "status", room), 1800);
      }
    });

    // Periodic duties: status broadcasts, backlog nags, nap patrol.
    let statusTimer: ReturnType<typeof setTimeout>;
    const status = () => {
      statusTimer = setTimeout(
        () => {
          const { lattice } = useWorld.getState();
          const agents = Object.values(lattice.agents);
          const pending = pendingApprovals(lattice).length;
          const now = performance.now();
          if (pending >= 3 && now - lastBacklogNag > 90_000 && say(fill(pick(KERNEL.backlog), { n: pending }), "nag", null)) {
            lastBacklogNag = now;
          } else {
            const napper = agents.find((a) => a.activity === "napping" && (seenNaps.get(a.agent.id) ?? 0) < clock.sim - 120_000);
            if (napper && Math.random() < 0.5) {
              seenNaps.set(napper.agent.id, clock.sim);
              say(fill(pick(KERNEL.nap), { agent: name(napper.agent.id) }), "scold", napper.place.room);
            } else {
              say(
                fill(pick(Math.random() < 0.3 ? SKIPPY_QUIPS : KERNEL.status), {
                  total: agents.length,
                  working: agents.filter((a) => ["working", "typing", "carrying"].includes(a.activity)).length,
                  napping: agents.filter((a) => a.activity === "napping").length,
                  waiting: pending,
                  shipped: lattice.stats.tasksDone,
                  failed: lattice.stats.tasksFailed,
                }),
                "status",
                null,
              );
            }
          }
          status();
        },
        STATUS_EVERY[0] + Math.random() * (STATUS_EVERY[1] - STATUS_EVERY[0]),
      );
    };
    status();
    // A first word shortly after boot, so you know who's in charge.
    const hello = setTimeout(() => say(pick(SKIPPY_HELLO), "status", null, true), 4000);

    return () => {
      unsub();
      clearTimeout(statusTimer);
      clearTimeout(hello);
    };
  }, []);
  // His subminds walk the rooms on his behalf.
  return <SubmindDirector />;
}
