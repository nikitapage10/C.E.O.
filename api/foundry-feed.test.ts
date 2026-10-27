import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("the Desk's GitHub feeds", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const feeds = {
    "foundry-feed": () => import("./foundry-feed.ts"),
    "foundry-usage": () => import("./foundry-usage.ts"),
  };
  for (const [name, load] of Object.entries(feeds)) {
    const url = `https://example.test/api/${name}`;

    it(`${name}: an unknown query redirects to the bare URL with no GitHub read`, async () => {
      const { GET } = await load();
      const res = await GET(new Request(`${url}?z=123`));
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe(`/api/${name}`);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`${name}: calls within the TTL share one set of GitHub reads, and the headers stay the same`, async () => {
      const { GET } = await load();
      const first = await GET(new Request(url));
      const reads = fetchMock.mock.calls.length;
      expect(reads).toBeGreaterThan(0);
      const second = await GET(new Request(url));
      expect(fetchMock.mock.calls.length).toBe(reads);
      expect(await second.text()).toBe(await first.text());
      expect(first.headers.get("Cache-Control")).toMatch(/^public, s-maxage=\d+, stale-while-revalidate=\d+$/);
      vi.advanceTimersByTime(61_000);
      await GET(new Request(url));
      expect(fetchMock.mock.calls.length).toBeGreaterThan(reads);
    });

    it(`${name}: simultaneous requests share one set of reads`, async () => {
      const { GET } = await load();
      await Promise.all([1, 2, 3].map(() => GET(new Request(url))));
      const together = fetchMock.mock.calls.length;
      // Past every memo, the build timings' ten minutes included, so the next call makes the same full set of reads.
      vi.advanceTimersByTime(601_000);
      fetchMock.mockClear();
      await GET(new Request(url));
      expect(together).toBe(fetchMock.mock.calls.length);
    });
  }
});

describe("the open pull requests on the Foundry feed (#432)", () => {
  it("links each to its issue and sums its checks, and keeps no title or body", async () => {
    const { checksOf, linkedIssue, readOpen } = await import("./foundry-feed.ts");
    expect(linkedIssue("chat/432-foundry-fit", "")).toBe(432);
    expect(linkedIssue("foundry/fix/12-red-main", "Closes #9")).toBe(12);
    expect(linkedIssue("tidy-up", "Some work\n\nCloses #77")).toBe(77);
    expect(linkedIssue("tidy-up", "Mentions #77 only")).toBeNull();
    expect(checksOf({ check_runs: [] })).toBe("unknown");
    expect(checksOf({ check_runs: [{ status: "completed", conclusion: "success" }, { status: "in_progress", conclusion: null }] })).toBe("running");
    expect(checksOf({ check_runs: [{ status: "completed", conclusion: "failure" }, { status: "in_progress", conclusion: null }] })).toBe("fail");
    expect(checksOf({ check_runs: [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "skipped" }] })).toBe("pass");
    const list = [{ number: 5, html_url: "https://github.com/x/pull/5", created_at: "2026-10-25T00:00:00Z", draft: true, title: "Secret-ish title", body: "Closes #3", head: { ref: "x", sha: "abc1234" } }];
    const got = await readOpen(list, async () => ({ check_runs: [{ status: "completed", conclusion: "success", started_at: "2026-10-25T00:01:00Z", completed_at: "2026-10-25T00:09:00Z" }] }));
    expect(got).toEqual([{ number: 5, html_url: "https://github.com/x/pull/5", created_at: "2026-10-25T00:00:00Z", draft: true, issue: 3, checks: "pass", checksAt: "2026-10-25T00:01:00Z", greenAt: "2026-10-25T00:09:00Z" }]);
  });
});

describe("build progress on the Foundry feed (#488)", () => {
  it("times a head commit's checks: first start, and last finish only once green", async () => {
    const { checkTimes } = await import("./foundry-feed.ts");
    expect(checkTimes({ check_runs: [] })).toEqual({ checksAt: null, greenAt: null });
    const runs = [
      { status: "completed", conclusion: "success", started_at: "2026-10-27T07:02:00Z", completed_at: "2026-10-27T07:06:00Z" },
      { status: "completed", conclusion: "success", started_at: "2026-10-27T07:01:00Z", completed_at: "2026-10-27T07:14:00Z" },
    ];
    expect(checkTimes({ check_runs: runs })).toEqual({ checksAt: "2026-10-27T07:01:00Z", greenAt: "2026-10-27T07:14:00Z" });
    expect(checkTimes({ check_runs: [...runs, { status: "in_progress", conclusion: null, started_at: "2026-10-27T07:03:00Z", completed_at: null }] })).toEqual({ checksAt: "2026-10-27T07:01:00Z", greenAt: null });
  });

  it("lists the issues with a pushed branch, numbers only", async () => {
    const { branchIssues } = await import("./foundry-feed.ts");
    expect(branchIssues([{ name: "chat/488-build-progress" }, { name: "foundry/build/30-x" }, { name: "main" }, { name: "dependabot/npm/x-1" }, { name: "foundry-shots" }])).toEqual([30, 488]);
    expect(branchIssues([{ ref: "refs/heads/chat/481-holo" }, { ref: "refs/heads/foundry/fix/12-red" }])).toEqual([12, 481]);
    expect(branchIssues(null)).toEqual([]);
  });

  it("times each merged pull request's milestones, with no title, body or branch", async () => {
    const { readTimings } = await import("./foundry-feed.ts");
    const closed = [
      { number: 487, created_at: "2026-10-27T07:10:00Z", merged_at: "2026-10-27T07:30:00Z", merge_commit_sha: "m487", title: "t", body: "Closes #481", head: { ref: "chat/481-holo", sha: "abc1234" } },
      { number: 470, created_at: "2026-10-26T07:10:00Z", merged_at: null, head: { ref: "x", sha: "abc1235" } },
    ];
    const deploys = { workflow_runs: [{ head_sha: "m487", conclusion: "success", updated_at: "2026-10-27T07:36:00Z" }] };
    const got = await readTimings(
      closed,
      async () => [{ commit: { committer: { date: "2026-10-27T07:05:00Z" } } }],
      async () => ({ check_runs: [{ status: "completed", conclusion: "success", started_at: "2026-10-27T07:11:00Z", completed_at: "2026-10-27T07:25:00Z" }] }),
      deploys,
    );
    expect(got).toEqual([{ issue: 481, pushed: "2026-10-27T07:05:00Z", opened: "2026-10-27T07:10:00Z", checksAt: "2026-10-27T07:11:00Z", greenAt: "2026-10-27T07:25:00Z", merged: "2026-10-27T07:30:00Z", deployed: "2026-10-27T07:36:00Z" }]);
  });
});
