/**
 * The Tokenomics tab's numbers (#1142), made from the usage ledger's lines (./meter.ts) and the providers' own
 * daily totals (./admin.ts): this month against each cap, the window's spend by provider, feature, model and day,
 * the per-call averages, the top cost drivers, the gap between the bill and the ledger, and plain-language waste
 * flags. Pure: the route reads the files and hands them in, and the tests hand in their own.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { Truth, TruthProvider } from "./admin.js";
import type { UsageLine } from "./meter.js";
import type { Provider } from "./prices.js";

export const PROVIDERS: readonly Provider[] = ["anthropic", "google", "openai"];

/** One row of a breakdown: its calls, dollars and tokens, and averages. */
export interface UsageRow {
  key: string;
  /** The provider, when every line of the row has the same one. */
  provider?: Provider;
  calls: number;
  errors: number;
  usd: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  searches: number;
  /** Mean milliseconds a call. */
  ms: number;
  /** Cache reads over all input, 0 to 1. */
  cacheHit: number;
}

export interface CapRow {
  id: string;
  label: string;
  usd: number;
  cap: number;
  /** The features it counts, by prefix. */
  features: string[];
}

export type FlagKind = "duplicate" | "cache" | "uncached" | "oversized" | "fallback" | "searches" | "cutoff" | "errors";

export interface WasteFlag {
  kind: FlagKind;
  /** "warn" costs money worth chasing; "info" is worth a look. */
  tone: "warn" | "info";
  feature?: string;
  /** The finding, in a plain sentence with its numbers. */
  text: string;
  /** What it cost, where that can be counted. */
  usd: number;
}

export interface TruthRow {
  provider: Provider;
  /** "ok": the provider's own numbers are in; "waiting": no admin key; "failed": the last pull failed; "ledger": none exists (Gemini). */
  state: "ok" | "waiting" | "failed" | "ledger";
  pulledAt?: number;
  /** The provider's dollars over the days it has reported in the window, and the ledger's over the same days. */
  billed: number | null;
  ledger: number;
  /** billed − ledger: what the ledger doesn't see. */
  gap: number | null;
  /** By model, largest bill first. */
  models: { model: string; billed: number; ledger: number }[];
}

export interface UsageReport {
  now: number;
  days: number;
  from: string;
  to: string;
  month: { label: string; usd: number; calls: number; projected: number; byProvider: Record<Provider, number> };
  caps: CapRow[];
  totals: UsageRow;
  byProvider: UsageRow[];
  byFeature: UsageRow[];
  byModel: UsageRow[];
  byDay: { day: string; usd: Record<Provider, number>; calls: number }[];
  drivers: UsageRow[];
  flags: WasteFlag[];
  truth: TruthRow[];
}

type Env = Record<string, string | undefined>;

/** The caps the callers hold, grouped by the features they count (each a non-secret app setting, else its default). */
export const CAP_GROUPS: { id: string; label: string; features: string[]; setting: string; fallback: number }[] = [
  { id: "skippy", label: "Skippy's month", features: ["skippy.", "call.", "kernel.", "senate.", "today.", "kitchen."], setting: "SKIPPY_BUDGET_USD", fallback: 60 },
  { id: "email", label: "Email", features: ["email."], setting: "EMAIL_BUDGET_USD", fallback: 10 },
  { id: "relay", label: "Texts", features: ["relay."], setting: "RELAY_BUDGET_USD", fallback: 10 },
  { id: "claude", label: "World, Green and shaping", features: ["world.", "green.", "foundry."], setting: "CLAUDE_CAP_USD", fallback: 10 },
  { id: "annex", label: "Job fit checks", features: ["annex."], setting: "FIT_CAP_USD", fallback: 15 },
  { id: "images", label: "Images", features: ["haven."], setting: "IMAGES_CAP_USD", fallback: 10 },
];

const capOf = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 500 ? n : fallback;
};

const inOf = (l: Pick<UsageLine, "tokensIn" | "cacheRead" | "cacheWrite" | "cacheWrite1h">) => l.tokensIn + l.cacheRead + l.cacheWrite + (l.cacheWrite1h ?? 0);
const money = (usd: number) => (usd >= 1 ? `$${usd.toFixed(2)}` : usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? `$${usd.toFixed(4)}` : "$0");
const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.round(n)));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Lines summed into one row. */
export function rowOf(key: string, lines: readonly UsageLine[]): UsageRow {
  const row: UsageRow = { key, calls: 0, errors: 0, usd: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, searches: 0, ms: 0, cacheHit: 0 };
  let ms = 0;
  const providers = new Set<Provider>();
  for (const l of lines) {
    row.calls += 1;
    if (!l.ok) row.errors += 1;
    row.usd += l.usd;
    row.tokensIn += l.tokensIn;
    row.tokensOut += l.tokensOut;
    row.cacheRead += l.cacheRead;
    row.cacheWrite += l.cacheWrite + (l.cacheWrite1h ?? 0);
    row.searches += l.searches;
    ms += l.ms;
    providers.add(l.provider);
  }
  const input = row.tokensIn + row.cacheRead + row.cacheWrite;
  row.usd = r6(row.usd);
  row.ms = row.calls ? Math.round(ms / row.calls) : 0;
  row.cacheHit = input ? row.cacheRead / input : 0;
  if (providers.size === 1) row.provider = [...providers][0];
  return row;
}

function groupBy(lines: readonly UsageLine[], key: (l: UsageLine) => string): UsageRow[] {
  const m = new Map<string, UsageLine[]>();
  for (const l of lines) {
    const id = key(l);
    const list = m.get(id);
    if (list) list.push(l);
    else m.set(id, [l]);
  }
  return [...m.entries()].map(([id, ls]) => rowOf(id, ls)).sort((a, b) => b.usd - a.usd || b.calls - a.calls);
}

/* ── waste flags ── */

/** Two calls of a feature this close together, with the same model and nearly the same input, count as a repeat. */
export const DUPLICATE_MS = 10_000;
/** A cached feature reading back less than this share of its input is missing its cache. */
export const LOW_CACHE_HIT = 0.3;
/** A feature sending at least this much input a call, with no cache at all, could use one. */
export const UNCACHED_INPUT = 8_000;
/** One call's input past this is oversized. */
export const OVERSIZED_INPUT = 50_000;
/** Searches a call may run at most (api/_skippy/budget.ts SEARCH_MAX). */
export const SEARCH_CAP = 3;
const CUTOFF = new Set(["max_tokens", "length", "MAX_TOKENS", "refusal", "SAFETY", "model_context_window_exceeded"]);

export function wasteFlags(lines: readonly UsageLine[]): WasteFlag[] {
  const flags: WasteFlag[] = [];
  const sorted = [...lines].sort((a, b) => a.at - b.at);
  const byFeature = new Map<string, UsageLine[]>();
  for (const l of sorted) byFeature.set(l.feature, [...(byFeature.get(l.feature) ?? []), l]);

  // Repeats: the same feature, model and input size again within seconds (a double tap, a retry that wasn't needed).
  for (const [feature, ls] of byFeature) {
    const last = new Map<string, UsageLine>();
    let n = 0;
    let usd = 0;
    for (const l of ls) {
      if (l.batch || !l.ok) continue;
      const prev = last.get(l.model);
      const size = inOf(l);
      if (prev && l.at - prev.at <= DUPLICATE_MS && size > 500 && Math.abs(size - inOf(prev)) <= size * 0.02) {
        n += 1;
        usd += l.usd;
      }
      last.set(l.model, l);
    }
    if (n > 0) flags.push({ kind: "duplicate", tone: "warn", feature, usd: r6(usd), text: `${feature} ran the same-sized call again within ${DUPLICATE_MS / 1000} s ${n} time${n === 1 ? "" : "s"}, ${money(usd)} for repeats.` });
  }

  for (const [feature, ls] of byFeature) {
    const ok = ls.filter((l) => l.ok && l.provider === "anthropic");
    if (ok.length < 5) continue;
    const row = rowOf(feature, ok);
    const input = row.tokensIn + row.cacheRead + row.cacheWrite;
    const avgIn = input / ok.length;
    if (row.cacheWrite + row.cacheRead > 0 && row.cacheHit < LOW_CACHE_HIT) {
      // What the writes cost over plain input (0.25x of the input rate at 5 minutes), against what the reads saved.
      flags.push({ kind: "cache", tone: "warn", feature, usd: 0, text: `${feature} caches its prompt but reads only ${pct(row.cacheHit)} of its input back (${k(row.cacheWrite)} written, ${k(row.cacheRead)} read over ${ok.length} calls): the cache expires before the next call, or its prefix changes.` });
    } else if (row.cacheWrite + row.cacheRead === 0 && avgIn >= UNCACHED_INPUT && ok.length >= 10) {
      flags.push({ kind: "uncached", tone: "info", feature, usd: 0, text: `${feature} sends about ${k(avgIn)} tokens a call with no prompt cache over ${ok.length} calls; a cached prefix would cut repeated input to a tenth.` });
    }
  }

  const big = sorted.filter((l) => l.ok && inOf(l) > OVERSIZED_INPUT);
  if (big.length) {
    const top = groupBy(big, (l) => l.feature).slice(0, 3);
    const usd = big.reduce((s, l) => s + l.usd, 0);
    flags.push({ kind: "oversized", tone: "warn", usd: r6(usd), feature: top[0]?.key, text: `${big.length} call${big.length === 1 ? "" : "s"} sent over ${k(OVERSIZED_INPUT)} tokens of input (${top.map((t) => `${t.key} ${t.calls}`).join(", ")}), ${money(usd)} in all.` });
  }

  // Gemini failing and the ask going on to Claude: a Gemini error or empty answer, then Claude within 30 s.
  const gem = sorted.filter((l) => l.provider === "google" && (!l.ok || l.stop === "empty"));
  if (gem.length) {
    let after = 0;
    let usd = gem.reduce((s, l) => s + l.usd, 0);
    for (const g of gem) {
      const next = sorted.find((l) => l.provider === "anthropic" && l.at >= g.at && l.at - g.at <= 30_000);
      if (next) {
        after += 1;
        usd += next.usd;
      }
    }
    flags.push({ kind: "fallback", tone: "warn", feature: gem[0]?.feature, usd: r6(usd), text: `Gemini failed or came back empty ${gem.length} time${gem.length === 1 ? "" : "s"}${after ? `; ${after} went on to Claude, ${money(usd)} for both tries` : ""}.` });
  }

  for (const [feature, ls] of byFeature) {
    const searching = ls.filter((l) => l.searches > 0);
    const maxed = searching.filter((l) => l.searches >= SEARCH_CAP);
    if (searching.length >= 3 && maxed.length / searching.length >= 0.3) {
      flags.push({ kind: "searches", tone: "info", feature, usd: r6(maxed.reduce((s, l) => s + l.usd, 0)), text: `${feature} hit its ${SEARCH_CAP}-search limit on ${maxed.length} of ${searching.length} searching calls: the question may be too broad, or the limit too low for it.` });
    }
  }

  const cut = sorted.filter((l) => l.ok && l.stop && CUTOFF.has(l.stop));
  if (cut.length) {
    const usd = cut.reduce((s, l) => s + l.usd, 0);
    const top = groupBy(cut, (l) => l.feature).slice(0, 3);
    flags.push({ kind: "cutoff", tone: "warn", usd: r6(usd), feature: top[0]?.key, text: `${cut.length} answer${cut.length === 1 ? " was" : "s were"} cut off or refused and still cost ${money(usd)} (${top.map((t) => `${t.key} ${t.calls}`).join(", ")}): raise max_tokens or trim the ask.` });
  }

  const errs = sorted.filter((l) => !l.ok);
  if (errs.length && errs.length / Math.max(1, sorted.length) >= 0.05) {
    const usd = errs.reduce((s, l) => s + l.usd, 0);
    const top = groupBy(errs, (l) => l.feature).slice(0, 3);
    flags.push({ kind: "errors", tone: usd > 0 ? "warn" : "info", usd: r6(usd), feature: top[0]?.key, text: `${errs.length} of ${sorted.length} calls failed (${top.map((t) => `${t.key} ${t.calls}`).join(", ")})${usd > 0 ? `, ${money(usd)} still billed` : ", nothing billed"}.` });
  }

  return flags.sort((a, b) => (a.tone === b.tone ? b.usd - a.usd : a.tone === "warn" ? -1 : 1));
}

/* ── the report ── */

const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

/** The days of a window ending today (UTC), oldest first. */
export function windowDays(now: number, days: number): string[] {
  const d = new Date(now);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i)).toISOString().slice(0, 10));
  return out;
}

/** The days the month-to-date covers (UTC), oldest first. */
export function monthDays(now: number): string[] {
  const d = new Date(now);
  return windowDays(now, d.getUTCDate());
}

function truthRows(window: readonly UsageLine[], days: readonly string[], truth: Truth, env: Env): TruthRow[] {
  const keyed: Record<TruthProvider, string> = { anthropic: "ANTHROPIC_ADMIN_KEY", openai: "OPENAI_ADMIN_KEY" };
  return PROVIDERS.map((provider): TruthRow => {
    const mine = window.filter((l) => l.provider === provider);
    if (provider === "google") return { provider, state: "ledger", billed: null, ledger: r6(mine.reduce((s, l) => s + l.usd, 0)), gap: null, models: [] };
    const t = truth[provider];
    const reported = t ? days.filter((d) => t.days[d]) : [];
    const sameDays = new Set(reported);
    const ledgerSame = mine.filter((l) => sameDays.has(dayKey(l.at)));
    const ledger = r6(ledgerSame.reduce((s, l) => s + l.usd, 0));
    if (!t || (!t.ok && !reported.length)) {
      const state = !env[keyed[provider]]?.trim() && !t ? "waiting" : t && !t.ok ? "failed" : "waiting";
      return { provider, state, ...(t && { pulledAt: t.pulledAt }), billed: null, ledger: r6(mine.reduce((s, l) => s + l.usd, 0)), gap: null, models: [] };
    }
    const byModel = new Map<string, { billed: number; ledger: number }>();
    for (const d of reported) for (const [m, v] of Object.entries(t.days[d] ?? {})) byModel.set(m, { billed: (byModel.get(m)?.billed ?? 0) + v.usd, ledger: byModel.get(m)?.ledger ?? 0 });
    for (const l of ledgerSame) byModel.set(l.model, { billed: byModel.get(l.model)?.billed ?? 0, ledger: (byModel.get(l.model)?.ledger ?? 0) + l.usd });
    const billed = r6([...byModel.values()].reduce((s, v) => s + v.billed, 0));
    return {
      provider,
      state: t.ok ? "ok" : "failed",
      pulledAt: t.pulledAt,
      billed,
      ledger,
      gap: r6(billed - ledger),
      models: [...byModel.entries()].map(([model, v]) => ({ model, billed: r6(v.billed), ledger: r6(v.ledger) })).sort((a, b) => b.billed - a.billed || b.ledger - a.ledger).slice(0, 8),
    };
  });
}

/**
 * The report. `lines`: every ledger line of the window and of this month so far (either may be longer; each part
 * picks its own days). `days`: the window's length, ending today (UTC).
 */
export function buildReport(lines: readonly UsageLine[], truth: Truth, opts: { now: number; days: number; env: Env }): UsageReport {
  const { now, env } = opts;
  const days = windowDays(now, opts.days);
  const inWindow = new Set(days);
  const window = lines.filter((l) => inWindow.has(dayKey(l.at)));
  const inMonth = new Set(monthDays(now));
  const month = lines.filter((l) => inMonth.has(dayKey(l.at)));

  const byProvider = PROVIDERS.map((p) => rowOf(p, window.filter((l) => l.provider === p)));
  const byDay = days.map((day) => {
    const usd = { anthropic: 0, google: 0, openai: 0 } as Record<Provider, number>;
    let calls = 0;
    for (const l of window) {
      if (dayKey(l.at) !== day) continue;
      usd[l.provider] += l.usd;
      calls += 1;
    }
    for (const p of PROVIDERS) usd[p] = r6(usd[p]);
    return { day, usd, calls };
  });

  const d = new Date(now);
  const monthUsd = month.reduce((s, l) => s + l.usd, 0);
  const daysIn = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(1, (now - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) / 86_400_000);
  const monthBy = { anthropic: 0, google: 0, openai: 0 } as Record<Provider, number>;
  for (const l of month) monthBy[l.provider] += l.usd;
  for (const p of PROVIDERS) monthBy[p] = r6(monthBy[p]);

  return {
    now,
    days: opts.days,
    from: days[0] ?? "",
    to: days[days.length - 1] ?? "",
    month: { label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }), usd: r6(monthUsd), calls: month.length, projected: r6((monthUsd / elapsed) * daysIn), byProvider: monthBy },
    caps: CAP_GROUPS.map((g) => ({ id: g.id, label: g.label, features: g.features, cap: capOf(env[g.setting], g.fallback), usd: r6(month.filter((l) => g.features.some((f) => l.feature.startsWith(f))).reduce((s, l) => s + l.usd, 0)) })),
    totals: rowOf("all", window),
    byProvider,
    byFeature: groupBy(window, (l) => l.feature),
    byModel: groupBy(window, (l) => l.model || "unknown"),
    byDay,
    drivers: groupBy(window, (l) => `${l.feature} · ${l.model || "unknown"}`).slice(0, 6),
    flags: wasteFlags(window),
    truth: truthRows(window, days, truth, env),
  };
}

/** One ledger line read back from a day's file, or null when it isn't one (an old or broken line). */
export function readLine(raw: string): UsageLine | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const l = v as Partial<UsageLine>;
  if (!l || typeof l !== "object" || typeof l.at !== "number" || typeof l.feature !== "string" || !PROVIDERS.includes(l.provider as Provider)) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  return {
    at: l.at,
    provider: l.provider as Provider,
    model: typeof l.model === "string" ? l.model : "",
    feature: l.feature,
    tokensIn: n(l.tokensIn),
    tokensOut: n(l.tokensOut),
    cacheWrite: n(l.cacheWrite),
    cacheWrite1h: n(l.cacheWrite1h),
    cacheRead: n(l.cacheRead),
    searches: n(l.searches),
    usd: n(l.usd),
    ms: n(l.ms),
    ok: l.ok !== false,
    ...(typeof l.status === "number" && { status: l.status }),
    ...(typeof l.stop === "string" && { stop: l.stop }),
    ...(l.batch === true && { batch: true }),
  };
}
