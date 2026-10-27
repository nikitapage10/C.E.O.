import { create } from "zustand";
import type { AnalysisFacts, AnalysisKey, GreenAnalysis } from "../../../../../api/_green/types.ts";
import { readFeeds } from "./league.ts";

/**
 * The Commentator's call (#276), browser side: GET /api/green-analysis (signed-in Desk only) when the Green page opens,
 * and POST { action: "refresh" } from its button, at most once a day (#261; the server holds the line; the page just
 * shows when the next one is allowed). The words were written on the server from the board's numbers only.
 */

export type { GreenAnalysis };

const PATH = "/api/green-analysis";

/**
 * "signed-out": the Desk's passkey session is needed; "off": the route isn't here (a local preview); "waiting": no
 * league data is connected yet, so nothing was written (#261).
 */
export type AnalysisStatus = "idle" | "ready" | "none" | "waiting" | "signed-out" | "off" | "failed";

const KEYS: AnalysisKey[] = ["matchup", "calls", "waiver", "review", "weak", "byes", "injuries", "trade"];

/** "in 40 min", "in 6 h": how long until the next on-demand take. */
export function waitWords(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return min < 90 ? `${min} min` : `${Math.ceil(min / 60)} h`;
}
const str = (v: unknown, max = 600) => (typeof v === "string" && v.length <= max ? v : null);

/** The analysis as the server sent it, every string capped; null when it isn't one. */
export function readAnalysis(v: unknown): GreenAnalysis | null {
  const a = v as Partial<GreenAnalysis> | null;
  if (!a || typeof a !== "object" || !str(a.at, 40) || !Number.isFinite(Date.parse(a.at!)) || typeof a.week !== "number" || !str(a.headline) || !Array.isArray(a.sections) || !a.facts) return null;
  const sections = a.sections.filter((s) => !!s && KEYS.includes(s.key) && str(s.title, 80) && str(s.text)).slice(0, 8);
  const second = (Array.isArray(a.second) ? a.second : []).filter((s) => !!s && str(s.start, 60) && str(s.sit, 60) && str(s.take, 240)).slice(0, 3);
  return {
    at: a.at!,
    season: str(a.season, 8) ?? "",
    week: a.week,
    trigger: a.trigger === "scheduled" ? "scheduled" : "manual",
    headline: a.headline!,
    sections,
    facts: a.facts as AnalysisFacts,
    second,
    writer: a.writer === "claude" ? "claude" : "scripted",
    ...(a.scripted && ["no-key", "capped", "failed", "checked"].includes(a.scripted) && { scripted: a.scripted }),
    sources: readFeeds(a.sources),
  };
}

interface AnalysisStore {
  status: AnalysisStatus;
  analysis: GreenAnalysis | null;
  /** When the next on-demand refresh is allowed (ms), or null. */
  refreshAfter: number | null;
  busy: boolean;
  /** A short note after a refresh that didn't go through. */
  note: string | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
}

const statusOf = (res: Response): AnalysisStatus | null => {
  if (!(res.headers.get("content-type") ?? "").includes("json")) return "off";
  if (res.status === 401 || res.status === 403) return "signed-out";
  if (res.status === 503 || res.status === 404) return "off";
  return res.ok ? null : "failed";
};

const after = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

export const useGreenAnalysis = create<AnalysisStore>((set, get) => ({
  status: "idle",
  analysis: null,
  refreshAfter: null,
  busy: false,
  note: null,
  load: async () => {
    try {
      const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const bad = statusOf(res);
      if (bad) return set({ status: bad });
      const body = (await res.json()) as { state?: unknown; analysis?: unknown; refreshAfter?: unknown };
      const analysis = body.state === "ready" ? readAnalysis(body.analysis) : null;
      set({ status: analysis ? "ready" : "none", analysis, refreshAfter: after(body.refreshAfter) });
    } catch {
      set({ status: "failed" });
    }
  },
  refresh: async () => {
    if (get().busy) return;
    set({ busy: true, note: null });
    try {
      const res = await fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", body: JSON.stringify({ action: "refresh" }) });
      if (res.status === 429) {
        const body = (await res.json().catch(() => null)) as { wait?: unknown } | null;
        const wait = typeof body?.wait === "number" ? body.wait : 86_400;
        set({ busy: false, refreshAfter: Date.now() + wait * 1000, note: `The Commentator wrote one today; next refresh in ${waitWords(wait * 1000)}.` });
        return;
      }
      const bad = statusOf(res);
      if (bad) {
        set({ busy: false, status: bad === "failed" ? get().status : bad, note: bad === "signed-out" ? "Sign in to the Desk to ask for a fresh one." : "The refresh didn't go through. Try again in a few minutes." });
        return;
      }
      const body = (await res.json()) as { state?: unknown; analysis?: unknown; refreshAfter?: unknown };
      if (body.state === "waiting") {
        set({ busy: false, status: get().analysis ? get().status : "waiting", note: "Waiting on the league: no data is connected yet, so nothing was written." });
        return;
      }
      const analysis = readAnalysis(body.analysis);
      set(analysis ? { busy: false, status: "ready", analysis, refreshAfter: after(body.refreshAfter) } : { busy: false, note: "The refresh came back empty." });
    } catch {
      set({ busy: false, note: "The refresh didn't go through. Try again in a few minutes." });
    }
  },
}));
