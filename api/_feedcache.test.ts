import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonical, memo } from "./_feedcache.ts";

describe("canonical", () => {
  it("lets a request with no query through", () => {
    expect(canonical(new Request("https://ceo.test/api/foundry-feed"))).toBeNull();
  });

  it("sends any query to the bare path with a 308 the edge can cache", () => {
    const res = canonical(new Request("https://ceo.test/api/foundry-feed?z=123&y=4"));
    expect(res?.status).toBe(308);
    expect(res?.headers.get("Location")).toBe("/api/foundry-feed");
    expect(res?.headers.get("Cache-Control")).toBe("public, s-maxage=3600");
  });
});

describe("memo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps an answer for the ttl, then reads again", async () => {
    const load = vi.fn(async () => load.mock.calls.length);
    const get = memo(1000, load);
    expect(await get()).toBe(1);
    vi.advanceTimersByTime(999);
    expect(await get()).toBe(1);
    vi.advanceTimersByTime(2);
    expect(await get()).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("hands simultaneous callers the same read", async () => {
    let release: (v: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((r) => (release = r)));
    const get = memo(1000, load);
    const a = get();
    const b = get();
    release("once");
    expect(await a).toBe("once");
    expect(await b).toBe("once");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed read, and the next caller tries again", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("GitHub down")).mockResolvedValueOnce("back");
    const get = memo(1000, load);
    await expect(get()).rejects.toThrow("GitHub down");
    expect(await get()).toBe("back");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
