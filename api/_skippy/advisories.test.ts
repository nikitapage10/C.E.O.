import { describe, expect, it, vi } from "vitest";
import { OSV_BATCH, SEVERE_SHOWN, advisoryCache, advisoryLine, lookupAdvisories, readSummary, severityOf, stackBrief, stackLines, wantsStack, type AdvisorySummary } from "./advisories.ts";
import { LOCKED_PACKAGES } from "./stackDeps.ts";
import { STACK_FACTS } from "./stack.ts";
import { pickBlob } from "../_blob.ts";

vi.mock("@vercel/blob", async () => (await import("../_desk/fakeBlob.ts")).fakeBlob);

const NOW = Date.parse("2026-10-23T18:00:00Z");
const PKGS = [
  ["lodash", "4.17.15", 0],
  ["vite", "8.0.0", 1],
  ["react", "19.3.1", 0],
] as const;

/** OSV, stubbed: lodash has two advisories (one high), vite one critical, react none. */
function osv(opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (opts.fail) return new Response("down", { status: 503 });
    if (u === OSV_BATCH) {
      const q = JSON.parse(String(init?.body)) as { queries: { package: { name: string } }[] };
      const byName: Record<string, { id: string }[]> = { lodash: [{ id: "GHSA-aaaa-bbbb-cccc" }, { id: "GHSA-low0-low0-low0" }], vite: [{ id: "GHSA-crit-crit-crit" }] };
      return Response.json({ results: q.queries.map((x) => (byName[x.package.name] ? { vulns: byName[x.package.name] } : {})) });
    }
    const id = decodeURIComponent(u.slice(u.lastIndexOf("/") + 1));
    const sev: Record<string, unknown> = { "GHSA-aaaa-bbbb-cccc": { database_specific: { severity: "HIGH" } }, "GHSA-low0-low0-low0": { database_specific: { severity: "LOW" } }, "GHSA-crit-crit-crit": { severity: [{ type: "CVSS_V3", score: "9.8" }] } };
    return Response.json(sev[id] ?? {});
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("the advisory lookup (#312)", () => {
  it("reads severity from GitHub's rating, then a CVSS score", () => {
    expect(severityOf({ database_specific: { severity: "CRITICAL" } })).toBe("critical");
    expect(severityOf({ database_specific: { severity: "MODERATE" } })).toBe("moderate");
    expect(severityOf({ severity: [{ type: "CVSS_V3", score: "7.5" }] })).toBe("high");
    expect(severityOf({ severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N" }] })).toBe("unknown");
    expect(severityOf(null)).toBe("unknown");
  });

  it("counts advisories by severity and names the critical and high ones, runtime first", async () => {
    const { fetcher } = osv();
    const a = await lookupAdvisories(fetcher, NOW, PKGS);
    expect(a).toMatchObject({ packages: 3, advisories: 3, affected: 2, runtimeAffected: 1, counts: { critical: 1, high: 1, low: 1, moderate: 0, unknown: 0 } });
    expect(a.severe).toEqual([
      { id: "GHSA-crit-crit-crit", pkg: "vite 8.0.0", severity: "critical", dev: true },
      { id: "GHSA-aaaa-bbbb-cccc", pkg: "lodash 4.17.15", severity: "high", dev: false },
    ]);
    const line = advisoryLine(a);
    expect(line).toContain("3 across 2 of the 3 locked packages");
    expect(line).toContain("GHSA-crit-crit-crit (vite 8.0.0, critical, dev only)");
  });

  it("says plainly when nothing is known, and when the lookup didn't answer", () => {
    const none: AdvisorySummary = { at: new Date(NOW).toISOString(), packages: 447, advisories: 0, affected: 0, runtimeAffected: 0, counts: { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 }, severe: [] };
    expect(advisoryLine(none)).toContain("none known for any of the 447 locked packages");
    expect(advisoryLine(null)).toContain("didn't answer");
  });

  it("asks OSV once, then answers from memory; a failed lookup waits ten minutes", async () => {
    const ok = osv();
    const cache = advisoryCache({ fetcher: ok.fetcher, blob: null, key: "k" });
    expect((await cache(NOW))?.packages).toBe(LOCKED_PACKAGES.length);
    const after = ok.calls.length;
    await cache(NOW + 60 * 60_000);
    expect(ok.calls.length).toBe(after);

    const down = osv({ fail: true });
    const failing = advisoryCache({ fetcher: down.fetcher, blob: null, key: "k" });
    expect(await failing(NOW)).toBeNull();
    await failing(NOW + 5 * 60_000);
    expect(down.calls).toHaveLength(1);
    await failing(NOW + 11 * 60_000);
    expect(down.calls).toHaveLength(2);
  });

  it("keeps the summary in the blob store for the same lockfile, so a cold function doesn't ask again", async () => {
    const blob = pickBlob({ BLOB_STORE_ID: "store_adv" })!;
    const first = osv();
    await advisoryCache({ fetcher: first.fetcher, blob, key: "lock-1" })(NOW);
    const second = osv();
    expect((await advisoryCache({ fetcher: second.fetcher, blob, key: "lock-1" })(NOW + 60_000))?.advisories).toBeGreaterThanOrEqual(0);
    expect(second.calls).toEqual([]);
    // A new lockfile looks again.
    const third = osv();
    await advisoryCache({ fetcher: third.fetcher, blob, key: "lock-2" })(NOW + 60_000);
    expect(third.calls.length).toBeGreaterThan(0);
  });

  it("refuses a stored summary that isn't one, and trims what it keeps", () => {
    expect(readSummary({ at: "nope" })).toBeNull();
    expect(readSummary("x")).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `GHSA-${i}000-0000-0000`, pkg: "p 1.0.0 <b>", severity: "high", dev: false }));
    const s = readSummary({ at: new Date(NOW).toISOString(), packages: 1, advisories: 12, affected: 1, runtimeAffected: 1, counts: { high: 12 }, severe: [...many, { id: "<script>", pkg: "x", severity: "high" }] })!;
    expect(s.severe).toHaveLength(SEVERE_SHOWN);
    expect(s.severe[0]!.pkg).not.toMatch(/[<>]/);
  });
});

describe("the <stack> block", () => {
  it("says what we run and what we don't, small enough for the chat's budget", () => {
    const text = stackLines(null);
    expect(text).toContain("TypeScript");
    expect(text).toMatch(/None at all of [^.]*PHP/);
    expect(text).toContain("Vercel");
    expect(text).toContain("Azure Functions");
    expect(text).toContain("@anthropic-ai/sdk");
    expect(STACK_FACTS.languages.absent).toEqual(expect.arrayContaining(["PHP", "Python", "Java"]));
    // About a thousand tokens at most.
    expect(text.length).toBeLessThan(4_000);
  });
});

describe("when the whole sheet goes in", () => {
  it("only for asks about our tech; otherwise one line that still rules out PHP", () => {
    for (const ask of ["Are we exposed to the new PHP security flaw?", "any CVE in our packages", "what version of React do we run", "is the Vercel outage hitting us", "CVE-2026-1234 affect us?", "what do we run on"]) expect(wantsStack(ask), ask).toBe(true);
    for (const ask of ["Who do I start at kicker?", "good morning Skippy", "what's building?"]) expect(wantsStack(ask), ask).toBe(false);
    expect(stackBrief()).toMatch(/no PHP/);
    expect(stackBrief().length).toBeLessThan(300);
  });
});
