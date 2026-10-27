/**
 * Talk to Skippy (#434): the live voice call on the Desk's Skippy chat, on ElevenLabs Agents. Azure function (and
 * Vercel, by its file name). Everything here is for a signed-in Desk only (requireSession, #132), behind the site
 * lock like every function; the key stays in the Function App (Key Vault secret `elevenlabs`, ELEVENLABS_API_KEY,
 * the same key and the same voice as the day's story). How the agent, the cap and the settling work is in
 * api/_skippy/voice.ts.
 *
 * GET  → { ready, reason?, usage }: whether a call can start now (reason "no-key", "capped", "not-set-up") and the
 *        month's minutes ({ usedMin, budgetMin, leftMin, sessionMin, canTalk }). Settles sessions that have ended.
 * POST { action: "start" } → 200 { ok: true, token, conversation, maxSecs, desk, usage }: a one-session WebRTC token
 *        (short-lived, for the private agent only), the longest the call may run, and the Desk's state for Skippy.
 *        200 { ok: false, reason: "capped", usage } past the month's share or ElevenLabs' cap (the Desk goes back to
 *        typing); 429 { error: "slow-down", wait } past VOICE_RULES; 502 when ElevenLabs refused, with its reason
 *        (#470): { error: "key-invalid" } it doesn't accept the key, "agent-denied" the key lacks a permission,
 *        "plan" its plan or limits said no, "eleven" anything else; 503 not-set-up or no-key.
 * POST { action: "end", conversation } → { ok: true, usage }: the call is over; its real length is asked for now
 *        (or on a later request, when ElevenLabs hasn't finished it yet).
 * 401 signed-out, 403 cross-site, 400 bad-request.
 *
 * Environment: ELEVENLABS_API_KEY, optional ELEVENLABS_VOICE_ID, ELEVENLABS_BUDGET_USD (the $10 cap) and
 * ELEVENLABS_VOICE_BUDGET_USD (the talk's share, $5 by default); FOUNDRY_DESK_KEY and the blob store.
 */

import { pickBlob } from "./_blob.js";
import { deskKeyFor } from "./_desk/keys.js";
import { requireSession, withCookie } from "./_desk/session.js";
import { pickAuthStore, type AuthStore } from "./_desk/store.js";
import { setupList } from "./foundry.js";
import type { SetupStatus } from "./_desk/setup.js";
import { contextLines, deskContext } from "./_skippy/context.js";
import { BlobVoiceStore, VOICE_SESSION_SECS, countVoice, deskVariable, ensureAgent, isConversationId, mintToken, reserveAdd, settle, voiceBudget, voiceTag, voiceUsage, voiceWait, type VoiceStore, type VoiceUsage } from "./_skippy/voice.js";
import { elevenFromEnv, pickStoryStore, type ElevenConfig, type StoryStore } from "./_world/story.js";
import { pickStore } from "./_world/store.js";
import { foundryIssues } from "./skippy.js";

export interface VoiceDeps {
  deskKey: string;
  store: AuthStore | null;
  /** The month ledger the story keeps (ElevenLabs' one cap). */
  stories: StoryStore | null;
  voice: VoiceStore | null;
  eleven: ElevenConfig | null;
  /** The talk's share in dollars. */
  budget: number;
  /** The Desk's state as plain lines (api/_skippy/context.ts). */
  desk: () => Promise<string>;
  fetcher: typeof fetch;
  now: number;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

function live(): VoiceDeps {
  const env = process.env;
  const blob = pickBlob(env);
  const eleven = elevenFromEnv(env);
  return {
    deskKey: env.FOUNDRY_DESK_KEY ?? "",
    store: pickAuthStore(env),
    stories: pickStoryStore(env),
    voice: blob ? new BlobVoiceStore(blob) : null,
    eleven,
    budget: voiceBudget(env.ELEVENLABS_VOICE_BUDGET_USD, eleven?.budget ?? 10),
    desk: async () => {
      const [{ open, shipped }, setup, world] = await Promise.all([
        foundryIssues().catch(() => ({ open: [], shipped: [] })),
        setupList().catch((): SetupStatus | null => null),
        pickStore(env)
          ?.loadState()
          .catch(() => null) ?? Promise.resolve(null),
      ]);
      return contextLines(deskContext(open, shipped, setup, world ?? null), Date.now());
    },
    fetcher: (input, init) => fetch(input, init),
    now: Date.now(),
  };
}

async function usageOf(deps: VoiceDeps & { stories: StoryStore }): Promise<VoiceUsage> {
  return voiceUsage(await deps.stories.loadSpend(), deps.now, deps.budget, deps.eleven?.budget ?? 0);
}

async function settleQuietly(deps: VoiceDeps, only?: string): Promise<void> {
  if (!deps.eleven || !deps.voice || !deps.stories) return;
  const stories = deps.stories;
  await settle({ key: deps.eleven.key, store: deps.voice, addSpend: (at, add) => stories.addSpend(at, add), fetcher: deps.fetcher, now: deps.now, only }).catch(() => 0);
}

export async function status(request: Request, deps: VoiceDeps): Promise<Response> {
  if (!deps.deskKey || !deps.store) return json({ error: "not-set-up" }, 503);
  const signed = await requireSession(request, { deskKey: deps.deskKey, store: deps.store, now: deps.now });
  if (!signed.ok) return signed.response;
  if (!deps.stories || !deps.voice) return withCookie(json({ ready: false, reason: "not-set-up" }), signed);
  await settleQuietly(deps);
  let usage: VoiceUsage;
  try {
    usage = await usageOf({ ...deps, stories: deps.stories });
  } catch {
    return withCookie(json({ ready: false, reason: "not-set-up" }), signed);
  }
  const reason = !deps.eleven ? "no-key" : !usage.canTalk ? "capped" : null;
  return withCookie(json({ ready: !reason, ...(reason && { reason }), usage }), signed);
}

export async function talk(request: Request, deps: VoiceDeps): Promise<Response> {
  if (!deps.deskKey || !deps.store) return json({ error: "not-set-up" }, 503);
  // Only in a passkey session, checked before the body is read.
  const signed = await requireSession(request, { deskKey: deps.deskKey, store: deps.store, now: deps.now });
  if (!signed.ok) return signed.response;
  return withCookie(await act(request, deps, deps.store, signed.passkey.id), signed);
}

async function act(request: Request, deps: VoiceDeps, store: AuthStore, passkey: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { action?: unknown; conversation?: unknown } | null;
  if (!body || typeof body !== "object" || (body.action !== "start" && body.action !== "end")) return json({ error: "bad-request" }, 400);
  if (!deps.stories || !deps.voice) return json({ error: "not-set-up" }, 503);
  if (!deps.eleven) return json({ error: "no-key" }, 503);
  const stories = deps.stories;
  const voice = deps.voice;
  const eleven = deps.eleven;

  if (body.action === "end") {
    if (!isConversationId(body.conversation)) return json({ error: "bad-request" }, 400);
    await settleQuietly(deps, body.conversation);
    return json({ ok: true, usage: await usageOf({ ...deps, stories }).catch(() => null) });
  }

  // The pace, per passkey, counted before anything is called.
  const tag = voiceTag(passkey, await deskKeyFor(deps.deskKey, "client"));
  const limits = await store.limits();
  const wait = voiceWait(limits, tag, deps.now);
  if (wait > 0) {
    const s = Math.ceil(wait / 1000);
    return json({ error: "slow-down", wait: s }, 429, { "Retry-After": String(s) });
  }
  await store.saveLimits(countVoice(limits, tag, deps.now));

  // The cap: settle what has ended, then refuse when one more session at its longest doesn't fit. Unreadable: no call.
  await settleQuietly(deps);
  let usage: VoiceUsage;
  try {
    usage = await usageOf({ ...deps, stories });
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  if (!usage.canTalk) return json({ ok: false, reason: "capped", usage });

  let state;
  try {
    state = await voice.load();
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  const agent = await ensureAgent(eleven.key, eleven.voice, state.agent, deps.fetcher);
  if (!agent.ok) return json({ error: agent.why }, 502);
  if (agent.id !== state.agent?.id || agent.sig !== state.agent?.sig) {
    const kept = { id: agent.id, sig: agent.sig, tier: agent.tier };
    await voice.update((s) => ({ ...s, agent: kept })).catch(() => undefined);
  }

  const [minted, lines] = await Promise.all([mintToken(eleven.key, agent.id, deps.fetcher), deps.desk().catch(() => "")]);
  if ("why" in minted) {
    // The agent was deleted on ElevenLabs' side: forget it, so the next tap makes it again.
    if (minted.why === "missing") await voice.update((s) => ({ pending: s.pending })).catch(() => undefined);
    return json({ error: minted.why === "missing" ? "eleven" : minted.why }, 502);
  }

  // Counted at its longest now; settled to its real length later. A failed write means no call (fail closed).
  try {
    await stories.addSpend(deps.now, reserveAdd());
    if (minted.conversation) {
      const p = { id: minted.conversation, at: deps.now, secs: VOICE_SESSION_SECS };
      await voice.update((s) => ({ ...s, pending: [...s.pending.filter((x) => x.id !== p.id), p] }));
    }
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  const after = await usageOf({ ...deps, stories }).catch(() => usage);
  return json({ ok: true, token: minted.token, conversation: minted.conversation, maxSecs: VOICE_SESSION_SECS, desk: deskVariable(lines), usage: after });
}

export async function GET(request: Request): Promise<Response> {
  return status(request, live());
}

export async function POST(request: Request): Promise<Response> {
  return talk(request, live());
}
