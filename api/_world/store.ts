/**
 * Where the living Lattice keeps its world (docs/WORLD.md): one small interface, so the store can change without the
 * step changing. Picked by one setting, WORLD_STORE:
 *   blob      (default) the project's private Vercel Blob store, signed in the same way as the idea pictures
 *             (api/foundry-image.ts): Vercel's OIDC token, no key in the code.
 *   supabase  C.E.O.'s own Supabase project, once it is connected (a skeleton for now: see SupabaseStore).
 * Moving from Blob to Supabase is that setting plus a copy of the history (the days listed in the state).
 */

import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import type { DayPage, HistoryEntry, WorldState } from "./types.js";

export interface WorldStore {
  readonly kind: "blob" | "supabase" | "memory";
  /** The saved state, or null before the first step. */
  loadState(): Promise<WorldState | null>;
  /**
   * Save the state. Throws StaleStateError when someone else saved since this store last loaded it, so two steps
   * racing for the same hour can't both land.
   */
  saveState(state: WorldState): Promise<void>;
  /** Add an hour to its day's page of history. */
  appendHistory(entry: HistoryEntry): Promise<void>;
  /** File the day in Ilyr: a day's recap, on that day's page. */
  putRecap(day: string, text: string): Promise<void>;
  /** One page of history: a day, oldest hour first. */
  readDay(day: string): Promise<DayPage>;
}

/** Another step saved the state first; this one must not land. */
export class StaleStateError extends Error {
  constructor() {
    super("world state changed under this step");
  }
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ── Vercel Blob ── */

const STATE_PATH = "world/state.json";
const dayPath = (day: string) => `world/days/${day}.json`;

async function readJson<T>(path: string): Promise<{ value: T; etag: string } | null> {
  // Straight from storage, never a cached copy: the step's idempotency depends on reading its own last write.
  const found = await get(path, { access: "private", useCache: false });
  if (!found || !found.stream) return null;
  return { value: (await new Response(found.stream).json()) as T, etag: found.blob.etag };
}

async function writeJson(path: string, value: unknown, ifMatch?: string): Promise<void> {
  await put(path, JSON.stringify(value), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...(ifMatch ? { ifMatch } : {}),
  });
}

/**
 * The private Blob store: the state in `world/state.json`, and each day's history in `world/days/<day>.json`. Each
 * step costs two writes (the state and its day), and a day's recap one more, about 1,500 writes a month.
 */
export class BlobStore implements WorldStore {
  readonly kind = "blob" as const;
  private etag: string | null = null;

  async loadState(): Promise<WorldState | null> {
    const found = await readJson<WorldState>(STATE_PATH);
    this.etag = found?.etag ?? null;
    return found?.value ?? null;
  }

  async saveState(state: WorldState): Promise<void> {
    try {
      await writeJson(STATE_PATH, state, this.etag ?? undefined);
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) throw new StaleStateError();
      throw e;
    }
    this.etag = null;
  }

  async appendHistory(entry: HistoryEntry): Promise<void> {
    const page = await this.readDay(entry.day);
    await writeJson(dayPath(entry.day), { ...page, entries: [...page.entries.filter((e) => e.step !== entry.step), entry] });
  }

  async putRecap(day: string, text: string): Promise<void> {
    const page = await this.readDay(day);
    await writeJson(dayPath(day), { ...page, recap: text });
  }

  async readDay(day: string): Promise<DayPage> {
    if (!DAY.test(day)) return { day, entries: [], recap: null };
    const found = await readJson<DayPage>(dayPath(day));
    return found?.value ?? { day, entries: [], recap: null };
  }
}

/* ── Supabase (Postgres), once it is connected ── */

/**
 * C.E.O.'s own Supabase project (Nikita, 2026-10-13), not connected yet. When it is, set SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in Vercel, create these tables, fill in the methods below through Supabase's REST API
 * (PostgREST, plain fetch, no new dependency), copy the history across, and set WORLD_STORE=supabase:
 *
 *   create table world_state  (id int primary key default 1 check (id = 1), state jsonb not null, version int not null);
 *   create table world_history(step int primary key, day date not null, at timestamptz not null, entry jsonb not null);
 *   create index on world_history (day);
 *   create table world_days   (day date primary key, recap text);
 *
 * loadState: select state, version (remember the version). saveState: update … where version = <remembered>, and
 * throw StaleStateError when no row changed. appendHistory: upsert into world_history. putRecap: upsert into
 * world_days. readDay: world_history where day = …, order by step, plus that day's recap. Keep RLS on with no public
 * policies: only the service key (server side) reads or writes.
 */
export class SupabaseStore implements WorldStore {
  readonly kind = "supabase" as const;
  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  private notYet(): never {
    throw new Error(`The Supabase world store isn't built yet (${this.url ? "URL set" : "no URL"}, ${this.key ? "key set" : "no key"}). Set WORLD_STORE=blob until it is.`);
  }
  async loadState(): Promise<WorldState | null> {
    return this.notYet();
  }
  async saveState(): Promise<void> {
    return this.notYet();
  }
  async appendHistory(): Promise<void> {
    return this.notYet();
  }
  async putRecap(): Promise<void> {
    return this.notYet();
  }
  async readDay(): Promise<DayPage> {
    return this.notYet();
  }
}

/* ── In memory, for tests and local runs ── */

export class MemoryStore implements WorldStore {
  readonly kind = "memory" as const;
  state: WorldState | null = null;
  days = new Map<string, DayPage>();
  /** Bumped on every save; a save that didn't load the latest throws, like the real stores. */
  private version = 0;
  private loaded = -1;

  async loadState(): Promise<WorldState | null> {
    this.loaded = this.version;
    return this.state ? structuredClone(this.state) : null;
  }
  async saveState(state: WorldState): Promise<void> {
    if (this.loaded !== this.version) throw new StaleStateError();
    this.state = structuredClone(state);
    this.version += 1;
    this.loaded = -1;
  }
  async appendHistory(entry: HistoryEntry): Promise<void> {
    const page = await this.readDay(entry.day);
    this.days.set(entry.day, { ...page, entries: [...page.entries.filter((e) => e.step !== entry.step), structuredClone(entry)] });
  }
  async putRecap(day: string, text: string): Promise<void> {
    const page = await this.readDay(day);
    this.days.set(day, { ...page, recap: text });
  }
  async readDay(day: string): Promise<DayPage> {
    return structuredClone(this.days.get(day) ?? { day, entries: [], recap: null });
  }
}

/* ── Picking one ── */

/** Whether a Blob store is connected to the project (Vercel sets BLOB_STORE_ID; a read-write token also works). */
export const blobReady = (env: Record<string, string | undefined>) => Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN);

/** The store the WORLD_STORE setting names, or null when it isn't set up (no Blob store, no Supabase keys). */
export function pickStore(env: Record<string, string | undefined> = process.env): WorldStore | null {
  const kind = (env.WORLD_STORE ?? "blob").trim().toLowerCase();
  if (kind === "supabase") return env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null;
  if (kind === "memory") return new MemoryStore();
  return blobReady(env) ? new BlobStore() : null;
}
