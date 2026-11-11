import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { fakeMeals } from "./meals.fixture.ts";
import { backfillStepPhotos, mealsPost, MEALS_PATH, readMeals, type MealsDeps } from "./meals.ts";
import { ImageLedger } from "./photoGen.ts";
import { PhotoLibrary, queueStepPhotos, type PhotoDeps } from "./photos.ts";
import { weekStepShots } from "./stepShots.ts";

/** Cook steps' pictures at plan time (#1016): finalizing the week queues them; nothing is made in the answer. Made-up meals. */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-11-04T18:00:00Z");

function memoryBlob(): BlobBackend {
  const files = new Map<string, { bytes: Uint8Array; etag: string }>();
  let n = 0;
  return {
    kind: "azureblob",
    get: async (path) => {
      const f = files.get(path);
      return f ? { stream: new Response(f.bytes.slice()).body!, etag: f.etag, contentType: "application/json" } : null;
    },
    etag: async (path) => files.get(path)?.etag ?? null,
    put: async (path, body, opts) => {
      const cur = files.get(path);
      if (opts.ifMatch && cur?.etag !== opts.ifMatch) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && !opts.allowOverwrite && cur) throw new BlobPreconditionError("exists");
      files.set(path, { bytes: typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body), etag: `e${++n}` });
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

function setup() {
  const store = new MemoryAuthStore();
  const calls: unknown[] = [];
  const runs: Array<() => Promise<unknown>> = [];
  const library = new PhotoLibrary(memoryBlob());
  const photos: PhotoDeps = {
    desk: { deskKey: DESK, store, now: NOW },
    library,
    ledger: new ImageLedger(memoryBlob()),
    openaiKey: "sk-test-not-a-real-key",
    fetch: async (_url, init) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response("nope", { status: 500 });
    },
    env: {},
    log: () => undefined,
    kick: (run) => void runs.push(run),
  };
  const meals: MealsDeps = {
    desk: { deskKey: DESK, store, now: NOW },
    blob: memoryBlob(),
    env: {},
    log: () => undefined,
    stepPhotos: (file, week) => queueStepPhotos(weekStepShots(file, week), photos),
  };
  return { meals, photos, library, calls, runs, cookie: () => signedInCookie(DESK, NOW, store) };
}

const post = (body: unknown, cookie: string) => new Request(`${ORIGIN}/api/haven-meals`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });

describe("cook steps' pictures at plan time (#1016)", () => {
  it("wants one picture per step of every recipe cooked that week, each once", () => {
    const f = readMeals(fakeMeals())!;
    const shots = weekStepShots(f);
    expect(shots.length).toBeGreaterThan(7);
    expect(shots.every((s) => s.style === "step" && s.description.length > 0)).toBe(true);
    expect(new Set(shots.map((s) => JSON.stringify([s.meal, s.description, s.components]))).size).toBe(shots.length);
    // Every cooked night's meal is in it.
    const cooked = new Set(f.week!.slots.map((s) => s.meal).filter(Boolean));
    for (const m of cooked) expect(shots.some((s) => s.meal === m)).toBe(true);
  });

  it("finalizing queues every step and kicks the run off after the answer, never inside it; again queues nothing new", async () => {
    const s = setup();
    const cookie = await s.cookie();
    expect((await mealsPost(post({ action: "seed", meals: fakeMeals() }, cookie), s.meals)).status).toBe(200);
    expect((await s.library.catalog()).photos).toHaveLength(0);
    const res = await mealsPost(post({ action: "confirm" }, cookie), s.meals);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stepPhotos: number; meals: unknown };
    const want = weekStepShots(readMeals(body.meals)!);
    expect(body.stepPhotos).toBe(want.length);
    const cat = await s.library.catalog();
    expect(cat.photos.filter((p) => p.style === "step" && p.status === "queued")).toHaveLength(want.length);
    // Nothing was drawn in the answer: the run is handed off, once.
    expect(s.calls).toHaveLength(0);
    expect(s.runs).toHaveLength(1);
    const again = (await (await mealsPost(post({ action: "confirm" }, cookie), s.meals)).json()) as { stepPhotos: number };
    expect(again.stepPhotos).toBe(0);
    expect((await s.library.catalog()).photos).toHaveLength(want.length);
  });

  it("a run that stops partway leaves the rest queued for the timer, and the made ones are never made again", async () => {
    const s = setup();
    const shots = weekStepShots(readMeals(fakeMeals())!).slice(0, 3);
    expect(await queueStepPhotos(shots, s.photos)).toBe(3);
    // The first one is taken and the run dies: it goes stale and is claimed again later; the others wait as queued.
    const taken = await s.library.claim("dead-run", NOW);
    expect(taken?.style).toBe("step");
    expect((await s.library.catalog()).photos.filter((p) => p.status === "queued")).toHaveLength(2);
    expect(await queueStepPhotos(shots, s.photos)).toBe(0);
    expect((await s.library.catalog()).photos.filter((p) => p.status === "queued")).toHaveLength(2);
    expect(s.runs.length).toBeGreaterThan(0);
  });

  it("finalizing never fails when the photo library is missing", async () => {
    const s = setup();
    s.meals.stepPhotos = (file, week) => queueStepPhotos(weekStepShots(file, week), { ...s.photos, library: null });
    const cookie = await s.cookie();
    await mealsPost(post({ action: "seed", meals: fakeMeals() }, cookie), s.meals);
    const res = await mealsPost(post({ action: "confirm" }, cookie), s.meals);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { stepPhotos: number }).stepPhotos).toBe(0);
  });

  describe("the backfill for a week finalized before #1016 (#1026)", () => {
    /** A finalized week whose step pictures were never queued, as finalize did before #1016. */
    async function finalizedWithout(s: ReturnType<typeof setup>) {
      s.meals.stepPhotos = undefined;
      const cookie = await s.cookie();
      await mealsPost(post({ action: "seed", meals: fakeMeals() }, cookie), s.meals);
      const res = await mealsPost(post({ action: "confirm" }, cookie), s.meals);
      expect(res.status).toBe(200);
      expect((await s.library.catalog()).photos).toHaveLength(0);
      return readMeals(((await res.json()) as { meals: unknown }).meals)!;
    }

    it("queues the finalized week's missing step pictures without touching the plan; again queues nothing", async () => {
      const s = setup();
      const file = await finalizedWithout(s);
      const before = await s.meals.blob!.get(MEALS_PATH);
      const want = weekStepShots(file);
      expect(await backfillStepPhotos(s.meals.blob, s.photos)).toBe(want.length);
      const cat = await s.library.catalog();
      expect(cat.photos.filter((p) => p.style === "step" && p.status === "queued")).toHaveLength(want.length);
      // The planner file (and so the Kitchen list and the cart) was never written.
      expect((await s.meals.blob!.get(MEALS_PATH))?.etag).toBe(before?.etag);
      expect(s.calls).toHaveLength(0);
      expect(await backfillStepPhotos(s.meals.blob, s.photos)).toBe(0);
      expect((await s.library.catalog()).photos).toHaveLength(want.length);
    });

    it("never re-queues a step that failed or hit the cap (the next finalize does)", async () => {
      const s = setup();
      await finalizedWithout(s);
      await backfillStepPhotos(s.meals.blob, s.photos);
      const [first, second] = (await s.library.catalog()).photos;
      await s.library.settle(first!.id, { status: "failed" }, NOW);
      await s.library.settle(second!.id, { status: "budget" }, NOW);
      expect(await backfillStepPhotos(s.meals.blob, s.photos)).toBe(0);
      const after = await s.library.catalog();
      expect(after.photos.find((p) => p.id === first!.id)?.status).toBe("failed");
      expect(after.photos.find((p) => p.id === second!.id)?.status).toBe("budget");
    });

    it("does nothing for a draft week, an empty planner or a missing library", async () => {
      const s = setup();
      expect(await backfillStepPhotos(s.meals.blob, s.photos)).toBe("no-week");
      await mealsPost(post({ action: "seed", meals: fakeMeals() }, await s.cookie()), s.meals);
      const draft = readMeals(fakeMeals())!;
      expect(draft.week?.confirmedAt).toBeNull();
      expect(await backfillStepPhotos(s.meals.blob, s.photos)).toBe("no-week");
      expect(await backfillStepPhotos(null, s.photos)).toBe("not-set-up");
      expect(await backfillStepPhotos(s.meals.blob, { ...s.photos, library: null })).toBe("not-set-up");
      expect((await s.library.catalog()).photos).toHaveLength(0);
    });
  });
});
