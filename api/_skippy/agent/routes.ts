/**
 * Desk Skippy's agent, its three small endpoints (#646), each in the Desk's passkey session only (requireSession,
 * checked before a body is read; 401 signed out, 403 cross-site, 503 not set up):
 *
 *   POST /api/skippy-act      { confirm: <id>, yes: true|false }   Nikita's tap on a call that waits for it: Yes runs it
 *                                                                once with the input it was kept with; No drops it.
 *                             { tool: <name>, input: {…} }         a room's voice hook running one of the rooms' tools
 *                                                                (`@ceo/engine/voice`, RoomUtterance.tool): the same
 *                                                                registry and checks as the agent; one that sends,
 *                                                                spends or deletes comes back as { confirm } instead.
 *                             → { ok, text, did? } | { ok, confirm: { id, label, summary } } | { ok: false, text }
 *   GET  /api/skippy-memory   what Skippy keeps of Nikita: the core card, the facts and the pages' index (never the
 *                             journal's words). POST { action, … }: "core" { text }, "facts" { facts: string[], topic?,
 *                             source? } (the project's memory mirrored, or Nikita's own list; each checked on its own),
 *                             "page" { title, topic, summary, body, source? }, "forget" { id }. Everything through the
 *                             memory's rules (./memory.ts); a refused one is counted by reason, never echoed. POST
 *                             also takes the subminds' write key (#1124) for "core", "facts" and "page" only: it adds,
 *                             never reads or forgets.
 *   GET  /api/skippy-spend    Skippy's month (api/_skippy/budget.ts skippySpend): the cap, the warning, what is spent by
 *                             part, and the state. The Boiler Room's Controls (#647) read the same shape.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../../_blob.js";
import { skipTermsFrom } from "../../_email/filter.js";
import { requireSession, withCookie, type DeskDeps } from "../../_desk/session.js";
import { pickAuthStore } from "../../_desk/store.js";
import { plainLine } from "../../foundry.js";
import { roomKeyOf } from "../../_site/roomkeys.js";
import { BlobChatLedger, KERNEL_LEDGER_PATH, skippyBudget, skippySpend, type ChatLedger } from "../budget.js";
import { liveHost, livePending } from "./host.js";
import { BlobChatLog, chatLogGet } from "../chatlog.js";
import { BlobMemory, FACT_MAX, isMemoryId, type MemorySource, type MemoryStore, type Refusal } from "./memory.js";
import { isPendingId, type PendingStore } from "./pending.js";
import { callTool, confirmTool, type ToolHost } from "./tools.js";

type Env = Record<string, string | undefined>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

/** The most a body may be: a memory import of a few hundred facts. */
export const BODY_MAX_BYTES = 64_000;
/** The most facts one import may bring. */
export const IMPORT_MAX = 200;

async function bodyOf(request: Request): Promise<Record<string, unknown> | "bad" | "too-big"> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return "bad";
  const text = await request.text().catch(() => "");
  if (text.length > BODY_MAX_BYTES) return "too-big";
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : "bad";
  } catch {
    return "bad";
  }
}

/* ── POST /api/skippy-act ── */

export interface ActDeps {
  desk: DeskDeps;
  host: () => ToolHost;
  pending: PendingStore | null;
}

export async function act(request: Request, deps: ActDeps): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const send = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (!deps.pending) return send({ error: "not-set-up" }, 503);
  const body = await bodyOf(request);
  if (body === "too-big") return send({ error: "too-big" }, 413);
  if (body === "bad") return send({ error: "bad-request" }, 400);
  if (body.confirm !== undefined) {
    if (!isPendingId(body.confirm) || typeof body.yes !== "boolean") return send({ error: "bad-request" }, 400);
    const got = await confirmTool(body.confirm, body.yes, deps.host(), deps.pending);
    const { tool: _t, ...out } = got;
    return send({ ...out, ...wroteOf(got, body.yes) }, got.ok ? 200 : 409);
  }
  if (typeof body.tool !== "string" || (body.input !== undefined && (typeof body.input !== "object" || body.input === null || Array.isArray(body.input)))) return send({ error: "bad-request" }, 400);
  // A room's voice hook: it can show a Yes button, so confirm-gated tools come back waiting; never Relay's card.
  const got = await callTool(body.tool, body.input ?? {}, deps.host(), { pending: deps.pending, surface: "desk", direct: true });
  const { tool: _t, action: _a, ...out } = got;
  return send({ ...out, ...wroteOf(got, true) }, got.ok ? 200 : 422);
}

/** The tool that changed something (#698), so the page showing it reads itself again. Not for a read, a wait or a No. */
const wroteOf = (got: Awaited<ReturnType<typeof callTool>>, ran: boolean) => (ran && got.ok && !("confirm" in got) && got.tool && got.tool.effect !== "read" ? { wrote: [got.tool.name] } : {});

/* ── /api/skippy-memory ── */

export interface MemoryDeps {
  desk: DeskDeps;
  memory: MemoryStore | null;
  /** For the write key (POST only); without it, the passkey session alone. */
  env?: Env;
}

const SOURCES: readonly MemorySource[] = ["project", "import", "desk"];

export async function memoryGet(request: Request, deps: MemoryDeps): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if (!deps.memory) return withCookie(json({ error: "not-set-up" }, 503), signed);
  const m = await deps.memory.load().catch(() => null);
  if (!m) return withCookie(json({ error: "unreadable" }, 502), signed);
  const journal = (await deps.memory.readJournal(deps.desk.now).catch(() => [])).length;
  return withCookie(
    json({
      core: m.core,
      facts: m.facts.map((f) => ({ id: f.id, text: f.text, topic: f.topic, source: f.source, at: f.at })),
      pages: m.pages.map((p) => ({ id: p.id, title: p.title, topic: p.topic, summary: p.summary, source: p.source, at: p.at })),
      journal,
    }),
    signed,
  );
}

export async function memoryPost(request: Request, deps: MemoryDeps): Promise<Response> {
  // The subminds' write key (#1124) may add to the memory, never read or forget: Skippy, the Magnificent loads the
  // project's knowledge base of Nikita this way, with every line through the same rules.
  const feed = deps.env ? roomKeyOf(request, deps.env) === "feed" : false;
  let send: (body: unknown, status?: number) => Response;
  if (feed) send = (body, status = 200) => json(body, status);
  else {
    const signed = await requireSession(request, deps.desk);
    if (!signed.ok) return signed.response;
    send = (body, status = 200) => withCookie(json(body, status), signed);
  }
  if (!deps.memory) return send({ error: "not-set-up" }, 503);
  const body = await bodyOf(request);
  if (body === "too-big") return send({ error: "too-big" }, 413);
  if (body === "bad") return send({ error: "bad-request" }, 400);
  const now = deps.desk.now;
  const source: MemorySource = SOURCES.includes(body.source as MemorySource) ? (body.source as MemorySource) : "import";
  switch (body.action) {
    case "core": {
      if (typeof body.text !== "string") return send({ error: "bad-request" }, 400);
      const saved = await deps.memory.setCore(body.text);
      return saved.ok ? send({ ok: true }) : send({ error: "refused", why: saved.why }, 422);
    }
    case "facts": {
      if (!Array.isArray(body.facts) || body.facts.length > IMPORT_MAX || body.facts.some((f) => typeof f !== "string")) return send({ error: "bad-request" }, 400);
      const topic = typeof body.topic === "string" ? body.topic : "general";
      let kept = 0;
      const refused: Partial<Record<Refusal | "empty", number>> = {};
      for (const raw of body.facts as string[]) {
        const text = plainLine(raw, FACT_MAX);
        if (!text) continue;
        const saved = await deps.memory.addFact(text, topic, source, now);
        if (saved.ok) kept++;
        else if (saved.why !== "full" && saved.why !== "missing") refused[saved.why] = (refused[saved.why] ?? 0) + 1;
      }
      return send({ ok: true, kept, refused });
    }
    case "page": {
      const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
      if (!s("title") || !s("body")) return send({ error: "bad-request" }, 400);
      const saved = await deps.memory.putPage({ title: s("title"), topic: s("topic"), summary: s("summary"), body: s("body"), source }, now);
      return saved.ok ? send({ ok: true, id: saved.value.id }) : send({ error: "refused", why: saved.why }, 422);
    }
    case "forget": {
      if (feed) return send({ error: "not-allowed" }, 403);
      if (!isMemoryId(body.id)) return send({ error: "bad-request" }, 400);
      return (await deps.memory.forget(body.id)) ? send({ ok: true }) : send({ error: "missing" }, 404);
    }
    default:
      return send({ error: "bad-request" }, 400);
  }
}

/* ── GET /api/skippy-spend ── */

export interface SpendDeps {
  desk: DeskDeps;
  chat: ChatLedger | null;
  kernel: ChatLedger | null;
  env: Env;
}

export async function spend(request: Request, deps: SpendDeps): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if (!deps.chat) return withCookie(json({ error: "not-set-up" }, 503), signed);
  try {
    return withCookie(json(await skippySpend({ chat: deps.chat, kernel: deps.kernel }, skippyBudget(deps.env.SKIPPY_BUDGET_USD), deps.desk.now)), signed);
  } catch {
    return withCookie(json({ error: "unreadable" }, 502), signed);
  }
}

/* ── Live ── */

const deskOf = (env: Env): DeskDeps => ({ deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() });

export const actRoute = {
  POST: (request: Request) => act(request, { desk: deskOf(process.env), host: () => liveHost(process.env), pending: livePending(process.env) }),
};

const memoryOf = (env: Env) => {
  const blob = pickBlob(env);
  return blob ? new BlobMemory(blob, skipTermsFrom(env.EMAIL_SKIP_TERMS)) : null;
};
export const memoryRoute = {
  GET: (request: Request) => memoryGet(request, { desk: deskOf(process.env), memory: memoryOf(process.env) }),
  POST: (request: Request) => memoryPost(request, { desk: deskOf(process.env), memory: memoryOf(process.env), env: process.env }),
};

/** Desk chats kept whole (#1097): the read key or a passkey session (api/_skippy/chatlog.ts). */
export const chatRoute = {
  GET: (request: Request) => {
    const blob = pickBlob(process.env);
    return chatLogGet(request, { desk: deskOf(process.env), log: blob ? new BlobChatLog(blob, skipTermsFrom(process.env.EMAIL_SKIP_TERMS)) : null, env: process.env });
  },
};

export const spendRoute = {
  GET: (request: Request) => {
    const blob = pickBlob(process.env);
    return spend(request, { desk: deskOf(process.env), chat: blob ? new BlobChatLedger(blob) : null, kernel: blob ? new BlobChatLedger(blob, KERNEL_LEDGER_PATH) : null, env: process.env });
  },
};
