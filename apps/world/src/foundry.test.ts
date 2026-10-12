import { describe, expect, it } from "vitest";
import { crewFor, crewWork, parseChecks, parseCrates, type GhIssue } from "./foundry.ts";

const NOW = Date.parse("2026-10-12T22:00:00Z");

function issue(n: number, labels: string[], extra: Partial<GhIssue> = {}): GhIssue {
  return { number: n, title: `Issue ${n}`, state: "open", html_url: `https://github.com/x/${n}`, updated_at: "2026-10-12T21:00:00Z", labels: labels.map((name) => ({ name })), ...extra };
}

describe("parseCrates", () => {
  it("reads kind, state and rung from labels", () => {
    const [c] = parseCrates([issue(1, ["foundry", "foundry:fix", "foundry:working", "rung:2"])], NOW);
    expect(c).toMatchObject({ number: 1, kind: "fix", state: "working", rung: 2 });
  });

  it("drops pull requests, untyped issues, and closed issues that never shipped", () => {
    const crates = parseCrates(
      [
        issue(1, ["foundry", "foundry:fix"], { pull_request: {} }),
        issue(2, ["foundry"]),
        issue(3, ["foundry", "foundry:idea"], { state: "closed", closed_at: "2026-10-12T21:30:00Z" }),
        issue(4, ["bug"]),
      ],
      NOW,
    );
    expect(crates).toEqual([]);
  });

  it("keeps shipped crates for a day", () => {
    const crates = parseCrates(
      [
        issue(5, ["foundry", "foundry:upkeep", "foundry:shipped"], { state: "closed", closed_at: "2026-10-12T20:00:00Z" }),
        issue(6, ["foundry", "foundry:upkeep", "foundry:shipped"], { state: "closed", closed_at: "2026-10-10T20:00:00Z" }),
      ],
      NOW,
    );
    expect(crates.map((c) => [c.number, c.state])).toEqual([[5, "shipped"]]);
  });

  it("treats stuck over ready over working", () => {
    const [c] = parseCrates([issue(7, ["foundry", "foundry:build", "foundry:working", "foundry:ready", "foundry:stuck"])], NOW);
    expect(c!.state).toBe("stuck");
  });
});

describe("crewFor", () => {
  it("sends first-try fixes to Skippy, harder rungs and builds to Rocky, the rest to Rusty", () => {
    expect(crewFor({ kind: "fix", rung: null })).toBe("semicolon");
    expect(crewFor({ kind: "fix", rung: 1 })).toBe("semicolon");
    expect(crewFor({ kind: "fix", rung: 3 })).toBe("caret");
    expect(crewFor({ kind: "build", rung: null })).toBe("caret");
    expect(crewFor({ kind: "upkeep", rung: null })).toBe("tessellate");
    expect(crewFor({ kind: "idea", rung: null })).toBe("tessellate");
  });
});

describe("crewWork", () => {
  it("gives each crew member the crate that matters most and ignores waiting ideas", () => {
    const crates = parseCrates(
      [
        issue(1, ["foundry", "foundry:fix", "foundry:ready", "rung:1"]),
        issue(2, ["foundry", "foundry:fix", "foundry:stuck", "rung:1"]),
        issue(3, ["foundry", "foundry:idea"]),
      ],
      NOW,
    );
    const work = crewWork(crates);
    expect(work.semicolon?.number).toBe(2);
    expect(work.caret).toBeNull();
    expect(work.tessellate).toBeNull();
  });
});

describe("parseChecks", () => {
  it("maps the latest run to pass, fail or running", () => {
    expect(parseChecks([]).state).toBe("unknown");
    expect(parseChecks([{ status: "in_progress", conclusion: null, html_url: "u", updated_at: "2026-10-12T21:00:00Z" }]).state).toBe("running");
    expect(parseChecks([{ status: "completed", conclusion: "failure", html_url: "u", updated_at: "2026-10-12T21:00:00Z" }]).state).toBe("fail");
    expect(parseChecks([{ status: "completed", conclusion: "success", html_url: "u", updated_at: "2026-10-12T21:00:00Z" }]).state).toBe("pass");
  });
});
