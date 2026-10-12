import { describe, expect, it } from "vitest";
import { assignCrew, crewFor, crewOf, crewWork, lastUpkeep, parseChecks, parseCrates, type Crate, type GhIssue, readBody, visibleUpkeep } from "./foundry.ts";

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

describe("readBody", () => {
  it("reads the pitch and size the Foundry writes into an idea", () => {
    expect(readBody("**Pitch:** Make it faster.\n\n**Size:** Medium. **Builder:** Rocky.")).toEqual({ pitch: "Make it faster.", size: "medium" });
  });
  it("is empty for a plain issue", () => {
    expect(readBody("just words")).toEqual({ pitch: "", size: null });
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

  it("hands chat work to whoever is free, first responder first", () => {
    const by = assignCrew([crate(1, "build", "working"), crate(2, "chat", "working")]);
    expect(by.get(1)).toBe("caret");
    expect(by.get(2)).toBe("semicolon");
  });

  it("moves on to Rusty when Skippy holds a fix, and rides with Skippy when everyone is busy", () => {
    const busySkippy = assignCrew([crate(1, "fix", "working", 1), crate(2, "chat", "working")]);
    expect(busySkippy.get(2)).toBe("tessellate");
    const all = assignCrew([crate(1, "fix", "working", 1), crate(2, "upkeep", "working"), crate(3, "build", "working"), crate(4, "chat", "working")]);
    expect(all.get(4)).toBe("semicolon");
  });

  it("leaves queued and shipped crates in nobody's hands", () => {
    const by = assignCrew([crate(1, "chat", "queued"), crate(2, "fix", "shipped")]);
    expect(by.size).toBe(0);
    expect(crewOf(crate(1, "chat", "queued"), [])).toBe("semicolon");
  });
});
