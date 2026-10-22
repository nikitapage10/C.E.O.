/**
 * Skippy, the Magnificent on the Desk (#224), as a Vercel function (and an Azure one, through azure/src/index.ts):
 * Nikita types or says something on Today, and Skippy answers in a line or two and suggests where it should go.
 *
 * GET  → { ready }: whether the chat can work here (the Desk's sign-in and Claude are both set up). Nothing else.
 * POST → { message, history? } from a signed-in Desk only (requireSession, #132): `message` is what Nikita just said
 *        (at most 600 characters), `history` the last few turns the browser kept ({ who: "nikita" | "skippy", text },
 *        at most eight). Nothing is stored here and no message text is ever logged: the browser holds the
 *        conversation, and it is gone when the tab closes.
 *        200 { reply, actions }: Skippy's answer, and up to three buttons from a closed set (api/_skippy/prompt.ts):
 *          { kind: "idea", label, text }            file `text` as an idea, through the Suggest box's own path
 *          { kind: "answer", label, issue, text }   answer Rivet's open question on `issue`, through the Desk's path
 *          { kind: "open", label, page }            open a Desk page
 *          { kind: "lattice", label, room? }        enter the Lattice
 *        Skippy can't do any of them himself: the Desk shows them as buttons, and only Nikita's tap sends one, to
 *        api/foundry.ts with all of its own checks (the privacy check, the labels, the sign-in).
 *        200 { reply, actions: [], capped: true } when the month's chat budget is spent (api/_skippy/budget.ts).
 *        401 signed-out, 403 cross-site, 400 bad-request, 422 { error: "private", held } (the privacy check, before
 *        anything reaches Claude), 429 { error: "slow-down", wait } (api/_skippy/limits.ts), 502 model, 503 not-set-up.
 *
 * What Skippy is told about the Desk is what the Desk already shows (api/_skippy/context.ts): titles, numbers, labels
 * and counts from the Foundry's issues, the setup list's states and the world clock, scrubbed like the public feeds.
 *
 * Environment: FOUNDRY_DESK_KEY and the blob store (the Desk's sign-in), CLAUDE_API_KEY (or ANTHROPIC_API_KEY),
 * optional SKIPPY_BUDGET_USD (the chat's share of the $10 monthly Claude cap, $1 by default).
 */

import Anthropic from "@anthropic-ai/sdk";
import { pickBlob } from "./_blob.js";
import { deskKeyFor } from "./_desk/keys.js";
import { requireSession, withCookie } from "./_desk/session.js";
import { pickAuthStore, type AuthStore } from "./_desk/store.js";
import type { SetupStatus } from "./_desk/setup.js";
import { memo } from "./_feedcache.js";
import { githubToken } from "./_github.js";
import { PRIVATE_LABEL, privateParts } from "./_privacy.js";
import { setupList, type Usage } from "./foundry.js";
import { BlobChatLedger, CHAT_MAX_TOKENS, canChat, chatMonth, skippyBudget, type ChatLedger } from "./_skippy/budget.js";
import { contextLines, deskContext, EMPTY_CONTEXT, type ContextIssue, type DeskContext } from "./_skippy/context.js";
import { chatTag, chatWait, countChat } from "./_skippy/limits.js";
import { OVER_BUDGET, SKIPPY_PROMPT, SKIPPY_SCHEMA, chatInput, readChat, readReply } from "./_skippy/prompt.js";
import { monthTotals, worldBudget } from "./_world/budget.js";
import { claudeKey } from "./_world/claude.js";
import { pickStore } from "./_world/store.js";
import type { WorldState } from "./_world/types.js";

export const SKIPPY_MODEL = "claude-haiku-5-5";

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

/** One call to Claude: the parsed answer (null when unusable) and what it used (null when it never answered). */
export type Ask = (system: string, input: string) => Promise<{ answer: unknown; usage: Usage | null }>;

/** Claude Haiku with the fixed rules, the fenced input, structured output and a hard max_tokens. */
export function claudeChat(key: string): Ask {
  const client = new Anthropic({ apiKey: key, timeout: 15_000, maxRetries: 1 });
  return async (system, input) => {
    const res = await client.messages.create({
      model: SKIPPY_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SKIPPY_SCHEMA } },
      system,
      messages: [{ role: "user", content: input }],
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

async function readGithub<T>(path: string, fallback: T): Promise<T> {
  try {
    const token = await githubToken("read");
    const res = await fetch(`${GH}${path}`, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The Foundry's open issues and the last ships, kept 30 seconds per warm function. */
const foundryIssues = memo(30_000, async () => {
  const [open, shipped] = await Promise.all([
    readGithub<ContextIssue[]>("/issues?labels=foundry&state=open&sort=updated&direction=desc&per_page=50", []),
    readGithub<ContextIssue[]>("/issues?labels=foundry:shipped&state=closed&sort=updated&direction=desc&per_page=5", []),
  ]);
  return { open, shipped };
});

export interface ChatDeps {
  deskKey: string;
  store: AuthStore | null;
  ledger: ChatLedger | null;
  ask: Ask | null;
  /** The saved world (its spend and its clock), or null. */
  world: () => Promise<WorldState | null>;
  /** The Desk's live state for Skippy. */
  desk: (world: WorldState | null) => Promise<DeskContext>;
  now: number;
  env: Record<string, string | undefined>;
}

function defaultDeps(): ChatDeps {
  const env = process.env;
  const blob = pickBlob(env);
  const key = claudeKey(env);
  return {
    deskKey: env.FOUNDRY_DESK_KEY ?? "",
    store: pickAuthStore(env),
    ledger: blob ? new BlobChatLedger(blob) : null,
    ask: key ? claudeChat(key) : null,
    world: async () => (await pickStore(env)?.loadState().catch(() => null)) ?? null,
    desk: async (world) => {
      const [{ open, shipped }, setup] = await Promise.all([foundryIssues().catch(() => ({ open: [], shipped: [] })), setupList().catch((): SetupStatus | null => null)]);
      return deskContext(open, shipped, setup, world);
    },
    now: Date.now(),
    env,
  };
}

export async function GET(): Promise<Response> {
  const d = defaultDeps();
  return json({ ready: Boolean(d.deskKey && d.store && d.ledger && d.ask) });
}

export async function POST(request: Request): Promise<Response> {
  return chat(request, defaultDeps());
}

/** The chat itself, with everything it touches handed in (the tests stub each piece). */
export async function chat(request: Request, deps: ChatDeps): Promise<Response> {
  if (!deps.deskKey || !deps.store) return json({ error: "not-set-up" }, 503);
  // Only in a passkey session, checked before the body is even read: without one nothing goes anywhere.
  const signed = await requireSession(request, { deskKey: deps.deskKey, store: deps.store, now: deps.now });
  if (!signed.ok) return signed.response;
  return withCookie(await answer(request, deps, deps.store, signed.passkey.id), signed);
}

async function answer(request: Request, deps: ChatDeps, store: AuthStore, passkey: string): Promise<Response> {
  if (!deps.ask || !deps.ledger) return json({ error: "not-set-up" }, 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const said = readChat(body);
  if (!said) return json({ error: "bad-request" }, 400);

  // The privacy check (#127), on everything that would reach Claude: text that looks private is held back whole.
  const held = [...new Set([said.message, ...said.history.map((t) => t.text)].flatMap((t) => privateParts(t)))];
  if (held.length) return json({ error: "private", held: held.map((k) => PRIVATE_LABEL[k]) }, 422);

  // The pace, per passkey: counted before the call, so a refused or failed call still counts.
  const tag = chatTag(passkey, await deskKeyFor(deps.deskKey, "client"));
  const limits = await store.limits();
  const wait = chatWait(limits, tag, deps.now);
  if (wait > 0) {
    const s = Math.ceil(wait / 1000);
    return json({ error: "slow-down", wait: s }, 429, { "Retry-After": String(s) });
  }
  await store.saveLimits(countChat(limits, tag, deps.now));

  // The month's budget: the world's spend and the chat's own ledger. Unreadable means no call (fail closed).
  const world = await deps.world();
  let spent: number;
  try {
    spent = chatMonth(await deps.ledger.load(), deps.now).usd;
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  const worldUsd = monthTotals(world ?? { spend: {} }, deps.now).usd;
  if (!canChat(spent, worldUsd, skippyBudget(deps.env.SKIPPY_BUDGET_USD, worldBudget(deps.env.WORLD_BUDGET_USD)))) {
    return json({ reply: OVER_BUDGET[Math.floor(deps.now / 60_000) % OVER_BUDGET.length], actions: [], capped: true });
  }

  const desk = await deps.desk(world).catch(() => EMPTY_CONTEXT);
  let got: Awaited<ReturnType<Ask>>;
  try {
    got = await deps.ask(SKIPPY_PROMPT, chatInput(contextLines(desk, deps.now), said.history, said.message));
  } catch {
    return json({ error: "model" }, 502);
  }
  // Every call that answered counts against the month, usable or not.
  if (got.usage) await deps.ledger.add(deps.now, got.usage).catch(() => undefined);
  const reply = readReply(got.answer, desk);
  return reply ? json(reply) : json({ error: "model" }, 502);
}
