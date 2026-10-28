/**
 * What the site keeps about Relay's texts line (#535, docs/RELAY-PRIVACY.md, "What the site keeps"): four blobs in
 * the private store (api/_blob.ts; on Azure the `ceo-state` container, no public access).
 *
 *   relay/status.json    the latest RelayStatus: counts, enum states, timestamps. Public by design. Plain.
 *   relay/hub.json       the pairing: its id, the SHA-256 of the hub's token, when paired and last heard from. Plain.
 *   relay/pair.json      an open pair code: its SHA-256, when it ends, the wrong tries so far. Plain.
 *   relay/private.json   SEALED (AES-256-GCM, a key derived from GMAIL_TOKEN_KEY with its own label, as the email
 *                        agent seals its mail list, api/_email/seal.ts): the hub's who's-waiting list (names,
 *                        Dialtone's gist, Blasto's drafts, 7 days at most) and the Desk's requests to the hub.
 *
 * Underscore folder: never served as a function.
 */

import { hkdfSync } from "node:crypto";
import { readRelayStatus, type RelayStatus } from "../../packages/core/src/relay.ts";
import { BlobPreconditionError, pickBlob, type BlobBackend } from "../_blob.js";
import { MIN_TOKEN_KEY, seal, unseal } from "../_email/seal.js";
import { readTextRequest, readTextsView, REQUEST_STATES, type RequestState, type TextRequest, type TextsView } from "./texts.js";

export const STATUS_PATH = "relay/status.json";
export const HUB_PATH = "relay/hub.json";
export const PAIR_PATH = "relay/pair.json";
export const PRIVATE_PATH = "relay/private.json";

export interface HubRecord {
  pairId: string;
  tokenHash: string;
  pairedAt: number;
  lastSeen: number | null;
}

export interface PairRecord {
  codeHash: string;
  until: number;
  tries: number;
}

/** A request and what became of it. */
export interface RequestEntry {
  req: TextRequest;
  state: RequestState;
  /** When the hub took it (once: a taken request is never handed out again). */
  takenAt: number | null;
  /** When the hub reported back. */
  doneAt: number | null;
}

export interface PrivateState {
  texts: TextsView | null;
  requests: RequestEntry[];
}

export const emptyPrivate = (): PrivateState => ({ texts: null, requests: [] });

/** Requests are kept a day after they end, so the Desk can show what became of them; then they go. */
export const REQUEST_KEEP_MS = 24 * 60 * 60_000;

export interface RelayStore {
  status(): Promise<RelayStatus | null>;
  saveStatus(status: RelayStatus): Promise<void>;
  hub(): Promise<HubRecord | null>;
  saveHub(hub: HubRecord | null): Promise<void>;
  pair(): Promise<PairRecord | null>;
  savePair(pair: PairRecord | null): Promise<void>;
  /** The sealed half and a version to save against. */
  load(): Promise<{ state: PrivateState; version: string | null }>;
  /** Saves only over `version` (or only when there was none); false when someone else wrote first. */
  save(state: PrivateState, version: string | null): Promise<boolean>;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : null);

export function readHub(v: unknown): HubRecord | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const pairId = str(o.pairId, /^[A-Za-z0-9_-]{8,40}$/);
  const tokenHash = str(o.tokenHash, /^[0-9a-f]{64}$/);
  const pairedAt = num(o.pairedAt);
  if (!pairId || !tokenHash || pairedAt === null) return null;
  return { pairId, tokenHash, pairedAt, lastSeen: num(o.lastSeen) };
}

export function readPair(v: unknown): PairRecord | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const codeHash = str(o.codeHash, /^[0-9a-f]{64}$/);
  const until = num(o.until);
  const tries = num(o.tries);
  return codeHash && until !== null && tries !== null ? { codeHash, until, tries } : null;
}

/** The sealed half as it was stored, each part checked again; anything odd is dropped, never repaired. */
export function readPrivate(v: unknown, now: number): PrivateState {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return emptyPrivate();
  const requests: RequestEntry[] = [];
  for (const e of Array.isArray(o.requests) ? (o.requests as Record<string, unknown>[]) : []) {
    const req = readTextRequest(e?.req);
    if (!req || !(REQUEST_STATES as readonly string[]).includes(e.state as string)) continue;
    if (now - req.until > REQUEST_KEEP_MS) continue;
    requests.push({ req, state: e.state as RequestState, takenAt: num(e.takenAt), doneAt: num(e.doneAt) });
  }
  return { texts: o.texts ? readTextsView(o.texts, now) : null, requests: requests.slice(-200) };
}

/** The sealing key: GMAIL_TOKEN_KEY through HKDF with Relay's own label, so it never equals the email agent's keys. */
export function relaySealKey(secret: string | undefined): Buffer | null {
  const s = (secret ?? "").trim();
  if (s.length < MIN_TOKEN_KEY) return null;
  return Buffer.from(hkdfSync("sha256", s, "ceo.relay.v1", "ceo.relay.private", 32));
}

async function readJson(blob: BlobBackend, path: string): Promise<unknown> {
  const found = await blob.get(path);
  if (!found) return null;
  try {
    return (await new Response(found.stream).json()) as unknown;
  } catch {
    return null;
  }
}

export class BlobRelayStore implements RelayStore {
  constructor(
    private readonly blob: BlobBackend,
    private readonly key: Buffer,
    private readonly now: () => number = Date.now,
  ) {}
  async status() {
    const got = readRelayStatus(await readJson(this.blob, STATUS_PATH));
    return got.ok ? got.status : null;
  }
  async saveStatus(status: RelayStatus) {
    const got = readRelayStatus(status);
    if (!got.ok) throw new Error("relay status refused");
    await this.blob.put(STATUS_PATH, JSON.stringify(got.status), { contentType: "application/json", allowOverwrite: true, cacheControlMaxAge: 60 });
  }
  async hub() {
    return readHub(await readJson(this.blob, HUB_PATH));
  }
  async saveHub(hub: HubRecord | null) {
    if (!hub) await this.blob.del(HUB_PATH);
    else await this.blob.put(HUB_PATH, JSON.stringify(hub), { contentType: "application/json", allowOverwrite: true });
  }
  async pair() {
    return readPair(await readJson(this.blob, PAIR_PATH));
  }
  async savePair(pair: PairRecord | null) {
    if (!pair) await this.blob.del(PAIR_PATH);
    else await this.blob.put(PAIR_PATH, JSON.stringify(pair), { contentType: "application/json", allowOverwrite: true });
  }
  async load() {
    const version = await this.blob.etag(PRIVATE_PATH);
    if (!version) return { state: emptyPrivate(), version: null };
    return { state: readPrivate(unseal(this.key, await readJson(this.blob, PRIVATE_PATH)), this.now()), version };
  }
  async save(state: PrivateState, version: string | null) {
    try {
      await this.blob.put(PRIVATE_PATH, JSON.stringify(seal(this.key, state)), { contentType: "application/json", ...(version ? { ifMatch: version, allowOverwrite: true } : { allowOverwrite: false }) });
      return true;
    } catch (e) {
      if (e instanceof BlobPreconditionError) return false;
      throw e;
    }
  }
}

/** For tests: the same contract, in memory, with versions, and the sealed half kept as JSON as the blob would be. */
export class MemoryRelayStore implements RelayStore {
  statusRec: RelayStatus | null = null;
  hubRec: HubRecord | null = null;
  pairRec: PairRecord | null = null;
  privateJson: string | null = null;
  ver = 0;
  constructor(private readonly now: () => number = Date.now) {}
  async status() {
    return this.statusRec;
  }
  async saveStatus(status: RelayStatus) {
    const got = readRelayStatus(status);
    if (!got.ok) throw new Error("relay status refused");
    this.statusRec = got.status;
  }
  async hub() {
    return this.hubRec ? { ...this.hubRec } : null;
  }
  async saveHub(hub: HubRecord | null) {
    this.hubRec = hub ? { ...hub } : null;
  }
  async pair() {
    return this.pairRec ? { ...this.pairRec } : null;
  }
  async savePair(pair: PairRecord | null) {
    this.pairRec = pair ? { ...pair } : null;
  }
  async load() {
    return this.privateJson ? { state: readPrivate(JSON.parse(this.privateJson), this.now()), version: String(this.ver) } : { state: emptyPrivate(), version: null };
  }
  async save(state: PrivateState, version: string | null) {
    if ((this.privateJson ? String(this.ver) : null) !== version) return false;
    this.privateJson = JSON.stringify(state);
    this.ver += 1;
    return true;
  }
}

/** Load, change, save over the version read; again on a lost race (a few times). The change's result, or null. */
export async function update<T>(store: RelayStore, change: (s: PrivateState) => { next: PrivateState; result: T } | null): Promise<T | null> {
  for (let i = 0; i < 4; i++) {
    const { state, version } = await store.load();
    const got = change(state);
    if (!got) return null;
    if (await store.save(got.next, version)) return got.result;
  }
  throw new Error("relay store busy");
}

/** The private store with its sealing key, or null where either is missing. Azure only. */
export function pickRelayStore(env: Record<string, string | undefined> = process.env): RelayStore | null {
  const blob = pickBlob(env);
  const key = relaySealKey(env.GMAIL_TOKEN_KEY);
  return blob && blob.kind === "azureblob" && key ? new BlobRelayStore(blob, key) : null;
}
