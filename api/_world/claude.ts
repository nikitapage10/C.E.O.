/**
 * The world step's Claude call (docs/WORLD.md): Claude Haiku, once an hour, for the whole Lattice, with the same key
 * as idea shaping (CLAUDE_API_KEY, or ANTHROPIC_API_KEY). The static part of the prompt (the rules and the cast) is
 * cached for an hour, so the next hour's step can read it back at a tenth of the price; the answer comes back as JSON
 * in the shape answerSchema gives.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Ask } from "./step.js";

export const WORLD_MODEL = "claude-haiku-5-5";

export const claudeKey = (env: Record<string, string | undefined> = process.env) => env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || "";

/** The step's call, or null when no key is set (every hour is then scripted). */
export function claudeAsk(key = claudeKey()): Ask | null {
  if (!key) return null;
  const client = new Anthropic({ apiKey: key, timeout: 45_000, maxRetries: 1 });
  return async (prompt, schema) => {
    const res = await client.messages.create({
      model: WORLD_MODEL,
      max_tokens: 3000,
      thinking: { type: "disabled" },
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: prompt.user }],
    });
    const text = res.content.find((b) => b.type === "text");
    let answer: unknown = null;
    if (res.stop_reason === "end_turn" && text && text.type === "text") {
      try {
        answer = JSON.parse(text.text);
      } catch {
        answer = null;
      }
    }
    return { answer, usage: res.usage };
  };
}
