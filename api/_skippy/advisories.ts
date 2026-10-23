/**
 * Desk Skippy's <stack> block (#312): what C.E.O. runs on (the generated sheet, api/_skippy/stack.ts) and a short
 * advisory summary for every locked package, from OSV.dev, so "are we exposed to X" gets a yes or no from facts.
 *
 * The advisory lookup is live but cheap: one POST to OSV's querybatch for the lockfile's packages (names and versions
 * only, already public in this repo), then the details of at most ADVISORY_DETAILS advisories it names, for their
 * severity. The summary is kept in the warm function for six hours and in the private blob store for twelve
 * (`desk/skippy/advisories.json`, keyed by the lockfile so a new deploy looks again), and a failed lookup is not tried
 * again for ten minutes. A lookup that fails or runs past its time leaves the summary out; the chat goes on.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash } from "node:crypto";
import type { BlobBackend } from "../_blob.js";
import { STACK_FACTS } from "./stack.js";
import { LOCKED_PACKAGES, STACK_DEPS } from "./stackDeps.js";
import type { StackDeps, StackFacts } from "./stackTypes.js";

export const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
export const OSV_VULN = "https://api.osv.dev/v1/vulns/";
/** OSV takes up to 1,000 queries a batch; smaller batches answer faster. */
const BATCH = 500;
/** The most advisories whose details are fetched for their severity. */
export const ADVISORY_DETAILS = 25;
/** The most severe ones named in the prompt. */
export const SEVERE_SHOWN = 6;
export const LOOKUP_TIMEOUT_MS = 6_000;
const MEMORY_MS = 6 * 60 * 60 * 1000;
const STORED_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const CACHE_PATH = "desk/skippy/advisories.json";

export type Severity = "critical" | "high" | "moderate" | "low" | "unknown";

export interface Advisory {
  id: string;
  /** "name version" of an affected package. */
  pkg: string;
  severity: Severity;
  /** Whether every package it affects is only a dev dependency. */
  dev: boolean;
}

export interface AdvisorySummary {
  /** ISO time of the lookup. */
  at: string;
  packages: number;
  /** Distinct advisories found, and the packages they affect (and how many of those ship at runtime). */
  advisories: number;
  affected: number;
  runtimeAffected: number;
  counts: Record<Severity, number>;
  /** The critical and high ones, most severe first, at most SEVERE_SHOWN. */
  severe: Advisory[];
}

type Locked = readonly (readonly [string, string, 0 | 1])[];

/** A hash of the lockfile's packages: the stored summary is only good for the same set. */
export const lockKey = (packages: Locked = LOCKED_PACKAGES) => createHash("sha256").update(JSON.stringify(packages)).digest("hex").slice(0, 16);

/** An advisory's severity from its OSV record: GitHub's own rating first, then a CVSS score when one is given. */
export function severityOf(record: unknown): Severity {
  const r = (record && typeof record === "object" ? record : {}) as { database_specific?: { severity?: unknown }; severity?: { type?: unknown; score?: unknown }[] };
  const given = typeof r.database_specific?.severity === "string" ? r.database_specific.severity.toLowerCase() : "";
  if (given === "critical" || given === "high" || given === "moderate" || given === "low") return given;
  if (given === "medium") return "moderate";
  for (const s of Array.isArray(r.severity) ? r.severity : []) {
    const n = typeof s?.score === "string" ? Number(s.score) : typeof s?.score === "number" ? s.score : NaN;
    if (Number.isFinite(n)) return n >= 9 ? "critical" : n >= 7 ? "high" : n >= 4 ? "moderate" : "low";
  }
  return "unknown";
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, low: 3, unknown: 4 };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;

/** One lookup against OSV for every locked package. Throws when OSV doesn't answer. */
export async function lookupAdvisories(fetcher: typeof fetch, now: number, packages: Locked = LOCKED_PACKAGES): Promise<AdvisorySummary> {
  const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  const hits = new Map<string, { pkgs: string[]; dev: boolean }>();
  const affected = new Map<string, boolean>();
  for (let i = 0; i < packages.length; i += BATCH) {
    const chunk = packages.slice(i, i + BATCH);
    const res = await fetcher(OSV_BATCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: chunk.map(([name, version]) => ({ package: { name, ecosystem: "npm" }, version })) }),
      signal,
    });
    if (!res.ok) throw new Error(`osv ${res.status}`);
    const body = (await res.json()) as { results?: { vulns?: { id?: unknown }[] }[] };
    (body.results ?? []).forEach((r, j) => {
      const p = chunk[j];
      if (!p) return;
      const pkg = `${p[0]} ${p[1]}`;
      for (const v of r?.vulns ?? []) {
        if (typeof v?.id !== "string" || !ID.test(v.id)) continue;
        const hit = hits.get(v.id) ?? { pkgs: [], dev: true };
        if (!hit.pkgs.includes(pkg)) hit.pkgs.push(pkg);
        hit.dev = hit.dev && p[2] === 1;
        hits.set(v.id, hit);
        affected.set(pkg, (affected.get(pkg) ?? true) && p[2] === 1);
      }
    });
  }
  const ids = [...hits.keys()].sort().slice(0, ADVISORY_DETAILS);
  const severities = new Map<string, Severity>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetcher(`${OSV_VULN}${encodeURIComponent(id)}`, { signal });
        severities.set(id, res.ok ? severityOf(await res.json()) : "unknown");
      } catch {
        severities.set(id, "unknown");
      }
    }),
  );
  const counts: Record<Severity, number> = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  const all: Advisory[] = [];
  for (const [id, hit] of hits) {
    const severity = severities.get(id) ?? "unknown";
    counts[severity]++;
    all.push({ id, pkg: hit.pkgs[0]!, severity, dev: hit.dev });
  }
  const severe = all
    .filter((a) => a.severity === "critical" || a.severity === "high")
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || Number(a.dev) - Number(b.dev) || (a.id < b.id ? -1 : 1))
    .slice(0, SEVERE_SHOWN);
  return {
    at: new Date(now).toISOString(),
    packages: packages.length,
    advisories: hits.size,
    affected: affected.size,
    runtimeAffected: [...affected.values()].filter((dev) => !dev).length,
    counts,
    severe,
  };
}

/** A stored summary, checked on the way in: null when it isn't one. */
export function readSummary(v: unknown): AdvisorySummary | null {
  const s = (v && typeof v === "object" ? v : null) as AdvisorySummary | null;
  if (!s || typeof s.at !== "string" || !Number.isFinite(Date.parse(s.at))) return null;
  const nums = [s.packages, s.advisories, s.affected, s.runtimeAffected];
  if (!nums.every((n) => Number.isInteger(n) && n >= 0) || !s.counts || typeof s.counts !== "object" || !Array.isArray(s.severe)) return null;
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 } as Record<Severity, number>;
  for (const k of Object.keys(counts) as Severity[]) counts[k] = Number.isInteger(s.counts[k]) ? s.counts[k] : 0;
  const severe = s.severe
    .filter((a) => a && typeof a.id === "string" && ID.test(a.id) && typeof a.pkg === "string" && (a.severity === "critical" || a.severity === "high"))
    .slice(0, SEVERE_SHOWN)
    .map((a) => ({ id: a.id, pkg: a.pkg.replace(/[^\w@./ -]/g, "").slice(0, 80), severity: a.severity, dev: a.dev === true }));
  return { at: new Date(Date.parse(s.at)).toISOString(), packages: s.packages, advisories: s.advisories, affected: s.affected, runtimeAffected: s.runtimeAffected, counts, severe };
}

/**
 * The advisory summary, cheaply: the warm function's copy, else the stored one for this lockfile, else one lookup
 * (stored for next time). Null when OSV can't be reached; then it waits ten minutes before trying again.
 */
export function advisoryCache(deps: { fetcher: typeof fetch; blob: BlobBackend | null; key?: string }) {
  const key = deps.key ?? lockKey();
  let kept: { at: number; value: AdvisorySummary | null } | null = null;
  let flying: Promise<AdvisorySummary | null> | null = null;
  const load = async (now: number): Promise<AdvisorySummary | null> => {
    if (deps.blob) {
      try {
        const found = await deps.blob.get(CACHE_PATH);
        const stored = found ? ((await new Response(found.stream).json()) as { key?: unknown; summary?: unknown }) : null;
        const summary = stored && stored.key === key ? readSummary(stored.summary) : null;
        if (summary && now - Date.parse(summary.at) < STORED_MS) return summary;
      } catch {
        // An unreadable copy is looked up again.
      }
    }
    const summary = await lookupAdvisories(deps.fetcher, now);
    if (deps.blob) {
      await deps.blob
        .put(CACHE_PATH, JSON.stringify({ key, summary }), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true })
        .catch(() => undefined);
    }
    return summary;
  };
  return (now: number): Promise<AdvisorySummary | null> => {
    if (kept && now - kept.at < (kept.value ? MEMORY_MS : RETRY_MS)) return Promise.resolve(kept.value);
    flying ??= load(now)
      .catch(() => null)
      .then((value) => {
        kept = { at: now, value };
        return value;
      })
      .finally(() => {
        flying = null;
      });
    return flying;
  };
}

const listOf = (items: string[]) => (items.length ? items.join(", ") : "(none)");

/** The advisory line of the <stack> block. */
export function advisoryLine(a: AdvisorySummary | null): string {
  if (!a) return "Advisories: the OSV.dev lookup didn't answer just now, so no fresh count; CI's npm audit refuses any change with a high or critical advisory.";
  const when = a.at.slice(0, 16).replace("T", " ");
  if (a.advisories === 0) return `Advisories (OSV.dev, checked ${when} UTC): none known for any of the ${a.packages} locked packages.`;
  const counts = (["critical", "high", "moderate", "low", "unknown"] as Severity[]).filter((k) => a.counts[k]).map((k) => `${a.counts[k]} ${k}`).join(", ");
  const severe = a.severe.length ? ` Critical or high: ${a.severe.map((s) => `${s.id} (${s.pkg}, ${s.severity}${s.dev ? ", dev only" : ""})`).join("; ")}.` : " None critical or high.";
  return `Advisories (OSV.dev, checked ${when} UTC): ${a.advisories} across ${a.affected} of the ${a.packages} locked packages (${a.runtimeAffected} of those ship at runtime): ${counts}.${severe}`;
}

/** The <stack> block: the generated sheet in a few lines, then the advisory summary. Kept short for the budget. */
export function stackLines(advisories: AdvisorySummary | null = null, f: StackFacts = STACK_FACTS, d: StackDeps = STACK_DEPS): string {
  const node = [f.node.ci.length ? `Node.js ${f.node.ci.join(", ")} in CI` : "", f.node.azure ? `Node.js ${f.node.azure} on Azure Functions` : "", f.node.engines ? `package.json engines node ${f.node.engines}` : ""].filter(Boolean);
  return [
    "C.E.O.'s own stack, generated from its repo at build time:",
    `Languages: ${listOf(f.languages.present)}. None at all of ${listOf(f.languages.absent)}: no code, no packages, no servers in those.`,
    `Runtime: ${node.join("; ")}. The browser app is React and three.js built with Vite.`,
    `Hosts: ${f.hosts.join(". ")}. ${f.databases.length ? `Database clients: ${f.databases.join(", ")}.` : "No database server: state is JSON in blob storage."}`,
    `Calls out to: ${listOf(f.services)}.`,
    `Checks on every change: ${listOf(f.checks)}.`,
    `Top-level packages (locked versions), runtime: ${listOf(d.dependencies.runtime)}. Build and test only: ${listOf(d.dependencies.dev)}.`,
    `Lockfile: ${d.lockfile.packages} packages in all, ${d.lockfile.runtime} of them outside dev-only.`,
    advisoryLine(advisories),
  ].join("\n");
}

/**
 * Whether an ask is about our tech: then the whole sheet and the advisory lookup go in; otherwise one line does, so
 * small talk doesn't pay for a sheet it doesn't need (the chat runs on about a dollar a month).
 */
const TECH = /\b(?:vuln\w*|cve|ghsa|secur\w*|expos\w*|patch\w*|advisor\w*|exploit\w*|breach\w*|hack\w*|malware|supply.chain|zero.day|0.?day|php|python|java|ruby|golang|rust|\.net|node(?:\.?js)?|npm|packages?|dependenc\w*|depend\w*|librar\w*|stack|framework\w*|runtimes?|host\w*|vercel|azure|servers?|versions?|upgrad\w*|outdated|tech\w*|languages?|database\w*|sdk|react|vite|three\.?js|typescript|wordpress|log4\w*|openssl|run(?:s|ning)? on|built (?:with|on))\b/i;
export const wantsStack = (text: string): boolean => TECH.test(text);

/** The one line Skippy gets when the ask isn't about our tech. */
export function stackBrief(f: StackFacts = STACK_FACTS): string {
  return `C.E.O. is ${f.languages.present.slice(0, 2).join(" and ")} on Node.js${f.node.azure ? ` ${f.node.azure}` : ""}, hosted on Azure; no ${f.languages.absent.slice(0, 3).join(", ")} anywhere. (The full stack sheet comes in when an ask is about our tech.)`;
}
