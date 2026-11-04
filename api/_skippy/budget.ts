/**
 * Skippy's month under his own cap (#224, #646, docs/THREAT-MODEL.md LLM10). Nikita set it on 2026-11-04 (#646, "Trail ·
 * Budget"): one hard stop of $60 a month for everything Skippy thinks with (the Desk's chat and its agent loop, the
 * always-on Kernel responder, Opus research and, later, hosted agent sessions), aiming for about $50, with a warning
 * on the Desk at $50. It is the non-secret app setting SKIPPY_BUDGET_USD (60 by default). Email and texts keep their
 * own $10 caps, and the world step its own share of the old $10 Claude cap (api/_world/budget.ts); none of those are
 * counted here.
 *
 * Each part keeps its own month ledger in the private blob store, beside the Desk's sign-ins: the chat's
 * (`desk/skippy/spend.json`, split into triage, talk and research) and the Kernel responder's
 * (`desk/skippy/kernel-agent-spend.json`). A call goes out only while
 *
 *   every part this month + one call at its most   <= SKIPPY_BUDGET_USD,
 *
 * so the month can't pass the cap even with two calls racing. Past it Skippy answers with a scripted line and spends
 * nothing until the month turns. The spend meter (GET /api/skippy-spend, the Boiler Room's Controls) reads the same sums.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, type BlobBackend } from "../_blob.js";
import { costOf, type Usage } from "../foundry.js";
import { monthOf } from "../_world/budget.js";

/** The old month's cap on Claude's API for the world step, the Green and shaping (api/_world/budget.ts, api/_green). */
export const CLAUDE_CAP_USD = 10;
/** Kept back for Rivet's shaping inside that old cap, which has no ledger of its own. */
export const SHAPING_RESERVE_USD = 2;
/** Skippy's month (#646), unless SKIPPY_BUDGET_USD says otherwise: a hard stop. */
export const SKIPPY_BUDGET_USD = 60;
/** Where the Desk warns: $50 of the $60 (Nikita, 2026-11-04), the same share of any other cap. */
export const SKIPPY_WARN_SHARE = 50 / 60;
/** The most SKIPPY_BUDGET_USD may say, as a seatbelt against a typo. */
export const SKIPPY_BUDGET_MAX = 500;
/** Where the Kernel responder's month ledger lives (#501), counted inside Skippy's month. */
export const KERNEL_LEDGER_PATH = "desk/skippy/kernel-agent-spend.json";

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

/**
 * The agent loop (#646): at most AGENT_ROUNDS calls a turn, each with at most AGENT_INPUT tokens in and
 * AGENT_MAX_TOKENS out (thinking included), on Opus at its most, plus a Haiku triage and the web searches.
 */
export const AGENT_ROUNDS = 4;
export const AGENT_INPUT = 60_000;
export const AGENT_MAX_TOKENS = 2_500;
export const HAIKU_PRICE = { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5, longFrom: 100_000, cacheWrite: 1.25, cacheRead: 0.1 } as const;

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

/** One agent turn at its most (#646): the triage, every round on Opus at its most, and the searches. About $1.20. */
export const AGENT_CEILING_USD = call(HAIKU_PRICE, 4_000, 200) + AGENT_ROUNDS * call(OPUS_PRICE, AGENT_INPUT, AGENT_MAX_TOKENS) + SEARCH_MAX * SEARCH_USD;

export interface ChatMonth {
  usd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Dollars by part (#646): "triage" (Haiku), "talk" (Sonnet), "research" (Opus), "web" (searches). */
  parts?: Record<string, number>;
}
/** Spend by month ("2026-10"). */
export type ChatSpend = Record<string, ChatMonth>;

const EMPTY: ChatMonth = { usd: 0, calls: 0, tokensIn: 0, tokensOut: 0 };

export const chatMonth = (spend: ChatSpend, now: number): ChatMonth => ({ ...EMPTY, ...spend[monthOf(now)] });

/** Skippy's month from SKIPPY_BUDGET_USD, else $60; never below 0 or past the seatbelt. */
export function skippyBudget(env: string | undefined): number {
  const n = Number(env);
  const asked = env !== undefined && env.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : SKIPPY_BUDGET_USD;
  return Math.min(asked, SKIPPY_BUDGET_MAX);
}

/** Where the Desk starts warning for a cap: $50 of $60. */
export const skippyWarn = (budget: number): number => Math.round(budget * SKIPPY_WARN_SHARE * 100) / 100;

/** Whether one more call at its most (`ceiling`) fits: everything Skippy spent this month plus it, under the cap. */
export function canChat(spent: number, budget: number, ceiling = CHAT_CEILING_USD): boolean {
  return spent + ceiling <= budget;
}

/** The ledger with one answer added (the last six months kept): its tokens, and what it cost (Sonnet's price unless said). */
export function addChatSpend(spend: ChatSpend, now: number, usage: Usage, usd = costOf(usage, SONNET_PRICE), parts?: Record<string, number>): ChatSpend {
  const month = monthOf(now);
  const cur = chatMonth(spend, now);
  const tokensIn = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const merged = { ...cur.parts };
  for (const [k, v] of Object.entries(parts ?? {})) if (Number.isFinite(v) && v > 0) merged[k] = (merged[k] ?? 0) + v;
  const next: ChatMonth = { usd: cur.usd + usd, calls: cur.calls + 1, tokensIn: cur.tokensIn + tokensIn, tokensOut: cur.tokensOut + usage.output_tokens, ...(Object.keys(merged).length && { parts: merged }) };
  const all = { ...spend, [month]: next };
  return Object.fromEntries(Object.keys(all).sort().slice(-6).map((k) => [k, all[k]!]));
}

/** Where the ledger lives. */
export interface ChatLedger {
  load(): Promise<ChatSpend>;
  add(now: number, usage: Usage, usd?: number, parts?: Record<string, number>): Promise<void>;
}

const SPEND_PATH = "desk/skippy/spend.json";

const clean = (got: unknown): ChatSpend => (got && typeof got === "object" && !Array.isArray(got) ? (got as ChatSpend) : {});

/** The ledger in the private blob store; a write checks the ETag, so two calls at once both count. */
export class BlobChatLedger implements ChatLedger {
  /** `path`: where this ledger lives; Skippy's by default (the Green's Commentator keeps its own beside it, #276). */
  constructor(
    private readonly blob: BlobBackend,
    private readonly path = SPEND_PATH,
  ) {}
  async load(): Promise<ChatSpend> {
    const found = await this.blob.get(this.path);
    return found ? clean(await new Response(found.stream).json()) : {};
  }
  async add(now: number, usage: Usage, usd?: number, parts?: Record<string, number>): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const etag = await this.blob.etag(this.path);
      const cur = etag ? await this.load() : {};
      try {
        await this.blob.put(this.path, JSON.stringify(addChatSpend(cur, now, usage, usd, parts)), {
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
  async add(now: number, usage: Usage, usd?: number, parts?: Record<string, number>): Promise<void> {
    this.spend = addChatSpend(this.spend, now, usage, usd, parts);
  }
}

/* ── The whole month, every part (#646) ── */

/** What the spend meter shows, and what GET /api/skippy-spend answers (the Boiler Room's Controls read it, #647). */
export interface SkippySpend {
  /** "2026-11". */
  month: string;
  capUsd: number;
  warnUsd: number;
  spentUsd: number;
  leftUsd: number;
  /** "ok" under the warning, "warn" past $50, "capped" when one more call wouldn't fit. */
  state: "ok" | "warn" | "capped";
  /** Dollars by part: the chat's triage, talk, research and web, the Kernel responder, hosted agents (0 until they run). */
  parts: { triage: number; talk: number; research: number; web: number; kernel: number; agents: number };
  calls: number;
  /** The caps Skippy's month doesn't cover, for the meter's footnote. */
  others: { emailCapUsd: number; textsCapUsd: number };
}

const cents = (n: number) => Math.round(n * 10_000) / 10_000;

/** Every part's month, summed. Throws when a ledger can't be read (callers fail closed). */
export async function skippySpend(ledgers: { chat: ChatLedger; kernel?: ChatLedger | null }, budget: number, now: number, others = { emailCapUsd: 10, textsCapUsd: 10 }): Promise<SkippySpend> {
  const [chat, kernel] = await Promise.all([ledgers.chat.load(), ledgers.kernel ? ledgers.kernel.load() : Promise.resolve({})]);
  const c = chatMonth(chat, now);
  const k = chatMonth(kernel, now);
  const p = c.parts ?? {};
  // A month written before #646 has no parts: all of it was the chat's talk.
  const named = (p.triage ?? 0) + (p.research ?? 0) + (p.web ?? 0) + (p.talk ?? 0);
  const talk = (p.talk ?? 0) + Math.max(0, c.usd - named);
  const spentUsd = cents(c.usd + k.usd);
  const warnUsd = skippyWarn(budget);
  const state = !canChat(spentUsd, budget) ? "capped" : spentUsd >= warnUsd ? "warn" : "ok";
  return {
    month: monthOf(now),
    capUsd: budget,
    warnUsd,
    spentUsd,
    leftUsd: cents(Math.max(0, budget - spentUsd)),
    state,
    parts: { triage: cents(p.triage ?? 0), talk: cents(talk), research: cents(p.research ?? 0), web: cents(p.web ?? 0), kernel: cents(k.usd), agents: 0 },
    calls: c.calls + k.calls,
    others,
  };
}

/** Everything Skippy spent this month, the chat's and the Kernel responder's together. Throws when unreadable. */
export async function skippySpent(chat: ChatLedger, kernel: ChatLedger | null, now: number): Promise<number> {
  const [c, k] = await Promise.all([chat.load(), kernel ? kernel.load() : Promise.resolve({})]);
  return chatMonth(c, now).usd + chatMonth(k, now).usd;
}
