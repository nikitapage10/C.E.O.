/**
 * The always-on responder's Claude loop (#501, api/_skippy/kernelagent.ts): the rules and the private brief as the
 * system prompt (the brief behind a prompt-cache breakpoint), the live state and the question as the user turn, and
 * three tools: Anthropic's web search (at most three), "file_build_request" (the code files the issue from Nikita's own
 * words; the model picks only a size) and "deliver", which ends the run with the answer. At most five calls, each with
 * a hard max_tokens. The model has no other tool and cannot send, open a link or change anything.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SORT_MODEL, type Usage } from "../_email/budget.js";
import { RUN_LIMITS, type AgentRequest, type AgentRun } from "./kernelagent.js";

const TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: RUN_LIMITS.searches },
  {
    name: "file_build_request",
    description: "File Nikita's request as a build or change request for the crew. Call it once, only when he asked for something to be built or changed. Returns the issue number.",
    input_schema: { type: "object", properties: { size: { type: "string", enum: ["small", "medium", "large"] } }, required: ["size"], additionalProperties: false },
  },
  {
    name: "deliver",
    description: "Give Nikita your answer. Call it exactly once, last. mode is 'answer' for facts, look-ups and build requests, and 'ponder' for anything that hinges on a decision, plan, preference or judgment.",
    input_schema: { type: "object", properties: { mode: { type: "string", enum: ["answer", "ponder"] }, text: { type: "string" } }, required: ["mode", "text"], additionalProperties: false },
  },
] as const;

const add = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
  cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
});

/** The loop on the live API, with the Azure copy's CLAUDE_API_KEY. */
export function claudeAgent(key: string): (req: AgentRequest) => Promise<AgentRun> {
  const client = new Anthropic({ apiKey: key, timeout: 45_000, maxRetries: 1 });
  return async (req) => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: req.user }];
    let usage: Usage = { input_tokens: 0, output_tokens: 0 };
    let searches = 0;
    let out: AgentRun["out"] = null;
    for (let round = 0; round < RUN_LIMITS.rounds && !out; round++) {
      const res = await client.messages.create({
        model: req.model,
        max_tokens: RUN_LIMITS.maxTokens,
        // Haiku 5.5 takes thinking off outright; Sonnet 5.5 refuses "disabled" and turns it down with "between_tools".
        thinking: req.model === SORT_MODEL ? { type: "disabled" } : { type: "between_tools" },
        output_config: { effort: "low" },
        system: req.system.map((b) => ({ type: "text" as const, text: b.text, ...(b.cache && { cache_control: { type: "ephemeral" as const } }) })),
        tools: TOOLS as unknown as Anthropic.Messages.ToolUnion[],
        messages,
      });
      usage = add(usage, res.usage as Usage);
      searches += Math.min(RUN_LIMITS.searches, (res.usage as { server_tool_use?: { web_search_requests?: number } | null }).server_tool_use?.web_search_requests ?? 0);
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        const input = (block.input ?? {}) as Record<string, unknown>;
        if (block.name === "deliver") {
          if ((input.mode === "answer" || input.mode === "ponder") && typeof input.text === "string") out = { mode: input.mode, text: input.text };
          results.push({ type: "tool_result", tool_use_id: block.id, content: "Delivered." });
        } else if (block.name === "file_build_request") {
          const size = input.size === "small" || input.size === "large" ? input.size : "medium";
          const n = await req.fileBuild(size);
          results.push({ type: "tool_result", tool_use_id: block.id, content: n === null ? "The request could not be filed." : `Filed as issue #${n}.`, ...(n === null && { is_error: true }) });
        } else results.push({ type: "tool_result", tool_use_id: block.id, content: "No such tool.", is_error: true });
      }
      if (out) break;
      if (res.stop_reason === "pause_turn") continue;
      if (!results.length) break; // it stopped without delivering
      messages.push({ role: "user", content: results });
    }
    return { out, usage, searches };
  };
}
