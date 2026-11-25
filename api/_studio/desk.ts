/**
 * The Studio desk's data (#1227): the zombie-guide series' ideas, each episode's stages (pitch, voice and mix, render,
 * post) with what Nikita reviews at each, his approvals and notes, and both profiles' numbers from Zernio.
 *
 *   GET  /api/studio-desk                         passkey session: { ideas, episodes, social } (social read live from
 *                                                 Zernio, kept 5 minutes); the read key: { ideas, episodes } only, for
 *                                                 the Director's thread to pick up pitches, approvals and notes.
 *   POST /api/studio-desk { action: "pitch", text }                     passkey session: a new idea.
 *   POST /api/studio-desk { action: "approve", episode, stage }         passkey session: that stage is approved.
 *   POST /api/studio-desk { action: "note", episode?, stage?, text,     passkey session: a note for the Director (typed,
 *                           version?, t?, t2? }                         or said with Space held on the Studio page),
 *                                                                       pinned to a version and a moment (t) or a range
 *                                                                       (t to t2, seconds). It stays a draft (#1229).
 *   POST /api/studio-desk { action: "unnote", id }                      passkey session: drops one of his drafts.
 *   POST /api/studio-desk { action: "send", episode?, stage? }          passkey session: "these are all my notes": his
 *                                                                       drafts there go to the Director as one batch.
 *   POST /api/studio-desk { action: "publish", episode }                passkey session: publishes the episode's own
 *                                                                       Zernio draft (api/_studio/social.ts, its own
 *                                                                       drafts only), a minute out.
 *   PUT  /api/studio-desk { action: "episode", episode }                the feed key: the Director's thread saves an
 *                                                                       episode's state (stages, links, captions).
 *   PUT  /api/studio-desk { action: "idea", id, status }                the feed key: an idea taken up or set aside.
 *   PUT  /api/studio-desk { action: "note-state", id, state, reply? }   the feed key: a sent note fixed, still open or
 *                                                                       won't fix, with a line on what was done.
 *
 * Drafts are his alone: the read key never sees a note until Send notes, so the Director waits for the whole batch.
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
  /** The cover photo posted with the video (the draft carries it too) (#1231). */
  cover?: string;
  /** Where it went live. */
  links?: string[];
  /** Every cut or mix so far, oldest first; `media` is the newest (#1229). */
  versions?: Version[];
  at?: number;
}

export interface Version {
  v: number;
  media: string;
  /** What changed in it, in a few words. */
  label?: string;
  at?: number;
}

export const NOTE_STATES = ["draft", "held", "sent", "fixed", "open", "wontfix"] as const;
export type NoteState = (typeof NOTE_STATES)[number];
const T_MAX = 3_600;

export interface Episode {
  id: string;
  n: number;
  title: string;
  /** Other titles the Director offers for it; the desk's re-roll steps through them (#1233). */
  titles?: string[];
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
  /** The version it's about, and the moment (t) or range (t to t2), in seconds. */
  version?: number;
  t?: number;
  t2?: number;
  /** A draft until Send notes; then the Director marks it. Older notes without one were sent. "held": sent during a
   *  render with "Hold for the next version", and it goes to the Director when that version lands (#1233). */
  state?: NoteState;
  reply?: string;
}

/** Whether a note has left the draft pile. */
export const isSent = (n: Note) => (n.state ?? "sent") !== "draft" && n.state !== "held";

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
  const allowed = ["status", "text", "media", "cover", "stills", "captions", "draft", "links", "versions", "at"];
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
  if (s.cover !== undefined) {
    if (!isMediaUrl(s.cover)) return null;
    out.cover = s.cover;
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
  if (s.versions !== undefined) {
    const vs = readVersions(s.versions);
    if (!vs) return null;
    out.versions = vs;
  }
  if (s.at !== undefined) {
    if (typeof s.at !== "number" || !Number.isFinite(s.at)) return null;
    out.at = s.at;
  }
  return out;
}

function readVersions(v: unknown): Version[] | null {
  if (!Array.isArray(v) || v.length > 30) return null;
  const out: Version[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const r = x as Record<string, unknown>;
    if (!Object.keys(r).every((k) => ["v", "media", "label", "at"].includes(k))) return null;
    if (typeof r.v !== "number" || !Number.isInteger(r.v) || r.v < 1 || r.v > 99 || !isMediaUrl(r.media)) return null;
    if (r.label !== undefined && !isText(r.label, 120)) return null;
    if (r.at !== undefined && (typeof r.at !== "number" || !Number.isFinite(r.at))) return null;
    out.push({ v: r.v, media: r.media, ...(r.label ? { label: r.label as string } : {}), ...(typeof r.at === "number" ? { at: r.at } : {}) });
  }
  return new Set(out.map((x) => x.v)).size === out.length ? out : null;
}

/** Whether a save brings a new version of any stage, or a stage that was working is done (held notes go then, #1233). */
export function landedNew(old: Episode, next: Episode): boolean {
  return STAGES.some((k) => {
    const a = old.stages[k];
    const b = next.stages[k];
    if (!b) return false;
    if ((b.versions?.length ?? 0) > (a?.versions?.length ?? 0)) return true;
    return a?.status === "working" && b.status !== "working";
  });
}

const isT = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= T_MAX;

/** An episode as the thread sends it, or null. */
export function readEpisode(v: unknown): Episode | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  if (!Object.keys(e).every((k) => ["id", "n", "title", "titles", "stages"].includes(k))) return null;
  if (e.titles !== undefined && (!Array.isArray(e.titles) || e.titles.length > 12 || !e.titles.every((t) => isText(t, 200)))) return null;
  if (typeof e.id !== "string" || !ID.test(e.id) || typeof e.n !== "number" || !Number.isInteger(e.n) || e.n < 0 || e.n > 999 || !isText(e.title, 200)) return null;
  if (!e.stages || typeof e.stages !== "object" || Array.isArray(e.stages)) return null;
  const stages: Partial<Record<Stage, StageState>> = {};
  for (const [k, s] of Object.entries(e.stages as Record<string, unknown>)) {
    if (!isStage(k)) return null;
    const got = readStage(s);
    if (!got) return null;
    stages[k] = got;
  }
  return { id: e.id, n: e.n, title: e.title, ...(Array.isArray(e.titles) ? { titles: e.titles as string[] } : {}), stages };
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
    return json({ ideas: st.ideas, episodes: st.episodes, notes: st.notes.filter(isSent).slice(-120), approvals: st.approvals.slice(-60) });
  }
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const [st, social] = await Promise.all([readState(deps.blob), socialFor(deps)]);
  return withCookie(json({ ideas: st.ideas, episodes: st.episodes, notes: st.notes.slice(-200), approvals: st.approvals.slice(-60), social }), signed);
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
    if (b.version !== undefined && (typeof b.version !== "number" || !Number.isInteger(b.version) || b.version < 1 || b.version > 99)) return reply({ error: "bad-request" }, 400);
    if ((b.t !== undefined && !isT(b.t)) || (b.t2 !== undefined && (!isT(b.t2) || !isT(b.t) || b.t2 <= b.t))) return reply({ error: "bad-request" }, 400);
    const round = (x: number) => Math.round(x * 10) / 10;
    const note: Note = {
      id: newId(now),
      at: now,
      text: b.text.trim(),
      via: b.via === "said" ? "said" : "typed",
      state: "draft",
      ...(b.episode ? { episode: b.episode as string } : {}),
      ...(b.stage ? { stage: b.stage as Stage } : {}),
      ...(typeof b.version === "number" ? { version: b.version } : {}),
      ...(isT(b.t) ? { t: round(b.t) } : {}),
      ...(isT(b.t2) ? { t2: round(b.t2) } : {}),
    };
    await change(blob, (st) => ({ ...st, notes: [...st.notes, note].slice(-400) }));
    console.log("studio: a draft note was left for the Director");
    return reply({ ok: true, note });
  }
  if (b.action === "unnote") {
    const id = b.id;
    if (typeof id !== "string" || id.length > 40) return reply({ error: "bad-request" }, 400);
    const next = await change(blob, (st) => (st.notes.some((n) => n.id === id && n.state === "draft") ? { ...st, notes: st.notes.filter((n) => n.id !== id) } : null));
    return next ? reply({ ok: true }) : reply({ error: "gone" }, 404);
  }
  if (b.action === "send") {
    if (b.episode !== undefined && (typeof b.episode !== "string" || !ID.test(b.episode))) return reply({ error: "bad-request" }, 400);
    if (b.stage !== undefined && !isStage(b.stage)) return reply({ error: "bad-request" }, 400);
    if (b.hold !== undefined && typeof b.hold !== "boolean") return reply({ error: "bad-request" }, 400);
    const mine = (n: Note) => n.state === "draft" && (b.episode === undefined || n.episode === b.episode) && (b.stage === undefined || n.stage === b.stage);
    // Held for the next version (#1233): they wait, and go to the Director when the cut being rendered lands.
    const to: NoteState = b.hold === true ? "held" : "sent";
    let sent = 0;
    await change(blob, (st) => {
      sent = st.notes.filter(mine).length;
      return sent ? { ...st, notes: st.notes.map((n) => (mine(n) ? { ...n, state: to } : n)) } : null;
    });
    if (!sent) return reply({ error: "no-drafts" }, 409);
    console.log(`studio: ${sent} note(s) ${to === "held" ? "held for the next version" : "sent to the Director"}`);
    return reply({ ok: true, sent, ...(to === "held" ? { held: true } : {}) });
  }
  if (b.action === "title") {
    // His own title for an episode, typed or re-rolled from the Director's alternatives (#1233).
    if (typeof b.episode !== "string" || !ID.test(b.episode) || !isText(b.title, 200)) return reply({ error: "bad-request" }, 400);
    const ep = b.episode;
    const title = (b.title as string).trim();
    const next = await change(blob, (st) => (st.episodes.some((x) => x.id === ep) ? { ...st, episodes: st.episodes.map((x) => (x.id === ep ? { ...x, title } : x)) } : null));
    if (!next) return reply({ error: "gone" }, 404);
    console.log("studio: an episode was retitled");
    return reply({ ok: true });
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
    let released = 0;
    await change(deps.blob, (st) => {
      const old = st.episodes.find((x) => x.id === e.id);
      const landed = !!old && landedNew(old, e);
      const notes = landed ? st.notes.map((n) => (n.state === "held" && n.episode === e.id ? (released++, { ...n, state: "sent" as NoteState }) : n)) : st.notes;
      return { ...st, notes, episodes: [...st.episodes.filter((x) => x.id !== e.id), e].sort((x, y) => x.n - y.n).slice(-60) };
    });
    return json({ ok: true, stages: Object.keys(e.stages).length, ...(released ? { released } : {}) });
  }
  if (b.action === "idea") {
    const id = b.id;
    const status = b.status;
    if (typeof id !== "string" || id.length > 40 || (status !== "taken" && status !== "set-aside" && status !== "new")) return json({ error: "bad-request" }, 400);
    const next = await change(deps.blob, (st) => (st.ideas.some((i) => i.id === id) ? { ...st, ideas: st.ideas.map((i) => (i.id === id ? { ...i, status } : i)) } : null));
    return next ? json({ ok: true }) : json({ error: "gone" }, 404);
  }
  if (b.action === "note-state") {
    const id = b.id;
    const state = b.state;
    if (typeof id !== "string" || id.length > 40 || (state !== "fixed" && state !== "open" && state !== "wontfix")) return json({ error: "bad-request" }, 400);
    if (b.reply !== undefined && !isText(b.reply, 600)) return json({ error: "bad-request" }, 400);
    const next = await change(deps.blob, (st) =>
      st.notes.some((n) => n.id === id && isSent(n)) ? { ...st, notes: st.notes.map((n) => (n.id === id ? { ...n, state, ...(b.reply ? { reply: (b.reply as string).trim() } : {}) } : n)) } : null,
    );
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
