import { beforeEach, describe, expect, it } from "vitest";
import {
  GET,
  KEEP,
  MemoryTalkStore,
  POST,
  cleanCall,
  forgetLastWrite,
  isTalkTiming,
} from "./talkTiming.ts";

const good = {
  ok: true,
  mic: 800,
  token: 1500,
  code: 300,
  connected: 2400,
  firstWord: 3100,
  server: { auth: 4, eleven: 700 },
};
const post = (body: unknown, now: number, store = new MemoryTalkStore()) =>
  POST(
    new Request("https://x/api/world?timing=talk", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { store, now },
  );

describe("the Talk call timing beacon (#512)", () => {
  beforeEach(() => forgetLastWrite());

  it("answers on its own path and on the rewrite's query", () => {
    expect(isTalkTiming(new Request("https://x/api/talk-timing"))).toBe(true);
    expect(isTalkTiming(new Request("https://x/api/world?timing=talk"))).toBe(
      true,
    );
    expect(
      isTalkTiming(new Request("https://x/api/world?timing=lattice")),
    ).toBe(false);
  });

  it("keeps stage names and numbers only, with the server's own time", () => {
    const c = cleanCall(
      {
        ...good,
        transcript: "hello",
        words: "secret",
        server: { auth: 4.4, "bad name": 1, eleven: "x" },
      },
      "2026-10-27T10:00:00.000Z",
    );
    expect(c).toEqual({
      at: "2026-10-27T10:00:00.000Z",
      ok: true,
      stages: {
        mic: 800,
        token: 1500,
        code: 300,
        connected: 2400,
        firstWord: 3100,
      },
      server: { auth: 4 },
    });
    expect(JSON.stringify(c)).not.toContain("secret");
  });

  it("refuses what isn't a call, and a spoke call with no first word", () => {
    const at = "2026-10-27T10:00:00.000Z";
    expect(cleanCall(null, at)).toBeNull();
    expect(cleanCall({ mic: 1 }, at)).toBeNull();
    expect(cleanCall({ ok: true, mic: 1 }, at)).toBeNull();
    expect(cleanCall({ ok: false, mic: 1 }, at)?.stages).toEqual({ mic: 1 });
    expect(cleanCall({ ...good, firstWord: 1e12 }, at)?.stages.firstWord).toBe(
      600_000,
    );
  });

  it("stores newest first, keeps the last KEEP, and slows a flood", async () => {
    const store = new MemoryTalkStore();
    expect((await post(good, 10_000, store)).status).toBe(204);
    expect((await post(good, 10_500, store)).status).toBe(429);
    for (let i = 0; i < KEEP + 5; i++)
      await store.add({
        at: String(i),
        ok: true,
        stages: { firstWord: i },
        server: {},
      });
    expect((await store.read()).length).toBe(KEEP);
    const res = await GET(new Request("https://x/api/talk-timing"), {
      store,
      now: 0,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(((await res.json()) as { calls: unknown[] }).calls.length).toBe(
      KEEP,
    );
  });

  it("is off without a store, and refuses bad bodies", async () => {
    expect(
      (
        await POST(new Request("https://x/", { method: "POST", body: "{}" }), {
          store: null,
          now: 0,
        })
      ).status,
    ).toBe(503);
    expect((await post("nope", 5000)).status).toBe(400);
    expect((await post("x".repeat(2000), 9000)).status).toBe(413);
  });
});
