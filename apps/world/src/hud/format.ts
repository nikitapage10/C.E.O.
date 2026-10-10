import { ROOMS, type AgentEvent, type LatticeState } from "@ceo/core";

export interface FeedLine {
  id: string;
  ts: number;
  kind: "quip" | "task" | "done" | "fail" | "approval" | "resolved";
  agentId?: string;
  who?: string;
  text: string;
}

const ACTION_VERB: Record<string, string> = {
  "message.send": "wants to send a message",
  "trade.place": "wants to place a trade",
  "waiver.claim": "wants to make a waiver claim",
  "lineup.set": "suggests a lineup change",
  "code.merge": "wants to merge",
  "email.send": "wants to send email",
  "lore.publish": "wants to publish lore",
  "purchase.make": "wants to buy something",
};

/** Turn raw events into the few lines worth reading. Movement and pose changes stay in the world. */
export function feedLines(state: LatticeState, limit = 40, nameOf?: (id: string) => string | undefined): FeedLine[] {
  const out: FeedLine[] = [];
  const name = (id: string) => nameOf?.(id) ?? state.agents[id]?.agent.name ?? id;
  for (const e of state.feed) {
    const line = toLine(e, state, name);
    if (line) out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

function toLine(e: AgentEvent, state: LatticeState, name: (id: string) => string): FeedLine | null {
  switch (e.type) {
    case "agent.quip":
      return { id: e.id, ts: e.ts, kind: "quip", agentId: e.agentId, who: name(e.agentId), text: `“${e.text}”` };
    case "task.started":
      return { id: e.id, ts: e.ts, kind: "task", agentId: e.agentId, who: name(e.agentId), text: `started ${e.title} · ${ROOMS[e.room].name}` };
    case "task.completed": {
      const t = state.tasks[e.taskId];
      if (!t) return null;
      return {
        id: e.id,
        ts: e.ts,
        kind: e.outcome === "success" ? "done" : "fail",
        agentId: t.agentId,
        who: name(t.agentId),
        text: e.outcome === "success" ? `finished ${t.title}` : `failed ${t.title}`,
      };
    }
    case "approval.requested":
      return {
        id: e.id,
        ts: e.ts,
        kind: "approval",
        agentId: e.approval.agentId,
        who: name(e.approval.agentId),
        text: `${ACTION_VERB[e.approval.action] ?? "needs you"}: ${e.approval.summary}`,
      };
    case "approval.resolved": {
      const a = state.approvals[e.approvalId];
      return {
        id: e.id,
        ts: e.ts,
        kind: "resolved",
        text: `C.E.O. ${e.decision} “${a?.request.summary ?? e.approvalId}”`,
      };
    }
    default:
      return null;
  }
}

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
