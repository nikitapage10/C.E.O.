/**
 * The texts line's own Claude cap (#535; Nikita, 2026-10-28: Relay's texts get their own $10 a month, separate from
 * the email agent's): its own ledger, `relay/spend.json` in the private store, apart from email's, the world's,
 * Skippy's and the Kernel's. It mirrors the email agent's (api/_email/budget.ts) and prices each call from the same one
 * table (Haiku 5.5 sorts, Sonnet 5.5 drafts).
 *
 * The hard stop: a call goes out only once its worst case is reserved on the ledger, in a conditional write over the
 * version read, while this month's spend plus that reservation stays within the cap (RELAY_BUDGET_USD, $10 by
 * default, never more than $10). Two calls racing at the edge can't both fit: the second write loses, reads again and
 * finds no room. After the call the reservation is settled to what it really cost (or released if Anthropic refused it with an error status; a timeout keeps the worst case, as it may have been billed);
 * if that write never lands, the larger reservation stays, so the ledger fails closed. Past it, /api/relay-hub answers "paused": the hub keeps
 * counting texts as owed, without a sort or a draft, and the Desk says the texts cap is reached until the month
 * (UTC) turns. An unreadable ledger also stops the calls. The ledger holds dollars, calls and token counts only.
 *
 * Underscore folder: never served as a function.
 */

import { BlobPreconditionError, type BlobBackend } from "../_blob.js";
import { costFor, type Usage } from "../_email/budget.js";
import { monthOf } from "../_world/budget.js";
import { DRAFT_MAX_TOKENS, DRAFT_MODEL, SORT_MAX_TOKENS, SORT_MODEL, type RelayModel } from "./models.js";

export const SPEND_PATH = "relay/spend.json";
export const DEFAULT_RELAY_BUDGET_USD = 10;

/** RELAY_BUDGET_USD, or $10; never negative, never above $10. */
export function relayBudget(env: string | undefined): number {
  const n = Number(env);
  return env !== undefined && env.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.min(n, DEFAULT_RELAY_BUDGET_USD) : DEFAULT_RELAY_BUDGET_USD;
}

/** The most input one call can send: the instructions plus the capped snippet (about 1,500 tokens at most). */
export const MAX_INPUT_TOKENS = 3_000;

/** One call at its most: the ceiling checked before it goes out. */
export const CEILING: Record<RelayModel, number> = {
  [SORT_MODEL]: costFor(SORT_MODEL, { input_tokens: MAX_INPUT_TOKENS, output_tokens: SORT_MAX_TOKENS }),
  [DRAFT_MODEL]: costFor(DRAFT_MODEL, { input_tokens: MAX_INPUT_TOKENS, output_tokens: DRAFT_MAX_TOKENS }),
};

export interface Month {
  usd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}
export type Ledger = Record<string, Month>;

const EMPTY: Month = { usd: 0, calls: 0, tokensIn: 0, tokensOut: 0 };

export function readLedger(v: unknown): Ledger | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Ledger = {};
  for (const [k, m] of Object.entries(v as Record<string, Record<string, unknown>>)) {
    if (!/^\d{4}-\d{2}$/.test(k) || !m || typeof m.usd !== "number" || !Number.isFinite(m.usd)) return null;
    out[k] = { usd: m.usd, calls: Number(m.calls) || 0, tokensIn: Number(m.tokensIn) || 0, tokensOut: Number(m.tokensOut) || 0 };
  }
  return out;
}

export const monthSpend = (ledger: Ledger, now: number): Month => ({ ...EMPTY, ...ledger[monthOf(now)] });

/** Whether one more call on `model` fits under the cap this month. */
export function canSpend(ledger: Ledger, model: RelayModel, budget: number, now: number): boolean {
  return monthSpend(ledger, now).usd + CEILING[model] <= budget;
}

/** The ledger with one call's cost added (and months older than a year dropped). */
export function addSpend(ledger: Ledger, model: RelayModel, usage: Usage, now: number): Ledger {
  const m = monthSpend(ledger, now);
  const out: Ledger = {};
  for (const [k, v] of Object.entries(ledger)) if (k >= monthOf(now - 365 * 86_400_000)) out[k] = v;
  out[monthOf(now)] = { usd: m.usd + costFor(model, usage), calls: m.calls + 1, tokensIn: m.tokensIn + usage.input_tokens, tokensOut: m.tokensOut + usage.output_tokens };
  return out;
}

export interface SpendStore {
  load(): Promise<{ ledger: Ledger | null; version: string | null }>;
  save(ledger: Ledger, version: string | null): Promise<boolean>;
}

export class BlobSpendStore implements SpendStore {
  constructor(private readonly blob: BlobBackend) {}
  async load() {
    const version = await this.blob.etag(SPEND_PATH);
    if (!version) return { ledger: {}, version: null };
    const found = await this.blob.get(SPEND_PATH);
    let raw: unknown;
    try {
      raw = found ? await new Response(found.stream).json() : null;
    } catch {
      raw = null;
    }
    return { ledger: readLedger(raw), version };
  }
  async save(ledger: Ledger, version: string | null) {
    try {
      await this.blob.put(SPEND_PATH, JSON.stringify(ledger), { contentType: "application/json", ...(version ? { ifMatch: version, allowOverwrite: true } : { allowOverwrite: false }) });
      return true;
    } catch (e) {
      if (e instanceof BlobPreconditionError) return false;
      throw e;
    }
  }
}

export class MemorySpendStore implements SpendStore {
  json: string | null = null;
  ver = 0;
  async load() {
    return this.json ? { ledger: readLedger(JSON.parse(this.json)), version: String(this.ver) } : { ledger: {}, version: null };
  }
  async save(ledger: Ledger, version: string | null) {
    if ((this.json ? String(this.ver) : null) !== version) return false;
    this.json = JSON.stringify(ledger);
    this.ver += 1;
    return true;
  }
}

/** Adds one call's cost to the stored ledger, over the version read (again on a lost race). */
export async function recordSpend(store: SpendStore, model: RelayModel, usage: Usage, now: number): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const { ledger, version } = await store.load();
    if (await store.save(addSpend(ledger ?? {}, model, usage, now), version)) return;
  }
}

const keepYear = (ledger: Ledger, now: number): Ledger => {
  const out: Ledger = {};
  for (const [k, v] of Object.entries(ledger)) if (k >= monthOf(now - 365 * 86_400_000)) out[k] = v;
  return out;
};

/**
 * Reserves one call's worst case before it goes out. True only when it fits under the cap and the reservation was
 * written over the version read; false (no call) when it doesn't fit, the ledger can't be read, or the write keeps
 * losing races.
 */
export async function reserveSpend(store: SpendStore, model: RelayModel, budget: number, now: number): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    const { ledger, version } = await store.load();
    if (!ledger || !canSpend(ledger, model, budget, now)) return false;
    const m = monthSpend(ledger, now);
    const next = { ...keepYear(ledger, now), [monthOf(now)]: { ...m, usd: m.usd + CEILING[model], calls: m.calls + 1 } };
    if (await store.save(next, version)) return true;
  }
  return false;
}

/** Turns a reservation into the call's real cost (usage), or releases it (null: the call failed and cost nothing). */
export async function settleSpend(store: SpendStore, model: RelayModel, usage: Usage | null, now: number): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const { ledger, version } = await store.load();
    if (!ledger) return;
    const m = monthSpend(ledger, now);
    const delta = (usage ? costFor(model, usage) : 0) - CEILING[model];
    const month = usage
      ? { usd: Math.max(0, m.usd + delta), calls: m.calls, tokensIn: m.tokensIn + usage.input_tokens, tokensOut: m.tokensOut + usage.output_tokens }
      : { ...m, usd: Math.max(0, m.usd + delta), calls: Math.max(0, m.calls - 1) };
    if (await store.save({ ...keepYear(ledger, now), [monthOf(now)]: month }, version)) return;
  }
}
