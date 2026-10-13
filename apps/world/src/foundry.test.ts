import { describe, expect, it } from "vitest";
import { DOCK_CREW, MAX_AT_ONCE, MAX_RUNNING, SPARE_BAYS, assignCrew, rustyHands, shifts, waitingTurn, blueprintCrate, sparesAwake, crewFor, crewLoad, modelOf, crewOf, crewWork, lastUpkeep, parseChangelog, parseChecks, parseCrates, shippedToday, type Crate, type GhCommit, type GhIssue, type GhPull, readBody, visibleUpkeep } from "./foundry.ts";

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
  it("sends tiny fixes to Rivet, other fixes and unnamed builds to Rusty, and named builds to their builder", () => {
    expect(crewFor({ kind: "fix", rung: null })).toBe("semicolon");
    expect(crewFor({ kind: "fix", rung: 1 })).toBe("semicolon");
    expect(crewFor({ kind: "fix", rung: 2 })).toBe("tessellate");
    expect(crewFor({ kind: "fix", rung: 3 })).toBe("tessellate");
    expect(crewFor({ kind: "build", rung: null })).toBe("tessellate");
    expect(crewFor({ kind: "build", rung: null, builder: "tessellate" })).toBe("tessellate");
    expect(crewFor({ kind: "build", rung: null, builder: "caret" })).toBe("caret");
    expect(crewFor({ kind: "upkeep", rung: null })).toBe("tessellate");
    expect(crewFor({ kind: "idea", rung: null })).toBe("tessellate");
  });
});

describe("modelOf", () => {
  it("reads the model from the Builder line, else the rung, else the crew member's usual one", () => {
    expect(readBody("**Builder:** Rusty (Opus)").model).toBe("Opus");
    // Extra words in the brackets, like the effort, don't hide the model.
    expect(readBody("**Builder:** Rusty (Opus, medium effort)").model).toBe("Opus");
    expect(readBody("**Builder:** Rocky (Opus high)").model).toBe("Opus");
    expect(readBody("**Builder:** Rusty ( sonnet )").model).toBe("Sonnet");
    expect(readBody("**Builder:** Rusty (Opusly)").model).toBeNull();
    expect(modelOf({ rung: null, model: "Opus" }, "tessellate")).toBe("Opus");
    expect(modelOf({ rung: 2 }, "tessellate")).toBe("Sonnet");
    expect(modelOf({ rung: null }, "caret")).toBe("Opus");
    expect(modelOf({ rung: null }, "tessellate")).toBe("Sonnet");
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
    expect(readBody("**Pitch:** Make it faster.\n\n**Size:** Medium. **Builder:** Rocky.")).toEqual({ pitch: "Make it faster.", size: "medium", builder: "caret", images: [], model: null });
  });
  it("reads attached pictures from the markdown", () => {
    expect(readBody("**Pitch:** Look.\n\n![Picture 1](https://x.public.blob.vercel-storage.com/a.jpg)\n![Picture 2](https://x.public.blob.vercel-storage.com/b.png)\n![bad](http://no.tls/c.png)").images).toEqual(["https://x.public.blob.vercel-storage.com/a.jpg", "https://x.public.blob.vercel-storage.com/b.png"]);
  });
  it("is empty for a plain issue", () => {
    expect(readBody("just words")).toEqual({ pitch: "", size: null, builder: null, images: [], model: null });
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

  it("counts every job a crew member holds", () => {
    expect(crewLoad([crate(1, "fix", "working", 1), crate(2, "upkeep", "working"), crate(3, "build", "working"), crate(4, "chat", "working")])).toEqual({ semicolon: 1, caret: 0, tessellate: 3 });
  });

  it("leaves queued and shipped crates in nobody's hands", () => {
    const by = assignCrew([crate(1, "chat", "queued"), crate(2, "fix", "shipped")]);
    expect(by.size).toBe(0);
    expect(crewOf(crate(1, "chat", "queued"), [])).toBe("tessellate");
  });

  it("wakes one of the dock crew for each job really running past Rusty's first", () => {
    expect(sparesAwake([])).toBe(0);
    expect(sparesAwake([crate(1, "upkeep", "working")])).toBe(0);
    expect(sparesAwake([crate(1, "upkeep", "working"), crate(2, "fix", "working", 2)])).toBe(1);
    // Three jobs on the line: Rusty plus Dusty and Gusty.
    expect(sparesAwake([1, 2, 3].map((n) => crate(n, "build", "working")))).toBe(2);
    const lots = [1, 2, 3, 4, 5, 6].map((n) => crate(n, "fix", "working", 2));
    expect(sparesAwake(lots)).toBe(SPARE_BAYS);
    expect(DOCK_CREW.map((d) => d.name)).toEqual(["Dusty", "Gusty", "Musty"]);
  });

  it("keeps the dock crew asleep for jobs that aren't really running", () => {
    // Queued work, ideas waiting for a pick, jobs waiting on Nikita and stuck ones don't wake anybody.
    const idle = [crate(1, "build", "working"), crate(2, "chat", "queued"), crate(3, "idea", "queued"), crate(4, "build", "ready"), crate(5, "fix", "stuck", 2), crate(6, "upkeep", "shipped")];
    expect(sparesAwake(idle)).toBe(0);
    expect(crewLoad(idle).tessellate).toBe(3);
  });

  it("runs Rusty's four oldest jobs and leaves a fifth waiting its turn", () => {
    const five = [5, 1, 4, 2, 3].map((n) => crate(n, "build", "working"));
    const { running, waiting } = shifts(five, "tessellate");
    expect(MAX_RUNNING.tessellate).toBe(4);
    expect(running.map((c) => c.number)).toEqual([1, 2, 3, 4]);
    expect(waiting.map((c) => c.number)).toEqual([5]);
    expect(sparesAwake(five)).toBe(3);
    expect([...waitingTurn(five)]).toEqual([5]);
    expect([...rustyHands(five)]).toEqual([
      [1, "Rusty"],
      [2, "Dusty"],
      [3, "Gusty"],
      [4, "Musty"],
    ]);
  });

  it("gives Rocky one job at a time; his second waits", () => {
    const rocky = (n: number): Crate => ({ ...crate(n, "build", "working"), builder: "caret" });
    const { running, waiting } = shifts([rocky(8), rocky(7)], "caret");
    expect(MAX_RUNNING.caret).toBe(1);
    expect(running.map((c) => c.number)).toEqual([7]);
    expect(waiting.map((c) => c.number)).toEqual([8]);
  });

  it("runs at most four jobs across the crew: Rocky's one counts against Rusty's", () => {
    const jobs = [{ ...crate(1, "build", "working"), builder: "caret" as const }, ...[2, 3, 4, 5].map((n) => crate(n, "build", "working"))];
    expect(MAX_AT_ONCE).toBe(4);
    expect(shifts(jobs, "caret").running.map((c) => c.number)).toEqual([1]);
    expect(shifts(jobs, "tessellate").running.map((c) => c.number)).toEqual([2, 3, 4]);
    expect([...waitingTurn(jobs)]).toEqual([5]);
    expect(sparesAwake(jobs)).toBe(2);
  });

  it("never holds back urgent work: Rivet's fixes sit outside the four, and a fix of Rusty's goes ahead of his newest build", () => {
    const fixes = [1, 2, 3, 4, 5, 6].map((n) => crate(n, "fix", "working", 1));
    expect(shifts(fixes, "semicolon").waiting).toEqual([]);
    const busy = [...[1, 2, 3, 4].map((n) => crate(n, "build", "working")), ...fixes.map((c) => ({ ...c, number: c.number + 10 }))];
    expect(waitingTurn(busy).size).toBe(0);
    const rustyFix = [...[1, 2, 3, 4].map((n) => crate(n, "build", "working")), crate(9, "fix", "working", 2)];
    expect([...rustyHands(rustyFix)]).toEqual([
      [9, "Rusty"],
      [1, "Dusty"],
      [2, "Gusty"],
      [3, "Musty"],
    ]);
    expect([...waitingTurn(rustyFix)]).toEqual([4]);
  });

  it("counts a build paused for a fix as not running", () => {
    const jobs = [crate(1, "build", "working"), { ...crate(2, "build", "working"), paused: true }];
    expect(sparesAwake(jobs)).toBe(0);
    expect(waitingTurn(jobs).size).toBe(0);
  });
});

describe("blueprintCrate", () => {
  const crate = (number: number, kind: Crate["kind"], state: Crate["state"], size: Crate["size"], updatedAt = NOW): Crate => ({ number, title: `#${number}`, kind, state, rung: null, url: "", updatedAt, pitch: "", size, revising: false });

  it("is empty with nothing open or upcoming", () => {
    expect(blueprintCrate([])).toBeNull();
    expect(blueprintCrate([crate(1, "fix", "working", "large"), crate(2, "build", "shipped", "large")])).toBeNull();
  });

  it("picks the biggest open build or upcoming idea", () => {
    const picked = blueprintCrate([crate(1, "idea", "queued", "small"), crate(2, "idea", "queued", "large"), crate(3, "build", "working", "medium")]);
    expect(picked?.number).toBe(2);
  });

  it("breaks a tie by the one being built, then the newest", () => {
    expect(blueprintCrate([crate(1, "idea", "queued", "medium", NOW + 5), crate(2, "build", "working", "medium")])?.number).toBe(2);
    expect(blueprintCrate([crate(1, "idea", "queued", null, NOW), crate(2, "idea", "queued", null, NOW + 1)])?.number).toBe(2);
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
