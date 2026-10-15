import type { AgentEvent, ApprovalRequest, AutonomyPolicy, RelayStatus } from "@ceo/core";

/**
 * Phase 2+: the always-on hub. Not implemented yet — this file pins down the seams so the world and
 * future adapters agree on them. See README.md and docs/AGENT_STACK.md.
 */

/** Something that produces AgentEvents: Claude Code hooks, an OpenAI agent loop, BlueBubbles webhooks… */
export interface EventSource {
  id: string;
  start(emit: (event: AgentEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

/** Something that can carry out an approved action in the outside world. */
export interface ActionExecutor {
  /** Which actions this executor handles, e.g. ["message.send"]. */
  handles: ApprovalRequest["action"][];
  execute(request: ApprovalRequest): Promise<{ ok: boolean; note?: string }>;
}

export interface HubConfig {
  port: number;
  policy: AutonomyPolicy;
  sources: EventSource[];
  executors: ActionExecutor[];
}

/**
 * How Relay tells the site how it is doing: counts, enum states and timestamps only (docs/RELAY-PRIVACY.md, #149).
 * An implementation checks every status with `readRelayStatus` from `@ceo/core` before it sends it and drops a
 * refused one whole. Nothing else about Relay (names, handles, message text, drafts, summaries) ever leaves the Mac
 * for the site, and Relay sends the site no AgentEvents of its own.
 */
export interface RelayReporter {
  report(status: RelayStatus): Promise<void>;
}
