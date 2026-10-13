import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecurityFeed } from "./security-feed.ts";

const URL_ = "https://example.test/api/security-feed";
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Secrets an open alert carries that must never reach the public Desk. */
const LEAKS = ["api/foundry.ts", "js/sql-injection", "Untrusted data flows into a query", "lodash", "4.17.20", "CVE-2099-0001", "GHSA-xxxx-yyyy-zzzz", "docs/SECURITY.md:1", "Warn: no linked content"];

const codeAlert = {
  number: 7,
  state: "open",
  rule: { id: "js/sql-injection", description: "Untrusted data flows into a query", severity: "error" },
  most_recent_instance: { location: { path: "api/foundry.ts", start_line: 42 }, message: { text: "Untrusted data flows into a query" } },
  html_url: "https://github.com/nikitapage10/C.E.O./security/code-scanning/7",
};
const depAlert = {
  number: 3,
  state: "open",
  dependency: { package: { name: "lodash", ecosystem: "npm" }, manifest_path: "package-lock.json" },
  security_advisory: { cve_id: "CVE-2099-0001", ghsa_id: "GHSA-xxxx-yyyy-zzzz", summary: "Prototype pollution in lodash" },
  security_vulnerability: { vulnerable_version_range: "< 4.17.21", package: { name: "lodash" } },
  html_url: "https://github.com/nikitapage10/C.E.O./security/dependabot/3",
};
const run = (conclusion: string, id = 101) => ({
  workflow_runs: [{ id, conclusion, status: "completed", created_at: "2026-10-13T08:00:00Z", updated_at: "2026-10-13T08:05:00Z", html_url: `https://github.com/nikitapage10/C.E.O./actions/runs/${id}`, head_commit: { message: "fix api/foundry.ts" } }],
});
const scorecardBody = {
  date: "2026-10-13T19:51:30Z",
  score: 5.9,
  checks: [
    { name: "Security-Policy", score: 4, reason: "security policy file detected", details: ["Info: security policy file detected: docs/SECURITY.md:1", "Warn: no linked content found"], documentation: { short: "Determines if the project has published a security policy.", url: "x" } },
    { name: "Dangerous-Workflow", score: 10, reason: "no dangerous workflow patterns detected", details: null, documentation: { short: "Avoids dangerous patterns." } },
    { name: "<img src=x>", score: 10 },
  ],
};

/** A GitHub stub: answers each path from a table, 404 for anything else. */
function github(over: Partial<Record<string, () => Response>> = {}) {
  const table: Record<string, () => Response> = {
    "/actions/workflows/checks.yml/runs": () => json(run("success", 1)),
    "/actions/workflows/codeql.yml/runs": () => json(run("failure", 2)),
    "/actions/workflows/scorecard.yml/runs": () => json(run("success", 3)),
    "/actions/workflows/dependency-review.yml/runs": () => json(run("cancelled", 4)),
    "/actions/workflows/e2e.yml/runs": () => json({ workflow_runs: [] }),
    "": () => json({ full_name: "nikitapage10/C.E.O.", security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "disabled" } } }),
    "/private-vulnerability-reporting": () => json({ enabled: true }),
    "/code-scanning/alerts?state=open": () => json([codeAlert, codeAlert]),
    "/code-scanning/alerts?state=fixed": () => json([{ ...codeAlert, state: "fixed" }]),
    "/dependabot/alerts?state=open": () => json([depAlert]),
    "/dependabot/alerts?state=fixed": () => json([]),
    ...over,
  };
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "api.securityscorecards.dev") return (over.scorecard ?? (() => json(scorecardBody)))();
    const path = url.pathname.replace("/repos/nikitapage10/C.E.O.", "");
    const state = url.searchParams.get("state");
    const key = path.includes("/alerts") ? `${path}?state=${state}` : path;
    return (table[key] ?? (() => json({ message: "Not Found" }, 404)))();
  });
}

describe("the security feed", () => {
  let fetchMock: ReturnType<typeof github>;
  const load = async (over?: Parameters<typeof github>[0]) => {
    fetchMock = github(over);
    vi.stubGlobal("fetch", fetchMock);
    return import("./security-feed.ts");
  };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports each scan's last result, the switches, alert counts and the Scorecard score", async () => {
    const { GET } = await load();
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityFeed;
    const by = Object.fromEntries(body.workflows.map((w) => [w.id, w]));
    expect(by.checks).toMatchObject({ state: "pass", at: "2026-10-13T08:05:00Z", url: "https://github.com/nikitapage10/C.E.O./actions/runs/1", scope: "main" });
    expect(by.codeql!.state).toBe("fail");
    expect(by["dependency-review"]).toMatchObject({ state: "other", conclusion: "cancelled", scope: "pull request" });
    expect(by.e2e!.state).toBe("none");
    expect(Object.fromEntries(body.features.map((f) => [f.id, f.state]))).toEqual({
      "secret-scanning": "on",
      "push-protection": "off",
      "dependabot-alerts": "on",
      "dependabot-updates": "unreported",
      "private-reporting": "on",
    });
    expect(body.alerts).toEqual({ codeScanning: { open: 2, fixed: 1, more: false }, dependabot: { open: 1, fixed: 0, more: false } });
    expect(body.scorecard).toEqual({
      score: 5.9,
      date: "2026-10-13T19:51:30Z",
      checks: [
        { name: "Security-Policy", score: 4, short: "Determines if the project has published a security policy." },
        { name: "Dangerous-Workflow", score: 10, short: "Avoids dangerous patterns." },
      ],
    });
  });

  it("never lets an alert's or a check's details through: no paths, rules, packages, versions or descriptions", async () => {
    const { GET } = await load();
    const text = await (await GET(new Request(URL_))).text();
    for (const leak of LEAKS) expect(text, leak).not.toContain(leak);
    expect(text).not.toContain("security/code-scanning/7");
    expect(text).not.toContain("<img");
  });

  it("only makes GET reads, to the repo's API and Scorecard", async () => {
    const { GET } = await load();
    await GET(new Request(URL_));
    for (const [input, init] of fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]) {
      expect(String(input)).toMatch(/^https:\/\/(api\.github\.com\/repos\/nikitapage10\/C\.E\.O\.|api\.securityscorecards\.dev\/projects\/github\.com\/nikitapage10\/C\.E\.O\.)/);
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
    }
  });

  it("says 'not reported' for what the token can't read, instead of failing", async () => {
    const forbidden = () => json({ message: "Resource not accessible by integration" }, 403);
    const { GET } = await load({
      "": () => json({ full_name: "nikitapage10/C.E.O." }),
      "/private-vulnerability-reporting": forbidden,
      "/code-scanning/alerts?state=open": forbidden,
      "/code-scanning/alerts?state=fixed": forbidden,
      "/dependabot/alerts?state=open": forbidden,
      "/dependabot/alerts?state=fixed": forbidden,
      "/actions/workflows/e2e.yml/runs": forbidden,
      scorecard: () => json({ error: "not found" }, 404),
    });
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SecurityFeed;
    expect(body.features.every((f) => f.state === "unreported")).toBe(true);
    expect(body.alerts).toEqual({ codeScanning: null, dependabot: null });
    expect(body.scorecard).toBeNull();
    expect(body.workflows.find((w) => w.id === "e2e")!.state).toBe("unreported");
    expect(body.workflows.find((w) => w.id === "checks")!.state).toBe("pass");
  });

  it("fails with 502 and no cache when GitHub answers nothing, and tries again on the next call", async () => {
    const down = () => json({ message: "API rate limit exceeded" }, 403);
    const over = Object.fromEntries(["", "/actions/workflows/checks.yml/runs", "/actions/workflows/codeql.yml/runs", "/actions/workflows/scorecard.yml/runs", "/actions/workflows/dependency-review.yml/runs", "/actions/workflows/e2e.yml/runs"].map((k) => [k, down]));
    const { GET } = await load(over);
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe('{"error":"github"}');
    const before = fetchMock.mock.calls.length;
    await GET(new Request(URL_));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it("survives a network error on every read", async () => {
    const { GET } = await load();
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await GET(new Request(URL_))).status).toBe(502);
  });

  it("drops a run link that isn't the repo's own run page, and an odd date", async () => {
    const { GET } = await load({
      "/actions/workflows/checks.yml/runs": () => json({ workflow_runs: [{ conclusion: "success", updated_at: "yesterday", html_url: "https://evil.example/actions/runs/1" }] }),
    });
    const body = (await (await GET(new Request(URL_))).json()) as SecurityFeed;
    expect(body.workflows[0]).toMatchObject({ id: "checks", state: "pass", at: null, url: null });
  });

  it("counts 100 and more as 100+", async () => {
    const many = () => json(Array.from({ length: 100 }, () => codeAlert));
    const { GET } = await load({ "/code-scanning/alerts?state=fixed": many });
    const body = (await (await GET(new Request(URL_))).json()) as SecurityFeed;
    expect(body.alerts.codeScanning).toEqual({ open: 2, fixed: 100, more: true });
  });

  it("redirects an unknown query to the bare URL with no read, and shares one set of reads within the TTL", async () => {
    const { GET } = await load();
    const redirect = await GET(new Request(`${URL_}?z=1`));
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("Location")).toBe("/api/security-feed");
    expect(fetchMock).not.toHaveBeenCalled();

    const [a, b] = await Promise.all([GET(new Request(URL_)), GET(new Request(URL_))]);
    const reads = fetchMock.mock.calls.length;
    expect(reads).toBe(12); // five runs, the repo, private reporting, four alert lists, Scorecard
    expect(await a.text()).toBe(await b.text());
    expect(a.headers.get("Cache-Control")).toMatch(/^public, s-maxage=\d+, stale-while-revalidate=\d+$/);
    await GET(new Request(URL_));
    expect(fetchMock.mock.calls.length).toBe(reads);
    vi.advanceTimersByTime(121_000);
    await GET(new Request(URL_));
    expect(fetchMock.mock.calls.length).toBe(reads * 2);
  });
});
