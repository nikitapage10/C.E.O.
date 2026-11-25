import { describe, expect, it } from "vitest";
import { isFeedWrite } from "../_site/roomkeys.ts";
import { draftBody, parseSocialJob, studioSocial } from "./social.ts";

/** The Studio's posting line (#1225). Every key, id and link here is made up. */

const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-11-25T05:00:00Z");
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const ENV = { SUBMIND_FEED_TOKEN: FEED, SUBMIND_LOG_TOKEN: LOG };
const VIDEO = "https://media.zernio.test/u/ep3.mp4";

type Call = { url: string; method: string; auth: string | null; body: unknown };

function fakeZernio(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = url.replace("https://zernio.com/api/v1", "").split("?")[0];
    const hit = routes[`${method} ${path}`];
    if (hit === undefined) return new Response("{}", { status: 404 });
    if (typeof hit === "number") return new Response("{}", { status: hit });
    return new Response(JSON.stringify(hit), { status: 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const ACCOUNTS = { accounts: [{ _id: "acc_ig_0001", platform: "instagram", username: "show", isActive: true }, { _id: "acc_tt_0001", platform: "tiktok", username: "show", isActive: true }] };

function post(body: unknown, fetcher: typeof fetch, key = FEED, zkey = "test-zernio-key") {
  return studioSocial(new Request(`${ORIGIN}/api/studio-social`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body) }), { key: zkey, env: ENV, now: NOW, fetcher });
}

describe("studio-social", () => {
  it("is a feed-key write the gate lets through", () => {
    expect(isFeedWrite(new Request(`${ORIGIN}/api/studio-social`, { method: "POST" }))).toBe(true);
  });

  it("refuses the read key, other methods and a query", async () => {
    const { fetcher, calls } = fakeZernio({ "GET /accounts": ACCOUNTS });
    expect((await post({ mode: "accounts" }, fetcher, LOG)).status).toBe(401);
    expect((await studioSocial(new Request(`${ORIGIN}/api/studio-social`, { method: "GET" }), { key: "k", env: ENV, now: NOW, fetcher })).status).toBe(405);
    expect((await studioSocial(new Request(`${ORIGIN}/api/studio-social?x=1`, { method: "POST", headers: { Authorization: `Bearer ${FEED}` }, body: "{}" }), { key: "k", env: ENV, now: NOW, fetcher })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("answers not-set-up without a Zernio key", async () => {
    const { fetcher } = fakeZernio({});
    expect((await post({ mode: "accounts" }, fetcher, FEED, "")).status).toBe(503);
  });

  it("lists accounts with the key only in the header", async () => {
    const { fetcher, calls } = fakeZernio({ "GET /accounts": ACCOUNTS });
    const res = await post({ mode: "accounts" }, fetcher);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [{ id: "acc_ig_0001", platform: "instagram", username: "show", active: true }, { id: "acc_tt_0001", platform: "tiktok", username: "show", active: true }] });
    expect(calls[0]?.auth).toBe("Bearer test-zernio-key");
    expect(calls[0]?.url).not.toContain("test-zernio-key");
  });

  it("makes a draft, never a published post", async () => {
    const { fetcher, calls } = fakeZernio({ "GET /accounts": ACCOUNTS, "POST /posts": { post: { _id: "post_0001", status: "draft" } } });
    const res = await post({ mode: "draft", caption: "They're eating your neighbors.", video: VIDEO, platforms: ["instagram", "tiktok"] }, fetcher);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "post_0001", status: "draft" });
    const made = calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(made.isDraft).toBe(true);
    expect(made.externalId).toBe(`ceo-studio-${NOW}`);
    expect(made.publishNow).toBeUndefined();
    expect(made.scheduledFor).toBeUndefined();
    expect(made.platforms).toEqual([{ platform: "instagram", accountId: "acc_ig_0001" }, { platform: "tiktok", accountId: "acc_tt_0001" }]);
  });

  it("publishes only its own drafts, a minute out", async () => {
    const { fetcher, calls } = fakeZernio({
      "GET /posts/post_mine1": { post: { _id: "post_mine1", status: "draft", externalId: "ceo-studio-1" } },
      "PUT /posts/post_mine1": { post: { _id: "post_mine1", status: "scheduled" } },
      "GET /posts/post_other": { post: { _id: "post_other", status: "draft", externalId: "someone-else" } },
      "GET /posts/post_live1": { post: { _id: "post_live1", status: "published", externalId: "ceo-studio-2" } },
    });
    const ok = await post({ mode: "publish", id: "post_mine1" }, fetcher);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: "post_mine1", status: "scheduled", at: "2026-11-25T05:01:00.000Z" });
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ isDraft: false, scheduledFor: "2026-11-25T05:01:00.000Z" });
    expect((await post({ mode: "publish", id: "post_other" }, fetcher)).status).toBe(403);
    expect((await post({ mode: "publish", id: "post_live1" }, fetcher)).status).toBe(409);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("replies only from the show's own accounts, short", async () => {
    const { fetcher, calls } = fakeZernio({ "GET /accounts": ACCOUNTS, "POST /inbox/comments/p1aaaa": { success: true, data: { commentId: "r1" } } });
    const ok = await post({ mode: "reply", postId: "p1aaaa", accountId: "acc_tt_0001", commentId: "c1", message: "Taxes are on the list." }, fetcher);
    expect(ok.status).toBe(201);
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ accountId: "acc_tt_0001", commentId: "c1", message: "Taxes are on the list." });
    expect((await post({ mode: "reply", postId: "p1aaaa", accountId: "acc_xx_0001", commentId: "c1", message: "hi" }, fetcher)).status).toBe(403);
    expect(parseSocialJob({ mode: "reply", postId: "p1aaaa", accountId: "acc_tt_0001", commentId: "c1", message: "x".repeat(301) })).toBeNull();
  });

  it("says which account is missing", async () => {
    const { fetcher } = fakeZernio({ "GET /accounts": { accounts: [] } });
    const res = await post({ mode: "draft", caption: "x", video: VIDEO, platforms: ["tiktok"] }, fetcher);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no-tiktok-account" });
  });

  it("parses only the closed shapes", () => {
    expect(parseSocialJob({ mode: "accounts", extra: 1 })).toBeNull();
    expect(parseSocialJob({ mode: "draft", caption: "x", video: "http://plain.test/v.mp4", platforms: ["instagram"] })).toBeNull();
    expect(parseSocialJob({ mode: "draft", caption: "x", video: VIDEO, platforms: ["twitter"] })).toBeNull();
    expect(parseSocialJob({ mode: "draft", caption: "x", video: VIDEO, platforms: ["tiktok", "tiktok"] })).toBeNull();
    expect(parseSocialJob({ mode: "draft", caption: "x", video: VIDEO, platforms: ["tiktok"], publishNow: true })).toBeNull();
    expect(parseSocialJob({ mode: "presign", filename: "ep3.mp4", contentType: "video/mp4", size: 300_000_000 })).toEqual({ mode: "presign", filename: "ep3.mp4", contentType: "video/mp4", size: 300_000_000 });
    expect(parseSocialJob({ mode: "presign", filename: "../ep3.mp4", contentType: "video/mp4", size: 1 })).toBeNull();
    expect(parseSocialJob({ mode: "thread", postId: "post_0001", accountId: "acc_tt_0001" })).toEqual({ mode: "thread", postId: "post_0001", accountId: "acc_tt_0001" });
  });

  it("labels TikTok drafts as AI-made and public with comments on", () => {
    const body = draftBody({ mode: "draft", caption: "x", video: VIDEO, cover: "https://media.zernio.test/u/c.jpg", platforms: ["tiktok"] }, { instagram: "", tiktok: "acc_tt_0001" }, NOW);
    expect(body.tiktokSettings).toMatchObject({ privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: true, videoMadeWithAi: true, videoCoverImageUrl: "https://media.zernio.test/u/c.jpg" });
  });

  it("reads comments for the thread only from Instagram and TikTok", async () => {
    const { fetcher } = fakeZernio({
      "GET /inbox/comments": { data: [{ id: "p1aaaa", accountId: "acc_tt_0001", platform: "tiktok", commentCount: 3, content: "Ep 3", permalink: "https://tiktok.test/v/1" }, { id: "p2aaaa", platform: "twitter", commentCount: 9 }] },
      "GET /inbox/comments/p1aaaa": { comments: [{ id: "c1", message: "do taxes next", from: { username: "fan" }, createdTime: "2026-11-25T05:00:00Z", likeCount: 2, replyCount: 0, canReply: true }] },
    });
    const list = await (await post({ mode: "comments" }, fetcher)).json();
    expect(list.posts).toHaveLength(1);
    const thread = await (await post({ mode: "thread", postId: "p1aaaa", accountId: "acc_tt_0001" }, fetcher)).json();
    expect(thread.comments[0]).toEqual({ id: "c1", message: "do taxes next", from: "fan", at: "2026-11-25T05:00:00Z", likes: 2, replies: 0, canReply: true });
  });

  it("hides Zernio's failures behind a short code", async () => {
    const { fetcher } = fakeZernio({ "GET /accounts": 401 });
    const res = await post({ mode: "accounts" }, fetcher);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "zernio-401" });
  });
});
