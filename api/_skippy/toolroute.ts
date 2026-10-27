/**
 * The call's live lookups (#479): GET /api/skippy-tools?read=<room>, called by ElevenLabs mid-call when Skippy or one
 * of his subminds uses a read tool (api/_skippy/voicecrew.ts). Azure only (azure/src/index.ts).
 *
 * Only a live call's own tool token opens it (`x-ceo-voice-tool`, api/_skippy/voicetoken.ts): signed by this Desk's
 * key, unexpired, kept with its call and not ended. The site gate lets exactly this method and path through on a
 * signed, unexpired token (api/_site/gate.ts); this handler checks it fully again. Anything else is 401, with no
 * hint of which part failed. At most READS_PER_CALL lookups per call.
 *
 * GET → 200 { read, text }: the room as a few short lines (api/_skippy/voicereads.ts). The answer is never cached,
 * and its money (the positions and the bill) leaves only to the call that asked.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../_blob.js";
import { setupList } from "../foundry.js";
import type { SetupStatus } from "../_desk/setup.js";
import { readEmailStatus, type EmailStatus } from "../_email/status.js";
import * as emailRoute from "../_email/route.js";
import * as exchangeRoute from "../_exchange/route.js";
import { keyFrom, readPositions } from "../_exchange/positions.js";
import type { PmBoard, PmPositions } from "../_exchange/types.js";
import * as greenRoute from "../_green/route.js";
import type { GreenBoard } from "../_green/types.js";
import * as foundryFeed from "../foundry-feed.js";
import type { JobRun, OpenPull } from "../foundry-feed.js";
import { elevenFromEnv, pickStoryStore, storyMonth } from "../_world/story.js";
import { pickStore } from "../_world/store.js";
import type { WorldState } from "../_world/types.js";
import { foundryIssues } from "../skippy.js";
import { contextLines, deskContext } from "./context.js";
import { VOICE_SESSION_SECS, VOICE_USD_PER_MIN, voiceBudget } from "./voice.js";
import { billText, boilerText, exchangeText, foundryText, greenText, isRead, positionsText, relayText, type BillInput, type ReadName } from "./voicereads.js";
import { BlobCrewStore, TOOL_HEADER, checkToolToken, tokenHash, type CrewStore } from "./voicetoken.js";

export const PATH = "/api/skippy-tools";
/** How long a lookup may take before the route answers "slow" (ElevenLabs' tool timeout is five seconds). */
export const READ_BUDGET_MS = 4_300;
/** What the call hears when a room is too slow: the agent then answers from what it already knows. */
export const SLOW_TEXT = "That room's data is slow right now; answer from what you already know and say it's dragging.";
/** The most lookups one call may make. */
export const READS_PER_CALL = 60;

/** Each room's read, as plain data (the same reads the Desk's room pages use). Null when it didn't answer. */
export interface RoomSources {
  green(): Promise<GreenBoard | null>;
  exchange(): Promise<PmBoard | null>;
  positions(): Promise<PmPositions | null>;
  email(): Promise<EmailStatus | null>;
  /** The typed chat's Foundry lines (api/_skippy/context.ts). */
  foundryBoard(): Promise<string>;
  jobs(): Promise<{ jobs: JobRun[] | null; open: OpenPull[] | null }>;
  world(): Promise<WorldState | null>;
  bill(): Promise<BillInput | null>;
}

export interface ToolDeps {
  deskKey: string;
  crew: CrewStore | null;
  sources: RoomSources;
  now: number;
  /** For tests: the read budget (ms). */
  budgetMs?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

/** One room's text from its sources. */
export async function readText(read: ReadName, s: RoomSources, now: number): Promise<string> {
  const q = <T>(p: Promise<T>, empty: T) => p.catch(() => empty);
  switch (read) {
    case "green":
      return greenText(await q(s.green(), null));
    case "exchange":
      return exchangeText(await q(s.exchange(), null));
    case "exchange_positions":
      return positionsText(await q(s.positions(), null));
    case "relay":
      return relayText(await q(s.email(), null));
    case "foundry": {
      const [board, { open }] = await Promise.all([q(s.foundryBoard(), ""), q(s.jobs(), { jobs: null, open: null })]);
      return foundryText(board, open);
    }
    case "boiler": {
      const [{ jobs, open }, world, email, green, exchange] = await Promise.all([q(s.jobs(), { jobs: null, open: null }), q(s.world(), null), q(s.email(), null), q(s.green(), null), q(s.exchange(), null)]);
      return boilerText({ jobs, open, world: world ? { step: world.step, at: world.at } : null, email, green, exchange, now });
    }
    case "voice_bill": {
      const b = await q(s.bill(), null);
      return b ? billText(b) : "The ElevenLabs ledger isn't answering right now.";
    }
  }
}

/** Lookups counted per call, in this instance (a call stays on one instance or two; the cap is a seatbelt). */
const counted = new Map<string, number>();

export async function handle(request: Request, deps: ToolDeps): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method" }, 405);
  const token = request.headers.get(TOOL_HEADER);
  const check = await checkToolToken(token, deps.deskKey, deps.crew, deps.now);
  if (!check.ok) return json({ error: "not-allowed" }, check.why === "store" ? 503 : 401);
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const read = url.searchParams.get("read");
  if (keys.length !== 1 || url.searchParams.getAll("read").length !== 1 || !isRead(read)) return json({ error: "bad-request" }, 400);
  const tag = tokenHash(token!);
  const n = (counted.get(tag) ?? 0) + 1;
  if (counted.size > 50) counted.clear();
  counted.set(tag, n);
  if (n > READS_PER_CALL) return json({ error: "slow-down" }, 429);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(SLOW_TEXT), deps.budgetMs ?? READ_BUDGET_MS);
  });
  const text = await Promise.race([readText(read, deps.sources, deps.now), slow]).finally(() => clearTimeout(timer));
  return json({ read, text, ...(text === SLOW_TEXT && { slow: true }) });
}

/* ── The live sources ── */

const bodyOf = async <T>(res: Response | Promise<Response>): Promise<T | null> => {
  const r = await res;
  return r.ok ? ((await r.json().catch(() => null)) as T | null) : null;
};
const local = (path: string) => new Request(`https://localhost${path}`);

let posKept: { at: number; value: PmPositions } | null = null;

export function liveSources(env: Record<string, string | undefined> = process.env): RoomSources {
  const feed = () => bodyOf<{ jobs?: unknown; open?: unknown }>(foundryFeed.GET(local("/api/foundry-feed")));
  return {
    green: () => bodyOf<GreenBoard>(greenRoute.GET(local(greenRoute.PATH))),
    exchange: () => bodyOf<PmBoard>(exchangeRoute.GET(local(exchangeRoute.PATH))),
    positions: async () => {
      const key = keyFrom(env);
      if ("error" in key) return { ok: true, state: "waiting", reason: key.error };
      const now = Date.now();
      if (posKept && now - posKept.at < 60_000) return posKept.value;
      const value = await readPositions((u, i) => fetch(u, i), key, now);
      posKept = { at: now, value };
      return value;
    },
    email: async () => readEmailStatus((await bodyOf<{ status?: unknown }>(emailRoute.GET(local("/api/email?view=status"))))?.status),
    foundryBoard: async () => {
      const [{ open, shipped }, setup, world] = await Promise.all([
        foundryIssues().catch(() => ({ open: [], shipped: [] })),
        setupList().catch((): SetupStatus | null => null),
        pickStore(env)
          ?.loadState()
          .catch(() => null) ?? Promise.resolve(null),
      ]);
      return contextLines(deskContext(open, shipped, setup, world ?? null), Date.now());
    },
    jobs: async () => {
      const f = await feed().catch(() => null);
      // The job board is [{ file, run }], run trimmed to JobRun (or null when the workflow has none).
      const jobs = Array.isArray(f?.jobs) ? (f.jobs as { run?: JobRun | null }[]).map((j) => j?.run).filter((r): r is JobRun => !!r && typeof r.name === "string") : null;
      return { jobs, open: Array.isArray(f?.open) ? (f.open as OpenPull[]) : null };
    },
    world: async () => (await pickStore(env)?.loadState()) ?? null,
    bill: async () => {
      const stories = pickStoryStore(env);
      const eleven = elevenFromEnv(env);
      if (!stories) return null;
      const cap = eleven?.budget ?? 10;
      return { month: storyMonth(await stories.loadSpend(), Date.now()), share: voiceBudget(env.ELEVENLABS_VOICE_BUDGET_USD, cap), cap, usdPerMin: VOICE_USD_PER_MIN, sessionSecs: VOICE_SESSION_SECS };
    },
  };
}

export function GET(request: Request): Promise<Response> {
  const env = process.env;
  const blob = pickBlob(env);
  return handle(request, { deskKey: env.FOUNDRY_DESK_KEY ?? "", crew: blob ? new BlobCrewStore(blob) : null, sources: liveSources(env), now: Date.now() });
}
