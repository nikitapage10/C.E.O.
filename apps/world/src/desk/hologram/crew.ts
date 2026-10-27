import type { RoomId } from "@ceo/core";
import { SUBMINDS } from "../../../../../packages/simulator/src/subminds.ts";

/**
 * Who has the mic on a call (#481 with #479's crew): Skippy's subminds take it with ElevenLabs' agent transfer, and
 * the hologram swaps to that submind's can in its room's colours. The call's start answer carries the crew as
 * ElevenLabs agent id → submind id (`crew`); the call's events name the agent speaking. Kept pure, for the tests.
 */

const AGENT_ID = /^[A-Za-z0-9_-]{4,80}$/;

/** The crew from the call's start answer: only well-formed agent ids, and only subminds the Lattice knows. */
export function readCrew(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [agent, id] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    if (AGENT_ID.test(agent) && typeof id === "string" && SUBMINDS.some((m) => m.id === id)) out[agent] = id;
  }
  return out;
}

/** The room whose submind an agent is; null for Skippy's own agent (or anyone else). */
export function roomOfAgent(agentId: string, crew: Record<string, string>): RoomId | null {
  const id = crew[agentId];
  return id ? (SUBMINDS.find((m) => m.id === id)?.room ?? null) : null;
}

const get = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

/**
 * The agent an incoming call event names, if any: an agent line's `agent_metadata.agent_id` (at the top, or inside
 * the event's own payload), or the target of a `transfer_to_agent` tool's result.
 */
export function agentOfEvent(ev: unknown): string | null {
  const pick = (v: unknown) => (typeof v === "string" && AGENT_ID.test(v) ? v : null);
  if (!ev || typeof ev !== "object") return null;
  const direct = pick(get(get(ev, "agent_metadata"), "agent_id"));
  if (direct) return direct;
  for (const v of Object.values(ev as Record<string, unknown>)) {
    const inner = pick(get(get(v, "agent_metadata"), "agent_id"));
    if (inner) return inner;
  }
  const payload = get(ev, "agent_tool_response_full_payload") ?? get(ev, "agent_tool_response");
  if (get(payload, "tool_name") === "transfer_to_agent" && get(payload, "is_error") !== true) {
    const result = get(payload, "full_tool_result");
    if (typeof result === "string") {
      try {
        const r = JSON.parse(result) as unknown;
        return pick(get(r, "to_agent")) ?? pick(get(r, "agent_id")) ?? pick(get(r, "transferred_to")) ?? null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
