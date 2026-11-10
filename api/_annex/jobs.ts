/**
 * The Annex's Job search (#1000): Google Jobs through SerpApi (engine `google_jobs`), run on a light daily schedule and
 * on demand, merged into one private record the Desk reads. Azure only (azure/src/index.ts).
 *
 * Private by design. A job search is nobody's business but Nikita's, so every read and write takes a Desk (passkey)
 * session, the record lives in the private store (desk/annex/jobs.json), and the search itself (titles, places, the pay
 * floor, the avoid list, the resume) is typed on the Desk, never written in the repo. Logs carry counts only.
 *
 * Light on quota. SerpApi counts every search against a monthly plan, so: one scheduled run a day at most, a run is one
 * search per saved query, rotating through up to MAX_SEARCHES of them PER_RUN at a time, a hand run waits MANUAL_GAP_MS after the last, and nothing runs once
 * this month's searches reach the budget (JOBS_MONTHLY_SEARCHES, default 240). SerpApi's own account page (free, not
 * counted) is read after each run so the Desk shows the plan's real searches left. No Claude call anywhere: matches
 * are scored with plain rules against the profile and the resume's words.
 *
 * GET  /api/annex-jobs                      → JobsView (Desk session)
 * POST /api/annex-jobs { action: "run" }    run the saved searches now
 *                      { action: "mark", id, state }        new, saved, applied or dismissed
 *                      { action: "profile", profile }       the searches, pay floor, companies, prefer and avoid words
 *                      { action: "resume", text }           the resume as plain text ("" removes it)
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";

export const JOBS_PATH = "/api/annex-jobs";
export const JOBS_STORE = "desk/annex/jobs.json";
export const RESUME_STORE = "desk/annex/jobs-resume.json";
export const SERP_URL = "https://serpapi.com/search.json";
export const SERP_ACCOUNT_URL = "https://serpapi.com/account.json";

/** At most this many saved searches, so one run is at most this many SerpApi searches. */
export const MAX_SEARCHES = 16;
/** Searches in one run: a longer list is worked through in turns, PER_RUN a day, so each search comes round every few days. */
export const PER_RUN = 7;
/** Jobs kept at most; the oldest unsaved ones go first. */
export const MAX_JOBS = 300;
/** A job not seen again and not saved or applied to drops off after this long. */
export const STALE_MS = 21 * 86_400_000;
/** A scheduled run waits this long after the last scheduled one (the timer fires once a day; this guards a double fire). */
export const SCHEDULE_GAP_MS = 20 * 3_600_000;
/** A hand run waits this long after the last run of any kind. */
export const MANUAL_GAP_MS = 30 * 60_000;
export const DEFAULT_MONTHLY = 240;
export const MAX_RESUME = 20_000;

export const JOB_STATES = ["new", "saved", "applied", "dismissed"] as const;
export type JobState = (typeof JOB_STATES)[number];

export interface JobSearch {
  /** What to search, e.g. a job title. */
  q: string;
  /** A place Google knows ("Denver, Colorado, United States"); empty searches anywhere. */
  location: string;
  /** Work from home only. */
  remote: boolean;
}

export interface JobsProfile {
  searches: JobSearch[];
  /** Hide a job whose listed yearly pay tops out below this; null shows all. Jobs with no pay listed always show. */
  minSalary: number | null;
  /** Words that lift a job (seniority, skills, kinds of company). */
  prefer: string[];
  /** Words that hide a job when in its title or company (whole words, so "meta" never hides "metadata"). */
  avoid: string[];
  /** Companies to lift to the top (whole words in the company's name). */
  companies: string[];
  /** Whether the daily run is on. */
  daily: boolean;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  via: string;
  posted: string | null;
  remote: boolean;
  schedule: string | null;
  salary: string | null;
  /** Yearly pay range, parsed from the listing; null when none is listed. */
  payMin: number | null;
  payMax: number | null;
  link: string | null;
  apply: { title: string; link: string }[];
  snippet: string;
  highlights: string[];
  /** Which saved search found it first. */
  search: string;
  score: number;
  why: string[];
  hidden: string | null;
  firstSeen: string;
  lastSeen: string;
  state: JobState;
  stateAt: string | null;
}

export interface JobRun {
  at: string;
  by: "schedule" | "hand";
  searches: number;
  found: number;
  added: number;
  error: string | null;
}

export interface JobsAccount {
  /** The plan's searches a month and what is left of them, from SerpApi's account page. */
  perMonth: number | null;
  left: number | null;
  at: string;
}

export interface JobsState {
  profile: JobsProfile;
  jobs: Job[];
  runs: JobRun[];
  /** This month (UTC, YYYY-MM) and how many searches the runs used in it. */
  month: string;
  used: number;
  /** Where the next run starts in the saved searches (they rotate when there are more than PER_RUN). */
  cursor: number;
  account: JobsAccount | null;
}

export interface JobsView extends JobsState {
  configured: boolean;
  budget: number;
  hasResume: boolean;
  nextRun: string | null;
}

export const defaultProfile = (): JobsProfile => ({ searches: [], minSalary: null, prefer: [], avoid: [], companies: [], daily: true });
export const defaultJobs = (): JobsState => ({ profile: defaultProfile(), jobs: [], runs: [], month: "", used: 0, cursor: 0, account: null });

/* ── Reading things defensively ── */

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const words = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((w) => str(w, 60).toLowerCase()).filter(Boolean))].slice(0, 40)
    : typeof v === "string"
      ? words(v.split(/[,\n]/))
      : [];
const httpsLink = (v: unknown): string | null => {
  const s = str(v, 2000);
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
};

export function cleanProfile(raw: unknown): JobsProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof JobsProfile, unknown>>;
  const searches = (Array.isArray(r.searches) ? r.searches : [])
    .map((s) => {
      const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return { q: str(o.q, 120), location: str(o.location, 120), remote: o.remote === true };
    })
    .filter((s) => s.q)
    .slice(0, MAX_SEARCHES);
  const n = typeof r.minSalary === "number" ? r.minSalary : typeof r.minSalary === "string" ? Number(r.minSalary.replace(/[^\d.]/g, "")) : NaN;
  return { searches, minSalary: Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 5_000_000) : null, prefer: words(r.prefer), avoid: words(r.avoid), companies: words(r.companies), daily: r.daily !== false };
}

const isState = (v: unknown): v is JobState => (JOB_STATES as readonly unknown[]).includes(v);

export function readJobs(raw: unknown): JobsState {
  const s = defaultJobs();
  const r = raw as Partial<JobsState> | null;
  if (!r || typeof r !== "object") return s;
  s.profile = cleanProfile(r.profile);
  s.jobs = Array.isArray(r.jobs) ? r.jobs.filter((j): j is Job => !!j && typeof j === "object" && typeof (j as Job).id === "string" && isState((j as Job).state)).slice(0, MAX_JOBS) : [];
  s.runs = Array.isArray(r.runs) ? r.runs.slice(0, 30) : [];
  s.month = typeof r.month === "string" ? r.month.slice(0, 7) : "";
  s.used = typeof r.used === "number" && r.used >= 0 ? r.used : 0;
  s.cursor = typeof r.cursor === "number" && Number.isInteger(r.cursor) && r.cursor >= 0 ? r.cursor : 0;
  s.account = r.account && typeof r.account === "object" ? r.account : null;
  return s;
}

/* ── Pay ── */

const HOURS_A_YEAR = 2080;

/** "$150K–$200K a year", "150,000–180,000 a year", "45–60 an hour" → a yearly range; null when there is no number. */
export function parsePay(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, "");
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*([km])?/g)].map((m) => Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1)).filter((n) => n > 0);
  if (!nums.length) return null;
  const per = /hour|hr\b/.test(t) ? HOURS_A_YEAR : /month/.test(t) ? 12 : /week/.test(t) ? 52 : /day/.test(t) ? 260 : 1;
  const yearly = nums.slice(0, 2).map((n) => Math.round(n * per));
  return { min: Math.min(...yearly), max: Math.max(...yearly) };
}

/* ── One SerpApi answer → jobs ── */

interface SerpJob {
  job_id?: unknown;
  title?: unknown;
  company_name?: unknown;
  location?: unknown;
  via?: unknown;
  share_link?: unknown;
  description?: unknown;
  extensions?: unknown;
  detected_extensions?: Record<string, unknown>;
  job_highlights?: { title?: unknown; items?: unknown }[];
  apply_options?: { title?: unknown; link?: unknown }[];
}

export function normaliseJob(raw: SerpJob, search: string, nowIso: string): Job | null {
  const title = str(raw.title, 160);
  const company = str(raw.company_name, 120);
  if (!title || !company) return null;
  // SerpApi's job_id is a long opaque string; the same posting keeps it across searches.
  const id = str(raw.job_id, 600) || `${title}|${company}|${str(raw.location, 120)}`.toLowerCase();
  const de = raw.detected_extensions ?? {};
  const ext = Array.isArray(raw.extensions) ? raw.extensions.map((e) => str(e, 80)) : [];
  const salary = str(de.salary, 80) || ext.find((e) => /\$|a year|an hour|per hour|k\b/i.test(e) && /\d/.test(e)) || null;
  const pay = parsePay(salary);
  const remote = de.work_from_home === true || ext.some((e) => /work from home|remote/i.test(e)) || /remote|anywhere/i.test(str(raw.location, 120));
  const apply = (Array.isArray(raw.apply_options) ? raw.apply_options : [])
    .map((a) => ({ title: str(a?.title, 60), link: httpsLink(a?.link) }))
    .filter((a): a is { title: string; link: string } => !!a.title && !!a.link)
    .slice(0, 4);
  const highlights = (Array.isArray(raw.job_highlights) ? raw.job_highlights : [])
    .flatMap((h) => (Array.isArray(h?.items) ? h.items.map((i) => str(i, 200)) : []))
    .filter(Boolean)
    .slice(0, 6);
  return {
    id,
    title,
    company,
    location: str(raw.location, 120),
    via: str(raw.via, 80).replace(/^via\s+/i, ""),
    posted: str(de.posted_at, 40) || null,
    remote,
    schedule: str(de.schedule_type, 40) || null,
    salary,
    payMin: pay?.min ?? null,
    payMax: pay?.max ?? null,
    link: apply[0]?.link ?? httpsLink(raw.share_link),
    apply,
    snippet: str(raw.description, 700),
    highlights,
    search,
    score: 0,
    why: [],
    hidden: null,
    firstSeen: nowIso,
    lastSeen: nowIso,
    state: "new",
    stateAt: null,
  };
}

/* ── Scoring: plain rules, no model ── */

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|group|director|head of)\b/i;
const JUNIOR = /\b(junior|jr\.?|associate|intern|entry[- ]level|apprentice)\b/i;
const STOP = new Set("a an and are as at be by for from has have in is it of on or our that the this to was we were will with you your".split(" "));

/** The resume's distinct words of four letters or more, for overlap with a job's text. */
export function resumeWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z+#.-]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether a word or phrase is in the text as a whole word, any case ("ai" is in "AI platform", not in "maintain"). */
export function hasWord(text: string, w: string): boolean {
  return w ? new RegExp(`(^|[^a-z0-9])${escape(w.toLowerCase())}($|[^a-z0-9])`).test(text.toLowerCase()) : false;
}

export function scoreJob(job: Job, profile: JobsProfile, resume: Set<string>): Job {
  const why: string[] = [];
  let score = 40;
  const hay = `${job.title} ${job.company} ${job.snippet} ${job.highlights.join(" ")}`.toLowerCase();
  const titleL = job.title.toLowerCase();
  const avoid = profile.avoid.find((w) => hasWord(`${job.title} ${job.company}`, w));
  const lift = (n: number, w: string) => {
    score += n;
    why.push(w);
  };
  if (SENIOR.test(job.title)) lift(12, "senior level");
  if (JUNIOR.test(job.title)) lift(-20, "junior level");
  const fav = profile.companies.find((w) => hasWord(job.company, w));
  if (fav) lift(18, "on your company list");
  const pref = profile.prefer.filter((w) => hasWord(hay, w));
  if (pref.length) lift(Math.min(24, pref.length * 8), `mentions ${pref.slice(0, 3).join(", ")}`);
  if (profile.searches.some((s) => s.q && titleL.includes(s.q.toLowerCase()))) lift(10, "title matches a search");
  if (job.remote) lift(6, "remote");
  let hidden: string | null = avoid ? `has "${avoid}"` : null;
  if (profile.minSalary && job.payMax !== null) {
    if (job.payMax < profile.minSalary) hidden ??= "pay under your floor";
    else lift(10, "pay clears your floor");
  }
  if (resume.size) {
    const jw = resumeWords(hay);
    let hit = 0;
    for (const w of jw) if (resume.has(w)) hit++;
    const share = jw.size ? hit / jw.size : 0;
    const add = Math.round(Math.min(1, share / 0.35) * 18);
    if (add >= 6) why.push("fits your resume");
    score += add;
  }
  return { ...job, score: Math.max(0, Math.min(100, score)), why: why.slice(0, 4), hidden };
}

/* ── The store ── */

export interface JobsStore {
  read(): Promise<JobsState>;
  write(state: JobsState): Promise<void>;
  readResume(): Promise<string>;
  writeResume(text: string): Promise<void>;
}

const JSON_PUT = { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 } as const;

export class BlobJobsStore implements JobsStore {
  constructor(private readonly blob: BlobBackend) {}
  private async json(path: string): Promise<unknown> {
    const found = await this.blob.get(path);
    return found ? await new Response(found.stream).json().catch(() => null) : null;
  }
  async read() {
    return readJobs(await this.json(JOBS_STORE));
  }
  async write(state: JobsState) {
    await this.blob.put(JOBS_STORE, JSON.stringify(state), JSON_PUT);
  }
  async readResume() {
    const r = (await this.json(RESUME_STORE)) as { text?: unknown } | null;
    return typeof r?.text === "string" ? r.text : "";
  }
  async writeResume(text: string) {
    if (text) await this.blob.put(RESUME_STORE, JSON.stringify({ text }), JSON_PUT);
    else await this.blob.del(RESUME_STORE).catch(() => undefined);
  }
}

export class MemoryJobsStore implements JobsStore {
  state = defaultJobs();
  resume = "";
  async read() {
    return readJobs(JSON.parse(JSON.stringify(this.state)));
  }
  async write(state: JobsState) {
    this.state = readJobs(JSON.parse(JSON.stringify(state)));
  }
  async readResume() {
    return this.resume;
  }
  async writeResume(text: string) {
    this.resume = text;
  }
}

const memory = new MemoryJobsStore();
export function pickJobsStore(env: Record<string, string | undefined> = process.env): JobsStore {
  const blob = pickBlob(env);
  return blob ? new BlobJobsStore(blob) : memory;
}

/* ── Running the searches ── */

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface JobsDeps {
  store: JobsStore;
  fetcher: Fetcher;
  /** SerpApi's private key (SERPAPI_KEY); empty while it isn't set. */
  key: string;
  /** This month's search budget. */
  budget: number;
  now: number;
}

export function budgetOf(env: Record<string, string | undefined>): number {
  const n = Number(env.JOBS_MONTHLY_SEARCHES);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MONTHLY;
}

export function searchUrl(s: JobSearch, key: string): string {
  const p = new URLSearchParams({ engine: "google_jobs", q: s.q, hl: "en", gl: "us", google_domain: "google.com", api_key: key });
  if (s.location) p.set("location", s.location);
  if (s.remote) p.set("ltype", "1");
  return `${SERP_URL}?${p}`;
}

const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);

/** This month's count, reset when the month turns. */
function rollMonth(state: JobsState, now: number): void {
  const m = monthOf(now);
  if (state.month !== m) {
    state.month = m;
    state.used = 0;
  }
}

/** Every job scored again against the profile and resume, best first, the stale ones dropped, and capped. */
export function tidy(jobs: Job[], profile: JobsProfile, resume: Set<string>, now: number): Job[] {
  const kept = jobs.filter((j) => j.state === "saved" || j.state === "applied" || now - Date.parse(j.lastSeen) < STALE_MS);
  const scored = kept.map((j) => scoreJob(j, profile, resume));
  scored.sort((a, b) => (a.state === "dismissed" ? 1 : 0) - (b.state === "dismissed" ? 1 : 0) || b.score - a.score || b.lastSeen.localeCompare(a.lastSeen));
  const keep = scored.filter((j) => j.state === "saved" || j.state === "applied");
  const rest = scored.filter((j) => j.state !== "saved" && j.state !== "applied");
  return [...keep, ...rest].slice(0, Math.max(MAX_JOBS, keep.length));
}

/** The next run's searches: PER_RUN of them from the cursor, wrapping round the list. */
export function batchOf<T>(searches: T[], cursor: number): T[] {
  const n = searches.length;
  if (n <= PER_RUN) return searches;
  return Array.from({ length: PER_RUN }, (_, i) => searches[(cursor + i) % n]!);
}

export type RunResult = "ran" | "no-key" | "no-searches" | "budget" | "not-due" | "off" | "failed";

/** One run of the saved searches. `by: "schedule"` keeps to the daily gap; a hand run to MANUAL_GAP_MS. */
export async function runJobs(deps: JobsDeps, by: JobRun["by"]): Promise<{ result: RunResult; state: JobsState }> {
  const state = await deps.store.read();
  rollMonth(state, deps.now);
  const { searches } = state.profile;
  if (!deps.key) return { result: "no-key", state };
  if (!searches.length) return { result: "no-searches", state };
  if (by === "schedule" && !state.profile.daily) return { result: "off", state };
  const last = state.runs.find((r) => by === "hand" || r.by === "schedule");
  const gap = by === "schedule" ? SCHEDULE_GAP_MS : MANUAL_GAP_MS;
  if (last && deps.now - Date.parse(last.at) < gap) return { result: "not-due", state };
  const batch = batchOf(searches, state.cursor);
  if (state.used + batch.length > deps.budget) return { result: "budget", state };

  const nowIso = new Date(deps.now).toISOString();
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  let found = 0;
  let added = 0;
  let used = 0;
  let error: string | null = null;
  for (const s of batch) {
    used++;
    try {
      const res = await deps.fetcher(searchUrl(s, deps.key), { signal: AbortSignal.timeout(30_000) });
      const body = (await res.json().catch(() => null)) as { jobs_results?: SerpJob[]; error?: unknown } | null;
      if (!res.ok) {
        error = `HTTP ${res.status}`;
        // A bad key or a spent plan fails every search the same way: stop here.
        if (res.status === 401 || res.status === 429) break;
        continue;
      }
      // "Google hasn't returned any results" is an answer, not a failure.
      for (const raw of body?.jobs_results ?? []) {
        const job = normaliseJob(raw, s.q, nowIso);
        if (!job) continue;
        found++;
        const was = byId.get(job.id);
        if (was) byId.set(job.id, { ...job, state: was.state, stateAt: was.stateAt, firstSeen: was.firstSeen, search: was.search });
        else {
          byId.set(job.id, job);
          added++;
        }
      }
    } catch {
      error = "unreachable";
    }
  }
  state.used += used;
  state.cursor = searches.length ? (state.cursor + batch.length) % searches.length : 0;
  const resume = resumeWords(await deps.store.readResume().catch(() => ""));
  state.jobs = tidy([...byId.values()], state.profile, resume, deps.now);
  state.runs = [{ at: nowIso, by, searches: used, found, added, error }, ...state.runs].slice(0, 30);
  state.account = (await readAccount(deps).catch(() => null)) ?? state.account;
  await deps.store.write(state);
  return { result: error && !found ? "failed" : "ran", state };
}

/** SerpApi's account page: the plan's searches a month and what is left. Free; it doesn't count as a search. */
export async function readAccount(deps: Pick<JobsDeps, "fetcher" | "key" | "now">): Promise<JobsAccount | null> {
  if (!deps.key) return null;
  const res = await deps.fetcher(`${SERP_ACCOUNT_URL}?${new URLSearchParams({ api_key: deps.key })}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const a = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return a ? { perMonth: num(a.searches_per_month), left: num(a.total_searches_left) ?? num(a.plan_searches_left), at: new Date(deps.now).toISOString() } : null;
}

/** When the next scheduled run fires: the timer's next 13:00 UTC (JOBS_SCHEDULE), or null while the daily run is off. */
export function nextRunAt(state: JobsState, now: number): string | null {
  if (!state.profile.daily || !state.profile.searches.length) return null;
  const d = new Date(now);
  d.setUTCHours(13, 0, 0, 0);
  if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Once a day at 13:00 UTC (6 or 7 a.m. in Denver), Azure's six-field cron. */
export const JOBS_SCHEDULE = "0 0 13 * * *";

export function viewOf(state: JobsState, deps: Pick<JobsDeps, "key" | "budget" | "now">, hasResume: boolean): JobsView {
  const s = { ...state };
  rollMonth(s, deps.now);
  return { ...s, configured: !!deps.key, budget: deps.budget, hasResume, nextRun: nextRunAt(s, deps.now) };
}

/** A change from the Desk: a job's state, the profile or the resume. Returns the new state, or an error word. */
export async function changeJobs(deps: JobsDeps, body: Record<string, unknown>): Promise<{ state: JobsState; hasResume: boolean } | { error: string }> {
  const state = await deps.store.read();
  let resumeText = await deps.store.readResume().catch(() => "");
  if (body.action === "mark") {
    const job = state.jobs.find((j) => j.id === body.id);
    if (!job || !isState(body.state)) return { error: "bad-request" };
    job.state = body.state;
    job.stateAt = new Date(deps.now).toISOString();
  } else if (body.action === "profile") {
    state.profile = cleanProfile(body.profile);
  } else if (body.action === "resume") {
    if (typeof body.text !== "string") return { error: "bad-request" };
    resumeText = body.text.slice(0, MAX_RESUME).trim();
    await deps.store.writeResume(resumeText);
  } else return { error: "bad-request" };
  state.jobs = tidy(state.jobs, state.profile, resumeWords(resumeText), deps.now);
  await deps.store.write(state);
  return { state, hasResume: !!resumeText };
}
