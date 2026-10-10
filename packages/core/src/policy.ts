import type { ActionKind, ApprovalRequest } from "./events.ts";

/**
 * Autonomy is configuration, not code. Every agent starts at "approve": it drafts, you tap.
 * Loosening an agent later means adding a rule here, e.g. let the Relay auto-reply to family,
 * or let the Exchange place trades up to $5 with a $25 daily cap.
 */
export type AutonomyMode = "approve" | "auto" | "read_only";

export interface AutonomyLimits {
  /** Largest single action allowed to run automatically. */
  maxAmountUsd?: number;
  /** Total automatic spend per Lattice day. */
  dailyCapUsd?: number;
  /** If set, automatic actions may only touch these targets (contacts, tickers, leagues…). */
  allowTargets?: string[];
}

export interface AutonomyRule {
  agentId?: string;
  action?: ActionKind;
  mode: AutonomyMode;
  limits?: AutonomyLimits;
}

export interface AutonomyPolicy {
  defaultMode: AutonomyMode;
  rules: AutonomyRule[];
}

export const DEFAULT_POLICY: AutonomyPolicy = { defaultMode: "approve", rules: [] };

export type PolicyDecision =
  | { decision: "ask"; reason: string }
  | { decision: "auto"; reason: string }
  | { decision: "block"; reason: string };

function specificity(rule: AutonomyRule): number {
  return (rule.agentId ? 2 : 0) + (rule.action ? 1 : 0);
}

export function ruleFor(policy: AutonomyPolicy, agentId: string, action: ActionKind): AutonomyRule {
  const matches = policy.rules
    .filter((r) => (!r.agentId || r.agentId === agentId) && (!r.action || r.action === action))
    .sort((a, b) => specificity(b) - specificity(a));
  return matches[0] ?? { mode: policy.defaultMode };
}

export function evaluate(
  policy: AutonomyPolicy,
  request: ApprovalRequest,
  ledger: { spentTodayUsd: number } = { spentTodayUsd: 0 },
): PolicyDecision {
  const rule = ruleFor(policy, request.agentId, request.action);
  if (rule.mode === "read_only") return { decision: "block", reason: "This agent is read-only for that action." };
  if (rule.mode === "approve") return { decision: "ask", reason: "Needs your approval." };

  const limits = rule.limits ?? {};
  const amount = request.amountUsd ?? 0;
  if (limits.maxAmountUsd !== undefined && amount > limits.maxAmountUsd) {
    return { decision: "ask", reason: `Over the $${limits.maxAmountUsd} automatic limit.` };
  }
  if (limits.dailyCapUsd !== undefined && ledger.spentTodayUsd + amount > limits.dailyCapUsd) {
    return { decision: "ask", reason: `Would pass the $${limits.dailyCapUsd} daily cap.` };
  }
  if (limits.allowTargets && (!request.target || !limits.allowTargets.includes(request.target))) {
    return { decision: "ask", reason: "Target isn't on the allowlist." };
  }
  return { decision: "auto", reason: "Within automatic limits." };
}
