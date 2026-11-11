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
 * counted) is read after each run so the Desk shows the plan's real searches left.
 *
 * Rules filter, the AI scores (#1025). The plain rules here are hard filters only, cheap and run before any model: a job
 * is hidden when it is neither near home (the private profile's `near` places) nor fully remote, when it has an avoided
 * word, when it is already applied to, or when its listed pay tops out under the floor; saved and applied jobs always
 * stay visible. They also give a provisional score, shown as "not checked yet". The match score itself is the AI fit
 * check's (fit.ts: Claude Sonnet reading the resume against the posting's requirements), under its own $15 a month cap.
 *
 * GET  /api/annex-jobs                      → JobsView (Desk session)
 * POST /api/annex-jobs { action: "run" }    run the saved searches now
 *                      { action: "mark", id, state }        new, saved, applied or dismissed
 *                      { action: "profile", profile }       the searches, pay floor, companies, prefer and avoid words
 *                      { action: "resume", text }           the resume as plain text ("" removes it); checks the top jobs' fit
 *                      { action: "fit", id }                the AI fit check for one job, now (fit.ts)
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import {
  BATCH_CALL_MAX_USD,
  BATCH_GIVE_UP_MS,
  BATCH_MAX,
  CALL_MAX_USD,
  FIT_CAP_USD,
  MAX_TRIES,
  RESUME_NOW,
  batchUsd,
  callUsd,
  defaultBook,
  pauseOf,
  postingBlock,
  readBook,
  readFit,
  resumeHash,
  rollBook,
  underCap,
  type FitAI,
  type FitAnswer,
  type FitBook,
  type FitPause,
  type JobFit,
} from "./fit.js";

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
  /** Your years of experience: a job is ranked by how its asked-for years compare, never by its title's level. */
  years: number | null;
  /** Roles already applied to (outside C.E.O. too): a found job matching one is filed under Applied, never a new match. */
  applied: { company: string; title: string }[];
  /** Places close to home (whole words in a job's location; a state's name also matches its ", CO" code): a job
   * elsewhere is hidden unless it is fully remote. Empty turns that rule off. */
  near: string[];
  /** Company tiers (whole words in the company's name): big companies rank first, then rising ones, then the rest. */
  big: string[];
  rising: string[];
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
  /** The company's logo as SerpApi gave it: an https image or a small inline data image; null when none. */
  logo?: string | null;
  /** The years of experience the posting asks for, read from its text; null when it names none. */
  yearsAsked?: number | null;
  /** The posting's description, up to POSTING_CHARS, for the fit check only: never sent to the browser. */
  detail?: string;
  /** Which saved search found it first. */
  search: string;
  /** The provisional score from the rules; the match score is `fit.score` once the AI has checked it. */
  score: number;
  /** The AI fit check's answer (fit.ts); null or absent until it has run against the current resume. */
  fit?: JobFit | null;
  /** Failed fit checks so far; at MAX_TRIES it keeps its provisional score. */
  fitTries?: number;
  /** Near home on site, near and hybrid, fully remote, or on site / hybrid elsewhere. */
  work?: Work;
  /** The US state in its location, as a two-letter code; null when none is named. */
  region?: string | null;
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
  /** The AI fit check's month and its batch in flight (fit.ts). */
  fit: FitBook;
}

/** The fit check as the Desk pane shows it: the month's spend against the cap, never on a public page. */
export interface FitCheckView {
  paused: FitPause;
  usd: number;
  cap: number;
  checks: number;
  /** Jobs waiting in a batch. */
  pending: number;
}

export interface JobsView extends Omit<JobsState, "fit"> {
  configured: boolean;
  budget: number;
  hasResume: boolean;
  nextRun: string | null;
  fitCheck: FitCheckView;
}

export const defaultProfile = (): JobsProfile => ({ searches: [], minSalary: null, prefer: [], avoid: [], companies: [], daily: true, years: null, applied: [], near: [], big: [], rising: [] });
export const defaultJobs = (): JobsState => ({ profile: defaultProfile(), jobs: [], runs: [], month: "", used: 0, cursor: 0, account: null, fit: defaultBook() });

/* ── Reading things defensively ── */

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const words = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((w) => str(w, 60).toLowerCase()).filter(Boolean))].slice(0, 40)
    : typeof v === "string"
      ? words(v.split(/[,\n]/))
      : [];
/** Like words, but keeping the casing as typed (company names are shown); matched without case. */
const names = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : [];
  const seen = new Set<string>();
  return list
    .map((w) => str(w, 60))
    .filter((w) => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()))
    .slice(0, 400);
};
/** A logo SerpApi sends: an https URL, or an inline raster image (never SVG, which can carry script) under 40 KB. */
export function logoOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(v)) return v.length <= 40_000 ? v : null;
  try {
    return new URL(v).protocol === "https:" && v.length <= 2_000 ? v : null;
  } catch {
    return null;
  }
}
const httpsLink = (v: unknown): string | null => {
  const s = str(v, 2000);
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
};

const yearsOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n < 60 ? Math.round(n) : null;
};

/**
 * The years of experience a posting asks for: "8+ years", "5-7 years of experience", "at least 10 years". The
 * largest number next to "years" (the main ask; a range counts by its low end, and "3 years in AI" beside "8+ years"
 * stays 8); null when it names none.
 */
export function yearsAskedIn(text: string): number | null {
  const found = [...text.toLowerCase().matchAll(/(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 30);
  return found.length ? Math.max(...found) : null;
}

/** "Company: Title" lines or { company, title } objects; an entry needs both, since a company alone would file away every opening there. */
export function appliedOf(v: unknown): { company: string; title: string }[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [];
  return list
    .map((x) => {
      if (typeof x === "string") {
        const at = x.indexOf(":");
        return at > 0 ? { company: str(x.slice(0, at), 80), title: str(x.slice(at + 1), 160) } : { company: "", title: "" };
      }
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { company: str(o.company, 80), title: str(o.title, 160) };
    })
    .filter((x) => x.company && x.title)
    .slice(0, 400);
}

const tokens = (t: string) => new Set(t.toLowerCase().replace(/&/g, " and ").match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w) && w !== "and") ?? []);

/** Whether a found job is one already applied to: the same company (either name inside the other) and a title that
 * shares most of its words (or one title's words all in the other). */
export function appliedBefore(job: Pick<Job, "company" | "title">, applied: { company: string; title: string }[]): boolean {
  const co = job.company.toLowerCase();
  const jt = tokens(job.title);
  return applied.some((a) => {
    const ac = a.company.toLowerCase();
    if (!(co.includes(ac) || ac.includes(co))) return false;
    const at = tokens(a.title);
    if (!at.size || !jt.size) return false;
    let both = 0;
    for (const w of at) if (jt.has(w)) both++;
    return both / Math.min(at.size, jt.size) >= 0.99 || both / Math.max(at.size, jt.size) >= 0.8;
  });
}

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
  return { searches, minSalary: Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 5_000_000) : null, prefer: words(r.prefer), avoid: words(r.avoid), companies: names(r.companies).slice(0, 40), daily: r.daily !== false, years: yearsOf(r.years), applied: appliedOf(r.applied), near: words(r.near), big: names(r.big).slice(0, 400), rising: names(r.rising).slice(0, 400) };
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
  s.fit = readBook(r.fit);
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
  thumbnail?: unknown;
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
    detail: str(raw.description, 6_000),
    logo: logoOf(raw.thumbnail),
    yearsAsked: yearsAskedIn(`${str(raw.description, 20_000)} ${highlights.join(" ")}`),
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

/* ── The rules: hard filters and a provisional score ── */

const STOP = new Set("a an and are as at be by for from has have in is it of on or our that the this to was we were will with you your".split(" "));

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether a word or phrase is in the text as a whole word, any case ("ai" is in "AI platform", not in "maintain"). */
export function hasWord(text: string, w: string): boolean {
  return w ? new RegExp(`(^|[^a-z0-9])${escape(w.toLowerCase())}($|[^a-z0-9])`).test(text.toLowerCase()) : false;
}

/** The US states, by name, for reading "Denver, CO" as Colorado and the other way round. */
export const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};
const STATE_CODES = new Set(Object.values(US_STATES));

/** The US state a location names ("Denver, CO", "Boulder, Colorado, United States"), as its code; null when none. */
export function regionOf(location: string): string | null {
  const code = location.match(/,\s*([A-Z]{2})\b/);
  if (code && STATE_CODES.has(code[1]!)) return code[1]!;
  // Longest names first, so "West Virginia" is never read as Virginia.
  const name = Object.keys(US_STATES)
    .sort((a, b) => b.length - a.length)
    .find((n) => hasWord(location, n));
  return name ? US_STATES[name]! : null;
}

/** Whether a location is close to home: one of the profile's places as a whole word, or in a state it names. */
export function isNear(location: string, near: string[]): boolean {
  if (!location) return false;
  const region = regionOf(location);
  return near.some((w) => hasWord(location, w) || (!!region && (US_STATES[w] === region || w.toUpperCase() === region)));
}

export type Work = "near" | "hybrid" | "remote" | "elsewhere";

/** How the job is worked, for the place rule and the filter: near on site, near and hybrid, fully remote, elsewhere. */
export function workOf(job: Pick<Job, "title" | "location" | "snippet" | "remote"> & { detail?: string }, near: string[]): Work {
  const hybrid = /\bhybrid\b/i.test(`${job.title} ${job.location} ${job.snippet} ${job.detail ?? ""}`);
  if (isNear(job.location, near)) return hybrid ? "hybrid" : "near";
  if (job.remote && !hybrid) return "remote";
  return near.length ? "elsewhere" : hybrid ? "hybrid" : "elsewhere";
}

/**
 * The rules (#1025): hard filters, then a provisional score until the AI fit check has run. Hidden: a job neither near
 * home nor fully remote (only when the profile names places), an avoided word, or listed pay under the floor. Saved and
 * applied jobs always stay visible. The provisional score weighs the years asked, the company lists, the lift words,
 * the place and the pay; it never reads the resume (that is the AI's job, fit.ts).
 */
export function scoreJob(job: Job, profile: JobsProfile): Job {
  const why: string[] = [];
  let score = 40;
  const hay = `${job.title} ${job.company} ${job.snippet} ${job.highlights.join(" ")}`.toLowerCase();
  const avoid = profile.avoid.find((w) => hasWord(`${job.title} ${job.company}`, w));
  const lift = (n: number, w: string) => {
    score += n;
    why.push(w);
  };
  // Experience asked for, not the title's level: a Director at one company is a Senior at another (Nikita, 2026-11-10).
  const asked = job.yearsAsked ?? null;
  if (asked !== null && profile.years) {
    if (asked > profile.years + 2) lift(-15, `asks ${asked}+ years`);
    else if (asked >= profile.years - 4) lift(14, `asks ${asked}+ years, fits`);
    else if (asked <= profile.years - 7) lift(-8, `asks only ${asked}+ years`);
    else lift(6, `asks ${asked}+ years`);
  }
  const fav = profile.companies.find((w) => hasWord(job.company, w));
  if (fav) lift(18, "on your company list");
  // Then the company's tier (Nikita, 2026-11-10): big companies first, then startups on the rise, then everyone else.
  else if (profile.big.some((w) => hasWord(job.company, w))) lift(12, "big company");
  else if (profile.rising.some((w) => hasWord(job.company, w))) lift(7, "rising company");
  const pref = profile.prefer.filter((w) => hasWord(hay, w));
  if (pref.length) lift(Math.min(24, pref.length * 8), `mentions ${pref.slice(0, 3).join(", ")}`);
  // Close to home first, then hybrid, then remote (Nikita, 2026-11-10: remote roles are harder to land).
  const work = workOf(job, profile.near);
  if (work === "near") lift(16, "near you");
  else if (work === "hybrid") lift(profile.near.length ? 22 : 3, profile.near.length ? "near you, hybrid" : "hybrid");
  else if (work === "remote") lift(profile.near.length ? 1 : 6, "remote");
  // Nikita isn't moving (2026-11-11): a job elsewhere that isn't fully remote is never a result.
  let hidden: string | null = avoid ? `has "${avoid}"` : profile.near.length && work === "elsewhere" ? "not near you or remote" : null;
  if (profile.minSalary && job.payMax !== null) {
    if (job.payMax < profile.minSalary) hidden ??= "pay under your floor";
    else lift(10, "pay clears your floor");
  }
  if (job.state === "saved" || job.state === "applied") hidden = null;
  return { ...job, score: Math.max(0, Math.min(100, score)), why: why.slice(0, 4), hidden, work, region: regionOf(job.location) };
}

/** The match score: the AI's fit when it has checked the job, else the provisional score. */
export const matchOf = (j: Pick<Job, "score" | "fit">) => j.fit?.score ?? j.score;

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
  /** The AI fit check (fit.ts); null while no Claude key is set. */
  ai?: FitAI | null;
  /** The fit check's month cap, FIT_CAP_USD unless a test says otherwise. */
  fitCap?: number;
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

/** Every job filtered and scored again against the profile, best match first, the stale ones dropped, and capped. */
export function tidy(jobs: Job[], profile: JobsProfile, now: number): Job[] {
  // A role already applied to elsewhere goes straight to Applied, so it never comes up as new.
  jobs = jobs.map((j) => (j.state === "new" && appliedBefore(j, profile.applied) ? { ...j, state: "applied" as const, stateAt: new Date(now).toISOString() } : j));
  const kept = jobs.filter((j) => j.state === "saved" || j.state === "applied" || now - Date.parse(j.lastSeen) < STALE_MS);
  const scored = kept.map((j) => scoreJob(j, profile));
  scored.sort((a, b) => (a.state === "dismissed" ? 1 : 0) - (b.state === "dismissed" ? 1 : 0) || matchOf(b) - matchOf(a) || b.lastSeen.localeCompare(a.lastSeen));
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
        // Seen again: the fit check's answer stays (it is checked once per resume).
        if (was) byId.set(job.id, { ...job, state: was.state, stateAt: was.stateAt, firstSeen: was.firstSeen, search: was.search, fit: was.fit ?? null, fitTries: was.fitTries ?? 0 });
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
  state.jobs = tidy([...byId.values()], state.profile, deps.now);
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

export function viewOf(state: JobsState, deps: Pick<JobsDeps, "key" | "budget" | "now" | "ai" | "fitCap">, hasResume: boolean): JobsView {
  const s = { ...state };
  rollMonth(s, deps.now);
  const { fit, ...rest } = s;
  const book = rollBook(fit, deps.now);
  const cap = deps.fitCap ?? FIT_CAP_USD;
  // The postings' full text is for the fit check only; the browser gets the snippet and highlights.
  // Filtered again on every read, so a rule change (the place rule, #1025) shows before the next run writes it.
  const jobs = tidy(rest.jobs, rest.profile, deps.now).map(({ detail: _detail, ...j }) => j);
  return {
    ...rest,
    jobs,
    configured: !!deps.key,
    budget: deps.budget,
    hasResume,
    nextRun: nextRunAt(s, deps.now),
    fitCheck: { paused: pauseOf(book, !!deps.ai, hasResume, cap), usd: Math.round(book.usd * 100) / 100, cap, checks: book.checks, pending: book.batch ? Object.keys(book.batch.ids).length : 0 },
  };
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
  } else if (body.action === "fit") {
    if (typeof body.id !== "string" || !state.jobs.some((j) => j.id === body.id)) return { error: "bad-request" };
    state.jobs = tidy(state.jobs, state.profile, deps.now);
    await checkNow(deps, state, resumeText, [body.id]);
  } else return { error: "bad-request" };
  state.jobs = tidy(state.jobs, state.profile, deps.now);
  if (body.action === "resume") {
    // A new resume: a batch in flight was for the old one. The top few are checked now, the rest go in a batch.
    state.fit = { ...state.fit, batch: null };
    const hash = resumeHash(resumeText);
    const top = state.jobs.filter((j) => needsFit(j, hash)).slice(0, RESUME_NOW);
    await checkNow(deps, state, resumeText, top.map((j) => j.id));
    await startBatch(deps, state, resumeText).catch(() => 0);
    state.jobs = tidy(state.jobs, state.profile, deps.now);
  }
  await deps.store.write(state);
  return { state, hasResume: !!resumeText };
}

/* ── The AI fit check (fit.ts), run against the stored jobs ── */

/** Whether a job is due a fit check: shown (or saved or applied), not dismissed, not yet checked against this resume. */
export function needsFit(j: Job, hash: string): boolean {
  if (!hash || j.state === "dismissed" || j.hidden) return false;
  return j.fit?.resume !== hash && (j.fitTries ?? 0) < MAX_TRIES;
}

const postingOf = (j: Job) => postingBlock({ title: j.title, company: j.company, location: j.location, highlights: j.highlights, description: j.detail || j.snippet });

/** One answer applied to its job: the fit on success, one more try counted on failure. */
function applyAnswer(state: JobsState, id: string, got: FitAnswer, hash: string, nowIso: string): boolean {
  const job = state.jobs.find((j) => j.id === id);
  if (!job || got.failed) return false;
  const fit = readFit(got.answer, hash, nowIso);
  if (fit) {
    job.fit = fit;
    job.fitTries = 0;
  } else job.fitTries = (job.fitTries ?? 0) + 1;
  return !!fit;
}

/** A few jobs checked now (a "Check fit" tap, a resume change), each pair only while it fits under the cap at its most. */
export async function checkNow(deps: JobsDeps, state: JobsState, resumeText: string, ids: string[]): Promise<number> {
  const hash = resumeHash(resumeText);
  const cap = deps.fitCap ?? FIT_CAP_USD;
  state.fit = rollBook(state.fit, deps.now);
  const ai = deps.ai;
  if (!ai || !hash) return 0;
  const due = ids.map((id) => state.jobs.find((j) => j.id === id)).filter((j): j is Job => !!j && needsFit(j, hash));
  const nowIso = new Date(deps.now).toISOString();
  let checked = 0;
  // Two at a time: quick enough for a tap, gentle on the rate limit.
  for (let i = 0; i < due.length; i += 2) {
    const pair = due.slice(i, i + 2);
    if (!underCap(state.fit, pair.length, CALL_MAX_USD, cap)) break;
    const answers = await Promise.all(pair.map((j) => ai.check(resumeText, postingOf(j)).catch((): FitAnswer => ({ answer: null, usage: null, failed: true }))));
    pair.forEach((j, n) => {
      const got = answers[n]!;
      state.fit.usd += callUsd(got.usage);
      if (applyAnswer(state, j.id, got, hash, nowIso)) {
        checked++;
        state.fit.checks++;
      }
    });
  }
  return checked;
}

/** Every job due a check, sent as one batch at half price: as many as the cap allows at their most. */
export async function startBatch(deps: JobsDeps, state: JobsState, resumeText: string): Promise<number> {
  const hash = resumeHash(resumeText);
  const cap = deps.fitCap ?? FIT_CAP_USD;
  state.fit = rollBook(state.fit, deps.now);
  if (!deps.ai || !hash || state.fit.batch) return 0;
  const room = Math.floor((cap - state.fit.usd) / BATCH_CALL_MAX_USD);
  const due = state.jobs.filter((j) => needsFit(j, hash)).slice(0, Math.max(0, Math.min(BATCH_MAX, room)));
  if (!due.length) return 0;
  const ids: Record<string, string> = {};
  const postings = due.map((j, i) => {
    ids[`j${i}`] = j.id;
    return { id: `j${i}`, posting: postingOf(j) };
  });
  const batchId = await deps.ai.submit(resumeText, postings);
  state.fit.batch = { id: batchId, at: new Date(deps.now).toISOString(), resume: hash, ids };
  return due.length;
}

/** A finished batch's answers applied (only while the resume is the one it went out with); null while it runs. */
export async function collectBatch(deps: JobsDeps, state: JobsState, resumeText: string): Promise<number | null> {
  const batch = state.fit.batch;
  if (!deps.ai || !batch) return 0;
  const got = await deps.ai.collect(batch.id);
  if (!got) {
    if (deps.now - Date.parse(batch.at) > BATCH_GIVE_UP_MS) state.fit = { ...state.fit, batch: null };
    return null;
  }
  state.fit = rollBook(state.fit, deps.now);
  const hash = resumeHash(resumeText);
  const nowIso = new Date(deps.now).toISOString();
  let checked = 0;
  for (const [custom, jobId] of Object.entries(batch.ids)) {
    const answer = got.get(custom) ?? { answer: null, usage: null, failed: true };
    state.fit.usd += batchUsd(answer.usage);
    if (batch.resume === hash && applyAnswer(state, jobId, answer, hash, nowIso)) {
      checked++;
      state.fit.checks++;
    }
  }
  state.fit.batch = null;
  return checked;
}

export interface FitTick {
  checked: number;
  sent: number;
  waiting: boolean;
  paused: FitPause;
}

/**
 * The fit check's tick (after the daily run, and every 20 minutes from the timer): a finished batch is read back, then
 * every job still due a check (new ones, and on the first tick the jobs stored before #1025, which is the backfill)
 * goes out in one new batch. Nothing is asked of the API and nothing written while nothing is due.
 */
export async function fitTick(deps: JobsDeps): Promise<FitTick> {
  const state = await deps.store.read();
  const resumeText = await deps.store.readResume().catch(() => "");
  state.jobs = tidy(state.jobs, state.profile, deps.now);
  const hash = resumeHash(resumeText);
  const paused = pauseOf(rollBook(state.fit, deps.now), !!deps.ai, !!hash, deps.fitCap ?? FIT_CAP_USD);
  const due = state.jobs.some((j) => needsFit(j, hash));
  if (!state.fit.batch && (paused || !due)) return { checked: 0, sent: 0, waiting: false, paused };
  const checked = (await collectBatch(deps, state, resumeText).catch(() => null)) ?? 0;
  const waiting = !!state.fit.batch;
  const sent = waiting || paused ? 0 : await startBatch(deps, state, resumeText).catch(() => 0);
  state.jobs = tidy(state.jobs, state.profile, deps.now);
  await deps.store.write(state);
  return { checked, sent, waiting: waiting || sent > 0, paused };
}

/** The fit check's timer: every 20 minutes, Azure's six-field cron. */
export const FIT_SCHEDULE = "0 */20 * * * *";
