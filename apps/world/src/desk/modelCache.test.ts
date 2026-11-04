import { beforeEach, describe, expect, it, vi } from "vitest";
import { cachedModel, clearModelCache, modelReady } from "./modelCache.ts";

describe("cachedModel", () => {
  beforeEach(() => clearModelCache());

  it("loads a model once and shares it", async () => {
    const load = vi.fn(async () => ({ scene: 1 }));
    expect(modelReady("a.glb")).toBe(false);
    const [a, b] = await Promise.all([cachedModel("a.glb", load), cachedModel("a.glb", load)]);
    const c = await cachedModel("a.glb", load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(modelReady("a.glb")).toBe(true);
  });

  it("forgets a failed load so it can be tried again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("ok");
    await expect(cachedModel("b.glb", load)).rejects.toThrow("offline");
    expect(modelReady("b.glb")).toBe(false);
    await expect(cachedModel("b.glb", load)).resolves.toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
