import { create } from "zustand";

/**
 * The Job search's record, browser side (#1000): read from GET /api/annex-jobs and changed with POST, both in a Desk
 * (passkey) session only. Nothing is kept on the device: a job search is private, so signed out the section asks for
 * the passkey and shows nothing else. The shapes mirror api/_annex/jobs.ts (JobsView).
 */

export type JobState = "new" | "saved" | "applied" | "dismissed";

export interface JobSearchQ {
  q: string;
  location: string;
  remote: boolean;
}

export interface JobsProfile {
  searches: JobSearchQ[];
  minSalary: number | null;
  prefer: string[];
  avoid: string[];
  companies: string[];
  daily: boolean;
  years: number | null;
  applied: { company: string; title: string }[];
  near: string[];
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
  payMin: number | null;
  payMax: number | null;
  link: string | null;
  apply: { title: string; link: string }[];
  snippet: string;
  highlights: string[];
  logo?: string | null;
  yearsAsked?: number | null;
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

export interface JobsView {
  profile: JobsProfile;
  jobs: Job[];
  runs: JobRun[];
  month: string;
  used: number;
  cursor: number;
  budget: number;
  account: { perMonth: number | null; left: number | null; at: string } | null;
  configured: boolean;
  hasResume: boolean;
  nextRun: string | null;
}

export const RUN_WORD: Record<string, string> = {
  ran: "Searched",
  "no-key": "SerpApi's key isn't set yet",
  "no-searches": "Add a search first",
  budget: "This month's search budget is spent",
  "not-due": "Searched less than 30 minutes ago",
  off: "The daily run is off",
  failed: "SerpApi didn't answer",
  shelved: "The pop-up is on the Shelf",
};

type Load = "idle" | "loading" | "ready" | "signed-out" | "failed";

interface JobsStore {
  load: Load;
  view: JobsView | null;
  busy: boolean;
  /** The last run or save's outcome, in words. */
  said: string | null;
  refresh: () => Promise<void>;
  send: (body: Record<string, unknown>) => Promise<boolean>;
}

const isView = (v: unknown): v is JobsView => !!v && typeof v === "object" && Array.isArray((v as JobsView).jobs) && !!(v as JobsView).profile;

export const useJobs = create<JobsStore>((set, get) => ({
  load: "idle",
  view: null,
  busy: false,
  said: null,
  refresh: async () => {
    if (get().load === "idle") set({ load: "loading" });
    try {
      const res = await fetch("/api/annex-jobs", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (res.status === 401 || res.status === 403) return set({ load: "signed-out", view: null });
      const body = res.ok ? await res.json().catch(() => null) : null;
      set(isView(body) ? { load: "ready", view: body } : { load: get().view ? "ready" : "failed" });
    } catch {
      set({ load: get().view ? "ready" : "failed" });
    }
  },
  send: async (body) => {
    set({ busy: true, said: null });
    try {
      const res = await fetch("/api/annex-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
      const back = (await res.json().catch(() => null)) as (JobsView & { result?: string; error?: string }) | null;
      if (res.status === 401) return (set({ load: "signed-out", view: null, busy: false }), false);
      if (isView(back)) set({ view: back, load: "ready" });
      const word = back?.result ?? back?.error;
      set({ busy: false, said: word ? (RUN_WORD[word] ?? (res.ok ? null : "Couldn't save that")) : res.ok ? "Saved" : "Couldn't save that" });
      return res.ok;
    } catch {
      set({ busy: false, said: "Couldn't reach the server" });
      return false;
    }
  },
}));

/** "$150K" from 150000. */
export const k = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1_000)}K`);

/** How long ago, in a word or two. */
export function since(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The bed's crystals in the Glasshouse: new, saved and applied jobs, each its own colour. */
export function jobsGrowth(view: JobsView | null): { parts: { colour: string; n: number }[]; share: number; note: string } | null {
  if (!view) return null;
  const count = (s: JobState) => view.jobs.filter((j) => j.state === s && !j.hidden).length;
  const parts = [
    { colour: "#d8b45a", n: count("new") },
    { colour: "#7fc8a9", n: count("saved") },
    { colour: "#f1e2b0", n: count("applied") },
  ].filter((p) => p.n > 0);
  const shown = parts.reduce((n, p) => n + p.n, 0);
  return { parts, share: view.budget ? Math.min(1, view.used / view.budget) : 0, note: shown ? `${count("new")} new · ${count("applied")} applied` : "no jobs yet" };
}

const wordIn = (text: string, w: string) => {
  const t = w.trim().toLowerCase();
  return !!t && new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text.toLowerCase());
};

export type CareerVerdict = "up" | "level" | "back";

export interface CareerMove {
  /** 0–100: how far the job would push the career forward. */
  value: number;
  verdict: CareerVerdict;
  /** "Step up", "Sideways", "Step back". */
  word: string;
  /** The company's standing, in a word or two, and its 0–100 part. */
  standing: { word: string; n: number };
  /** The role's level against your years, and its 0–100 part. */
  level: { word: string; n: number };
  /** Pay against your floor, and its 0–100 part; null when the listing names no pay. */
  pay: { word: string; n: number } | null;
}

const LEAD_TITLE = /\b(director|head of|vp|vice president|principal|staff|chief|group (product|program) manager|senior manager)\b/i;
const LOW_TITLE = /\b(associate|junior|jr|entry|intern|coordinator|assistant|analyst ii?|specialist i{1,2})\b/i;

/**
 * Whether a job moves the career forward (Nikita, 2026-11-10): the company's standing from your own lists (big
 * companies are industry leaders, rising ones are startups on the up, the rest unknown), the role's level from the
 * years it asks and its title against your years, and its pay against your floor. Plain rules, no model.
 */
export function careerMove(job: Job, profile: JobsProfile): CareerMove {
  const on = (list: string[]) => list.some((w) => wordIn(job.company, w));
  const big = on(profile.big);
  const fav = on(profile.companies);
  const rising = on(profile.rising);
  const standing = big
    ? { word: "Industry leader", n: fav ? 100 : 90 }
    : rising
      ? { word: "Rising startup", n: fav ? 78 : 70 }
      : fav
        ? { word: "On your list", n: 75 }
        : { word: "Lesser known", n: 35 };

  const yrs = profile.years ?? 10;
  let lvl = 60;
  if (job.yearsAsked != null) lvl = job.yearsAsked >= yrs ? 90 : job.yearsAsked >= yrs - 3 ? 70 : job.yearsAsked >= yrs - 5 ? 45 : 25;
  if (LEAD_TITLE.test(job.title)) lvl = Math.max(lvl, 80) + 10;
  else if (LOW_TITLE.test(job.title)) lvl -= 25;
  else if (/\bsenior|sr\.?\b/i.test(job.title)) lvl += 5;
  lvl = Math.max(0, Math.min(100, lvl));
  const level = { word: lvl >= 80 ? "Senior / lead role" : lvl >= 55 ? "At your level" : "Junior to you", n: lvl };

  const top = job.payMax ?? job.payMin;
  const floor = profile.minSalary ?? 180_000;
  const pay =
    top == null
      ? null
      : top >= floor * 1.15
        ? { word: "Pays well above floor", n: 95 }
        : top >= floor
          ? { word: "Pays at your floor", n: 70 }
          : top >= floor * 0.8
            ? { word: "Pays a little under", n: 40 }
            : { word: "Pays well under", n: 10 };

  const value = Math.round(pay ? standing.n * 0.5 + level.n * 0.3 + pay.n * 0.2 : standing.n * 0.6 + level.n * 0.4);
  const verdict: CareerVerdict = value >= 70 ? "up" : value >= 48 ? "level" : "back";
  return { value, verdict, word: verdict === "up" ? "Step up" : verdict === "level" ? "Sideways" : "Step back", standing, level, pay };
}
