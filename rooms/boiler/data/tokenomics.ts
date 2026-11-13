import { useEffect, useState } from "react";
import type { UsageReport, UsageRow } from "../../../api/_usage/aggregate.ts";
import type { Provider } from "../../../api/_usage/prices.ts";

/**
 * The Tokenomics tab's data (#1142), browser side: GET /api/boiler-usage?days=N in the Desk's passkey session, once
 * when the tab opens and when the window changes. The report is made on the server from the usage ledger and the
 * providers' own totals (api/_usage); this file only reads it and words it. Real data only: signed out, unset or
 * empty, the tab says so and shows no figures.
 */

export const USAGE_PATH = "/api/boiler-usage";
export const WINDOWS = [7, 30, 90] as const;
export type UsageWindow = (typeof WINDOWS)[number];

export type UsageState = { status: "loading" } | { status: "ready"; report: UsageReport } | { status: "signed-out" } | { status: "not-set-up" } | { status: "error" };

export const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Claude", google: "Gemini", openai: "OpenAI" };

/** What an answer from the route means for the tab. */
export async function readUsage(res: Response): Promise<UsageState> {
  if (res.status === 401) return { status: "signed-out" };
  if (res.status === 503) return { status: "not-set-up" };
  if (!res.ok) return { status: "error" };
  const body = (await res.json().catch(() => null)) as UsageReport | null;
  return body && typeof body === "object" && Array.isArray(body.byFeature) ? { status: "ready", report: body } : { status: "error" };
}

export function useTokenomics(days: UsageWindow, signedIn: boolean): UsageState {
  const [state, setState] = useState<UsageState>({ status: "loading" });
  useEffect(() => {
    if (!signedIn) {
      setState({ status: "signed-out" });
      return;
    }
    let live = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    fetch(`${USAGE_PATH}?days=${days}`, { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(readUsage)
      .catch((): UsageState => ({ status: "error" }))
      .then((next) => {
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
  }, [days, signedIn]);
  return state;
}

/* ── words and figures ── */

/** Dollars, to the cent from a dollar up, finer below. */
export function usd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  const a = Math.abs(n);
  const s = a >= 100 ? a.toFixed(0) : a >= 0.995 ? a.toFixed(2) : a >= 0.01 ? a.toFixed(3) : a.toFixed(4);
  return `${n < 0 ? "−" : ""}$${s}`;
}

/** A token count: 812, 14k, 1.2M. */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** A share: whole percents, one decimal under 10% so a small cache hit doesn't read as none. */
export const pct = (x: number) => (x > 0 && x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);

/** A row's per-call figures. */
export function perCall(r: UsageRow): { usd: number; tokensIn: number; tokensOut: number } {
  const n = Math.max(1, r.calls);
  return { usd: r.usd / n, tokensIn: (r.tokensIn + r.cacheRead + r.cacheWrite) / n, tokensOut: r.tokensOut / n };
}

/** A cap's tone: red at or past the cap, amber from 80%, else fine. */
export function capTone(used: number, cap: number): "ok" | "warn" | "over" {
  if (cap <= 0) return used > 0 ? "over" : "ok";
  return used >= cap ? "over" : used >= cap * 0.8 ? "warn" : "ok";
}

/** The title's verdict on the month: the share of the largest cap reached, worded. */
export function monthVerdict(r: UsageReport): { word: string; tone: "ok" | "warn" | "over" | "wait" } {
  if (!r.month.calls) return { word: "nothing yet", tone: "wait" };
  const tones = r.caps.map((c) => capTone(c.usd, c.cap));
  if (tones.includes("over")) return { word: "a cap reached", tone: "over" };
  if (tones.includes("warn")) return { word: "near a cap", tone: "warn" };
  return { word: "under every cap", tone: "ok" };
}

/** The day chart's columns: each day's dollars by provider, scaled to the window's highest day. */
export function dayBars(r: UsageReport): { day: string; total: number; parts: { provider: Provider; usd: number }[] }[] {
  return r.byDay.map((d) => ({ day: d.day, total: (["anthropic", "google", "openai"] as const).reduce((s, p) => s + d.usd[p], 0), parts: (["anthropic", "google", "openai"] as const).map((p) => ({ provider: p, usd: d.usd[p] })) }));
}

/** "Nov 13" from "2026-11-13". */
export function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
