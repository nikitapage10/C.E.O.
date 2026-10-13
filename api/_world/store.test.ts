import { describe, expect, it } from "vitest";
import { initialState } from "./step.ts";
import { BlobStore, MemoryStore, pickStore, StaleStateError, SupabaseStore } from "./store.ts";
import type { HistoryEntry } from "./types.ts";

const entry = (step: number, day = "2026-10-13"): HistoryEntry => ({
  step,
  at: `${day}T1${step % 10}:00:00.000Z`,
  day,
  source: "scripted",
  summary: `Hour ${step}`,
  scenes: [],
  changes: [],
  remarks: [],
  events: [],
  cost: null,
});

describe("the world store (in memory, as the Blob and Supabase stores behave)", () => {
  it("starts empty, then saves and loads the state", async () => {
    const store = new MemoryStore();
    expect(await store.loadState()).toBeNull();
    const state = { ...initialState(), step: 3, at: "2026-10-13T10:00:00.000Z" };
    await store.saveState(state);
    expect(await store.loadState()).toEqual(state);
  });

  it("hands out copies, so a caller can't change what is saved", async () => {
    const store = new MemoryStore();
    await store.loadState();
    await store.saveState(initialState());
    const loaded = (await store.loadState())!;
    loaded.step = 99;
    expect((await store.loadState())!.step).toBe(0);
  });

  it("refuses a save from a step that didn't load the latest state", async () => {
    const store = new MemoryStore();
    // Two steps load the same state; the first save lands, the second must not.
    await store.loadState();
    await store.loadState();
    await store.saveState({ ...initialState(), step: 1 });
    await expect(store.saveState({ ...initialState(), step: 2 })).rejects.toBeInstanceOf(StaleStateError);
    expect(store.state!.step).toBe(1);
  });

  it("appends history to its day's page, oldest first, and reads a page back", async () => {
    const store = new MemoryStore();
    await store.appendHistory(entry(1));
    await store.appendHistory(entry(2));
    await store.appendHistory(entry(3, "2026-10-14"));
    expect((await store.readDay("2026-10-13")).entries.map((e) => e.step)).toEqual([1, 2]);
    expect((await store.readDay("2026-10-14")).entries.map((e) => e.step)).toEqual([3]);
    expect(await store.readDay("2026-10-01")).toEqual({ day: "2026-10-01", entries: [], recap: null });
  });

  it("appending the same step again replaces it rather than doubling it", async () => {
    const store = new MemoryStore();
    await store.appendHistory(entry(1));
    await store.appendHistory({ ...entry(1), summary: "Rewritten" });
    const page = await store.readDay("2026-10-13");
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]!.summary).toBe("Rewritten");
  });

  it("files a day's recap on its page without touching its hours", async () => {
    const store = new MemoryStore();
    await store.appendHistory(entry(1));
    await store.putRecap("2026-10-13", "A day in Ilyr.");
    const page = await store.readDay("2026-10-13");
    expect(page.recap).toBe("A day in Ilyr.");
    expect(page.entries).toHaveLength(1);
  });
});

describe("picking the store (one setting)", () => {
  it("uses the private Blob store by default, once one is connected", () => {
    expect(pickStore({ BLOB_STORE_ID: "store_x" })).toBeInstanceOf(BlobStore);
    expect(pickStore({ BLOB_READ_WRITE_TOKEN: "t" })).toBeInstanceOf(BlobStore);
    expect(pickStore({ WORLD_STORE: "blob", BLOB_STORE_ID: "store_x" })).toBeInstanceOf(BlobStore);
  });

  it("is not set up without a store", () => {
    expect(pickStore({})).toBeNull();
    expect(pickStore({ WORLD_STORE: "supabase" })).toBeNull();
  });

  it("switches to Supabase by the setting, whose skeleton refuses to run until it is built", async () => {
    const store = pickStore({ WORLD_STORE: "Supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(store).toBeInstanceOf(SupabaseStore);
    await expect(store!.loadState()).rejects.toThrow(/WORLD_STORE=blob/);
  });

  it("has an in-memory store for local runs", () => {
    expect(pickStore({ WORLD_STORE: "memory" })).toBeInstanceOf(MemoryStore);
  });
});
