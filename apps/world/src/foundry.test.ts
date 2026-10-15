import { describe, expect, it } from "vitest";
import { changeSource, withTrails, MAX_PICTURES, pictureUrl, readPictures, CREW, CREW_ORDER, CREW_RANK, DOCK_CREW, MAX_AT_ONCE, MAX_RUNNING, SPARE_BAYS, assignCrew, rustyHands, shifts, waitingTurn, blueprintCrate, sparesAwake, crewJob, dockJobs, crewFor, crewLoad, modelOf, crewOf, crewWork, lastUpkeep, parseChangelog, recentWork, parseChecks, parseE2e, CHECKS_LINK, parseCrates, shippedToday, ideaCounts, openIdeas, type Crate, type GhCommit, type GhIssue, type GhPull, readBody, visibleUpkeep } from "./foundry.ts";

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

  it("shows a job the Builder flagged as blocked (#135) as stuck, waiting on Nikita", () => {
    const [c] = parseCrates([issue(8, ["foundry", "foundry:build", "foundry:working", "foundry:blocked"])], NOW);
    expect(c!.state).toBe("stuck");
  });
});

describe("ideas Rivet asks about first", () => {
  const body = "**Pitch:** Add a thing.\n**Size:** small\n**Builder:** Rusty (Sonnet)\n**Question:** Which page?\n\n**From Nikita (on the Desk):**\n\nadd a thing";
  it("marks an idea with foundry:question as asking, with its question", () => {
    const [c] = parseCrates([issue(9, ["foundry", "foundry:idea", "foundry:question"], { body })], NOW);
    expect(c).toMatchObject({ kind: "idea", asking: true, revising: false, question: "Which page?" });
  });
  it("is not asking without the label, and is never build work", () => {
    const [c] = parseCrates([issue(9, ["foundry", "foundry:idea"], { body })], NOW);
    expect(c!.asking).toBe(false);
    expect(c!.kind).toBe("idea");
  });
  it("only ideas ask", () => {
    const [c] = parseCrates([issue(9, ["foundry", "foundry:build", "foundry:question"], { body })], NOW);
    expect(c!.asking).toBe(false);
  });
  it("the pending card holds until the feed carries the question", async () => {
    const { useFoundry, pendingIdea, EMPTY_FOUNDRY } = await import("./foundry.ts");
    const card = { ...pendingIdea("add a thing", NOW), number: 9 };
    const store = useFoundry.getState();
    store.addPending(card);
    store.shapePending(9, { title: "Idea: Add a thing", pitch: "p", size: "small", short: "", builder: "tessellate", question: "Which page?" });
    expect(useFoundry.getState().pending[0]).toMatchObject({ asking: true, revising: false });
    // The feed has the issue, shaped but without the question label yet: the card stays.
    store.set({ ...EMPTY_FOUNDRY, crates: parseCrates([issue(9, ["foundry", "foundry:idea"], { body: "**Pitch:** p" })], NOW) });
    expect(useFoundry.getState().pending).toHaveLength(1);
    store.set({ ...EMPTY_FOUNDRY, crates: parseCrates([issue(9, ["foundry", "foundry:idea", "foundry:question"], { body })], NOW) });
    expect(useFoundry.getState().pending).toHaveLength(0);
  });
});

describe("questions apart from ideas waiting for a pick", () => {
  const ask = "**Pitch:** p\n**Question:** Which page?";
  const crates = parseCrates(
    [
      issue(3, ["foundry", "foundry:idea", "foundry:question"], { body: ask }),
      issue(1, ["foundry", "foundry:idea"], { body: "**Pitch:** p" }),
      issue(2, ["foundry", "foundry:idea", "foundry:question", "foundry:revise"], { body: ask }),
      issue(4, ["foundry", "foundry:build"], { body: "**Pitch:** p" }),
    ],
    NOW,
  );
  it("lists open ideas by issue number, pending cards last", () => {
    const sent = { ...crates[0]!, number: -5 };
    expect(openIdeas(crates, [sent]).map((c) => c.number)).toEqual([1, 2, 3, -5]);
  });
  it("counts questions apart from picks, and skips ideas being reshaped", () => {
    const { questions, toPick } = ideaCounts(openIdeas(crates, []));
    expect(questions.map((c) => c.number)).toEqual([3]);
    expect(toPick).toBe(1);
  });
  it("has no questions when nothing asks", () => {
    expect(ideaCounts([])).toEqual({ questions: [], toPick: 0 });
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

describe("parseE2e", () => {
  const run = (event: string, conclusion: string | null, status = "completed") => ({ status, conclusion, html_url: event, updated_at: "2026-10-12T21:00:00Z", event });
  it("reads the newest nightly run and ignores pull request runs", () => {
    expect(parseE2e(undefined).state).toBe("unknown");
    expect(parseE2e([]).state).toBe("unknown");
    expect(parseE2e([run("pull_request", "failure"), run("schedule", "success")])).toMatchObject({ state: "pass", url: "schedule" });
    expect(parseE2e([run("schedule", "failure")]).state).toBe("fail");
    expect(parseE2e([run("workflow_dispatch", null, "in_progress")]).state).toBe("running");
    expect(CHECKS_LINK.fail).toBe("down");
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
    expect(readBody("**Pitch:** Make it faster.\n\n**Size:** Medium. **Builder:** Rocky.")).toEqual({ pitch: "Make it faster.", size: "medium", builder: "caret", images: [], model: null, short: "", question: "" });
  });
  it("reads attached pictures as names in the private store, and only the Desk's own (#127)", () => {
    const body = "**Pitch:** Look.\n\n![Picture 1](https://ceo.example/api/foundry-image?p=foundry%2Fideas%2Fold.jpg)\n![other](https://x.public.blob.vercel-storage.com/a.jpg)\n![bad](http://no.tls/c.png)\n\n**Pictures:** 1, kept private and shown only on the Desk (foundry/ideas/b.png)";
    expect(readBody(body).images).toEqual(["foundry/ideas/old.jpg", "foundry/ideas/b.png"]);
  });
  it("reads Rivet's question line", () => {
    const body = "**Pitch:** Add a thing.\n**Size:** small\n**Builder:** Rusty (Sonnet)\n**Question:** Should it also work on the phone?\n\n**From Nikita (on the Desk):**\n\nadd a thing";
    expect(readBody(body).question).toBe("Should it also work on the phone?");
    expect(readBody(body).pitch).toBe("Add a thing.");
    expect(readBody("**Pitch:** No question here.").question).toBe("");
  });
  it("is empty for a plain issue", () => {
    expect(readBody("just words")).toEqual({ pitch: "", size: null, builder: null, images: [], model: null, short: "", question: "" });
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
    const at = (h: number) => ({ key: `${h}`, at: new Date(2026, 9, 13, h).getTime(), title: "", kind: "chat" as const, issue: null, landed: null, by: null, short: "", approval: "none" as const, origin: "chat" as const });
    expect(shippedToday([at(9), at(1), { ...at(0), at: new Date(2026, 9, 12, 23).getTime() }], now)).toBe(2);
  });
});

describe("recentWork", () => {
  const shipped = (n: number, labels: string[], closed: string, body = ""): GhIssue => ({ number: n, title: ` Title ${n} `, state: "closed", html_url: `https://x/issues/${n}`, updated_at: closed, closed_at: closed, body, labels: ["foundry", "foundry:shipped", ...labels].map((name) => ({ name })) });
  const log = parseChangelog(
    [
      shipped(1, ["foundry:build"], "2026-10-12T01:00:00Z", "**Builder:** Rocky (Opus)"),
      shipped(2, ["foundry:build"], "2026-10-12T02:00:00Z", "**Short:** Crew recents\n**Builder:** Rusty (Sonnet)"),
      shipped(3, ["foundry:fix", "rung:1"], "2026-10-12T03:00:00Z"),
      shipped(4, ["foundry:fix", "rung:1"], "2026-10-12T04:00:00Z"),
      shipped(5, ["foundry:fix", "rung:1"], "2026-10-12T05:00:00Z"),
      shipped(6, ["foundry:fix", "rung:1"], "2026-10-12T06:00:00Z"),
      shipped(7, ["foundry:chat"], "2026-10-12T07:00:00Z"),
    ],
    [],
    [],
  );

  it("reads the Short line and attributes by Builder line, fix rung and Rusty by default", () => {
    expect(readBody("**Short:** Hi there").short).toBe("Hi there");
    expect(recentWork(log, "caret")).toEqual([{ number: 1, url: "https://x/issues/1", name: "Title 1", at: Date.parse("2026-10-12T01:00:00Z") }]);
    expect(recentWork(log, "tessellate").map((r) => [r.number, r.name])).toEqual([[7, "Title 7"], [2, "Crew recents"]]);
  });

  it("lists the newest three, newest first, and is empty with nothing shipped", () => {
    expect(recentWork(log, "semicolon").map((r) => r.number)).toEqual([6, 5, 4]);
    expect(recentWork([], "caret")).toEqual([]);
  });
});

describe("the Short line", () => {
  it("reads the short line under the size", () => {
    expect(readBody("**Pitch:** Faster.\n**Size:** small\n**Short:** Speeding up the Lattice\n**Builder:** Rusty (Sonnet)").short).toBe("Speeding up the Lattice");
    expect(readBody("**Short:**   Adding a podium. ").short).toBe("Adding a podium");
    expect(readBody("**Short:** *Fixing the furnace*").short).toBe("Fixing the furnace");
    expect(readBody("**Short:**\n**Builder:** Rusty").short).toBe("");
  });
  it("carries it, and when the issue was opened, onto the crate", () => {
    const [c] = parseCrates([issue(43, ["foundry", "foundry:chat", "foundry:working"], { body: "**Size:** small\n**Short:** Speeding up the Lattice", created_at: "2026-10-12T20:00:00Z" })], NOW);
    expect(c).toMatchObject({ short: "Speeding up the Lattice", createdAt: Date.parse("2026-10-12T20:00:00Z") });
  });
});

describe("crewJob", () => {
  const crate = (number: number, kind: Crate["kind"], state: Crate["state"], over: Partial<Crate> = {}): Crate => ({ number, title: `#${number}`, kind, state, rung: null, url: "", updatedAt: NOW, pitch: "", size: null, revising: false, ...over });

  it("shows each crew member the job in their own hands", () => {
    const jobs = [crate(3, "build", "working"), crate(1, "chat", "working"), crate(2, "fix", "working", { rung: 1 }), crate(4, "build", "working", { builder: "caret" })];
    expect(crewJob(jobs, "tessellate", NOW)?.number).toBe(1);
    expect(crewJob(jobs, "semicolon", NOW)?.number).toBe(2);
    expect(crewJob(jobs, "caret", NOW)?.number).toBe(4);
  });

  it("puts Rusty's newer running jobs in his dock crew's hands, in bay order", () => {
    const jobs = [5, 1, 4, 2, 3].map((n) => crate(n, "build", "working"));
    expect(crewJob(jobs, "tessellate", NOW)?.number).toBe(1);
    expect(dockJobs(jobs).map((c) => c.number)).toEqual([2, 3, 4]);
    expect(dockJobs([crate(1, "build", "working")])).toEqual([]);
  });

  it("puts a stuck or waiting job first: it's what their routine is about", () => {
    const jobs = [crate(1, "build", "working"), crate(2, "fix", "stuck", { rung: 2 })];
    expect(crewJob(jobs, "tessellate", NOW)?.number).toBe(2);
    expect(crewJob([crate(6, "build", "ready")], "tessellate", NOW)?.number).toBe(6);
  });

  it("shows a job waiting its turn when it's the only one they hold", () => {
    const rocky = [crate(7, "build", "working", { builder: "caret" }), crate(8, "build", "working", { builder: "caret" })];
    expect(crewJob(rocky, "caret", NOW)?.number).toBe(7);
    expect(crewJob([crate(9, "build", "working", { paused: true })], "tessellate", NOW)?.number).toBe(9);
  });

  it("keeps Rusty on the latest upkeep between ticks, unless ideas wait on the board", () => {
    const at = Date.UTC(2026, 9, 13, 3, 0);
    const upkeep = crate(4, "upkeep", "shipped", { updatedAt: Date.UTC(2026, 9, 13, 1, 2) });
    expect(crewJob([upkeep], "tessellate", at)?.number).toBe(4);
    expect(crewJob([upkeep, crate(5, "idea", "queued")], "tessellate", at)).toBeNull();
    expect(crewJob([upkeep], "semicolon", at)).toBeNull();
    expect(crewJob([], "caret", at)).toBeNull();
  });
});

describe("crew order and rank", () => {
  it("lists Rivet, then Rusty, then Rocky, each a tier up", () => {
    expect(CREW_ORDER.map((id) => CREW[id].name)).toEqual(["Rivet", "Rusty", "Rocky"]);
    expect(CREW_ORDER.map((id) => CREW_RANK[id].tier)).toEqual([1, 2, 3]);
    expect(CREW_ORDER.map((id) => CREW_RANK[id].models)).toEqual(["Haiku", "Sonnet/Opus", "Opus"]);
    expect([...CREW_ORDER].sort()).toEqual(Object.keys(CREW).sort());
  });
});

describe("changeSource (approval and origin on the Changelog)", () => {
  const shipped = (n: number, labels: string[], body = ""): GhIssue => ({ number: n, title: `T${n}`, state: "closed", html_url: `https://x/issues/${n}`, updated_at: "2026-10-12T01:00:00Z", closed_at: `2026-10-12T0${n}:00:00Z`, body, labels: ["foundry", "foundry:shipped", ...labels].map((name) => ({ name })) });

  it("reads an auto-approved build from foundry:auto, a Desk idea from Nikita's words, the rest from the kind", () => {
    const log = parseChangelog(
      [
        shipped(1, ["foundry:build", "foundry:auto"], "**Pitch:** Tidy.\n**Builder:** Rusty (Sonnet)"),
        shipped(2, ["foundry:build"], "**Pitch:** A podium.\n\n**From Nikita (on the Desk):**\n\nA podium."),
        shipped(3, ["foundry:build", "foundry:auto"], "**From Nikita (on the Desk):**\n\nA smaller badge."),
        shipped(4, ["foundry:upkeep"]),
        shipped(5, ["foundry:fix", "rung:1"]),
        shipped(6, ["foundry:chat"]),
        shipped(7, ["foundry:idea"]),
      ],
      [],
      [],
    );
    const by = Object.fromEntries(log.map((c) => [c.issue!.number, [c.approval, c.origin]]));
    expect(by).toEqual({
      1: ["auto", "builder"],
      2: ["manual", "nikita"],
      3: ["auto", "nikita"],
      4: ["none", "upkeep"],
      5: ["none", "fix"],
      6: ["none", "chat"],
      // An older build without foundry:auto was Nikita's call.
      7: ["manual", "builder"],
    });
  });

  it("reads the trail when it has one", () => {
    expect(changeSource("build", [], "", ["**Trail · Decision:** Auto-approved by Skippy, the Builder (low risk: copy tweak)."])).toEqual({ approval: "auto", origin: "builder" });
    expect(changeSource("build", [], "", ['**Trail · Origin:** Nikita in the Foundry thread: "a podium"', "**Trail · Decision:** Approved for building by Nikita on the Desk."])).toEqual({ approval: "manual", origin: "nikita" });
    expect(changeSource("fix", ["rung:3"], "", ["**Trail · Decision:** Shipped by Nikita on the thread's card."])).toEqual({ approval: "manual", origin: "fix" });
    expect(changeSource("fix", [], "", ["**Trail · Decision:** Small green fix: ships as upkeep, no approval needed."])).toEqual({ approval: "none", origin: "fix" });
    // Only a step that starts the comment counts.
    expect(changeSource("upkeep", [], "", ["Nice! **Trail · Decision:** Auto-approved by Skippy"])).toEqual({ approval: "none", origin: "upkeep" });
  });

  it("calls a merged pull request with no issue by its branch", () => {
    const log = parseChangelog([], [{ number: 9, title: "x", html_url: "https://x/pull/9", merged_at: "2026-10-12T01:00:00Z", head: { ref: "foundry/upkeep/x" } }], []);
    expect([log[0]!.approval, log[0]!.origin]).toEqual(["none", "upkeep"]);
  });

  it("folds trail steps into the changelog once the Desk has them", () => {
    const log = parseChangelog([shipped(1, ["foundry:build"]), shipped(2, ["foundry:upkeep"])], [], []);
    const folded = withTrails(log, [
      { issue: 1, body: "**Trail · Origin:** Nikita on the Desk (04:02 MT)." },
      { issue: 1, body: "**Trail · Decision:** Auto-approved by Skippy, the Builder (low risk: copy)." },
      { issue: 2, body: "**Trail · Work:** foundry/upkeep/2-x" },
    ]);
    expect(folded.map((c) => [c.issue!.number, c.approval, c.origin])).toEqual([
      [2, "none", "upkeep"],
      [1, "auto", "nikita"],
    ]);
    expect(withTrails(log, [])).toBe(log);
  });

  it("marks an open auto-approved build so the Desk can offer Stop", () => {
    const [c] = parseCrates([issue(8, ["foundry", "foundry:build", "foundry:auto", "foundry:working"])], NOW);
    expect(c!.auto).toBe(true);
    expect(parseCrates([issue(9, ["foundry", "foundry:build"])], NOW)[0]).not.toHaveProperty("auto");
  });
});

describe("Changelog pictures", () => {
  const SHOT = "https://raw.githubusercontent.com/nikitapage10/C.E.O./foundry-shots/";
  const shipped = (n: number, labels: string[]): GhIssue => ({ number: n, title: `T${n}`, state: "closed", html_url: `https://x/issues/${n}`, updated_at: "2026-10-12T01:00:00Z", closed_at: `2026-10-12T0${n}:00:00Z`, body: "", labels: ["foundry", "foundry:shipped", ...labels].map((name) => ({ name })) });
  const step = (...lines: string[]) => ["**Trail · Pictures:** the Changelog with pictures, wide and phone.", "", ...lines].join("\n");

  it("accepts only the foundry-shots branch of this repo, an issue folder and a JPEG or PNG", () => {
    expect(pictureUrl(`${SHOT}162/20261015-101500-changelog-wide.jpg`)).toBe(`${SHOT}162/20261015-101500-changelog-wide.jpg`);
    expect(pictureUrl(`${SHOT}9/card.jpeg`)).not.toBeNull();
    expect(pictureUrl(`${SHOT}9/card.PNG`)).not.toBeNull();
    for (const bad of [
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo=",
      "data:image/svg+xml,<svg onload=alert(1)>",
      `http://raw.githubusercontent.com/nikitapage10/C.E.O./foundry-shots/162/a.jpg`,
      "https://raw.githubusercontent.com/nikitapage10/C.E.O./main/162/a.jpg",
      "https://raw.githubusercontent.com/nikitapage10/C.E.O./foundry-shots-evil/162/a.jpg",
      "https://raw.githubusercontent.com/someone-else/C.E.O./foundry-shots/162/a.jpg",
      "https://raw.githubusercontent.com/nikitapage10/other/foundry-shots/162/a.jpg",
      "https://raw.githubusercontent.com.evil.example/nikitapage10/C.E.O./foundry-shots/162/a.jpg",
      "https://evil.example/https://raw.githubusercontent.com/nikitapage10/C.E.O./foundry-shots/162/a.jpg",
      `${SHOT}162/a.gif`,
      `${SHOT}162/a.svg`,
      `${SHOT}162/a.jpg.html`,
      `${SHOT}162/a.jpg?x=1`,
      `${SHOT}162/a.jpg#x`,
      `${SHOT}162/../../../main/a.jpg`,
      `${SHOT}162/%2e%2e/a.jpg`,
      `${SHOT}162/sub/a.jpg`,
      `${SHOT}abc/a.jpg`,
      `${SHOT}162/.jpg`,
      `${SHOT}162/a b.jpg`,
      ` ${SHOT}162/a.jpg`,
      `JAVASCRIPT:${SHOT}162/a.jpg`,
    ]) {
      expect(pictureUrl(bad), bad).toBeNull();
    }
  });

  it("reads the images on a Pictures step, dropping every other link", () => {
    const pics = readPictures(
      step(
        `![changelog-wide](${SHOT}162/20261015-101500-changelog-wide.jpg)`,
        "![x](javascript:alert(1))",
        "![x](data:image/png;base64,AAAA)",
        "![x](https://raw.githubusercontent.com/nikitapage10/C.E.O./main/162/a.jpg)",
        "![x](https://raw.githubusercontent.com/attacker/C.E.O./foundry-shots/162/a.jpg)",
        `![changelog-wide](${SHOT}162/20261015-101500-changelog-wide.jpg)`,
        `![](${SHOT}162/20261015-101501-viewer_open.png)`,
        `[not an image](${SHOT}162/link.jpg)`,
      ),
    );
    expect(pics.map((p) => [p.src.slice(SHOT.length), p.alt])).toEqual([
      ["162/20261015-101500-changelog-wide.jpg", "changelog wide"],
      ["162/20261015-101501-viewer_open.png", "viewer open"],
    ]);
    expect(pics[0]!.note).toBe("the Changelog with pictures, wide and phone.");
  });

  it("keeps alt text and the note short and plain", () => {
    const [p] = readPictures(`**Trail · Pictures:** <img src=x onerror=alert(1)> **bold** ‮evil\n\n![<script>alert(1)</script>${"a".repeat(150)}](${SHOT}1/a.jpg)`);
    expect(p!.alt).not.toMatch(/[<>]/);
    expect(p!.alt.length).toBeLessThanOrEqual(60);
    expect(p!.note).not.toMatch(/[<>*‮]/);
    // An alt the pattern can't read falls back to the file's name.
    expect(readPictures(`**Trail · Pictures:** x\n![](${SHOT}1/20261015-101500-desk-phone.jpg)`)[0]!.alt).toBe("desk phone");
  });

  it("reads nothing from a comment that isn't a Pictures step", () => {
    expect(readPictures(`**Trail · Work:** ![a](${SHOT}1/a.jpg)`)).toEqual([]);
    expect(readPictures(`Look! **Trail · Pictures:** ![a](${SHOT}1/a.jpg)`)).toEqual([]);
  });

  it("caps how many pictures a change shows", () => {
    const many = Array.from({ length: 30 }, (_, i) => `![p${i}](${SHOT}1/p${i}.jpg)`);
    expect(readPictures(step(...many))).toHaveLength(MAX_PICTURES);
  });

  it("folds each issue's pictures into the changelog, oldest step first", () => {
    const log = parseChangelog([shipped(1, ["foundry:build"]), shipped(2, ["foundry:upkeep"])], [], []);
    const folded = withTrails(log, [
      { issue: 1, at: "2026-10-15T12:00:00Z", body: step(`![after](${SHOT}1/after.jpg)`) },
      { issue: 1, at: "2026-10-15T10:00:00Z", body: step(`![before](${SHOT}1/before.jpg)`, `![after](${SHOT}1/after.jpg)`) },
      { issue: 2, at: "2026-10-15T10:00:00Z", body: step("![x](https://example.com/x.jpg)") },
    ]);
    const one = folded.find((c) => c.issue?.number === 1)!;
    expect(one.pictures?.map((p) => p.alt)).toEqual(["before", "after"]);
    expect(folded.find((c) => c.issue?.number === 2)).not.toHaveProperty("pictures");
  });
});
