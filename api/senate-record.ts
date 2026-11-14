/**
 * The Senate Record (#1181): every motion the Senate has argued, with the chair's ruling, newest first, for the Archive's
 * Senate Record place. Read-only and public like the chamber itself (behind the site lock on Azure like every function,
 * azure/src/index.ts). No model call, no key: it only reads the two small lists the chamber keeps
 * (api/_skippy/senaterecord.ts and the motions in api/_skippy/senatetalk.ts).
 *
 * GET → 200 { entries: [{ motion, close?, at? }] }: the kept rulings first, then motions argued before #1181 (the
 *       motion alone). 200 { entries: [] } when there is no store here. A store that doesn't answer → 503.
 */

import { pickBlob, type BlobBackend } from "./_blob.js";
import { BlobRecordStore, senateRecord, type RecordStore } from "./_skippy/senaterecord.js";
import { BlobTopicStore, type TopicStore } from "./_skippy/senatetalk.js";

export interface SenateRecordDeps {
  record: RecordStore | null;
  topics: TopicStore | null;
}

export function liveDeps(blob: BlobBackend | null = pickBlob(process.env)): SenateRecordDeps {
  return { record: blob ? new BlobRecordStore(blob) : null, topics: blob ? new BlobTopicStore(blob) : null };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? "private, max-age=30" : "no-store" },
  });
}

export async function recordGet(deps: SenateRecordDeps): Promise<Response> {
  if (!deps.record && !deps.topics) return json({ entries: [] });
  try {
    const [rulings, motions] = await Promise.all([deps.record?.load() ?? [], deps.topics?.load() ?? []]);
    return json(senateRecord(rulings, motions));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

export function GET(): Promise<Response> {
  return recordGet(liveDeps());
}
