/**
 * The always-on responder's routes and wiring (#501; logic in ./kernelagent.ts, the Claude loop in ./kernelrun.ts).
 * Azure only: both routes are registered by azure/src/index.ts, and `registerKernelAgent` sets the listener that
 * starts the responder when a hand-off to Skippy is kept.
 *
 *   PUT  /api/kernel-brief   the private brief (kernel-brief.md), for Skippy, the Magnificent to seed and refresh. The
 *                            room-key header the subminds' write key travels in (the egress proxy adds it; the same
 *                            SUBMIND_FEED_TOKEN as POST /api/skippy-answer, as `x-ceo-room-key` or a bearer) and
 *                            nothing else opens it. Markdown or plain text, at most 40,000 bytes, held back whole
 *                            (422, kinds only) when it looks private. Kept in the private blob store, never in the
 *                            repo and never on a public path. Only the time is logged, never a word of it.
 *   POST /api/kernel-agent   { id }: runs the responder for one hand-off, in its own invocation. The same write key.
 *                            The listener calls it on the Function App's own address and does not wait for it, so a
 *                            long answer never holds up the chat that handed the question off. 200 { state, usd }.
 *
 * Neither route reads or returns the brief, a question or an answer.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { PRIVATE_LABEL, privateParts } from "../_privacy.js";
import { waitUntil } from "../_waitUntil.js";
import { githubToken } from "../_github.js";
import { setupList } from "../foundry.js";
import { keepAnswer, answerDeps, foundryIssues } from "../skippy.js";
import { roomKeyOf } from "../_site/roomkeys.js";
import { claudeKey } from "../_world/claude.js";
import { pickStore } from "../_world/store.js";
import type { SetupStatus } from "../_desk/setup.js";
import { BlobChatLedger } from "./budget.js";
import { contextLines, deskContext } from "./context.js";
import { BRIEF_MAX_BYTES, BRIEF_PATH, KERNEL_LEDGER_PATH, kernelAgentOn, respond, type AgentDeps } from "./kernelagent.js";
import { claudeAgent } from "./kernelrun.js";
import { BlobRoomLog, isTurnId, onHandoff } from "./log.js";
import { liveRoomReads } from "./roomReads.js";
import { roomLines } from "./rooms.js";

type Env = Record<string, string | undefined>;

export const BRIEF_ROUTE = "/api/kernel-brief";
export const AGENT_ROUTE = "/api/kernel-agent";
const BRIEF_META = "desk/skippy/kernel-brief.meta.json";
const GH = "https://api.github.com/repos/nikitapage10/C.E.O.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/** The write key, from either header the proxy sends; true only for the feed key. */
const hasWriteKey = (request: Request, env: Env): boolean => roomKeyOf(request, env) === "feed";

/* ── The brief ── */

export interface BriefDeps {
  env: Env;
  blob: BlobBackend | null;
  now: number;
  /** The one line that is logged: the time. */
  log?: (line: string) => void;
}

/** The brief as the responder reads it: "" when none has been seeded. */
export async function loadBrief(blob: BlobBackend | null): Promise<string> {
  if (!blob) return "";
  const found = await blob.get(BRIEF_PATH);
  return found ? await new Response(found.stream).text() : "";
}

export async function putBrief(request: Request, deps: BriefDeps): Promise<Response> {
  if (!hasWriteKey(request, deps.env)) return json({ error: "unauthorized" }, 401);
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("text/")) return json({ error: "bad-request" }, 415);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: "bad-request" }, 400);
  if (bytes.byteLength > BRIEF_MAX_BYTES) return json({ error: "too-large", max: BRIEF_MAX_BYTES }, 413);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  // The Desk's privacy check: a private-looking brief is held back whole, and only the kinds are said.
  const held = privateParts(text);
  if (held.length) return json({ error: "private", held: held.map((k) => PRIVATE_LABEL[k]) }, 422);
  const at = new Date(deps.now).toISOString();
  try {
    await deps.blob.put(BRIEF_PATH, bytes, { contentType: "text/markdown; charset=utf-8", addRandomSuffix: false, allowOverwrite: true });
    await deps.blob.put(BRIEF_META, JSON.stringify({ at, bytes: bytes.byteLength }), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  } catch {
    return json({ error: "unwritable" }, 502);
  }
  (deps.log ?? console.log)(`kernel-brief updated ${at}`);
  return json({ ok: true, bytes: bytes.byteLength, at });
}

/* ── The responder, live ── */

/** Everything the responder touches, from the server's own settings. */
export function liveAgent(env: Env = process.env): AgentDeps {
  const blob = pickBlob(env);
  const key = claudeKey(env);
  const log = new BlobRoomLog(blob ?? NO_BLOB);
  const reads = { ...liveRoomReads(env), clock: async () => null as string | null };
  return {
    log,
    ledger: new BlobChatLedger(blob ?? NO_BLOB, KERNEL_LEDGER_PATH),
    env,
    now: Date.now(),
    run: key && blob ? claudeAgent(key) : null,
    brief: () => loadBrief(blob),
    desk: async () => {
      const world = (await pickStore(env)?.loadState().catch(() => null)) ?? null;
      const [{ open, shipped }, setup, rooms] = await Promise.all([
        foundryIssues().catch(() => ({ open: [], shipped: [] })),
        setupList().catch((): SetupStatus | null => null),
        roomLines({ ...reads, clock: async () => world?.at ?? null }, Date.now()).catch(() => ""),
      ]);
      return { desk: contextLines(deskContext(open, shipped, setup, world), Date.now()), rooms };
    },
    fileIssue: async (title, body) => {
      const res = await fetch(`${GH}/issues`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${await githubToken("issues")}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, labels: ["foundry", "foundry:chat"] }),
      });
      return res.ok ? ((await res.json()) as { number: number }).number : null;
    },
    keep: async ({ id, text, final }) => {
      const res = await keepAnswer({ ...answerDeps(), log }, { id, from: "kernel-agent", text, final, ping: final });
      return res.ok;
    },
  };
}

/** A store that is never there, so a missing blob store reads as empty and fails every write. */
const NO_BLOB: BlobBackend = {
  kind: "azureblob",
  get: async () => null,
  etag: async () => null,
  put: async () => {
    throw new Error("no blob store");
  },
  del: async () => undefined,
};

export async function runAgent(request: Request, deps: { env: Env; agent: () => AgentDeps }): Promise<Response> {
  if (!hasWriteKey(request, deps.env)) return json({ error: "unauthorized" }, 401);
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || !isTurnId(body.id)) return json({ error: "bad-request" }, 400);
  const out = await respond(body.id, deps.agent());
  return json({ state: out.state, usd: Math.round(out.usd * 1e6) / 1e6, ...("filed" in out && out.filed !== undefined && { filed: out.filed }) });
}

/* ── The trigger ── */

/**
 * Starts the responder for a new hand-off: a request to the Function App's own address, which runs it in an
 * invocation of its own (so it outlives the chat's) and is not waited for. Without that address (a local run) it
 * runs in-process. Does nothing when the responder is off or has no key: the watcher takes the hand-off.
 */
export function startFor(id: string, env: Env = process.env, send: typeof fetch = fetch, run: (id: string) => Promise<unknown> = (i) => respond(i, liveAgent(env))): void {
  if (!kernelAgentOn(env) || !claudeKey(env)) return;
  const host = env.WEBSITE_HOSTNAME?.trim();
  const token = env.SUBMIND_FEED_TOKEN?.trim();
  if (host && token) {
    waitUntil(
      send(`https://${host}${AGENT_ROUTE}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(10 * 60_000),
      }).catch(() => undefined),
    );
  } else waitUntil(run(id).catch(() => undefined));
}

/** Sets the listener: every hand-off to Skippy that is kept starts the responder. Called once at start-up. */
export function registerKernelAgent(env: Env = process.env): void {
  onHandoff((turn) => startFor(turn.id, env));
}

/* ── The handlers Azure registers ── */

export const brief = { PUT: (request: Request) => putBrief(request, { env: process.env, blob: pickBlob(process.env), now: Date.now() }) };
export const agent = { POST: (request: Request) => runAgent(request, { env: process.env, agent: () => liveAgent(process.env) }) };
