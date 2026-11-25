/**
 * Both of the show's profiles from Zernio (#1227): followers, posts and likes per account, each recent post's numbers,
 * and the newest comments. Read for the signed-in Studio desk (api/_studio/desk.ts) and, numbers only, for the
 * Director's thread's daily growth log (POST /api/studio-social { mode: "stats" }, api/_studio/social.ts).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { isMediaUrl, zernio, type ZernioDeps } from "./social.js";


export interface Profile {
  platform: string;
  username: string;
  name: string;
  bio: string;
  followers: number;
  posts: number;
  likes?: number;
  url?: string;
  avatar?: string;
}

export interface PostStat {
  platform: string;
  /** A story (24-hour) or a feed post (Reel, video); Zernio marks stories in the post's content type. */
  kind: "post" | "story";
  text: string;
  at: string;
  url?: string;
  thumb?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  follows: number;
  /** The signal metrics (social media skill, 2026-11-25): accounts reached, DM sends, watch and completion. */
  reach: number;
  sends: number;
  profileViews: number;
  /** Percent of plays watched to the end; null when the platform gives no watch signal. */
  completion: number | null;
  /** Average watch per play, in seconds (Instagram Reels); null when not given. */
  watchS: number | null;
  /** Percent of Reels plays skipped in the first seconds; null when not given. */
  skip: number | null;
}

export interface CommentLine {
  platform: string;
  from: string;
  text: string;
  at: string;
  likes: number;
  post: string;
}

export interface Social {
  at: number;
  profiles: Profile[];
  posts: PostStat[];
  comments: CommentLine[];
}

/** Whether Zernio's post is a story: its content or media type says so, at the top or in the platform data. */
export function postKind(p: Record<string, unknown>): "post" | "story" {
  const psd = (p.platformSpecificData ?? {}) as Record<string, unknown>;
  const said = [p.contentType, p.postType, p.mediaType, p.type, psd.contentType, psd.postType, psd.mediaType].filter((v) => typeof v === "string").join(" ");
  return /stor(y|ies)/i.test(said) ? "story" : "post";
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const s = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");

/** Both profiles, their recent posts with numbers, and the newest comments; null when Zernio can't be read. */
export async function readSocial(z: ZernioDeps): Promise<Omit<Social, "at"> | null> {
  const [acc, posts, inbox] = await Promise.all([zernio(z, "GET", "/accounts"), zernio(z, "GET", "/analytics?limit=24"), zernio(z, "GET", "/inbox/comments?limit=20&sortBy=date&sortOrder=desc")]);
  if (!acc.ok) return null;
  const accounts = ((acc.data as { accounts?: Record<string, unknown>[] } | null)?.accounts ?? []).filter((a) => a && (a.platform === "instagram" || a.platform === "tiktok"));
  const profiles: Profile[] = accounts.map((a) => {
    const pd = ((a.metadata as Record<string, unknown> | undefined)?.profileData ?? {}) as Record<string, unknown>;
    const extra = (pd.extraData ?? {}) as Record<string, unknown>;
    return {
      platform: s(a.platform),
      username: s(a.username ?? pd.username),
      name: s(pd.displayName ?? a.displayName),
      bio: s(pd.bio, 300),
      followers: n(pd.followersCount),
      posts: n(extra.mediaCount ?? extra.videoCount),
      ...(typeof extra.likesCount === "number" ? { likes: extra.likesCount } : {}),
      ...(isMediaUrl(pd.profileUrl) ? { url: pd.profileUrl } : {}),
      ...(isMediaUrl(pd.profilePicture) ? { avatar: pd.profilePicture } : {}),
    };
  });
  const stats: PostStat[] = posts.ok
    ? ((posts.data as { posts?: Record<string, unknown>[] } | null)?.posts ?? []).filter((p) => p && (p.platform === "instagram" || p.platform === "tiktok")).map((p) => {
        const a = (p.analytics ?? {}) as Record<string, unknown>;
        return {
          platform: s(p.platform),
          kind: postKind(p),
          text: s(p.content, 160),
          at: s(p.publishedAt, 40),
          ...(isMediaUrl(p.platformPostUrl) ? { url: p.platformPostUrl } : {}),
          ...(isMediaUrl(p.thumbnailUrl) ? { thumb: p.thumbnailUrl } : {}),
          views: n(a.views),
          likes: n(a.likes),
          comments: n(a.comments),
          shares: n(a.shares),
          saves: n(a.saves),
          follows: n(a.follows),
          reach: n(a.reach),
          sends: n(a.sends),
          profileViews: n(a.profileViews),
          completion: typeof a.completionRate === "number" && a.completionRate > 0 ? a.completionRate : null,
          watchS: typeof a.igReelsAvgWatchTime === "number" && a.igReelsAvgWatchTime > 0 ? Math.round(a.igReelsAvgWatchTime / 100) / 10 : null,
          skip: typeof a.reelsSkipRate === "number" && a.reelsSkipRate > 0 ? a.reelsSkipRate : null,
        };
      })
    : [];
  const comments: CommentLine[] = [];
  if (inbox.ok) {
    const withComments = ((inbox.data as { data?: Record<string, unknown>[] } | null)?.data ?? []).filter((p) => p && (p.platform === "instagram" || p.platform === "tiktok") && n(p.commentCount) > 0).slice(0, 4);
    const threads = await Promise.all(withComments.map((p) => zernio(z, "GET", `/inbox/comments/${encodeURIComponent(s(p.id, 80))}?accountId=${encodeURIComponent(s(p.accountId, 80))}&limit=10`).then((r) => ({ p, r }))));
    for (const { p, r } of threads) {
      if (!r.ok) continue;
      for (const c of ((r.data as { comments?: Record<string, unknown>[] } | null)?.comments ?? []).slice(0, 10)) {
        const from = (c.from ?? {}) as Record<string, unknown>;
        comments.push({ platform: s(p.platform), from: s(from.username ?? from.name, 60), text: s(c.message, 500), at: s(c.createdTime, 40), likes: n(c.likeCount), post: s(p.content, 80) });
      }
    }
    comments.sort((a, b) => b.at.localeCompare(a.at));
  }
  return { profiles, posts: stats, comments: comments.slice(0, 30) };
}

