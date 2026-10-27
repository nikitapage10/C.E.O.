/**
 * Talk to Skippy (#434): the live voice call on the Desk's Skippy chat, on ElevenLabs Agents. Azure function (and
 * Vercel, by its file name). Everything here is for a signed-in Desk only (requireSession, #132), behind the site
 * lock like every function; the key stays in the Function App (Key Vault secret `elevenlabs`, ELEVENLABS_API_KEY,
 * the same key and the same voice as the day's story). How the agent, the cap and the settling work is in
 * api/_skippy/voice.ts.
 *
 * GET  → { ready, reason?, usage, credits? }: whether a call can start now (reason "no-key", "capped", "not-set-up"),
 *        the month's minutes and dollars ({ usedMin, budgetMin, leftMin, sessionMin, canTalk, calls, usedUsd, budgetUsd,
 *        storyUsd, elevenUsd, capUsd }) and, when ElevenLabs answers, the plan's credits ({ used, limit, resetAt, tier },
 *        #477; left out when it doesn't). Settles sessions that have ended. Signed-in only, so the bill never goes public.
 * POST { action: "start" } → 200 { ok: true, token, conversation, maxSecs, desk, usage, crew? }: a one-session WebRTC token
 *        (short-lived, for the private agent only), the longest the call may run (ten minutes), and the Desk's state for
 *        Skippy, the month's ElevenLabs bill on top (billLines, #477).
 *        200 { ok: false, reason: "capped", usage } past the month's share or ElevenLabs' cap (the Desk goes back to
 *        typing); 429 { error: "slow-down", wait } past VOICE_RULES; 502 when ElevenLabs refused, with its reason
 *        (#470): { error: "key-invalid" } it doesn't accept the key, "agent-denied" the key lacks a permission,
 *        "plan" its plan or limits said no, "eleven" anything else; 503 not-set-up or no-key.
 *        With Skippy's crew (#479) the answer also carries `tool`, the call's own key for its lookups (the browser passes
 *        it to ElevenLabs as the secret variable `secret__ceo_tool`; api/_skippy/voicetoken.ts), and (#481) `crew`, each
 *        submind's ElevenLabs agent id to its own id ("turf"), so the Desk's hologram shows whoever has the mic.
 * POST { action: "end", conversation } → { ok: true, usage }: the call is over; its tool token is revoked and its real
 *        length is asked for now (or on a later request, when ElevenLabs hasn't finished it yet); once it is, the
 *        subminds' exchanges on it go to the Council (api/_skippy/voicecouncil.ts).
 * GET ?handoffs=<conversation> → { handoffs: [turn ids] }: what the call handed to the Kernel (#480), so the Desk's chat
 *        waits on those answers like typed ones.
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
import { roomLines } from "./_skippy/rooms.js";
import { liveRoomReads } from "./_skippy/roomReads.js";
import { BlobRoomLog, type RoomLog } from "./_skippy/log.js";
import { exchangesOf } from "./_skippy/voicecouncil.js";
import { ensureCrew, skippyToolIds, skippyTransfers } from "./_skippy/voicecrew.js";
import { BlobCrewStore, TOOL_SLACK_MS, callHandoffs, endToolToken, issueToolToken, type CrewStore } from "./_skippy/voicetoken.js";
import { siteUrl } from "./_site/hosts.js";
import { BlobVoiceStore, VOICE_LLM, VOICE_SESSION_SECS, VOICE_SILENCE_SECS, billLines, countVoice, creditsReader, deskVariable, ensureAgent, isConversationId, mintToken, reserveAdd, settle, voiceBudget, voiceTag, voiceUsage, voiceWait, type AgentCrew, type ElevenCredits, type VoiceState, type VoiceStore, type VoiceUsage } from "./_skippy/voice.js";
import { elevenFromEnv, pickStoryStore, type ElevenConfig, type StoryStore } from "./_world/story.js";
import { pickStore } from "./_world/store.js";
import { foundryIssues } from "./skippy.js";
import { memo } from "./_feedcache.js";

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
  /** The plan's credits from ElevenLabs (#477), null when it doesn't answer. Left out, none are asked for. */
  credits?: () => Promise<ElevenCredits | null>;
  /**
   * Skippy's crew (#479): the store of the calls' tool tokens and of the tools' and subminds' ids on ElevenLabs, the
   * room log the Council reads, and the site's address the tools call. Left out, the call has no lookups or subminds.
   */
  crew?: CrewStore | null;
  roomLog?: RoomLog | null;
  site?: string;
  fetcher: typeof fetch;
  now: number;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

/** How long the Desk's lines for a call are kept per warm instance (#496): a minute, so a tap after the warm-up is instant. */
export const DESK_KEEP_MS = 60_000;

/** The longest a start waits on the Desk's lines when they aren't kept (#496). */
export const DESK_WAIT_MS = 800;
/** What Skippy is told when they weren't ready in time. */
export const DESK_LATE = "(The Desk's lines are still loading: look the rooms up with your read tools.)";

/** The Desk's state as plain lines for Skippy: the Foundry's, then the live rooms' (#478). Kept a minute (#496). */
const deskLines = memo(DESK_KEEP_MS, async () => {
  const env = process.env;
  const [{ open, shipped }, setup, world] = await Promise.all([
    foundryIssues().catch(() => ({ open: [], shipped: [] })),
    setupList().catch((): SetupStatus | null => null),
    pickStore(env)
      ?.loadState()
      .catch(() => null) ?? Promise.resolve(null),
  ]);
  // A room that fails or is slow is left out.
  const rooms = await roomLines({ ...liveRoomReads(env), clock: async () => world?.at ?? null }, Date.now()).catch(() => "");
  return [contextLines(deskContext(open, shipped, setup, world ?? null), Date.now()), rooms].filter(Boolean).join("\n");
});

/**
 * The start's stages, timed (#496), for a `Server-Timing` header the browser can read: each stage's milliseconds by
 * name. Names only, never a value.
 */
export function stageTimer(clock: () => number = () => performance.now()) {
  const t0 = clock();
  const marks: { name: string; ms: number }[] = [];
  return {
    async time<T>(name: string, work: Promise<T>): Promise<T> {
      const at = clock();
      try {
        return await work;
      } finally {
        marks.push({ name, ms: clock() - at });
      }
    },
    marks: () => [...marks],
    header: () => [...marks.map((m) => `${m.name};dur=${Math.round(m.ms)}`), `total;dur=${Math.round(clock() - t0)}`].join(", "),
  };
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
    desk: deskLines,
    ...(eleven && { credits: creditsReader(eleven.key) }),
    crew: blob ? new BlobCrewStore(blob) : null,
    roomLog: blob ? new BlobRoomLog(blob) : null,
    site: siteUrl(env),
    fetcher: (input, init) => fetch(input, init),
    now: Date.now(),
  };
}

async function usageOf(deps: VoiceDeps & { stories: StoryStore }): Promise<VoiceUsage> {
  return voiceUsage(await deps.stories.loadSpend(), deps.now, deps.budget, deps.eleven?.budget ?? 0);
}

const creditsOf = (deps: VoiceDeps) => (deps.credits ? deps.credits().catch(() => null) : Promise.resolve(null));

async function settleQuietly(deps: VoiceDeps, only?: string): Promise<void> {
  if (!deps.eleven || !deps.voice || !deps.stories) return;
  const stories = deps.stories;
  const { crew, roomLog } = deps;
  // Once a call is over, each stretch a submind held the mic goes to the Council (#479, Desk-only).
  const onDone =
    crew && roomLog
      ? async (p: { id: string; at: number }, conversation: unknown) => {
          const { agents } = await crew.load(deps.now);
          for (const t of exchangesOf(conversation, agents, p.at)) await roomLog.add(t, deps.now);
        }
      : undefined;
  await settle({ key: deps.eleven.key, store: deps.voice, addSpend: (at, add) => stories.addSpend(at, add), fetcher: deps.fetcher, now: deps.now, only, onDone }).catch(() => 0);
}

/**
 * Skippy's crew on ElevenLabs (#479): the lookup tools and the subminds' agents, made or brought up to date (only a
 * change in code calls ElevenLabs), and what Skippy's own agent then carries. Null when there is no crew store or
 * nothing could be made: the call goes ahead as before, without lookups or subminds.
 */
async function crewFor(deps: VoiceDeps, eleven: ElevenConfig, skippy: string): Promise<{ crew: AgentCrew | null; agents: Record<string, string> }> {
  const none = { crew: null, agents: {} };
  if (!deps.crew || !deps.site) return none;
  const store = deps.crew;
  try {
    const known = await store.load(deps.now);
    const got = await ensureCrew({ key: eleven.key, voice: eleven.voice, site: deps.site, skippy, limits: { sessionSecs: VOICE_SESSION_SECS, silenceSecs: VOICE_SILENCE_SECS, llm: VOICE_LLM }, fetcher: deps.fetcher }, known);
    if (JSON.stringify(got) !== JSON.stringify({ tools: known.tools, agents: known.agents })) await store.update(deps.now, (s) => ({ ...s, ...got }));
    const toolIds = skippyToolIds(got.tools);
    // Who's who on the call (#481): each submind's ElevenLabs agent id to its own id. Agent ids only, never a key.
    const agents = Object.fromEntries(Object.entries(got.agents).map(([id, a]) => [a.id, id]));
    return toolIds.length ? { crew: { toolIds, transfers: skippyTransfers(got.agents) }, agents } : none;
  } catch {
    return none;
  }
}

/** Skippy's agent with his crew: a first-ever call makes Skippy bare first, since the subminds need his id to hand back. */
async function skippyAgent(deps: VoiceDeps, eleven: ElevenConfig, state: VoiceState): Promise<{ agent: Awaited<ReturnType<typeof ensureAgent>>; crew: AgentCrew | null; agents: Record<string, string> }> {
  let known = state.agent;
  if (!known && deps.crew) {
    const bare = await ensureAgent(eleven.key, eleven.voice, undefined, deps.fetcher);
    if (!bare.ok) return { agent: bare, crew: null, agents: {} };
    known = { id: bare.id, sig: bare.sig, tier: bare.tier };
  }
  const { crew, agents } = known ? await crewFor(deps, eleven, known.id) : { crew: null, agents: {} };
  // Only a change in code calls ElevenLabs: with the stored signatures matching, this is local work (ensureAgent and
  // ensureCrew compare them first, #496).
  return { agent: await ensureAgent(eleven.key, eleven.voice, known, deps.fetcher, undefined, crew), crew, agents };
}

/** Skippy's agent checked (and, after a deploy that changed it, PATCHed) and kept, as the start and the warm-up do. */
async function agentReady(deps: VoiceDeps, eleven: ElevenConfig, voice: VoiceStore) {
  const state = await voice.load();
  const got = await skippyAgent(deps, eleven, state);
  if (got.agent.ok && (got.agent.id !== state.agent?.id || got.agent.sig !== state.agent?.sig)) {
    const kept = { id: got.agent.id, sig: got.agent.sig, tier: got.agent.tier };
    await voice.update((s) => ({ ...s, agent: kept })).catch(() => undefined);
  }
  return got;
}

/**
 * The warm-up (#496), GET ?warm=1 when Nikita's pointer or focus reaches Talk: wakes the function, fills the Desk's
 * lines for the minute they are kept, and checks Skippy's agent and crew (PATCHing them once after a deploy that
 * changed them), so the tap itself only mints a token. Signed-in only; answers { ok } with its stages' timings.
 */
async function warm(deps: VoiceDeps): Promise<Response> {
  const t = stageTimer();
  if (deps.eleven && deps.voice) {
    const eleven = deps.eleven;
    const voice = deps.voice;
    await Promise.all([t.time("desk", deps.desk().catch(() => "")), t.time("agent", agentReady(deps, eleven, voice).catch(() => null)), t.time("credits", creditsOf(deps))]);
  }
  return json({ ok: true }, 200, { "Server-Timing": t.header() });
}

export async function status(request: Request, deps: VoiceDeps): Promise<Response> {
  if (!deps.deskKey || !deps.store) return json({ error: "not-set-up" }, 503);
  const signed = await requireSession(request, { deskKey: deps.deskKey, store: deps.store, now: deps.now });
  if (!signed.ok) return signed.response;
  // The hand-offs to the Kernel a call made (#479), so the Desk's chat waits on their answers like typed ones.
  const conv = new URL(request.url).searchParams.get("handoffs");
  if (conv !== null) {
    if (!isConversationId(conv)) return withCookie(json({ error: "bad-request" }, 400), signed);
    const turns = deps.crew ? await callHandoffs(deps.crew, conv, deps.now).catch(() => []) : [];
    return withCookie(json({ handoffs: turns }), signed);
  }
  if (new URL(request.url).searchParams.get("warm") === "1") return withCookie(await warm(deps), signed);
  if (!deps.stories || !deps.voice) return withCookie(json({ ready: false, reason: "not-set-up" }), signed);
  // The chat just opened: start filling the Desk's lines for a call now (#496), without waiting on them.
  void deps.desk().catch(() => "");
  await settleQuietly(deps);
  let usage: VoiceUsage;
  try {
    usage = await usageOf({ ...deps, stories: deps.stories });
  } catch {
    return withCookie(json({ ready: false, reason: "not-set-up" }), signed);
  }
  const reason = !deps.eleven ? "no-key" : !usage.canTalk ? "capped" : null;
  const plan = deps.eleven ? await creditsOf(deps) : null;
  return withCookie(json({ ready: !reason, ...(reason && { reason }), usage, ...(plan && { credits: plan }) }), signed);
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
    // The call is over: its tool token answers nothing more (#479).
    if (deps.crew) await endToolToken(deps.crew, body.conversation, deps.now);
    await settleQuietly(deps, body.conversation);
    return json({ ok: true, usage: await usageOf({ ...deps, stories }).catch(() => null) });
  }

  // Timed, stage by stage, into a Server-Timing header (#496).
  const t = stageTimer();
  // The pace, per passkey, counted before anything is called.
  const tag = voiceTag(passkey, await deskKeyFor(deps.deskKey, "client"));
  const limits = await t.time("pace", store.limits());
  const wait = voiceWait(limits, tag, deps.now);
  if (wait > 0) {
    const s = Math.ceil(wait / 1000);
    return json({ error: "slow-down", wait: s }, 429, { "Retry-After": String(s) });
  }
  // From here, what doesn't depend on another runs side by side (#496): the pace's write and the month's ledger, with
  // the Desk's lines (kept a minute) and the plan's credits (kept five) under way behind them.
  const counted = t.time("count", store.saveLimits(countVoice(limits, tag, deps.now)));
  // The Desk's lines wait at most DESK_WAIT_MS: kept, they are instant; cold, the call starts without them and Skippy
  // reads the rooms with his tools instead (the lines carry on filling the cache for the next tap).
  const deskP = t.time("desk", Promise.race([deps.desk().catch(() => ""), new Promise<string>((r) => setTimeout(() => r(DESK_LATE), DESK_WAIT_MS))]));
  const planP = t.time("credits", creditsOf(deps));

  // The cap: refuse when one more session at its longest doesn't fit. Only then are ended sessions settled first (their
  // unused minutes given back) and the month read again: settling asks ElevenLabs about each, so it stays off the
  // common path (the chat's status read and the call's end settle too). Unreadable: no call.
  let usage: VoiceUsage;
  try {
    await counted;
    usage = await t.time("ledger", usageOf({ ...deps, stories }));
    if (!usage.canTalk) {
      await t.time("settle", settleQuietly(deps));
      usage = await usageOf({ ...deps, stories });
    }
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  if (!usage.canTalk) return json({ ok: false, reason: "capped", usage });

  // Skippy's agent, checked only once the cap allows a call (a capped month never calls ElevenLabs). With the stored
  // signatures matching (the warm-up has usually seen to it), this is two reads of our own store.
  let got;
  try {
    got = await t.time("agent", agentReady(deps, eleven, voice));
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  const { agent, agents } = got;
  if (!agent.ok) return json({ error: agent.why }, 502);

  const [minted, lines, plan] = await Promise.all([t.time("mint", mintToken(eleven.key, agent.id, deps.fetcher)), deskP, planP]);
  if ("why" in minted) {
    // The agent was deleted on ElevenLabs' side: forget it, so the next tap makes it again.
    if (minted.why === "missing") await voice.update((s) => ({ pending: s.pending })).catch(() => undefined);
    return json({ error: minted.why === "missing" ? "eleven" : minted.why }, 502);
  }

  // Counted at its longest now; settled to its real length later. A failed write means no call (fail closed). The
  // ledger, the pending list and the call's tool key are written side by side.
  // The call's own key for its lookups (#479): good for the call's longest and a little more, kept as a hash with the
  // call, passed to ElevenLabs as a secret dynamic variable that only the tools' header ever carries.
  let after: VoiceUsage;
  let tool: string | null;
  try {
    const p = minted.conversation ? { id: minted.conversation, at: deps.now, secs: VOICE_SESSION_SECS } : null;
    [after, tool] = await t.time(
      "keep",
      Promise.all([
        stories.addSpend(deps.now, reserveAdd()).then(() => usageOf({ ...deps, stories }).catch(() => usage)),
        deps.crew && minted.conversation ? issueToolToken(deps.crew, deps.deskKey, minted.conversation, deps.now + VOICE_SESSION_SECS * 1000 + TOOL_SLACK_MS, deps.now) : Promise.resolve(null),
        p ? voice.update((s) => ({ ...s, pending: [...s.pending.filter((x) => x.id !== p.id), p] })) : Promise.resolve(null),
      ]).then(([a, k]) => [a, k] as const),
    );
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  // Who's who on the call (#481): each submind's ElevenLabs agent id, so the Desk's hologram can swap to whoever has
  // the mic after a transfer. Agent ids only, never a key.
  const crew = agents;
  // The bill goes first, so the Desk's cut at DESK_MAX never drops it.
  return json({ ok: true, token: minted.token, conversation: minted.conversation, maxSecs: VOICE_SESSION_SECS, desk: deskVariable(`${billLines(after, plan)}\n${lines}`), usage: after, ...(plan && { credits: plan }), ...(tool && { tool }), ...(Object.keys(crew).length && { crew }) }, 200, { "Server-Timing": t.header() });
}

export async function GET(request: Request): Promise<Response> {
  return status(request, live());
}

export async function POST(request: Request): Promise<Response> {
  return talk(request, live());
}
