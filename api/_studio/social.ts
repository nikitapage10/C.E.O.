/**
 * The Studio's posting line (#1225): finished zombie-guide episodes go to Instagram Reels and TikTok through Zernio
 * (zernio.com, free for two connected accounts), and the Director's thread reads the comments they get. Azure only:
 * the key is the Function App's ZERNIO_API_KEY (Key Vault `zernio-api-key`), sent only in the Authorization header.
 *
 *   POST /api/studio-social { mode: "accounts" }                                  → { accounts: [{ id, platform, username, active }] }
 *   POST /api/studio-social { mode: "presign", filename, contentType, size }      → { uploadUrl, publicUrl }  (PUT the file to uploadUrl)
 *   POST /api/studio-social { mode: "draft", caption, video, cover?, platforms }  → { id, status }  (a Zernio draft, never published)
 *   POST /api/studio-social { mode: "publish", id }                               → { id, status: "scheduled", at }  (only a draft this route made)
 *   POST /api/studio-social { mode: "status", id }                                → { id, status, platforms: [{ platform, status, url? }] }
 *   POST /api/studio-social { mode: "comments" }                                  → { posts: [{ id, accountId, platform, permalink, comments, text }] }
 *   POST /api/studio-social { mode: "reply", postId, accountId, commentId, message } → { id }  (a reply Nikita OKed, as the show)
 *   POST /api/studio-social { mode: "thread", postId, accountId }                 → { comments: [{ id, message, from, at, likes, replies, canReply }] }
 *
 * Who: the feed key only (SUBMIND_FEED_TOKEN, a POST with no query, api/_site/roomkeys.ts), checked by the gate and
 * again here. What it can do: make drafts, and publish a draft this route made (its externalId starts `ceo-studio-`)
 * once Nikita says "go" in the Director thread (his pick, 2026-11-25: the thread publishes on his word in chat). A
 * publish is scheduled a minute out so the upload runs in Zernio, not inside this request. It can't publish anything
 * else in the account or edit a live post. It may reply to a comment on one of the show's Instagram or TikTok posts,
 * as the show (Nikita, 2026-11-25: replies in his voice; drafted for his OK first, automatic later). What it
 * reads back: the connected accounts' platform and username, its own drafts' status, and the comments on the show's
 * posts (public on the platforms already; they go only to the thread, never to the Lattice or a public page).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { roomKeyOf, STUDIO_SOCIAL_PATH } from "../_site/roomkeys.js";

export { STUDIO_SOCIAL_PATH };
const API = "https://zernio.com/api/v1";
const BODY_MAX = 8_000;
export const CAPTION_MAX = 2_200;
/** A reply's length: kept short on purpose (short replies read best on both platforms). */
export const REPLY_MAX = 300;
const COMMENT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
export const PLATFORMS = ["instagram", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];
const UPLOAD_TYPES = ["video/mp4", "image/jpeg", "image/png"] as const;
/** 2 GB: a 3-minute 1080x1920 render is a few hundred MB; Zernio takes up to 5 GB. */
const SIZE_MAX = 2 * 1024 ** 3;
const ID = /^[A-Za-z0-9_-]{6,64}$/;
/** The externalId every draft this route makes carries: publish refuses any post without it. */
export const MINE = "ceo-studio-";
/** How far out a publish is scheduled, so Zernio does the upload after this request has answered. */
export const PUBLISH_LEAD_MS = 60_000;
const FILENAME = /^[A-Za-z0-9._-]{1,120}\.(mp4|jpe?g|png)$/;

export type SocialJob =
  | { mode: "accounts" }
  | { mode: "comments" }
  | { mode: "presign"; filename: string; contentType: (typeof UPLOAD_TYPES)[number]; size: number }
  | { mode: "draft"; caption: string; video: string; cover?: string; platforms: Platform[] }
  | { mode: "status"; id: string }
  | { mode: "publish"; id: string }
  | { mode: "reply"; postId: string; accountId: string; commentId: string; message: string }
  | { mode: "thread"; postId: string; accountId: string };

export interface StudioSocialDeps {
  key: string;
  env: Record<string, string | undefined>;
  now: number;
  fetcher?: typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
/** A media link Zernio can fetch: https only, no credentials, a sane length. */
export function isMediaUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2_000) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** The job a body asks for, or null when it doesn't fit exactly. */
export function parseSocialJob(body: unknown): SocialJob | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  const only = (...allowed: string[]) => keys.every((k) => allowed.includes(k));
  if ((b.mode === "accounts" || b.mode === "comments") && only("mode")) return { mode: b.mode };
  if (b.mode === "presign" && only("mode", "filename", "contentType", "size")) {
    const ct = b.contentType;
    if (typeof b.filename !== "string" || !FILENAME.test(b.filename)) return null;
    if (typeof ct !== "string" || !(UPLOAD_TYPES as readonly string[]).includes(ct)) return null;
    if (typeof b.size !== "number" || !Number.isInteger(b.size) || b.size <= 0 || b.size > SIZE_MAX) return null;
    return { mode: "presign", filename: b.filename, contentType: ct as (typeof UPLOAD_TYPES)[number], size: b.size };
  }
  if (b.mode === "draft" && only("mode", "caption", "video", "cover", "platforms")) {
    if (!isText(b.caption, CAPTION_MAX) || !isMediaUrl(b.video)) return null;
    if (b.cover !== undefined && !isMediaUrl(b.cover)) return null;
    const p = b.platforms;
    if (!Array.isArray(p) || p.length === 0 || p.length > PLATFORMS.length || new Set(p).size !== p.length) return null;
    if (!p.every((x) => (PLATFORMS as readonly unknown[]).includes(x))) return null;
    return { mode: "draft", caption: b.caption, video: b.video, ...(b.cover ? { cover: b.cover as string } : {}), platforms: p as Platform[] };
  }
  if ((b.mode === "status" || b.mode === "publish") && only("mode", "id") && typeof b.id === "string" && ID.test(b.id)) return { mode: b.mode, id: b.id };
  if (b.mode === "thread" && only("mode", "postId", "accountId") && typeof b.postId === "string" && ID.test(b.postId) && typeof b.accountId === "string" && ID.test(b.accountId)) {
    return { mode: "thread", postId: b.postId, accountId: b.accountId };
  }
  if (b.mode === "reply" && only("mode", "postId", "accountId", "commentId", "message") && typeof b.postId === "string" && ID.test(b.postId) && typeof b.accountId === "string" && ID.test(b.accountId)) {
    if (typeof b.commentId !== "string" || !COMMENT_ID.test(b.commentId) || !isText(b.message, REPLY_MAX)) return null;
    return { mode: "reply", postId: b.postId, accountId: b.accountId, commentId: b.commentId, message: b.message };
  }
  return null;
}

type Account = { _id?: unknown; platform?: unknown; username?: unknown; isActive?: unknown };

/** One Zernio call. The key goes only in the header, never in a URL, a log or an error. */
async function call(deps: StudioSocialDeps, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
  const res = await (deps.fetcher ?? fetch)(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${deps.key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: await res.json().catch(() => null) };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function accounts(deps: StudioSocialDeps) {
  const r = await call(deps, "GET", "/accounts");
  if (!r.ok) return r;
  const list = ((r.data as { accounts?: Account[] } | null)?.accounts ?? []).filter((a) => a && typeof a === "object");
  return { ok: true as const, data: list.map((a) => ({ id: str(a._id) ?? "", platform: str(a.platform) ?? "", username: str(a.username) ?? "", active: a.isActive !== false })) };
}

/** The Zernio post a draft becomes: always `isDraft`, TikTok public with comments on and the AI label set honestly. */
export function draftBody(job: SocialJob & { mode: "draft" }, accountIds: Record<Platform, string>, now: number) {
  return {
    content: job.caption,
    isDraft: true,
    externalId: `${MINE}${now}`,
    mediaItems: [{ type: "video", url: job.video, ...(job.cover ? { thumbnail: job.cover, instagramThumbnail: job.cover } : {}) }],
    platforms: job.platforms.map((platform) => ({ platform, accountId: accountIds[platform] })),
    ...(job.platforms.includes("tiktok")
      ? {
          tiktokSettings: {
            privacyLevel: "PUBLIC_TO_EVERYONE",
            allowComment: true,
            allowDuet: true,
            allowStitch: true,
            commercialContentType: "none",
            contentPreviewConfirmed: true,
            expressConsentGiven: true,
            mediaType: "video",
            videoMadeWithAi: true,
            ...(job.cover ? { videoCoverImageUrl: job.cover } : {}),
          },
        }
      : {}),
  };
}

const fail = (status: number) => json({ error: `zernio-${status}` }, status === 401 || status === 403 ? 503 : 502);

/** POST /api/studio-social: the feed key only. */
export async function studioSocial(request: Request, deps: StudioSocialDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  if (!deps.key) return json({ error: "not-set-up" }, 503);
  const raw = await request.text();
  if (raw.length > BODY_MAX) return json({ error: "too-big" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const job = parseSocialJob(body);
  if (!job) return json({ error: "bad-request" }, 400);

  try {
    if (job.mode === "accounts") {
      const r = await accounts(deps);
      return r.ok ? json({ accounts: r.data }) : fail(r.status);
    }
    if (job.mode === "presign") {
      const r = await call(deps, "POST", "/media/presign", { filename: job.filename, contentType: job.contentType, size: job.size });
      if (!r.ok) return fail(r.status);
      const d = r.data as { uploadUrl?: unknown; publicUrl?: unknown } | null;
      if (!isMediaUrl(d?.uploadUrl) || !isMediaUrl(d?.publicUrl)) return json({ error: "zernio-shape" }, 502);
      return json({ uploadUrl: d.uploadUrl, publicUrl: d.publicUrl });
    }
    if (job.mode === "draft") {
      const r = await accounts(deps);
      if (!r.ok) return fail(r.status);
      const ids = {} as Record<Platform, string>;
      for (const p of job.platforms) {
        const found = r.data.find((a) => a.platform === p && a.active && a.id);
        if (!found) return json({ error: `no-${p}-account` }, 409);
        ids[p] = found.id;
      }
      const made = await call(deps, "POST", "/posts", draftBody(job, ids, deps.now));
      if (!made.ok) return fail(made.status);
      const post = (made.data as { post?: { _id?: unknown; status?: unknown } } | null)?.post;
      return json({ id: str(post?._id) ?? "", status: str(post?.status) ?? "draft" }, 201);
    }
    if (job.mode === "publish") {
      const r = await call(deps, "GET", `/posts/${encodeURIComponent(job.id)}`);
      if (!r.ok) return fail(r.status);
      const d = r.data as { post?: Record<string, unknown> } & Record<string, unknown>;
      const post = (d?.post ?? d ?? {}) as { status?: unknown; externalId?: unknown };
      if (typeof post.externalId !== "string" || !post.externalId.startsWith(MINE)) return json({ error: "not-ours" }, 403);
      if (post.status !== "draft") return json({ error: "not-a-draft", status: str(post.status) ?? "" }, 409);
      const at = new Date(deps.now + PUBLISH_LEAD_MS).toISOString();
      const put = await call(deps, "PUT", `/posts/${encodeURIComponent(job.id)}`, { isDraft: false, scheduledFor: at });
      if (!put.ok) return fail(put.status);
      console.log(JSON.stringify({ at: new Date(deps.now).toISOString(), event: "studio.social.publish", id: job.id, scheduledFor: at }));
      return json({ id: job.id, status: "scheduled", at });
    }
    if (job.mode === "reply") {
      const r = await accounts(deps);
      if (!r.ok) return fail(r.status);
      const acct = r.data.find((a) => a.id === job.accountId && a.active);
      if (!acct || !(PLATFORMS as readonly string[]).includes(acct.platform)) return json({ error: "not-ours" }, 403);
      const sent = await call(deps, "POST", `/inbox/comments/${encodeURIComponent(job.postId)}`, { accountId: job.accountId, commentId: job.commentId, message: job.message });
      if (!sent.ok) return fail(sent.status);
      console.log(JSON.stringify({ at: new Date(deps.now).toISOString(), event: "studio.social.reply", platform: acct.platform, postId: job.postId }));
      return json({ id: str((sent.data as { data?: { commentId?: unknown } } | null)?.data?.commentId) ?? "" }, 201);
    }
    if (job.mode === "status") {
      const r = await call(deps, "GET", `/posts/${encodeURIComponent(job.id)}`);
      if (!r.ok) return fail(r.status);
      const d = r.data as { post?: Record<string, unknown> } & Record<string, unknown>;
      const post = (d?.post ?? d ?? {}) as { _id?: unknown; status?: unknown; platforms?: { platform?: unknown; status?: unknown; platformPostUrl?: unknown }[] };
      const platforms = (Array.isArray(post.platforms) ? post.platforms : []).map((p) => ({ platform: str(p.platform) ?? "", status: str(p.status) ?? "", ...(isMediaUrl(p.platformPostUrl) ? { url: p.platformPostUrl } : {}) }));
      return json({ id: job.id, status: str(post.status) ?? "", platforms });
    }
    if (job.mode === "comments") {
      const r = await call(deps, "GET", "/inbox/comments?limit=50&sortBy=date&sortOrder=desc");
      if (!r.ok) return fail(r.status);
      const list = ((r.data as { data?: Record<string, unknown>[] } | null)?.data ?? []).filter((p) => p && (p.platform === "instagram" || p.platform === "tiktok"));
      return json({
        posts: list.map((p) => ({ id: str(p.id) ?? "", accountId: str(p.accountId) ?? "", platform: str(p.platform) ?? "", permalink: isMediaUrl(p.permalink) ? p.permalink : undefined, comments: num(p.commentCount), text: (str(p.content) ?? "").slice(0, 200) })),
      });
    }
    const r = await call(deps, "GET", `/inbox/comments/${encodeURIComponent(job.postId)}?accountId=${encodeURIComponent(job.accountId)}&limit=100`);
    if (!r.ok) return fail(r.status);
    const list = ((r.data as { comments?: Record<string, unknown>[] } | null)?.comments ?? []).filter((c) => c && typeof c === "object");
    return json({
      comments: list.map((c) => {
        const from = c.from as { username?: unknown; name?: unknown } | undefined;
        return { id: str(c.id) ?? "", message: (str(c.message) ?? "").slice(0, 2_200), from: str(from?.username) ?? str(from?.name) ?? "", at: str(c.createdTime) ?? "", likes: num(c.likeCount), replies: num(c.replyCount), canReply: c.canReply === true };
      }),
    });
  } catch {
    return json({ error: "zernio-down" }, 502);
  }
}

export function POST(request: Request): Promise<Response> {
  return studioSocial(request, { key: process.env.ZERNIO_API_KEY?.trim() ?? "", env: process.env, now: Date.now() });
}
