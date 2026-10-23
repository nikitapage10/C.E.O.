import { describe, expect, it, vi } from "vitest";
import { waitUntil } from "../../api/_waitUntil.ts";
import { stepOk, tick, TICK_SCHEDULE, VERCEL_STEP_URL, vercelUrl } from "./tick.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const log = () => ({ log: vi.fn(), error: vi.fn() });

describe("the world's steady clock (Azure timer, #271)", () => {
  it("knocks twice an hour, at :05 and :35", () => {
    expect(TICK_SCHEDULE).toBe("0 5,35 * * * *");
  });

  it("counts 200 and 409 as a working clock", () => {
    expect(stepOk(200)).toBe(true);
    expect(stepOk(409)).toBe(true);
    expect(stepOk(401)).toBe(false);
    expect(stepOk(0)).toBe(false);
  });

  it("leaves Vercel alone unless asked (#313, Azure is the only home)", () => {
    expect(vercelUrl({})).toBeNull();
    expect(vercelUrl({ WORLD_TICK_VERCEL: "" })).toBeNull();
    expect(vercelUrl({ WORLD_TICK_VERCEL: "off" })).toBeNull();
    expect(vercelUrl({ WORLD_TICK_VERCEL: "http://plain.example" })).toBeNull();
    expect(vercelUrl({ WORLD_TICK_VERCEL: "on" })).toBe(VERCEL_STEP_URL);
    expect(vercelUrl({ WORLD_TICK_VERCEL: "https://x.example/api/world-step" })).toBe("https://x.example/api/world-step");
  });

  it("steps Azure only by default, with no HTTP call", async () => {
    const fetcher = vi.fn(async () => json({})) as unknown as typeof fetch;
    const out = await tick({ step: () => json({ stepped: true }), fetch: fetcher, env: {}, log: log() });
    expect(out.azure.status).toBe(200);
    expect(out.vercel).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("steps Azure in-process, waits for its stories, and POSTs to Vercel when turned on", async () => {
    let told = false;
    const step = vi.fn(async () => {
      waitUntil(new Promise<void>((r) => setTimeout(() => ((told = true), r()), 5)));
      return json({ stepped: true, at: "2026-10-22T08:05:00Z" });
    });
    const fetcher = vi.fn(async () => json({ stepped: false, at: "x", nextAt: "y" })) as unknown as typeof fetch;
    const out = await tick({ step, fetch: fetcher, env: { WORLD_TICK_VERCEL: "on" }, log: log() });
    expect(told).toBe(true);
    expect(out.azure.status).toBe(200);
    expect(out.vercel?.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(VERCEL_STEP_URL, expect.objectContaining({ method: "POST" }));
  });

  it("fails loudly when either side fails, after trying both", async () => {
    const l = log();
    const fetcher = vi.fn(async () => json({ error: "site-locked" }, 401)) as unknown as typeof fetch;
    await expect(tick({ step: () => json({ stepped: false, error: "already-stepped" }, 409), fetch: fetcher, env: { WORLD_TICK_VERCEL: "on" }, log: l })).rejects.toThrow("vercel HTTP 401");
    expect(l.error).toHaveBeenCalled();
    const broken = vi.fn(async () => {
      throw new Error("blob down");
    });
    await expect(tick({ step: broken, fetch: fetcher, env: {}, log: log() })).rejects.toThrow("azure HTTP 0");
  });
});
