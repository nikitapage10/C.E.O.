import { describe, expect, it } from "vitest";
import { assignCrew, crewFor, crewLoad, crewOf, crewWork, lastUpkeep, parseChangelog, parseChecks, parseCrates, shippedToday, type Crate, type GhCommit, type GhIssue, type GhPull, readBody, visibleUpkeep } from "./foundry.ts";

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
  it("sends fixes by rung (Rivet, Rusty, Rocky), builds to the named builder or Rusty, the rest to Rusty", () => {
    expect(crewFor({ kind: "fix", rung: null })).toBe("semicolon");
    expect(crewFor({ kind: "fix", rung: 1 })).toBe("semicolon");
    expect(crewFor({ kind: "fix", rung: 2 })).toBe("tessellate");
    expect(crewFor({ kind: "fix", rung: 3 })).toBe("caret");
    expect(crewFor({ kind: "build", rung: null })).toBe("tessellate");
    expect(crewFor({ kind: "build", rung: null, builder: "tessellate" })).toBe("tessellate");
    expect(crewFor({ kind: "build", rung: null, builder: "caret" })).toBe("caret");
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

describe("readBody", () => {
  it("reads the pitch and size the Foundry writes into an idea", () => {
    expect(readBody("**Pitch:** Make it faster.\n\n**Size:** Medium. **Builder:** Rocky.")).toEqual({ pitch: "Make it faster.", size: "medium", builder: "caret" });
  });
  it("is empty for a plain issue", () => {
    expect(readBody("just words")).toEqual({ pitch: "", size: null, builder: null });
  });
});

describe("visibleUpkeep", () => {
  const at = Date.UTC(2026, 9, 13, 3, 0); // between the 00:57 and 06:57 ticks
  const crate = (over: Partial<Crate>): Crate => ({ number: 4, title: "Upkeep", kind: "upkeep", state: "shipped", rung: null, url: "", updatedAt: at - 60_000, pitch: "", size: null, revising: false, ...over });
  it("keeps the latest tick's upkeep in Rusty's hands until the next tick", () => {
    expect(lastUpkeep(at)).toBe(Date.UTC(2026, 9, 13, 0, 57));
    expect(visibleUpkeep([crate({ updatedAt: Date.UTC(2026, 9, 13, 1, 2) })], at)?.number).toBe(4);
  });
  it("lets go of upkeep from before the latest tick", () => {
    expect(visibleUpkeep([crate({ updatedAt: Date.UTC(2026, 9, 12, 23, 30) })], at)).toBeNull();
    expect(visibleUpkeep([crate({ kind: "fix", updatedAt: at })], at)).toBeNull();
  });
});

describe("assignCrew", () => {
  const crate = (number: number, kind: Crate["kind"], state: Crate["state"], rung: Crate["rung"] = null): Crate => ({ number, title: `#${number}`, kind, state, rung, url: "", updatedAt: NOW, pitch: "", size: null, revising: false });

  it("hands builds and chat work to the builder their issue names, Rusty when it names none", () => {
    const by = assignCrew([crate(1, "build", "working"), crate(2, "chat", "working"), { ...crate(3, "chat", "working"), builder: "caret" }]);
    expect(by.get(1)).toBe("tessellate");
    expect(by.get(2)).toBe("tessellate");
    expect(by.get(3)).toBe("caret");
  });

  it("counts the extra jobs a crew member holds as clones", () => {
    expect(crewLoad([crate(1, "fix", "working", 1), crate(2, "upkeep", "working"), crate(3, "build", "working"), crate(4, "chat", "working")])).toEqual({ semicolon: 1, caret: 0, tessellate: 3 });
  });

  it("leaves queued and shipped crates in nobody's hands", () => {
    const by = assignCrew([crate(1, "chat", "queued"), crate(2, "fix", "shipped")]);
    expect(by.size).toBe(0);
    expect(crewOf(crate(1, "chat", "queued"), [])).toBe("tessellate");
  });
});

describe("the changelog", () => {
  const issue = (number: number, labels: string[], closed: string): GhIssue => ({ number, title: `Issue ${number}`, state: "closed", html_url: `https://x/issues/${number}`, updated_at: closed, closed_at: closed, labels: labels.map((name) => ({ name })) });
  const pull = (number: number, ref: string, merged: string | null, body = ""): GhPull => ({ number, title: `PR ${number}`, html_url: `https://x/pull/${number}`, merged_at: merged, body, head: { ref } });

  it("lists shipped issues with the PR or commit that landed them, and merged PRs that had no issue, newest first", () => {
    const issues = [issue(11, ["foundry", "foundry:upkeep", "foundry:shipped"], "2026-10-13T01:00:00Z"), issue(13, ["foundry", "foundry:chat", "foundry:shipped"], "2026-10-13T03:00:00Z"), issue(6, ["foundry", "foundry:idea", "foundry:passed"], "2026-10-12T20:00:00Z")];
    const pulls = [pull(12, "foundry/upkeep/11-lint", "2026-10-13T00:59:00Z"), pull(20, "foundry/fix/99-typo", "2026-10-13T02:00:00Z"), pull(21, "draft", null)];
    const commits: GhCommit[] = [{ sha: "055dfdf123", html_url: "https://x/commit/055dfdf", commit: { message: "Desk: real data only\n\nCloses #13" } }];
    const log = parseChangelog(issues, pulls, commits);
    expect(log.map((c) => c.key)).toEqual(["issue-13", "pr-20", "issue-11"]);
    expect(log[0]!.landed).toEqual({ label: "055dfdf", url: "https://x/commit/055dfdf" });
    expect(log[1]!.kind).toBe("fix");
    expect(log[2]!.landed?.label).toBe("PR #12");
  });

  it("counts what shipped since midnight", () => {
    const now = new Date(2026, 9, 13, 15).getTime();
    const at = (h: number) => ({ key: `${h}`, at: new Date(2026, 9, 13, h).getTime(), title: "", kind: "chat" as const, issue: null, landed: null });
    expect(shippedToday([at(9), at(1), { ...at(0), at: new Date(2026, 9, 12, 23).getTime() }], now)).toBe(2);
  });
});
