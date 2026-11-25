import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { FEED_TOKEN, isFeedWrite, isLogRead, LOG_TOKEN } from "../_site/roomkeys.ts";
import { deskGet, deskPost, deskPut, readEpisode, readSocial, type StudioDeskDeps } from "./desk.ts";

/** The Studio desk (#1227). Every key, id, link and number here is made up. */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const NOW = Date.parse("2026-11-25T05:00:00Z");
const URL_ = `${ORIGIN}/api/studio-desk`;

function memoryBlob(): BlobBackend & { files: Map<string, { body: string; v: number }> } {
  const files = new Map<string, { body: string; v: number }>();
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.body).body!, etag: String(files.get(path)!.v), contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? String(files.get(path)!.v) : null),
    put: async (path, body, opts) => {
      const cur = files.get(path);
      if (opts.ifMatch && String(cur?.v) !== opts.ifMatch) throw new BlobPreconditionError("changed");
      if (opts.allowOverwrite === false && cur) throw new BlobPreconditionError("there");
      files.set(path, { body: typeof body === "string" ? body : new TextDecoder().decode(body as Uint8Array), v: (cur?.v ?? 0) + 1 });
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

type Call = { url: string; method: string; body: unknown };
function fakeZernio(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = routes[`${method} ${url.replace("https://zernio.com/api/v1", "").split("?")[0]}`];
    if (hit === undefined) return new Response("{}", { status: 404 });
    if (typeof hit === "number") return new Response("{}", { status: hit });
    return new Response(JSON.stringify(hit), { status: 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

function deps(routes: Record<string, unknown> = {}, key = "test-zernio-key") {
  const store = new MemoryAuthStore();
  const blob = memoryBlob();
  const z = fakeZernio(routes);
  const d: StudioDeskDeps = { desk: { deskKey: DESK, store, now: NOW }, blob, env: { [LOG_TOKEN]: LOG, [FEED_TOKEN]: FEED }, zernio: { key, now: NOW, fetcher: z.fetcher } };
  return { d, store, blob, calls: z.calls };
}

const req = (method: string, body?: unknown, headers: Record<string, string> = {}) => new Request(URL_, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });

const EP3 = {
  id: "ep3",
  n: 3,
  title: "Foreign policy",
  stages: {
    pitch: { status: "approved", text: "The lesson: alliances." },
    mix: { status: "approved", media: "https://media.zernio.test/u/ep3-mix.m4a" },
    render: { status: "ready", media: "https://media.zernio.test/u/ep3.mp4", stills: ["https://media.zernio.test/u/s1.jpg"], captions: ["They're eating your neighbors."] },
    post: { status: "ready", draft: "post_mine1" },
  },
};

describe("studio-desk", () => {
  it("is a feed-key PUT and a read-key GET the gate lets through", () => {
    expect(isFeedWrite(new Request(URL_, { method: "PUT" }))).toBe(true);
    expect(isFeedWrite(new Request(URL_, { method: "POST" }))).toBe(false);
    expect(isLogRead(new Request(URL_))).toBe(true);
    expect(isLogRead(new Request(`${URL_}?x=1`))).toBe(false);
  });

  it("answers nobody without a session, and the read key without the profiles", async () => {
    const { d, calls } = deps();
    expect((await deskGet(req("GET"), d)).status).toBe(401);
    expect((await deskPost(req("POST", { action: "pitch", text: "taxes" }), d)).status).toBe(401);
    const r = await deskGet(req("GET", undefined, bearer(LOG)), d);
    expect(r.status).toBe(200);
    const got = await r.json();
    expect(got).toEqual({ ideas: [], episodes: [], notes: [], approvals: [] });
    expect(got.social).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("takes the thread's episode with the feed key only, and refuses loose shapes", async () => {
    const { d } = deps();
    expect((await deskPut(req("PUT", { action: "episode", episode: EP3 }, bearer(LOG)), d)).status).toBe(401);
    expect((await deskPut(req("PUT", { action: "episode", episode: EP3 }), d)).status).toBe(401);
    const ok = await deskPut(req("PUT", { action: "episode", episode: EP3 }, bearer(FEED)), d);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, stages: 4 });
    expect(readEpisode({ ...EP3, stages: { render: { status: "ready", media: "http://plain.test/v.mp4" } } })).toBeNull();
    expect(readEpisode({ ...EP3, stages: { trailer: { status: "ready" } } })).toBeNull();
    expect(readEpisode({ ...EP3, stages: { pitch: { status: "ready", secret: 1 } } })).toBeNull();
    expect(readEpisode({ ...EP3, extra: 1 })).toBeNull();
    const read = await (await deskGet(req("GET", undefined, bearer(LOG)), d)).json();
    expect(read.episodes[0].stages.render.stills).toEqual(["https://media.zernio.test/u/s1.jpg"]);
  });

  it("keeps a pitch, a said note and an approval for a passkey session", async () => {
    const { d, store } = deps({ "GET /accounts": { accounts: [] }, "GET /analytics": { posts: [] }, "GET /inbox/comments": { data: [] } });
    const cookie = { Cookie: await signedInCookie(DESK, NOW, store) };
    await deskPut(req("PUT", { action: "episode", episode: EP3 }, bearer(FEED)), d);
    expect((await deskPost(req("POST", { action: "pitch", text: "Taxes, but the IRS is a lich." }, cookie), d)).status).toBe(200);
    expect((await deskPost(req("POST", { action: "note", text: "Make the poster bigger.", episode: "ep3", stage: "render", via: "said" }, cookie), d)).status).toBe(200);
    expect((await deskPost(req("POST", { action: "approve", episode: "ep3", stage: "render" }, cookie), d)).status).toBe(200);
    // A stage that isn't ready can't be approved again.
    expect((await deskPost(req("POST", { action: "approve", episode: "ep3", stage: "render" }, cookie), d)).status).toBe(409);
    expect((await deskPost(req("POST", { action: "pitch", text: "" }, cookie), d)).status).toBe(400);
    expect((await deskPost(req("POST", { action: "send", episode: "ep3" }, cookie), d)).status).toBe(200);
    const got = await (await deskGet(req("GET", undefined, bearer(LOG)), d)).json();
    expect(got.ideas[0]).toMatchObject({ text: "Taxes, but the IRS is a lich.", status: "new" });
    expect(got.notes[0]).toMatchObject({ text: "Make the poster bigger.", episode: "ep3", stage: "render", via: "said" });
    expect(got.approvals).toEqual([{ at: NOW, episode: "ep3", stage: "render" }]);
    expect(got.episodes[0].stages.render.status).toBe("approved");
  });

  it("publishes only the episode's own ready draft", async () => {
    const { d, store, calls } = deps({
      "GET /posts/post_mine1": { post: { _id: "post_mine1", status: "draft", externalId: "ceo-studio-1" } },
      "PUT /posts/post_mine1": { post: { _id: "post_mine1", status: "scheduled" } },
    });
    const cookie = { Cookie: await signedInCookie(DESK, NOW, store) };
    expect((await deskPost(req("POST", { action: "publish", episode: "ep3" }, cookie), d)).status).toBe(409);
    await deskPut(req("PUT", { action: "episode", episode: EP3 }, bearer(FEED)), d);
    const ok = await deskPost(req("POST", { action: "publish", episode: "ep3" }, cookie), d);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, at: "2026-11-25T05:01:00.000Z" });
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ isDraft: false, scheduledFor: "2026-11-25T05:01:00.000Z" });
    // Once published, the post stage is approved and a second tap does nothing.
    expect((await deskPost(req("POST", { action: "publish", episode: "ep3" }, cookie), d)).status).toBe(409);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("reads both profiles, their posts and the newest comments, and caches them", async () => {
    const { d, store, calls } = deps({
      "GET /accounts": {
        accounts: [
          { _id: "acc_ig_0001", platform: "instagram", username: "show", metadata: { profileData: { displayName: "Show", bio: "Small puppets.", followersCount: 120, extraData: { mediaCount: 2 } } } },
          { _id: "acc_tt_0001", platform: "tiktok", username: "show", metadata: { profileData: { followersCount: 900, extraData: { videoCount: 2, likesCount: 4000 } } } },
          { _id: "acc_x_0001", platform: "twitter", username: "nope" },
        ],
      },
      "GET /analytics": { posts: [{ platform: "tiktok", content: "Ep 1", publishedAt: "2026-11-24T01:00:00Z", analytics: { views: 8000, likes: 400, comments: 12, shares: 9, saves: 3, follows: 40 } }] },
      "GET /inbox/comments": { data: [{ id: "p1aaaa", accountId: "acc_tt_0001", platform: "tiktok", commentCount: 1, content: "Ep 1" }] },
      "GET /inbox/comments/p1aaaa": { comments: [{ id: "c1", message: "do taxes next", from: { username: "fan" }, createdTime: "2026-11-25T04:00:00Z", likeCount: 2 }] },
    });
    const cookie = { Cookie: await signedInCookie(DESK, NOW, store) };
    const got = await (await deskGet(req("GET", undefined, cookie), d)).json();
    expect(got.social.profiles).toEqual([
      { platform: "instagram", username: "show", name: "Show", bio: "Small puppets.", followers: 120, posts: 2 },
      { platform: "tiktok", username: "show", name: "", bio: "", followers: 900, posts: 2, likes: 4000 },
    ]);
    expect(got.social.posts[0]).toMatchObject({ platform: "tiktok", views: 8000, follows: 40 });
    expect(got.social.comments).toEqual([{ platform: "tiktok", from: "fan", text: "do taxes next", at: "2026-11-25T04:00:00Z", likes: 2, post: "Ep 1" }]);
    const before = calls.length;
    await deskGet(req("GET", undefined, cookie), d);
    expect(calls.length).toBe(before);
  });

  it("shows the desk without profiles when Zernio is down or not set up", async () => {
    expect(await readSocial({ key: "k", now: NOW, fetcher: fakeZernio({ "GET /accounts": 401 }).fetcher })).toBeNull();
    const { d, store } = deps({}, "");
    const got = await (await deskGet(req("GET", undefined, { Cookie: await signedInCookie(DESK, NOW, store) }), d)).json();
    expect(got.social).toBeNull();
  });

  it("keeps timed notes as his drafts until Send notes, then the Director marks them (#1229)", async () => {
    const { d, store } = deps({ "GET /accounts": { accounts: [] } });
    const cookie = { Cookie: await signedInCookie(DESK, NOW, store) };
    const v = [{ v: 2, media: "https://media.zernio.test/u/ep3-v2.mp4", label: "first cut" }, { v: 3, media: "https://media.zernio.test/u/ep3-v3.mp4" }];
    expect((await deskPut(req("PUT", { action: "episode", episode: { ...EP3, stages: { ...EP3.stages, render: { ...EP3.stages.render, versions: v } } } }, bearer(FEED)), d)).status).toBe(200);
    expect(readEpisode({ ...EP3, stages: { render: { status: "ready", versions: [{ v: 1, media: "https://a.test/1.mp4" }, { v: 1, media: "https://a.test/2.mp4" }] } } })).toBeNull();
    const point = await (await deskPost(req("POST", { action: "note", text: "The doctor shows up twice.", episode: "ep3", stage: "render", version: 3, t: 93.08 }, cookie), d)).json();
    expect(point.note).toMatchObject({ version: 3, t: 93.1, state: "draft" });
    expect((await deskPost(req("POST", { action: "note", text: "Music too loud here.", episode: "ep3", stage: "render", version: 3, t: 120, t2: 131.5 }, cookie), d)).status).toBe(200);
    const gone = await (await deskPost(req("POST", { action: "note", text: "Never mind.", episode: "ep3", stage: "render", version: 3, t: 5 }, cookie), d)).json();
    expect((await deskPost(req("POST", { action: "note", text: "x", episode: "ep3", t: 10, t2: 4 }, cookie), d)).status).toBe(400);
    expect((await deskPost(req("POST", { action: "note", text: "x", episode: "ep3", t2: 4 }, cookie), d)).status).toBe(400);
    expect((await deskPost(req("POST", { action: "unnote", id: gone.note.id }, cookie), d)).status).toBe(200);
    // The Director sees nothing until the batch is sent, and can't mark a draft.
    expect((await (await deskGet(req("GET", undefined, bearer(LOG)), d)).json()).notes).toEqual([]);
    expect((await deskPut(req("PUT", { action: "note-state", id: point.note.id, state: "fixed" }, bearer(FEED)), d)).status).toBe(404);
    const sent = await (await deskPost(req("POST", { action: "send", episode: "ep3", stage: "render" }, cookie), d)).json();
    expect(sent).toEqual({ ok: true, sent: 2 });
    expect((await deskPost(req("POST", { action: "send", episode: "ep3" }, cookie), d)).status).toBe(409);
    expect((await deskPost(req("POST", { action: "unnote", id: point.note.id }, cookie), d)).status).toBe(404);
    const read = await (await deskGet(req("GET", undefined, bearer(LOG)), d)).json();
    expect(read.notes.map((n: { t2?: number; state: string }) => [n.t2, n.state])).toEqual([[undefined, "sent"], [131.5, "sent"]]);
    expect(read.episodes[0].stages.render.versions).toEqual(v);
    expect((await deskPut(req("PUT", { action: "note-state", id: point.note.id, state: "fixed", reply: "Camera breaks at hard cuts now." }, bearer(FEED)), d)).status).toBe(200);
    expect((await deskPut(req("PUT", { action: "note-state", id: point.note.id, state: "done" }, bearer(FEED)), d)).status).toBe(400);
    const after = await (await deskGet(req("GET", undefined, cookie), d)).json();
    expect(after.notes[0]).toMatchObject({ state: "fixed", reply: "Camera breaks at hard cuts now." });
  });

  it("sets an idea taken with the feed key", async () => {
    const { d, store } = deps({ "GET /accounts": { accounts: [] } });
    const cookie = { Cookie: await signedInCookie(DESK, NOW, store) };
    const { idea } = await (await deskPost(req("POST", { action: "pitch", text: "Credit scores" }, cookie), d)).json();
    expect((await deskPut(req("PUT", { action: "idea", id: idea.id, status: "taken" }, bearer(FEED)), d)).status).toBe(200);
    expect((await deskPut(req("PUT", { action: "idea", id: "nope", status: "taken" }, bearer(FEED)), d)).status).toBe(404);
    const got = await (await deskGet(req("GET", undefined, bearer(LOG)), d)).json();
    expect(got.ideas[0].status).toBe("taken");
  });
});
