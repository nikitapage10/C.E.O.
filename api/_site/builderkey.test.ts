import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { FAKE_PLAN } from "../_haven/plan.fixture.ts";
import { PLAN_PATH, planGet, planPost, planPut, type PlanDeps } from "../_haven/plan.ts";
import { mealsGet, mealsPost, type MealsDeps } from "../_haven/meals.ts";
import { BUILDER_HEADER, BUILDER_KEY, MIN_BUILDER_KEY, builderKeyValue, builderReads, isBuilderRead } from "./builderkey.ts";
import { decide, type GateContext } from "./gate.ts";
import { FEED_TOKEN, LOG_TOKEN } from "./roomkeys.ts";
import { siteKeys, stateOf } from "./state.ts";

/** The Builder's read key (#800): GET or HEAD on three private Haven reads, nothing else. Synthetic keys and data only. */

const NOW = Date.parse("2026-11-05T12:00:00Z");
const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";
const KEY = "test-builder-key-not-a-real-one-0123456789abcdef";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const ENV = { FOUNDRY_DESK_KEY: DESK, [LOG_TOKEN]: LOG, [FEED_TOKEN]: FEED, [BUILDER_KEY]: KEY };

const req = (path: string, method = "GET", key?: string) =>
  new Request(`${ORIGIN}${path}`, { method, headers: { ...(key && { [BUILDER_HEADER]: key }) }, ...(method === "POST" || method === "PUT" ? { body: "{}" } : {}) });

async function ctx(env: Record<string, string> = ENV): Promise<GateContext> {
  return { state: stateOf({ v: 1, passkey: true, locked: "2026-11-01T00:00:00.000Z", sv: "version-one" }, {}), keys: (await siteKeys({ FOUNDRY_DESK_KEY: DESK }))!, env, now: NOW };
}

const READS = ["/api/haven-plan", "/api/haven-meals", "/api/haven-photos?view=catalog", "/api/haven-photos?view=catalog&ids=a,b", "/api/haven-photos?id=abc", "/api/haven-photos?id=abc&size=full"];

describe("builderKeyValue", () => {
  it("counts only when set, long enough and different from every other key", () => {
    expect(builderKeyValue({ [BUILDER_KEY]: KEY })).toBe(KEY);
    expect(builderKeyValue({})).toBeNull();
    expect(builderKeyValue({ [BUILDER_KEY]: "" })).toBeNull();
    expect(builderKeyValue({ [BUILDER_KEY]: "x".repeat(MIN_BUILDER_KEY - 1) })).toBeNull();
    for (const other of ["FOUNDRY_DESK_KEY", "SITE_BYPASS_TOKEN", "SITE_SESSION_SECRET", "DESK_PINGS_SECRET", LOG_TOKEN, FEED_TOKEN]) {
      expect(builderKeyValue({ [BUILDER_KEY]: KEY, [other]: KEY })).toBeNull();
    }
  });
});

describe("the gate", () => {
  it("lets the key through on each listed read, GET and HEAD", async () => {
    const c = await ctx();
    for (const path of READS) {
      for (const method of ["GET", "HEAD"]) {
        const d = decide(req(path, method, KEY), c);
        expect(d.allow && d.why, `${method} ${path}`).toBe("builder-read");
      }
    }
  });

  it("refuses a wrong, missing, short or unset key", async () => {
    const c = await ctx();
    for (const path of READS) {
      expect(decide(req(path, "GET", "wrong-key-wrong-key-wrong-key-wrong-key"), c).allow).toBe(false);
      expect(decide(req(path), c).allow).toBe(false);
    }
    const unset = await ctx({ FOUNDRY_DESK_KEY: DESK });
    expect(decide(req("/api/haven-plan", "GET", KEY), unset).allow).toBe(false);
    const short = await ctx({ ...ENV, [BUILDER_KEY]: "short" });
    expect(decide(req("/api/haven-plan", "GET", "short"), short).allow).toBe(false);
    const dup = await ctx({ ...ENV, [BUILDER_KEY]: FEED });
    expect(decide(req("/api/haven-plan", "GET", FEED), dup).allow).toBe(false);
  });

  it("refuses every write, and every other route or query, even with the right key", async () => {
    const c = await ctx();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      for (const path of ["/api/haven-plan", "/api/haven-meals", "/api/haven-photos", "/api/haven", "/api/capture", "/api/email", "/api/desk-pings"]) {
        const d = decide(req(path, method, KEY), c);
        expect(d.allow, `${method} ${path}`).toBe(false);
        if (!d.allow) expect(d.response.status).toBe(401);
      }
    }
    for (const path of ["/api/haven", "/api/haven?view=list", "/api/haven/devices", "/api/email", "/api/keys", "/api/haven-plan?x=1", "/api/haven-plan/", "/api/haven-plan%2f", "/api/haven-meals?a=1&a=2", "/api/haven-photos?token=1", "/api/haven-plan/../haven"]) {
      expect(decide(req(path, "GET", KEY), c).allow, path).toBe(false);
    }
  });
});

describe("the handlers", () => {
  function blob(): BlobBackend & { files: Map<string, Uint8Array> } {
    const files = new Map<string, Uint8Array>();
    return {
      kind: "azureblob",
      files,
      get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: "1", contentType: "application/json" } : null),
      etag: async (path) => (files.has(path) ? "1" : null),
      put: async (path, body, opts) => {
        if (opts.ifMatch) throw new BlobPreconditionError("unused");
        files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
        return { pathname: path };
      },
      del: async (path) => void files.delete(path),
    };
  }
  const base = (env: Record<string, string>) => {
    const b = blob();
    return { desk: { deskKey: DESK, store: new MemoryAuthStore(), now: NOW }, blob: b, env, log: () => undefined };
  };

  it("serves the plan and the meals to the key with no session, and refuses without it", async () => {
    const p: PlanDeps = base(ENV);
    await p.blob!.put(PLAN_PATH, JSON.stringify(FAKE_PLAN), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
    const got = await planGet(req("/api/haven-plan", "GET", KEY), p);
    expect(got.status).toBe(200);
    expect(got.headers.get("Set-Cookie")).toBeNull();
    expect(((await got.json()) as { plan: { w: number } }).plan.w).toBe(FAKE_PLAN.w);
    expect((await planGet(req("/api/haven-plan", "GET", "wrong-key-wrong-key-wrong-key-wrong-key"), p)).status).toBe(401);
    expect((await planGet(req("/api/haven-plan"), p)).status).toBe(401);
    expect((await planGet(req("/api/haven-plan", "GET", KEY), base({ FOUNDRY_DESK_KEY: DESK }))).status).toBe(401);

    const m: MealsDeps = base(ENV);
    const meals = await mealsGet(req("/api/haven-meals", "GET", KEY), m);
    expect(meals.status).toBe(200);
    expect(await meals.json()).toEqual({ meals: null, components: [] });
    expect((await mealsGet(req("/api/haven-meals"), m)).status).toBe(401);
  });

  it("keeps every write refused with the key", async () => {
    const p = base(ENV);
    const postReq = new Request(`${ORIGIN}/api/haven-plan`, { method: "POST", headers: { "Content-Type": "application/json", [BUILDER_HEADER]: KEY }, body: JSON.stringify({ plan: FAKE_PLAN }) });
    expect((await planPost(postReq, p)).status).toBe(401);
    const putReq = new Request(`${ORIGIN}/api/haven-plan`, { method: "PUT", headers: { "Content-Type": "application/json", [BUILDER_HEADER]: KEY }, body: JSON.stringify({ plan: FAKE_PLAN }) });
    expect((await planPut(putReq, p)).status).toBe(401);
    const mealsReq = new Request(`${ORIGIN}/api/haven-meals`, { method: "POST", headers: { "Content-Type": "application/json", [BUILDER_HEADER]: KEY }, body: JSON.stringify({ action: "confirm" }) });
    expect((await mealsPost(mealsReq, base(ENV))).status).toBe(401);
    expect(p.blob.files.size).toBe(0);
  });
});

describe("builderReads", () => {
  it("is GET or HEAD only and never reads a write", () => {
    expect(isBuilderRead(req("/api/haven-plan", "GET"))).toBe(true);
    expect(isBuilderRead(req("/api/haven-plan", "POST"))).toBe(false);
    expect(builderReads(req("/api/haven-plan", "PUT", KEY), ENV)).toBe(false);
    expect(builderReads(req("/api/haven-plan", "GET", KEY), ENV)).toBe(true);
  });
});
