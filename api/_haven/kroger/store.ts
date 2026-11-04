/**
 * King Soopers' state in the private store (#664): `haven/kroger.json`, read in full only in a Desk passkey session.
 *
 *   zip      the ZIP the store picker searches near, set on the Desk (empty until then; never in code or logs)
 *   found    the last store search's rows, so picking one needs no second call
 *   store    the home store Nikita picked
 *   picks    by list item (its name's key, api/_haven/list.ts `sameKey`): the product matched at that store, the other
 *            matches to swap to, whether Nikita chose it himself, whether to leave it out of the send
 *   last     the last Kroger call's time and whether it worked (Systems' live or down; never what it was)
 *   sent     the last send's time, item count and whether it worked
 *
 * The cart grant's refresh token is not here: it is sealed with HOME_TOKEN_KEY (api/_haven/devices/vault.ts, `kroger`).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../../_blob.js";
import { readJson, updateJson } from "../json.js";
import { line, readStore, readStoredProduct, type Product, type StoreRow } from "./api.js";

export const KROGER_PATH = "haven/kroger.json";
/** The most picks kept (the Kitchen list keeps 100 items). */
export const PICKS_MAX = 100;
/** The most other matches kept per pick, to swap to without another call. */
export const ALTS_MAX = 8;

export interface ItemPick {
  term: string;
  at: string;
  product: Product | null;
  alts: Product[];
  chosen: boolean;
  skip: boolean;
}

export interface KrogerState {
  zip: string;
  found: StoreRow[];
  store: StoreRow | null;
  picks: Record<string, ItemPick>;
  last: { at: string; ok: boolean } | null;
  sent: { at: string; items: number; ok: boolean } | null;
}

export const EMPTY: KrogerState = { zip: "", found: [], store: null, picks: {}, last: null, sent: null };

export const ZIP = /^\d{5}$/;

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 32 && Number.isFinite(Date.parse(v)) ? v : null);

function readPick(v: unknown): ItemPick | null {
  const p = o(v);
  const at = iso(p.at);
  if (!at) return null;
  return {
    term: line(p.term, 60),
    at,
    product: p.product ? readStoredProduct(p.product) : null,
    alts: (Array.isArray(p.alts) ? p.alts : []).map(readStoredProduct).filter((x): x is Product => x !== null).slice(0, ALTS_MAX),
    chosen: p.chosen === true,
    skip: p.skip === true,
  };
}

/** The state as stored, checked: anything odd is dropped, never trusted. */
export function readState(v: unknown): KrogerState {
  const s = o(v);
  const picks: Record<string, ItemPick> = {};
  for (const [k, raw] of Object.entries(o(s.picks)).slice(0, PICKS_MAX)) {
    const key = line(k, 60);
    const pick = key ? readPick(raw) : null;
    if (pick) picks[key] = pick;
  }
  const last = o(s.last);
  const sent = o(s.sent);
  return {
    zip: typeof s.zip === "string" && ZIP.test(s.zip) ? s.zip : "",
    found: (Array.isArray(s.found) ? s.found : []).map(readStore).filter((x): x is StoreRow => x !== null).slice(0, 10),
    store: s.store ? readStore(s.store) : null,
    picks,
    last: iso(last.at) && typeof last.ok === "boolean" ? { at: last.at as string, ok: last.ok } : null,
    sent: iso(sent.at) && typeof sent.ok === "boolean" && typeof sent.items === "number" && Number.isInteger(sent.items) ? { at: sent.at as string, items: sent.items, ok: sent.ok } : null,
  };
}

export const readKroger = async (blob: BlobBackend): Promise<KrogerState> => readState(await readJson<unknown>(blob, KROGER_PATH, null));

/** Read, change, write (with the store's ETag check). `change` returns the next state, or null to write nothing. */
export const changeKroger = <R>(blob: BlobBackend, change: (cur: KrogerState) => { next: KrogerState | null; result: R }): Promise<R> =>
  updateJson<unknown, R>(blob, KROGER_PATH, null, (raw) => change(readState(raw)));
