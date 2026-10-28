/**
 * The texts line's live Claude call (#535), apart from ./models.ts so the Mac hub's bundle, which imports the models'
 * shapes and checks, never carries the SDK or a key. Function App only, with CLAUDE_API_KEY from the Key Vault.
 *
 * Underscore folder: never served as a function.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeCall } from "./models.js";

/** The live call through Anthropic's SDK, with the Function App's CLAUDE_API_KEY; null without a key. */
export function liveClaude(key: string): ClaudeCall | null {
  if (!key) return null;
  const client = new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 1 });
  return async (body) => {
    const res = await client.messages.create(body);
    const text = res.content.find((b) => b.type === "text");
    let answer: unknown = null;
    if (res.stop_reason === "end_turn" && text && text.type === "text") {
      try {
        answer = JSON.parse(text.text);
      } catch {
        answer = null;
      }
    }
    return { answer, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
  };
}

