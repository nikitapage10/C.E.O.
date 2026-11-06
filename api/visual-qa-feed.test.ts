import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestOf, type VisualQaFeed } from "./visual-qa-feed.ts";

const URL_ = "https://example.test/api/visual-qa-feed";
const RUN = "https://github.com/nikitapage10/C.E.O./actions/runs/77";
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const run = (over: Record<string, unknown> = {}) => ({
  workflow_runs: [{ id: 77, conclusion: "success", created_at: "2026-11-05T02:00:00Z", updated_at: "2026-11-05T02:10:00Z", html_url: RUN, ...over }],
});
const named = (...names: string[]) => ({ artifacts: names.map((name) => ({ name })) });

describe("latestOf", () => {
  it("reads the run's state, time and link, and the headline from the artifact name", () => {
    expect(latestOf(run(), named("recording", "visual-qa-summary-v1-reviewed-r9-f3-b1"))).toEqual({
      at: "2026-11-05T02:10:00Z",
      url: RUN,
      run: "pass",
      review: "reviewed",
      rooms: 9,
      findings: 3,
      blockers: 1,
    });
  });

  it("maps failures, timeouts and anything else, and falls back to created_at", () => {
    const states = ["failure", "timed_out", "cancelled", null].map((conclusion) => latestOf(run({ conclusion, updated_at: undefined }), null)?.run);
    expect(states).toEqual(["fail", "fail", "other", "other"]);
    expect(latestOf(run({ updated_at: undefined }), null)?.at).toBe("2026-11-05T02:00:00Z");
  });

  it("shows an unknown review with zero counts when the headline is missing or malformed", () => {
    for (const artifacts of [null, {}, named("recording"), named("visual-qa-summary-v1-bogus-r1-f1-b1"), { artifacts: [null, 3, { name: 5 }] }]) {
      expect(latestOf(run(), artifacts)).toMatchObject({ review: "unknown", rooms: 0, findings: 0, blockers: 0 });
    }
  });

  it("returns null with no run, or a run whose link or time isn't what GitHub sends", () => {
    expect(latestOf(null, null)).toBeNull();
    expect(latestOf({ workflow_runs: [] }, null)).toBeNull();
    expect(latestOf({ workflow_runs: ["x"] }, null)).toBeNull();
    expect(latestOf(run({ html_url: "https://evil.test/nikitapage10/C.E.O./actions/runs/77" }), null)).toBeNull();
    expect(latestOf(run({ html_url: `${RUN}?x=1` }), null)).toBeNull();
    expect(latestOf(run({ updated_at: "yesterday", created_at: "soon" }), null)).toBeNull();
  });
});

describe("the Visual QA feed", () => {
  const load = async (table: (path: string) => Response) => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => table(new URL(String(input)).pathname.replace("/repos/nikitapage10/C.E.O.", "")));
    vi.stubGlobal("fetch", fetchMock);
    return { ...(await import("./visual-qa-feed.ts")), fetchMock };
  };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("answers the latest run with its headline and caches the response", async () => {
    const { GET, fetchMock } = await load((path) =>
      path.endsWith("/visual-qa.yml/runs") ? json(run()) : path === "/actions/runs/77/artifacts" ? json(named("visual-qa-summary-v1-partial-r4-f0-b0")) : json({}, 404),
    );
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
    const body = (await res.json()) as VisualQaFeed;
    expect(body.at).toBe("2026-11-06T00:00:00.000Z");
    expect(body.latest).toMatchObject({ run: "pass", review: "partial", rooms: 4, findings: 0, blockers: 0, url: RUN });
    await GET(new Request(URL_));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still answers the run when the artifact list can't be read", async () => {
    const { GET } = await load((path) => (path.endsWith("/visual-qa.yml/runs") ? json(run()) : json({}, 500)));
    const body = (await (await GET(new Request(URL_))).json()) as VisualQaFeed;
    expect(body.latest).toMatchObject({ run: "pass", review: "unknown" });
  });

  it("answers no run before the workflow exists on main (404)", async () => {
    const { GET } = await load(() => json({ message: "Not Found" }, 404));
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    expect(((await res.json()) as VisualQaFeed).latest).toBeNull();
  });

  it("answers a 502 that names nothing when GitHub fails", async () => {
    const { GET } = await load(() => json({ message: "secret detail" }, 500));
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "github" });
  });

  it("sends a request with a query to the canonical path", async () => {
    const { GET, fetchMock } = await load(() => json(run()));
    const res = await GET(new Request(`${URL_}?x=1`));
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/api/visual-qa-feed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
