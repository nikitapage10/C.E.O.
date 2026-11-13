/**
 * GET /api/boiler-usage?days=30 (#1142): the Boiler Room's Tokenomics tab. The Desk's passkey session only
 * (requireSession, before anything is read: 401 signed out, 403 cross-site, 503 not set up), like the room's other
 * private reads. It reads the usage ledger's day files (./meter.ts) for the window and this month, and the providers'
 * own totals (./admin.ts), and answers with the report (./aggregate.ts): dollars, tokens, models, feature ids and
 * plain-language flags. Never a prompt, an answer or a key; the ledger holds none.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { readTruth, type Truth } from "./admin.js";
import { buildReport, monthDays, readLine, windowDays } from "./aggregate.js";
import { usagePath, type UsageLine } from "./meter.js";

type Env = Record<string, string | undefined>;

export const DAYS_DEFAULT = 30;
export const DAYS_MAX = 90;

/** The window asked for: 1 to 90 days, 30 when unsaid or unreadable. */
export function daysOf(raw: string | null): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 ? Math.min(n, DAYS_MAX) : DAYS_DEFAULT;
}

/** Where the route reads from: the private store, or fakes in tests. */
export interface UsageReader {
  day(day: string): Promise<UsageLine[]>;
  truth(): Promise<Truth>;
}

export class BlobUsageReader implements UsageReader {
  constructor(private readonly blob: BlobBackend) {}
  async day(day: string): Promise<UsageLine[]> {
    const found = await this.blob.get(usagePath(day));
    if (!found) return [];
    const text = await new Response(found.stream).text();
    return text.split("\n").flatMap((raw) => {
      const l = raw.trim() ? readLine(raw) : null;
      return l ? [l] : [];
    });
  }
  truth(): Promise<Truth> {
    return readTruth(this.blob);
  }
}

export interface UsageDeps {
  desk: DeskDeps;
  reader: UsageReader | null;
  env: Env;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

export async function usageGet(request: Request, deps: UsageDeps): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const send = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (!deps.reader) return send({ error: "not-set-up" }, 503);
  const now = deps.desk.now;
  const days = daysOf(new URL(request.url).searchParams.get("days"));
  const want = [...new Set([...windowDays(now, days), ...monthDays(now)])];
  try {
    const reader = deps.reader;
    const [lines, truth] = await Promise.all([Promise.all(want.map((d) => reader.day(d).catch(() => [] as UsageLine[]))).then((all) => all.flat()), reader.truth().catch(() => ({}) as Truth)]);
    return send(buildReport(lines, truth, { now, days, env: deps.env }));
  } catch {
    return send({ error: "unreadable" }, 502);
  }
}

export const usageRoute = {
  GET: (request: Request) => {
    const env = process.env;
    const blob = pickBlob(env);
    return usageGet(request, { desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() }, reader: blob ? new BlobUsageReader(blob) : null, env });
  },
};
