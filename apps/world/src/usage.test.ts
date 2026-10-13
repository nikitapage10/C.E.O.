import { describe, expect, it } from "vitest";
import { costOf, shapedBody, tidyShort, usageLine } from "../../../api/foundry.ts";
import { assignedModel, codeTokensByModel, formatSpan, formatTokens, formatUsd, foundryJobs, monthSpend, periodStart, readClaudeCode, readDuration, readSpend, weekStart, windowSpend, workByModel, type Job, type Trail, type UsageIssue } from "./usage.ts";

describe("shaping writes the Short line", () => {
  it("tidies Haiku's short line: one line, sentence case, four words at most, no full stop", () => {
    expect(tidyShort("speeding up the Lattice.")).toBe("Speeding up the Lattice");
    expect(tidyShort("  Adding   a podium  ")).toBe("Adding a podium");
    expect(tidyShort("Making the whole Desk load much faster")).toBe("Making the whole Desk");
    expect(tidyShort("")).toBe("");
  });
  it("writes it under the size", () => {
    const body = shapedBody({ title: "Idea: x", pitch: "Faster.", size: "small", short: "Speeding up the Lattice", builder: "Rusty", model: "Sonnet" }, "make it fast");
    expect(body).toMatch(/^\*\*Pitch:\*\* Faster\.\n\*\*Size:\*\* small\n\*\*Short:\*\* Speeding up the Lattice\n\*\*Builder:\*\* Rusty \(Sonnet\)/);
    expect(shapedBody({ title: "Idea: x", pitch: "P.", size: "small", short: "", builder: "Rusty", model: "Sonnet" }, "w")).not.toContain("**Short:**");
  });
});

const H = 3_600_000;

describe("the price of a shaping call", () => {
  it("prices Haiku 5.5 from the call's own tokens", () => {
    // 1,000,000 in at $0.10 and 100,000 out at $0.50 per million would be long-prompt priced, so keep it small.
    expect(costOf({ input_tokens: 2_000, output_tokens: 400 })).toBeCloseTo((2_000 * 0.1 + 400 * 0.5) / 1e6, 12);
    expect(costOf({ input_tokens: 1_000, output_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 1_000 })).toBeCloseTo((1_000 * 0.1 + 10_000 * 0.01 + 1_000 * 0.125) / 1e6, 12);
  });
  it("uses the long-prompt price past 100K tokens in", () => {
    expect(costOf({ input_tokens: 200_000, output_tokens: 1_000 })).toBeCloseTo((200_000 * 0.5 + 1_000 * 2.5) / 1e6, 12);
  });
  it("writes a trail line the Desk reads back exactly", () => {
    const usage = { input_tokens: 1_234, output_tokens: 210 };
    const line = usageLine(usage);
    expect(line).toBe("Used 1,234 tokens in and 210 out, $0.000228.");
    expect(readSpend(`**Trail · Shaped:** Rusty on Claude Haiku (claude-haiku-5-5), 1.2 s. ${line}`)).toEqual({ tokensIn: 1_234, tokensOut: 210, usd: 0.000228 });
    expect(readSpend("**Trail · Shaped:** the Builder (Opus).")).toBeNull();
  });
});

describe("this month's shaping spend", () => {
  const now = Date.UTC(2026, 9, 13, 12);
  const shaped = (at: string, tokensIn: number, out: number, usd: string): Trail => ({ issue: 1, at, body: `**Trail · Shaped:** Rusty on Claude Haiku. Used ${tokensIn.toLocaleString("en-US")} tokens in and ${out} out, $${usd}.` });
  it("adds up only this month's Shaped steps that carry a cost", () => {
    const trails: Trail[] = [
      shaped("2026-10-01T00:00:00Z", 1_000, 100, "0.000150"),
      shaped("2026-10-12T22:00:00Z", 2_500, 300, "0.000400"),
      shaped("2026-09-30T23:59:59Z", 9_000, 900, "0.001350"), // last month
      { issue: 2, at: "2026-10-12T00:00:00Z", body: "**Trail · Shaped:** the Builder (Opus). It waits for Nikita's pick." }, // the plan, not the API
      { issue: 3, at: "2026-10-12T00:00:00Z", body: "**Trail · Origin:** Used 5 tokens in and 5 out, $9.000000." }, // not a Shaped step
    ];
    const spend = monthSpend(trails, now);
    expect(spend.month).toBe("October 2026");
    expect(spend.calls).toBe(2);
    expect(spend.tokensIn).toBe(3_500);
    expect(spend.tokensOut).toBe(400);
    expect(spend.usd).toBeCloseTo(0.00055, 9);
  });
  it("is zero with no calls", () => {
    expect(monthSpend([], now)).toMatchObject({ calls: 0, usd: 0 });
  });
});

describe("Foundry work by model", () => {
  const issue = (number: number, labels: string[], extra: Partial<UsageIssue> = {}): UsageIssue => ({ number, title: `#${number}`, state: "closed", created_at: "2026-10-01T00:00:00Z", closed_at: null, body: "", labels: ["foundry", ...labels], ...extra });
  const trail = (n: number, at: string, body: string): Trail => ({ issue: n, at, body });

  it("reads the model from the Assigned step, then the Builder line, then the rung", () => {
    expect(assignedModel("**Trail · Assigned:** the Builder (Opus) gives this to a Rusty clone on Sonnet, it's wiring.")).toBe("Sonnet");
    const jobs = foundryJobs(
      [
        issue(1, ["foundry:build", "foundry:shipped"], { body: "**Builder:** Rusty (Sonnet)" }),
        issue(2, ["foundry:chat", "foundry:shipped"], { body: "**Builder:** Rocky (Opus)", closed_at: "2026-10-01T02:00:00Z" }),
        issue(3, ["foundry:fix", "foundry:shipped", "rung:1"], { closed_at: "2026-10-01T00:30:00Z" }),
        issue(4, ["foundry:upkeep", "foundry:shipped"], { closed_at: "2026-10-01T00:10:00Z" }),
      ],
      [trail(1, "2026-10-02T10:00:00Z", "**Trail · Assigned:** Rusty on Opus: it's design."), trail(1, "2026-10-02T13:00:00Z", "**Trail · Shipped:** abc1234 on main.")],
    );
    expect(jobs.map((j) => [j.issue, j.model])).toEqual([
      [1, "Opus"],
      [2, "Opus"],
      [3, "Haiku"],
      [4, "Sonnet"],
    ]);
    expect(jobs[0]!.end! - jobs[0]!.start).toBe(3 * H);
    expect(jobs[1]!.end! - jobs[1]!.start).toBe(2 * H);
  });

  it("times a build from its approval when nobody wrote an Assigned step", () => {
    const [job] = foundryJobs([issue(5, ["foundry:build", "foundry:shipped"], { closed_at: "2026-10-03T05:00:00Z" })], [trail(5, "2026-10-03T03:00:00Z", "Approved for building (picked on the Desk).")]);
    expect(job!.end! - job!.start).toBe(2 * H);
  });

  it("leaves out queued work, dropped work and ideas", () => {
    const jobs = foundryJobs(
      [
        issue(6, ["foundry:build"], { state: "open" }), // approved, nobody on it yet
        issue(7, ["foundry:fix"]), // closed without shipping
        issue(8, ["foundry:idea"], { state: "open" }),
        issue(9, ["foundry:build", "foundry:working"], { state: "open" }),
      ],
      [],
    );
    expect(jobs.map((j) => j.issue)).toEqual([9]);
    expect(jobs[0]!.end).toBeNull();
  });

  it("counts this week's share of each job and keeps running jobs going to now", () => {
    const now = new Date(2026, 9, 14, 12).getTime(); // Wednesday noon, local
    const monday = weekStart(now);
    expect(new Date(monday).getDay()).toBe(1);
    expect(new Date(monday).getHours()).toBe(0);
    const jobs: Job[] = [
      { issue: 1, model: "Opus", start: monday - 2 * H, end: monday + 1 * H }, // straddles Monday: 1h this week
      { issue: 2, model: "Opus", start: monday - 10 * H, end: monday - 5 * H }, // last week only
      { issue: 3, model: "Sonnet", start: now - 3 * H, end: null }, // running
    ];
    const all = workByModel(jobs, "all", now);
    const week = workByModel(jobs, "week", now);
    expect(all.Opus).toEqual({ jobs: 2, ms: 8 * H, running: 0 });
    expect(week.Opus).toEqual({ jobs: 1, ms: 1 * H, running: 0 });
    expect(week.Sonnet).toEqual({ jobs: 1, ms: 3 * H, running: 1 });
    expect(all.Haiku.jobs).toBe(0);
  });
});

describe("the tabs' windows", () => {
  const now = new Date(2026, 9, 14, 12).getTime(); // Wednesday noon, local
  it("starts each window where the tab says", () => {
    expect(periodStart("5h", now)).toBe(now - 5 * H);
    expect(periodStart("today", now)).toBe(new Date(2026, 9, 14).getTime());
    expect(periodStart("week", now)).toBe(new Date(2026, 9, 12).getTime()); // Monday
    expect(periodStart("all", now)).toBe(-Infinity);
  });
  it("counts a job's time only inside each window", () => {
    const jobs: Job[] = [
      { issue: 1, model: "Opus", start: now - 8 * H, end: now - 4 * H }, // 4h ago..8h ago: 1h in the last 5h, 4h today
      { issue: 2, model: "Haiku", start: now - 30 * H, end: now - 29 * H }, // yesterday
    ];
    expect(workByModel(jobs, "5h", now).Opus).toEqual({ jobs: 1, ms: 1 * H, running: 0 });
    expect(workByModel(jobs, "5h", now).Haiku.jobs).toBe(0);
    expect(workByModel(jobs, "today", now).Opus.ms).toBe(4 * H);
    expect(workByModel(jobs, "today", now).Haiku.jobs).toBe(0);
    expect(workByModel(jobs, "week", now).Haiku.jobs).toBe(1);
  });
  it("windows the shaping spend by each comment's date", () => {
    const shaped = (at: number, usd: string): Trail => ({ issue: 1, at: new Date(at).toISOString(), body: `**Trail · Shaped:** Rusty. Used 100 tokens in and 10 out, $${usd}.` });
    const trails = [shaped(now - 1 * H, "0.01"), shaped(now - 6 * H, "0.02"), shaped(now - 40 * H, "0.04")];
    expect(windowSpend(trails, "5h", now).usd).toBeCloseTo(0.01, 9);
    expect(windowSpend(trails, "today", now).calls).toBe(2);
    expect(windowSpend(trails, "all", now).usd).toBeCloseTo(0.07, 9);
  });
});

describe("Claude Code lines on Shipped steps", () => {
  it("reads tokens, model and run time in the formats the Builder writes", () => {
    expect(readClaudeCode("**Trail · Shipped:** abc on main.\nClaude Code: 291k tokens on Opus, 1 h 50 min.")).toEqual([{ model: "Opus", tokens: 291_000, ms: 110 * 60_000 }]);
    expect(readClaudeCode("Claude Code: 64k tokens on Haiku, 3 min.")).toEqual([{ model: "Haiku", tokens: 64_000, ms: 3 * 60_000 }]);
    expect(readClaudeCode("Claude Code: 89k tokens on Sonnet, 5 min.")[0]).toMatchObject({ model: "Sonnet", tokens: 89_000 });
    expect(readClaudeCode("Claude Code: 1.2M tokens on opus")).toEqual([{ model: "Opus", tokens: 1_200_000, ms: null }]);
    expect(readClaudeCode("Claude Code: 12,345 tokens on Sonnet, 45 s.")).toEqual([{ model: "Sonnet", tokens: 12_345, ms: 45_000 }]);
    expect(readClaudeCode("**Trail · Shipped:** abc on main.")).toEqual([]);
    expect(readClaudeCode("Claude Code: lots of tokens on Opus")).toEqual([]);
  });
  it("reads durations", () => {
    expect(readDuration("1 h 50 min.")).toBe(110 * 60_000);
    expect(readDuration("3 min")).toBe(180_000);
    expect(readDuration("nothing")).toBeNull();
  });
  it("shows tokens short, and a dash where none are recorded", () => {
    expect(formatTokens(291_000)).toBe("291k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(64_500)).toBe("64.5k");
    expect(formatTokens(850)).toBe("850");
    expect(formatTokens(null)).toBe("\u2014");
  });
  it("sums every line on every Shipped comment inside the window, by the comment's date", () => {
    const now = new Date(2026, 9, 14, 12).getTime();
    const at = (ms: number) => new Date(ms).toISOString();
    const trails: Trail[] = [
      { issue: 1, at: at(now - 1 * H), body: "**Trail · Shipped:** a1 on main.\nClaude Code: 100k tokens on Opus, 20 min.\nClaude Code: 50k tokens on Sonnet, 5 min." },
      { issue: 1, at: at(now - 2 * H), body: "**Trail · Shipped:** a2 follow-up.\nClaude Code: 91k tokens on Opus, 9 min." },
      { issue: 2, at: at(now - 30 * H), body: "**Trail · Shipped:** b on main.\nClaude Code: 64k tokens on Haiku, 3 min." },
      { issue: 3, at: at(now - 1 * H), body: "**Trail · Work:** Claude Code: 999k tokens on Opus" }, // not a Shipped step
    ];
    expect(codeTokensByModel(trails, "5h", now)).toEqual({ Haiku: null, Sonnet: 50_000, Opus: 191_000 });
    expect(codeTokensByModel(trails, "all", now)).toEqual({ Haiku: 64_000, Sonnet: 50_000, Opus: 191_000 });
    expect(codeTokensByModel([], "all", now)).toEqual({ Haiku: null, Sonnet: null, Opus: null });
  });
});

describe("usage formats", () => {
  it("shows spans and small dollar amounts plainly", () => {
    expect(formatSpan(45 * 60_000)).toBe("45m");
    expect(formatSpan(3 * H + 20 * 60_000)).toBe("3h 20m");
    expect(formatSpan(53 * H)).toBe("2d 5h");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.00042)).toBe("$0.0004");
    expect(formatUsd(1.371)).toBe("$1.37");
  });
});
