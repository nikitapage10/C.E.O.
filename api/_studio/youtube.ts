/**
 * The Studio's YouTube Shorts line (#1261): an episode goes to the show's channel through Google's own YouTube Data
 * API, with no third party in between. The grant is the Haven Google client's `youtube` grant (exactly the
 * `youtube.upload` scope, api/_haven/google/oauth.ts), connected once from Boiler Room > Controls > Connections, where
 * Google asks which channel; the refresh token is sealed in the private store and never reaches the browser.
 *
 * Only the Desk's Publish to YouTube calls this (api/_studio/desk.ts, a passkey session: nothing goes up without
 * Nikita's tap). The upload is resumable: one call opens the session with the title, description and status, then the
 * video streams from its https link straight into Google's upload URL. A Short is a 9:16 video up to three minutes;
 * the description carries #Shorts. `containsSyntheticMedia` is set honestly (the show is made with AI). The cover goes
 * up as the thumbnail when YouTube takes one (it needs a verified channel; a refusal is ignored).
 *
 * Until Google audits the API project, YouTube locks uploads from it to private; the answer carries the privacy
 * YouTube actually set, so the Desk can say so. Quota: about 1,600 units an upload and 50 a thumbnail, of 10,000 a day.
 *
 * Nothing here logs a token or the video's link. Underscore folder: Vercel never serves it as a function.
 */

import { accessToken, GrantRefusedError, type HavenClient, type StoredGrant } from "../_haven/google/oauth.js";
import type { HomeVault } from "../_haven/devices/vault.js";

export const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
export const THUMB_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
/** The show's channel (So, They're Eating Your Neighbors): an upload that lands anywhere else is reported, not hidden. */
export const SHOW_CHANNEL = "UCsHQxHpT02BmHHuLaXcYN1g";
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 5_000;
/** A three-minute 1080x1920 render is a few hundred MB; past this something is wrong. */
const VIDEO_MAX = 2 * 1024 ** 3;
const THUMB_MAX = 2 * 1024 ** 2;

export type Privacy = "public" | "private" | "unlisted";

export interface ShortJob {
  video: string;
  cover?: string;
  title: string;
  description: string;
}

export interface YoutubeDeps {
  fetch: typeof fetch;
  client: Pick<HavenClient, "clientId" | "clientSecret"> | null;
  vault: HomeVault | null;
  now: () => number;
}

export type ShortResult =
  | { ok: true; id: string; privacy: Privacy; channel: string; thumbnail: boolean }
  | { ok: false; error: "not-connected" | "refused" | "no-video" | "too-big" | "upload-failed" | "quota" };

/** YouTube's title rules: no angle brackets, at most 100 characters. */
export function cleanTitle(t: string): string {
  return t.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

/** The description: the caption, with #Shorts once, no angle brackets, within YouTube's limit. */
export function shortDescription(caption: string): string {
  const base = caption.replace(/[<>]/g, "").trim();
  const tagged = /#shorts\b/i.test(base) ? base : `${base}\n\n#Shorts`.trim();
  return tagged.slice(0, DESCRIPTION_MAX);
}

/** The metadata a Short opens its upload with: public asked for, not for kids, AI-made said honestly. */
export function videoResource(job: ShortJob) {
  return {
    snippet: { title: cleanTitle(job.title) || "So, They're Eating Your Neighbors", description: shortDescription(job.description), categoryId: "24" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true, embeddable: true },
  };
}

const isHttps = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** Uploads one Short to the connected channel. */
export async function uploadShort(deps: YoutubeDeps, job: ShortJob): Promise<ShortResult> {
  if (!deps.client || !deps.vault) return { ok: false, error: "not-connected" };
  if (!isHttps(job.video) || (job.cover && !isHttps(job.cover))) return { ok: false, error: "no-video" };
  const grant = await deps.vault.read<StoredGrant>("google-youtube").catch(() => null);
  if (!grant || grant.refused) return { ok: false, error: grant?.refused ? "refused" : "not-connected" };
  let token: string;
  try {
    token = await accessToken(deps.fetch, deps.client, "youtube", grant.refresh, deps.now());
  } catch (e) {
    if (e instanceof GrantRefusedError) {
      await deps.vault.write("google-youtube", { ...grant, refused: true }).catch(() => undefined);
      return { ok: false, error: "refused" };
    }
    return { ok: false, error: "upload-failed" };
  }

  const src = await deps.fetch(job.video, { signal: AbortSignal.timeout(60_000), redirect: "follow" }).catch(() => null);
  const size = Number(src?.headers.get("content-length") ?? 0);
  if (!src?.ok || !src.body) return { ok: false, error: "no-video" };
  if (!Number.isFinite(size) || size <= 0 || size > VIDEO_MAX) {
    await src.body.cancel().catch(() => undefined);
    return { ok: false, error: size > VIDEO_MAX ? "too-big" : "no-video" };
  }

  const open = await deps
    .fetch(UPLOAD_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
      body: JSON.stringify(videoResource(job)),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    })
    .catch(() => null);
  const session = open?.headers.get("location") ?? "";
  if (!open?.ok || !session.startsWith("https://www.googleapis.com/")) {
    await src.body.cancel().catch(() => undefined);
    return { ok: false, error: open?.status === 403 && (await quotaHit(open)) ? "quota" : "upload-failed" };
  }

  const put = await deps
    .fetch(session, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(size) },
      body: src.body,
      // Node streams a request body only half-duplex.
      ...({ duplex: "half" } as object),
      signal: AbortSignal.timeout(9 * 60_000),
      redirect: "error",
    } as RequestInit)
    .catch(() => null);
  if (!put?.ok) return { ok: false, error: put?.status === 403 && (await quotaHit(put)) ? "quota" : "upload-failed" };
  const video = (await put.json().catch(() => null)) as { id?: unknown; snippet?: { channelId?: unknown }; status?: { privacyStatus?: unknown } } | null;
  const id = typeof video?.id === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(video.id) ? video.id : "";
  if (!id) return { ok: false, error: "upload-failed" };
  const p = video?.status?.privacyStatus;
  const privacy: Privacy = p === "public" || p === "unlisted" ? p : "private";
  const channel = typeof video?.snippet?.channelId === "string" ? video.snippet.channelId : "";
  const thumbnail = job.cover ? await setThumbnail(deps, token, id, job.cover) : false;
  return { ok: true, id, privacy, channel, thumbnail };
}

async function quotaHit(res: Response): Promise<boolean> {
  const text = await res.text().catch(() => "");
  return /quotaExceeded|dailyLimitExceeded|uploadLimitExceeded/.test(text);
}

/** The cover as the video's thumbnail: best effort (an unverified channel can't set one). */
async function setThumbnail(deps: YoutubeDeps, token: string, id: string, cover: string): Promise<boolean> {
  const img = await deps.fetch(cover, { signal: AbortSignal.timeout(30_000), redirect: "follow" }).catch(() => null);
  if (!img?.ok) return false;
  const type = (img.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (type !== "image/jpeg" && type !== "image/png") return false;
  const bytes = new Uint8Array(await img.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (!bytes.length || bytes.length > THUMB_MAX) return false;
  const res = await deps
    .fetch(`${THUMB_URL}?videoId=${encodeURIComponent(id)}&uploadType=media`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": type }, body: bytes, signal: AbortSignal.timeout(30_000), redirect: "error" })
    .catch(() => null);
  await res?.body?.cancel().catch(() => undefined);
  return Boolean(res?.ok);
}
