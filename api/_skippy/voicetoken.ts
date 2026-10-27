/**
 * The call's own key for its live lookups (#479). When Nikita taps Talk, the function mints the call's ElevenLabs token
 * (api/skippy-voice.ts) and, beside it, one random tool token for that call alone. The browser hands it to ElevenLabs
 * as a secret dynamic variable (`secret__ceo_tool`), which ElevenLabs binds only to tool headers and never sends to the
 * LLM (elevenlabs.io/docs, "Secret dynamic variables"); every webhook tool of Skippy and his subminds sends it back as
 * `x-ceo-voice-tool`. The lookups (api/_skippy/toolroute.ts) answer only a token that is:
 *
 *   1. signed: `vt1.<expiry>.<nonce>.<mac>`, an HMAC under a key derived from FOUNDRY_DESK_KEY (no new secret anywhere),
 *      which the site gate checks with nothing but the environment (api/_site/gate.ts), and
 *   2. live: kept in the private store with its call (`desk/skippy/voice-tools.json`, as a SHA-256 hash only), not past
 *      its expiry (the call's longest plus two minutes), and not ended (the call's "end" revokes it).
 *
 * A missing, wrong, forged, expired or ended token is refused. The token is never logged or kept in the clear.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BlobPreconditionError, type BlobBackend } from "../_blob.js";

/** The header each tool webhook sends the token in. */
export const TOOL_HEADER = "x-ceo-voice-tool";
/** The secret dynamic variable that carries it (the `secret__` prefix keeps it out of the LLM). */
export const TOOL_VAR = "secret__ceo_tool";
/** How long past the call's longest a token still answers: a lookup at the last second, and clock skew. */
export const TOOL_SLACK_MS = 2 * 60_000;
/** The most tokens kept (one call at a time, so a handful at most). */
const KEEP = 20;
/** The most hand-offs to the Kernel one call may make. */
export const MAX_HANDOFFS = 5;

const B64 = /^[A-Za-z0-9_-]+$/;

/** The key tokens are signed with: derived from the Desk key, so it is no new secret and never the Desk key itself. */
export function toolKey(deskKey: string): Buffer | null {
  const k = deskKey.trim();
  return k.length >= 16 ? createHmac("sha256", k).update("ceo-voice-tool-v1").digest() : null;
}

const macOf = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest("base64url");

/** A fresh token for one call, good until `until` (ms). */
export function mintToolToken(deskKey: string, until: number): string | null {
  const key = toolKey(deskKey);
  if (!key) return null;
  const body = `vt1.${Math.floor(until).toString(36)}.${randomBytes(18).toString("base64url")}`;
  return `${body}.${macOf(key, body)}`;
}

/** The token's expiry (ms) when it is well-formed and signed by this Desk key; null otherwise. Expiry not checked. */
export function signedUntil(token: string | null | undefined, deskKey: string): number | null {
  if (!token || token.length > 200) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "vt1" || !parts.slice(1).every((p) => B64.test(p))) return null;
  const key = toolKey(deskKey);
  if (!key) return null;
  const want = Buffer.from(macOf(key, parts.slice(0, 3).join(".")));
  const got = Buffer.from(parts[3]!);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const until = parseInt(parts[1]!, 36);
  return Number.isFinite(until) ? until : null;
}

/** The sync check the site gate runs: signed by this Desk key and not yet expired. */
export const toolTokenSigned = (token: string | null | undefined, deskKey: string, now: number): boolean => {
  const until = signedUntil(token, deskKey);
  return until !== null && until > now;
};

export const tokenHash = (token: string) => createHash("sha256").update(token.trim()).digest("hex");

/* ── What is kept ── */

export interface KeptToken {
  /** SHA-256 of the token: the token itself is never stored. */
  hash: string;
  /** ElevenLabs' conversation id ("" when it didn't say). */
  conversation: string;
  /** Good until (ms). */
  until: number;
  /** The call ended: refused from then on. */
  ended?: boolean;
  /** The hand-offs to the Kernel this call made (#479, turn ids in the `kernel` room's log). */
  handoffs?: string[];
}

/** One agent or tool on ElevenLabs, with the signature of the settings it was last given. */
export interface KeptThing {
  id: string;
  sig: string;
  tier?: "full" | "core";
}

export interface CrewState {
  tokens: KeptToken[];
  /** The webhook tools, by name (api/_skippy/voicecrew.ts). */
  tools: Record<string, KeptThing>;
  /** The subminds' agents, by submind id (turf, ticker, static, soot, ember). */
  agents: Record<string, KeptThing>;
}

const ID = /^[A-Za-z0-9_-]{6,80}$/;
const HASH = /^[0-9a-f]{64}$/;

function things(raw: unknown): Record<string, KeptThing> {
  const out: Record<string, KeptThing> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const t = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    if (!/^[a-z_]{2,40}$/.test(name) || typeof t.id !== "string" || !ID.test(t.id) || typeof t.sig !== "string" || !/^[0-9a-f]{16}$/.test(t.sig)) continue;
    out[name] = { id: t.id, sig: t.sig, ...((t.tier === "full" || t.tier === "core") && { tier: t.tier }) };
  }
  return out;
}

export function cleanCrew(raw: unknown, now: number): CrewState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tokens = (Array.isArray(r.tokens) ? r.tokens : [])
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {}))
    .filter((t) => typeof t.hash === "string" && HASH.test(t.hash) && typeof t.until === "number" && Number.isFinite(t.until) && t.until > now)
    .map((t): KeptToken => {
      const handoffs = (Array.isArray(t.handoffs) ? t.handoffs : []).filter((h): h is string => typeof h === "string" && /^[0-9a-f]{16}$/.test(h)).slice(0, MAX_HANDOFFS);
      return { hash: t.hash as string, conversation: typeof t.conversation === "string" && ID.test(t.conversation) ? t.conversation : "", until: t.until as number, ...(t.ended === true && { ended: true }), ...(handoffs.length && { handoffs }) };
    })
    .slice(-KEEP);
  return { tokens, tools: things(r.tools), agents: things(r.agents) };
}

export interface CrewStore {
  load(now: number): Promise<CrewState>;
  update(now: number, fn: (s: CrewState) => CrewState): Promise<CrewState>;
}

const PATH = "desk/skippy/voice-tools.json";

export class BlobCrewStore implements CrewStore {
  constructor(private readonly blob: BlobBackend) {}
  async load(now: number): Promise<CrewState> {
    const found = await this.blob.get(PATH);
    return cleanCrew(found ? await new Response(found.stream).json().catch(() => null) : null, now);
  }
  async update(now: number, fn: (s: CrewState) => CrewState): Promise<CrewState> {
    for (let attempt = 0; ; attempt++) {
      const etag = await this.blob.etag(PATH);
      const next = cleanCrew(fn(etag ? await this.load(now) : cleanCrew(null, now)), now);
      try {
        await this.blob.put(PATH, JSON.stringify(next), { contentType: "application/json", addRandomSuffix: false, ...(etag ? { ifMatch: etag } : { allowOverwrite: false }) });
        return next;
      } catch (e) {
        if (attempt === 2 || !(e instanceof BlobPreconditionError || etag === null)) throw e;
      }
    }
  }
}

export class MemoryCrewStore implements CrewStore {
  state: unknown = null;
  async load(now: number) {
    return cleanCrew(structuredClone(this.state), now);
  }
  async update(now: number, fn: (s: CrewState) => CrewState) {
    this.state = cleanCrew(fn(cleanCrew(structuredClone(this.state), now)), now);
    return cleanCrew(structuredClone(this.state), now);
  }
}

/** Mint a call's tool token and keep its hash with the call. Null (no lookups this call) when it can't be kept. */
export async function issueToolToken(store: CrewStore, deskKey: string, conversation: string, until: number, now: number): Promise<string | null> {
  const token = mintToolToken(deskKey, until);
  if (!token) return null;
  const kept: KeptToken = { hash: tokenHash(token), conversation: ID.test(conversation) ? conversation : "", until };
  try {
    await store.update(now, (s) => ({ ...s, tokens: [...s.tokens, kept] }));
  } catch {
    return null;
  }
  return token;
}

/** The call's end: its token answers nothing more. */
export async function endToolToken(store: CrewStore, conversation: string, now: number): Promise<void> {
  if (!ID.test(conversation)) return;
  await store.update(now, (s) => ({ ...s, tokens: s.tokens.map((t) => (t.conversation === conversation ? { ...t, ended: true } : t)) })).catch(() => undefined);
}

export type TokenCheck = { ok: true; conversation: string; hash: string; handoffs: string[] } | { ok: false; why: "missing" | "bad" | "expired" | "unknown" | "ended" | "store" };

/** The full check the lookups run: signed, unexpired, kept and not ended. */
export async function checkToolToken(token: string | null | undefined, deskKey: string, store: CrewStore | null, now: number): Promise<TokenCheck> {
  if (!token || !token.trim()) return { ok: false, why: "missing" };
  const until = signedUntil(token, deskKey);
  if (until === null) return { ok: false, why: "bad" };
  if (until <= now) return { ok: false, why: "expired" };
  if (!store) return { ok: false, why: "store" };
  let state: CrewState;
  try {
    state = await store.load(now);
  } catch {
    return { ok: false, why: "store" };
  }
  const h = tokenHash(token);
  const kept = state.tokens.find((t) => t.hash === h);
  if (!kept) return { ok: false, why: "unknown" };
  if (kept.ended) return { ok: false, why: "ended" };
  if (kept.until <= now) return { ok: false, why: "expired" };
  return { ok: true, conversation: kept.conversation, hash: h, handoffs: kept.handoffs ?? [] };
}

/** Notes a hand-off this call made, for check_answers and the Desk's chat; false once the call has made its share. */
export async function noteHandoff(store: CrewStore, hash: string, turn: string, now: number): Promise<boolean> {
  let ok = false;
  await store.update(now, (s) => ({
    ...s,
    tokens: s.tokens.map((t) => {
      if (t.hash !== hash) return t;
      const list = t.handoffs ?? [];
      ok = list.length < MAX_HANDOFFS;
      return ok ? { ...t, handoffs: [...list, turn] } : t;
    }),
  }));
  return ok;
}

/** The hand-offs a call made, by its conversation id (the Desk reads them to wait on the answers in the chat). */
export async function callHandoffs(store: CrewStore, conversation: string, now: number): Promise<string[]> {
  if (!ID.test(conversation)) return [];
  const s = await store.load(now);
  return s.tokens.filter((t) => t.conversation === conversation).flatMap((t) => t.handoffs ?? []);
}
