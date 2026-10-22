/**
 * Skippy's chat under the month's Claude cap (#224, docs/THREAT-MODEL.md LLM10). Claude's API is capped at $10 a
 * month for C.E.O. (the provider's cap, and api/_world/budget.ts in code): the world step takes up to
 * WORLD_BUDGET_USD ($6 by default) and idea shaping lives in what is left. The chat gets a share of that remainder,
 * SKIPPY_BUDGET_USD ($2 by default), and never so much that the world, the chat and a reserve for Rivet's shaping
 * together pass the cap: a chat call goes out only while
 *
 *   chat this month + one call at its most   <= the chat's share, and
 *   world + chat this month + one call       <= $10 - the shaping reserve.
 *
 * The chat keeps its own month ledger in the private blob store (`desk/skippy/spend.json`), beside the Desk's
 * sign-ins, and every call is added to it from the call's own token use, as the world step does. Past the cap Skippy
 * answers with a scripted line and spends nothing until the month turns. The chat runs on Claude Sonnet 5.5, with Claude
 * Opus 5.5 for the hard questions and a web lookup when one is needed (Nikita, 2026-10-22): a typical answer costs
 * about a cent, a looked-up or escalated one a few cents.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, type BlobBackend } from "../_blob.js";
import { costOf, type Usage } from "../foundry.js";
import { monthOf } from "../_world/budget.js";

/** The month's cap on Claude's API for all of C.E.O. (shared with api/_world/budget.ts). */
export const CLAUDE_CAP_USD = 10;
/** Kept back for Rivet's shaping, which has no ledger of its own: the chat never eats into it. */
export const SHAPING_RESERVE_USD = 2;
/** The chat's share of the month, unless SKIPPY_BUDGET_USD says otherwise. */
export const SKIPPY_BUDGET_USD = 2;

/** List prices in dollars per million tokens (cache writes and reads as multiples of input). */
export const SONNET_PRICE = { input: 2, output: 10, longInput: 2, longOutput: 10, longFrom: 1_000_000, cacheWrite: 1.25, cacheRead: 0.1 } as const;
export const OPUS_PRICE = { input: 4, output: 20, longInput: 4, longOutput: 20, longFrom: 1_000_000, cacheWrite: 1.25, cacheRead: 0.05 } as const;
/** One web search, in dollars ($10 per 1,000). */
export const SEARCH_USD = 0.01;
/** The most searches one lookup may run. */
export const SEARCH_MAX = 3;
/** The most a lookup's summary may take, and the most it can add to the answering call's prompt. */
export const LOOKUP_MAX_TOKENS = 1_500;
/** A lookup reads search results (about 15k tokens a search at most) and writes a short summary. */
const LOOKUP_IN = 4_000 + SEARCH_MAX * 15_000;

/** The most one chat call can cost: its prompt (capped at 24k tokens by the input limits) and max_tokens out, thinking
 * included. */
export const CHAT_MAX_TOKENS = 2_000;
const call = (price: { input: number; output: number }, tokensIn: number, tokensOut: number) => (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
/** At most three calls: Sonnet's first answer, a lookup, and the answer again on Opus with the lookup's summary. */
export const CHAT_CEILING_USD =
  call(SONNET_PRICE, 24_000, CHAT_MAX_TOKENS) +
  call(SONNET_PRICE, LOOKUP_IN, LOOKUP_MAX_TOKENS) +
  SEARCH_MAX * SEARCH_USD +
  call(OPUS_PRICE, 24_000 + LOOKUP_MAX_TOKENS, CHAT_MAX_TOKENS);

export interface ChatMonth {
  usd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}
/** Spend by month ("2026-10"). */
export type ChatSpend = Record<string, ChatMonth>;

const EMPTY: ChatMonth = { usd: 0, calls: 0, tokensIn: 0, tokensOut: 0 };

export const chatMonth = (spend: ChatSpend, now: number): ChatMonth => ({ ...EMPTY, ...spend[monthOf(now)] });

/**
 * The chat's share from the environment, else $2; never more than the cap leaves after the world's share and the
 * shaping reserve, and never below 0.
 */
export function skippyBudget(env: string | undefined, world: number): number {
  const n = Number(env);
  const asked = env !== undefined && env !== "" && Number.isFinite(n) && n >= 0 ? n : SKIPPY_BUDGET_USD;
  return Math.max(0, Math.min(asked, CLAUDE_CAP_USD - SHAPING_RESERVE_USD - world));
}

/** Whether one more chat call fits: under the chat's share, and under the cap with the world's month and the reserve. */
export function canChat(chat: number, world: number, budget: number): boolean {
  return chat + CHAT_CEILING_USD <= budget && world + chat + CHAT_CEILING_USD <= CLAUDE_CAP_USD - SHAPING_RESERVE_USD;
}

/** The ledger with one answer added (the last six months kept): its tokens, and what it cost (Sonnet's price unless said). */
export function addChatSpend(spend: ChatSpend, now: number, usage: Usage, usd = costOf(usage, SONNET_PRICE)): ChatSpend {
  const month = monthOf(now);
  const cur = chatMonth(spend, now);
  const tokensIn = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const next: ChatMonth = { usd: cur.usd + usd, calls: cur.calls + 1, tokensIn: cur.tokensIn + tokensIn, tokensOut: cur.tokensOut + usage.output_tokens };
  const all = { ...spend, [month]: next };
  return Object.fromEntries(Object.keys(all).sort().slice(-6).map((k) => [k, all[k]!]));
}

/** Where the ledger lives. */
export interface ChatLedger {
  load(): Promise<ChatSpend>;
  add(now: number, usage: Usage, usd?: number): Promise<void>;
}

const SPEND_PATH = "desk/skippy/spend.json";

const clean = (got: unknown): ChatSpend => (got && typeof got === "object" && !Array.isArray(got) ? (got as ChatSpend) : {});

/** The ledger in the private blob store; a write checks the ETag, so two calls at once both count. */
export class BlobChatLedger implements ChatLedger {
  constructor(private readonly blob: BlobBackend) {}
  async load(): Promise<ChatSpend> {
    const found = await this.blob.get(SPEND_PATH);
    return found ? clean(await new Response(found.stream).json()) : {};
  }
  async add(now: number, usage: Usage, usd?: number): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const etag = await this.blob.etag(SPEND_PATH);
      const cur = etag ? await this.load() : {};
      try {
        await this.blob.put(SPEND_PATH, JSON.stringify(addChatSpend(cur, now, usage, usd)), {
          contentType: "application/json",
          addRandomSuffix: false,
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        });
        return;
      } catch (e) {
        if (attempt === 2 || !(e instanceof BlobPreconditionError || etag === null)) throw e;
      }
    }
  }
}

/** In memory, for tests. */
export class MemoryChatLedger implements ChatLedger {
  spend: ChatSpend = {};
  async load(): Promise<ChatSpend> {
    return structuredClone(this.spend);
  }
  async add(now: number, usage: Usage, usd?: number): Promise<void> {
    this.spend = addChatSpend(this.spend, now, usage, usd);
  }
}
