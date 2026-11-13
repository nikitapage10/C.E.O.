import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { BlobChatLog, callTurns, chatLogGet, CHATS_PATH, conversations, historyGet, keepable, type ChatTurn } from "./chatlog.ts";

/** Desk chats kept whole (#1097). Every word here is made up. */

const NOW = Date.parse("2026-11-13T01:00:00Z");
const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";

function memoryBlob(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && opts.allowOverwrite === false && files.has(path)) throw new BlobPreconditionError("exists");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

describe("Desk chats kept whole (#1097)", () => {
  it("keeps a whole turn, and leaves out one that trips the memory's rules", async () => {
    const long = `${"A sample sentence that goes on. ".repeat(30)}`.trim();
    expect(keepable({ at: "2026-11-13T00:00:00Z", via: "desk", q: "plan a sample week", a: long })?.a).toBe(long);
    expect(keepable({ at: "2026-11-13T00:00:00Z", via: "desk", q: "my salary is $90,000", a: "Noted." })).toBeNull();
    expect(keepable({ at: "2026-11-13T00:00:00Z", via: "desk", q: "call 555-010-4477", a: "Sure." })).toBeNull();
    expect(keepable({ at: "2026-11-13T00:00:00Z", via: "desk", q: "add sample to my skip list", a: "Done." })).toBeNull();
    const blob = memoryBlob();
    const log = new BlobChatLog(blob);
    expect(await log.add([{ at: "2026-11-13T00:10:00Z", via: "desk", q: "what's for dinner", a: "A sample dinner." }, { at: "2026-11-13T00:11:00Z", via: "phone", q: "my bank balance", a: "x" }], NOW)).toBe(1);
    expect((await log.read(0, NOW)).map((t) => t.q)).toEqual(["what's for dinner"]);
    // Older than thirty days goes.
    await log.add([{ at: "2026-10-01T00:00:00Z", via: "desk", q: "an old sample", a: "Old." }], NOW);
    expect((await log.read(0, NOW)).map((t) => t.q)).toEqual(["what's for dinner"]);
    expect(blob.files.has(CHATS_PATH)).toBe(true);
  });

  it("turns a finished call into turns, in order, once even if settled twice", async () => {
    const conversation = {
      metadata: { start_time_unix_secs: Date.parse("2026-11-13T00:30:00Z") / 1000 },
      transcript: [
        { role: "agent", message: "Ah, the C.E.O. calls.", time_in_call_secs: 0 },
        { role: "user", message: "Swap tonight's sample dinner.", time_in_call_secs: 4 },
        { role: "user", message: "For the other one.", time_in_call_secs: 6 },
        { role: "agent", message: "Swapping it now.", time_in_call_secs: 8 },
        { role: "user", message: "Thanks.", time_in_call_secs: 20 },
        { role: "agent", message: "", time_in_call_secs: 21 },
      ],
    };
    const turns = callTurns(conversation, "conv_sample", 0);
    expect(turns.map((t) => [t.q, t.a])).toEqual([
      ["", "Ah, the C.E.O. calls."],
      ["Swap tonight's sample dinner. For the other one.", "Swapping it now."],
      ["Thanks.", ""],
    ]);
    expect(turns[1]).toMatchObject({ via: "talk", call: "conv_sample", at: "2026-11-13T00:30:04.000Z" });
    const log = new BlobChatLog(memoryBlob());
    await log.add(turns, NOW);
    await log.add(turns, NOW);
    expect(await log.read(0, NOW)).toHaveLength(3);
  });

  it("reads with the read key or a passkey session, since a time, and nothing else", async () => {
    const blob = memoryBlob();
    const log = new BlobChatLog(blob);
    await log.add([1, 2, 3].map((i) => ({ at: `2026-11-13T00:0${i}:00Z`, via: "desk" as const, q: `sample ${i}`, a: "ok" })), NOW);
    const store = new MemoryAuthStore();
    const deps = { desk: { deskKey: DESK, store, now: NOW }, log, env: { SUBMIND_LOG_TOKEN: LOG } };
    const get = async (q: string, headers: Record<string, string>) => {
      const res = await chatLogGet(new Request(`${ORIGIN}/api/skippy-journal${q}`, { headers }), deps);
      return { status: res.status, body: (await res.json()) as { turns?: { q: string }[]; more?: boolean }, cache: res.headers.get("cache-control") };
    };
    const keyed = await get("?since=2026-11-13T00:01:30Z", { "x-ceo-room-key": LOG });
    expect(keyed.status).toBe(200);
    expect(keyed.cache).toContain("no-store");
    expect(keyed.body.turns?.map((t) => t.q)).toEqual(["sample 2", "sample 3"]);
    expect((await get("", { "x-ceo-room-key": "a wrong key that is long enough to count 0123" })).status).toBe(401);
    expect((await get("?since=nope", { "x-ceo-room-key": LOG })).status).toBe(400);
    expect((await get("?room=x", { "x-ceo-room-key": LOG })).status).toBe(400);
    const cookie = await signedInCookie(DESK, NOW, store);
    expect((await get("", { Cookie: cookie })).body.turns).toHaveLength(3);
    const post = await chatLogGet(new Request(`${ORIGIN}/api/skippy-journal`, { method: "POST", headers: { "x-ceo-room-key": LOG } }), deps);
    expect(post.status).toBe(405);
  });

  it("groups the history into conversations, newest first: a call as one, typed turns while they run close", () => {
    const turns: ChatTurn[] = [
      { at: "2026-11-12T10:00:00Z", via: "desk", q: "a sample morning question", a: "ok" },
      { at: "2026-11-12T10:20:00Z", via: "desk", q: "and a follow-up", a: "ok" },
      { at: "2026-11-12T10:25:00Z", via: "talk", q: "a sample call", a: "ok", call: "conv_a" },
      { at: "2026-11-12T10:26:00Z", via: "talk", q: "more on the call", a: "ok", call: "conv_a" },
      { at: "2026-11-12T12:00:00Z", via: "phone", q: "", a: "only Skippy spoke" },
      { at: "2026-11-12T12:01:00Z", via: "phone", q: `a long sample ${"word ".repeat(60)}`, a: "ok" },
    ];
    const got = conversations(turns);
    expect(got.map((c) => [c.id, c.kind, c.via, c.turns])).toEqual([
      [`c${Date.parse("2026-11-12T12:00:00Z")}`, "chat", "phone", 2],
      ["tconv_a", "talk", "talk", 2],
      [`c${Date.parse("2026-11-12T10:00:00Z")}`, "chat", "desk", 2],
    ]);
    expect(got[2]?.first).toBe("a sample morning question");
    expect(got[0]?.first.length).toBeLessThanOrEqual(160);
    expect(got[0]?.first.endsWith("…")).toBe(true);
    expect(got[1]?.end).toBe("2026-11-12T10:26:00Z");
  });

  it("answers the history in a passkey session only, never to the read key or the feed key", async () => {
    const log = new BlobChatLog(memoryBlob());
    await log.add(
      [
        { at: "2026-11-12T09:00:00Z", via: "desk", q: "sample first", a: "ok" },
        { at: "2026-11-12T20:00:00Z", via: "talk", q: "sample call", a: "ok", call: "conv_b" },
      ],
      NOW,
    );
    const store = new MemoryAuthStore();
    const deps = { desk: { deskKey: DESK, store, now: NOW }, log };
    const get = async (q: string, headers: Record<string, string>, method = "GET") => {
      const res = await historyGet(new Request(`${ORIGIN}/api/skippy-history${q}`, { method, headers }), deps);
      return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control"), cookie: res.headers.get("set-cookie") };
    };
    expect((await get("", {})).status).toBe(401);
    expect((await get("", { "x-ceo-room-key": LOG })).status).toBe(401);
    expect((await get("", { Authorization: `Bearer ${LOG}` })).status).toBe(401);
    expect((await get("?id=tconv_b", { "x-ceo-room-key": LOG })).status).toBe(401);
    const cookie = await signedInCookie(DESK, NOW, store);
    expect((await get("", { Cookie: cookie, Origin: "https://elsewhere.test", "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    const list = await get("", { Cookie: cookie });
    expect(list.status).toBe(200);
    expect(list.cache).toContain("no-store");
    expect(list.cookie).toBeTruthy();
    const convs = list.body.conversations as { id: string; first: string; lines?: unknown }[];
    expect(convs.map((c) => c.first)).toEqual(["sample call", "sample first"]);
    expect(convs[0]?.lines).toBeUndefined();
    const one = await get(`?id=${convs[1]?.id}`, { Cookie: cookie });
    expect((one.body.conversation as { lines: { q: string }[] }).lines.map((t) => t.q)).toEqual(["sample first"]);
    expect((await get("?id=tconv_none", { Cookie: cookie })).status).toBe(404);
    expect((await get("?id=../x", { Cookie: cookie })).status).toBe(400);
    expect((await get("?since=2026-11-01T00:00:00Z", { Cookie: cookie })).status).toBe(400);
    expect((await get("", { Cookie: cookie }, "POST")).status).toBe(405);
    expect((await historyGet(new Request(`${ORIGIN}/api/skippy-history`, { headers: { Cookie: cookie } }), { ...deps, log: null })).status).toBe(503);
  });
});
