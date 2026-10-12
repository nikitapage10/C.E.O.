import { z } from "zod";
import { LINEAGE_IDS } from "./lineages.ts";
import { ROOM_IDS } from "./layout.ts";

/**
 * AgentEvent is the one contract between event sources and the world.
 * Phase 1's simulator emits these; phase 2+ adapters (Claude Code hooks, OpenAI Agents SDK, BlueBubbles,
 * Sleeper, Kalshi…) normalise their activity into exactly the same shapes.
 */

export const LineageSchema = z.enum(LINEAGE_IDS);
export const RoomIdSchema = z.enum(ROOM_IDS);

export const PROVIDERS = ["simulated", "claude-code", "claude-agent-sdk", "openai", "cursor", "manus"] as const;
export const ProviderSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof ProviderSchema>;

export const PlaceSchema = z.object({ room: RoomIdSchema, station: z.string().min(1) });

export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  lineage: LineageSchema,
  provider: ProviderSchema,
  role: z.string(),
  home: PlaceSchema,
});
export type Agent = z.infer<typeof AgentSchema>;

export const ACTIVITIES = [
  "idle",
  "walking",
  "working",
  "typing",
  "carrying",
  "celebrating",
  "slumped",
  "napping",
  "waiting",
  "staring",
] as const;
export const ActivitySchema = z.enum(ACTIVITIES);
export type Activity = z.infer<typeof ActivitySchema>;

export const PROPS = ["crate", "cube", "envelope", "ball", "book", "coin", "mug", "chart"] as const;
export const PropSchema = z.enum(PROPS);
export type Prop = z.infer<typeof PropSchema>;

/** What an agent wants to do in the outside world. The policy engine decides whether it needs you. */
export const ACTION_KINDS = [
  "message.send",
  "trade.place",
  "waiver.claim",
  "lineup.set",
  "code.merge",
  "email.send",
  "lore.publish",
  "purchase.make",
] as const;
export const ActionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  action: ActionKindSchema,
  summary: z.string(),
  detail: z.string().optional(),
  /** Dollar amount at stake, when there is one (used by spending limits). */
  amountUsd: z.number().nonnegative().optional(),
  /** Who the action touches (a contact, a ticker, a league), for allowlists. */
  target: z.string().optional(),
  risk: z.enum(["low", "medium", "high"]),
  room: RoomIdSchema,
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

const base = {
  id: z.string().min(1),
  /** Lattice time in ms. */
  ts: z.number().nonnegative(),
  source: ProviderSchema,
};

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("agent.spawned"), agent: AgentSchema }),
  z.object({ ...base, type: z.literal("agent.moved"), agentId: z.string(), to: PlaceSchema }),
  z.object({
    ...base,
    type: z.literal("agent.activity"),
    agentId: z.string(),
    activity: ActivitySchema,
    prop: PropSchema.nullable().optional(),
  }),
  z.object({ ...base, type: z.literal("agent.quip"), agentId: z.string(), text: z.string().min(1) }),
  z.object({
    ...base,
    type: z.literal("task.started"),
    taskId: z.string(),
    agentId: z.string(),
    title: z.string(),
    room: RoomIdSchema,
  }),
  z.object({
    ...base,
    type: z.literal("task.progress"),
    taskId: z.string(),
    progress: z.number().min(0).max(1),
    note: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("task.completed"),
    taskId: z.string(),
    outcome: z.enum(["success", "failure"]),
    note: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal("approval.requested"), approval: ApprovalRequestSchema }),
  z.object({
    ...base,
    type: z.literal("approval.resolved"),
    approvalId: z.string(),
    decision: z.enum(["approved", "denied"]),
    by: z.enum(["user", "policy"]),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent["type"];
export type EventOf<T extends AgentEventType> = Extract<AgentEvent, { type: T }>;

/** An event before an id, timestamp and source are stamped on it (distributes over the union). */
export type AgentEventBody = AgentEvent extends infer E
  ? E extends AgentEvent
    ? Omit<E, "id" | "ts" | "source">
    : never
  : never;

/**
 * True for events from a real agent (through the hub). Everything the simulator or the world itself makes is
 * stamped "simulated", so this is how the Lattice-wide view keeps the demo out.
 */
export function isLive(event: Pick<AgentEvent, "source">): boolean {
  return event.source !== "simulated";
}
