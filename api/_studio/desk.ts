/**
 * The Studio desk's data (#1227): the zombie-guide series' ideas, each episode's stages (pitch, voice and mix, render,
 * post) with what Nikita reviews at each, his approvals and notes, and both profiles' numbers from Zernio.
 *
 *   GET  /api/studio-desk                         passkey session: { ideas, episodes, social } (social read live from
 *                                                 Zernio, kept 5 minutes); the read key: { ideas, episodes } only, for
 *                                                 the Director's thread to pick up pitches, approvals and notes.
 *   POST /api/studio-desk { action: "pitch", text }                     passkey session: a new idea.
 *   POST /api/studio-desk { action: "approve", episode, stage }         passkey session: that stage is approved.
 *   POST /api/studio-desk { action: "note", episode?, stage?, text }    passkey session: a note for the Director (typed,
 *                                                                       or said with Space held on the Studio page).
 *   POST /api/studio-desk { action: "publish", episode }                passkey session: publishes the episode's own
 *                                                                       Zernio draft (api/_studio/social.ts, its own
 *                                                                       drafts only), a minute out.
 *   PUT  /api/studio-desk { action: "episode", episode }                the feed key: the Director's thread saves an
 *                                                                       episode's state (stages, links, captions).
 *   PUT  /api/studio-desk { action: "idea", id, status }                the feed key: an idea taken up or set aside.
 *
 * What's kept: the series' working state in the private blob store (`studio/desk.json`), never personal data. Links
 * are https only (the review cut, stills and mix sit in Zernio's media store under unguessable names, the same place
 * a post's video goes). Comments are public on the platforms already and are read only for the signed-in Desk.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { readJson, updateJson } from "../_haven/json.js";
import { roomKeyOf, STUDIO_DESK_PATH } from "../_site/roomkeys.js";
import { isMediaUrl, publishDraft, type ZernioDeps } from "./social.js";
import { readSocial, type Social } from "./stats.js";

export { readSocial };
export type { CommentLine, PostStat, Profile, Social } from "./stats.js";

export { STUDIO_DESK_PATH };
const FILE = "studio/desk.json";
const CACHE = "studio/social-cache.json";
const CACHE_MS = 5 * 60_000;
const BODY_MAX = 64_000;
export const STAGES = ["pitch", "mix", "render", "post"] as const;
export type Stage = (typeof STAGES)[number];
export const STATUSES = ["waiting", "working", "ready", "changes", "approved", "done"] as const;
export type Status = (typeof STATUSES)[number];
const ID = /^[a-z0-9-]{1,40}$/;
const TEXT_MAX = 2_000;
const SCRIPT_MAX = 12_000;

export interface StageState {
  status: Status;
  /** What Nikita reads at this stage: the pitch, or the script. */
  text?: string;
  /** The mix (audio) or the review cut (video). */
  media?: string;
  /** Stills from the cut, or style frames with the pitch. */
  stills?: string[];
  /** Caption options, offered with the review cut. */
  captions?: string[];
  /** The Zernio draft the post stage publishes. */
  draft?: string;
  /** Where it went live. */
  links?: string[];
  at?: number;
}

export interface Episode {
  id: string;
  n: number;
  title: string;
  stages: Partial<Record<Stage, StageState>>;
}

export interface Note {
  id: string;
  at: number;
  text: string;
  episode?: string;
  stage?: Stage;
  /** "said" when it came from the room mic, "typed" from the box. */
  via: "said" | "typed";
}

export interface Idea {
  id: string;
  at: number;
  text: string;
  status: "new" | "taken" | "set-aside";
}

export interface Approval {
  at: number;
  episode: string;
  stage: Stage;
}

export interface DeskState {
  ideas: Idea[];
  episodes: Episode[];
  notes: Note[];
  approvals: Approval[];
}

const EMPTY: DeskState = { ideas: [], episodes: [], notes: [], approvals: [] };

export interface StudioDeskDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  env: Record<string, string | undefined>;
  zernio: ZernioDeps;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);
const newId = (now: number) => `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** One stage's state as the thread sends it, or null when it doesn't fit exactly. */
export function readStage(v: unknown): StageState | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  const allowed = ["status", "text", "media", "stills", "captions", "draft", "links", "at"];
  if (!Object.keys(s).every((k) => allowed.includes(k))) return null;
  if (typeof s.status !== "string" || !(STATUSES as readonly string[]).includes(s.status)) return null;
  const out: StageState = { status: s.status as Status };
  if (s.text !== undefined) {
    if (!isText(s.text, SCRIPT_MAX)) return null;
    out.text = s.text;
  }
  if (s.media !== undefined) {
    if (!isMediaUrl(s.media)) return null;
    out.media = s.media;
  }
  for (const k of ["stills", "links"] as const) {
    const list = s[k];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > 16 || !list.every(isMediaUrl)) return null;
    out[k] = list as string[];
  }
  if (s.captions !== undefined) {
    if (!Array.isArray(s.captions) || s.captions.length > 6 || !s.captions.every((c) => isText(c, 2_200))) return null;
    out.captions = s.captions as string[];
  }
  if (s.draft !== undefined) {
    if (typeof s.draft !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(s.draft)) return null;
    out.draft = s.draft;
  }
  if (s.at !== undefined) {
    if (typeof s.at !== "number" || !Number.isFinite(s.at)) return null;
    out.at = s.at;
  }
  return out;
}

/** An episode as the thread sends it, or null. */
export function readEpisode(v: unknown): Episode | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  if (!Object.keys(e).every((k) => ["id", "n", "title", "stages"].includes(k))) return null;
  if (typeof e.id !== "string" || !ID.test(e.id) || typeof e.n !== "number" || !Number.isInteger(e.n) || e.n < 0 || e.n > 999 || !isText(e.title, 200)) return null;
  if (!e.stages || typeof e.stages !== "object" || Array.isArray(e.stages)) return null;
  const stages: Partial<Record<Stage, StageState>> = {};
  for (const [k, s] of Object.entries(e.stages as Record<string, unknown>)) {
    if (!isStage(k)) return null;
    const got = readStage(s);
    if (!got) return null;
    stages[k] = got;
  }
  return { id: e.id, n: e.n, title: e.title, stages };
}

async function readState(blob: BlobBackend): Promise<DeskState> {
  const got = await readJson<DeskState>(blob, FILE, EMPTY);
  return { ...EMPTY, ...(got && typeof got === "object" ? got : {}) };
}

const change = (blob: BlobBackend, fn: (s: DeskState) => DeskState | null) =>
  updateJson<DeskState, DeskState | null>(blob, FILE, EMPTY, (cur) => {
    const next = fn({ ...EMPTY, ...(cur && typeof cur === "object" ? cur : {}) });
    return { next, result: next };
  });

async function socialFor(deps: StudioDeskDeps): Promise<Social | null> {
  if (!deps.zernio.key || !deps.blob) return null;
  const now = deps.zernio.now;
  const cached = await readJson<Social | null>(deps.blob, CACHE, null).catch(() => null);
  if (cached && typeof cached.at === "number" && now - cached.at < CACHE_MS) return cached;
  const fresh = await readSocial(deps.zernio).catch(() => null);
  if (!fresh) return cached ?? null;
  const out: Social = { at: now, ...fresh };
  await deps.blob.put(CACHE, JSON.stringify(out), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true }).catch(() => undefined);
  return out;
}

// ---------- the routes ----------

/** GET /api/studio-desk. */
export async function deskGet(request: Request, deps: StudioDeskDeps): Promise<Response> {
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  if (roomKeyOf(request, deps.env) === "log") {
    const st = await readState(deps.blob);
    return json({ ideas: st.ideas, episodes: st.episodes, notes: st.notes.slice(-60), approvals: st.approvals.slice(-60) });
  }
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const [st, social] = await Promise.all([readState(deps.blob), socialFor(deps)]);
  return withCookie(json({ ideas: st.ideas, episodes: st.episodes, notes: st.notes.slice(-60), approvals: st.approvals.slice(-60), social }), signed);
}

/** POST /api/studio-desk: the signed-in Desk. */
export async function deskPost(request: Request, deps: StudioDeskDeps): Promise<Response> {
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (!deps.blob) return reply({ error: "not-set-up" }, 503);
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return reply({ error: "too-big" }, 413);
  let b: Record<string, unknown>;
  try {
    const got: unknown = JSON.parse(raw);
    b = got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : {};
  } catch {
    return reply({ error: "bad-request" }, 400);
  }
  const now = deps.desk.now;
  const blob = deps.blob;

  if (b.action === "pitch") {
    if (!isText(b.text, TEXT_MAX)) return reply({ error: "bad-request" }, 400);
    const idea: Idea = { id: newId(now), at: now, text: b.text.trim(), status: "new" };
    await change(blob, (st) => ({ ...st, ideas: [...st.ideas, idea].slice(-100) }));
    console.log("studio: a new idea was pitched");
    return reply({ ok: true, idea });
  }
  if (b.action === "note") {
    if (!isText(b.text, TEXT_MAX)) return reply({ error: "bad-request" }, 400);
    if (b.episode !== undefined && (typeof b.episode !== "string" || !ID.test(b.episode))) return reply({ error: "bad-request" }, 400);
    if (b.stage !== undefined && !isStage(b.stage)) return reply({ error: "bad-request" }, 400);
    const note: Note = { id: newId(now), at: now, text: b.text.trim(), via: b.via === "said" ? "said" : "typed", ...(b.episode ? { episode: b.episode as string } : {}), ...(b.stage ? { stage: b.stage as Stage } : {}) };
    await change(blob, (st) => ({ ...st, notes: [...st.notes, note].slice(-200) }));
    console.log("studio: a note was left for the Director");
    return reply({ ok: true, note });
  }
  if (b.action === "approve") {
    if (typeof b.episode !== "string" || !ID.test(b.episode) || !isStage(b.stage)) return reply({ error: "bad-request" }, 400);
    const ep = b.episode;
    const stage = b.stage;
    const next = await change(blob, (st) => {
      const e = st.episodes.find((x) => x.id === ep);
      const cur = e?.stages[stage];
      if (!e || !cur || cur.status !== "ready") return null;
      return { ...st, episodes: st.episodes.map((x) => (x.id === ep ? { ...x, stages: { ...x.stages, [stage]: { ...cur, status: "approved", at: now } } } : x)), approvals: [...st.approvals, { at: now, episode: ep, stage }].slice(-200) };
    });
    if (!next) return reply({ error: "not-ready" }, 409);
    console.log(`studio: the ${stage} stage was approved`);
    return reply({ ok: true });
  }
  if (b.action === "publish") {
    if (typeof b.episode !== "string" || !ID.test(b.episode)) return reply({ error: "bad-request" }, 400);
    const st = await readState(blob);
    const e = st.episodes.find((x) => x.id === b.episode);
    const post = e?.stages.post;
    if (!e || !post?.draft || post.status !== "ready") return reply({ error: "not-ready" }, 409);
    if (!deps.zernio.key) return reply({ error: "not-set-up" }, 503);
    const got = await publishDraft(deps.zernio, post.draft);
    if (!got.ok) return reply({ error: got.error }, got.status);
    const ep = e.id;
    await change(blob, (cur) => ({ ...cur, episodes: cur.episodes.map((x) => (x.id === ep && x.stages.post ? { ...x, stages: { ...x.stages, post: { ...x.stages.post, status: "approved", at: now } } } : x)), approvals: [...cur.approvals, { at: now, episode: ep, stage: "post" as Stage }].slice(-200) }));
    console.log("studio: an episode was published from the Desk");
    return reply({ ok: true, at: got.at });
  }
  return reply({ error: "bad-request" }, 400);
}

/** PUT /api/studio-desk: the feed key only. */
export async function deskPut(request: Request, deps: StudioDeskDeps): Promise<Response> {
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return json({ error: "too-big" }, 413);
  let b: Record<string, unknown>;
  try {
    const got: unknown = JSON.parse(raw);
    b = got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : {};
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  if (b.action === "episode") {
    const e = readEpisode(b.episode);
    if (!e) return json({ error: "bad-episode" }, 400);
    await change(deps.blob, (st) => ({ ...st, episodes: [...st.episodes.filter((x) => x.id !== e.id), e].sort((x, y) => x.n - y.n).slice(-60) }));
    return json({ ok: true, stages: Object.keys(e.stages).length });
  }
  if (b.action === "idea") {
    const id = b.id;
    const status = b.status;
    if (typeof id !== "string" || id.length > 40 || (status !== "taken" && status !== "set-aside" && status !== "new")) return json({ error: "bad-request" }, 400);
    const next = await change(deps.blob, (st) => (st.ideas.some((i) => i.id === id) ? { ...st, ideas: st.ideas.map((i) => (i.id === id ? { ...i, status } : i)) } : null));
    return next ? json({ ok: true }) : json({ error: "gone" }, 404);
  }
  return json({ error: "bad-request" }, 400);
}

function liveDeps(): StudioDeskDeps {
  const env = process.env;
  const now = Date.now();
  return { desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now }, blob: pickBlob(env), env, zernio: { key: env.ZERNIO_API_KEY?.trim() ?? "", now } };
}

export const GET = (request: Request) => deskGet(request, liveDeps());
export const POST = (request: Request) => deskPost(request, liveDeps());
export const PUT = (request: Request) => deskPut(request, liveDeps());
