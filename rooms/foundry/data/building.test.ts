import { describe, expect, it } from "vitest";
import { readBody, readThread, threadOf, type Change, type Crate, type OpenPr } from "../../../apps/world/src/foundry.ts";
import { ageWords, buildingNow, justShipped, JUST_SHIPPED, queued, whatOf } from "./building.ts";

/** What's being built (#1204): the board at the top of the Foundry page, and the issues' Thread line it reads. */

const job = (number: number, o: Partial<Crate> = {}): Crate => ({
  number,
  title: `Job ${number}`,
  kind: "chat",
  state: "working",
  rung: null,
  url: `https://github.com/nikitapage10/C.E.O./issues/${number}`,
  updatedAt: 1_000 + number,
  pitch: "",
  size: "small",
  revising: false,
  builder: "tessellate",
  ...o,
});
const pr = (number: number, issue: number, checks: OpenPr["checks"] = "unknown"): OpenPr => ({ number, url: `https://github.com/x/pull/${number}`, at: 5_000, draft: false, issue, checks });
const change = (n: number, at: number, o: Partial<Change> = {}): Change => ({ key: `issue-${n}`, at, title: `Change ${n}`, kind: "chat", issue: { number: n, url: `u${n}` }, landed: null, by: "tessellate", short: "", approval: "none", origin: "chat", ...o });

describe("the Thread line", () => {
  it("reads a room, the Builder or a feature thread, and is empty without one", () => {
    expect(readBody("**Short:** Fixing the pantry\n**Thread:** haven\n").thread).toBe("Haven");
    expect(readThread("**Thread:** Boiler room")).toBe("Boiler Room");
    expect(readThread("**Thread:** Builder.")).toBe("Builder");
    expect(readThread("**Thread:** Lattice speed-up")).toBe("Lattice speed-up");
    expect(readBody("**Short:** Fixing the pantry").thread).toBe("");
  });

  it("keeps it plain and short: no markup, no links, one line", () => {
    const t = readThread("**Thread:** [click](https://x.example) <b>now</b> and a very long feature thread name indeed");
    expect(t).not.toMatch(/[<>[\]()]/);
    expect(t.length).toBeLessThanOrEqual(32);
  });

  it("falls back to the room the title leads with, else the Builder", () => {
    expect(threadOf({ title: "Kitchen: order-in meals in the plan" })).toBe("Haven");
    expect(threadOf({ title: "Relay: texts show again" })).toBe("Relay");
    expect(threadOf({ title: "Haven Kitchen: DoorDash ordering" })).toBe("Haven");
    expect(threadOf({ title: "Visual QA: Spire: Agent Memo is stuck" })).toBe("Spire");
    expect(threadOf({ title: "Senate debates: funnier scraps" })).toBe("Today");
    expect(threadOf({ title: "Idea: Find a motion in the Senate Record" })).toBe("Builder");
    expect(threadOf({ title: "Checks: audit gate fails on shipped packages" })).toBe("Builder");
    expect(threadOf({ title: "Speed up the Lattice" })).toBe("Builder");
    expect(threadOf({ title: "Relay: texts", thread: "Exchange" })).toBe("Exchange");
  });
});

describe("building now", () => {
  it("lists every job in hand with what, who, thread and state, nothing cut past the forge's four lanes", () => {
    const crates = [1, 2, 3, 4, 5].map((n) => job(n, { short: `Building ${n}`, thread: n === 1 ? "Haven" : "" }));
    const rows = buildingNow(crates, [pr(90, 1, "running"), pr(91, 2)]);
    expect(rows).toHaveLength(5);
    const one = rows.find((r) => r.crate.number === 1)!;
    expect(one).toMatchObject({ what: "Building 1", thread: "Haven", state: "checks", hand: "Rusty" });
    expect(one.pr?.number).toBe(90);
    expect(rows.find((r) => r.crate.number === 2)!.state).toBe("pr");
    expect(rows.find((r) => r.crate.number === 3)!.state).toBe("working");
    expect(rows.find((r) => r.crate.number === 5)!.state).toBe("waiting");
  });

  it("leaves out queued work and ideas waiting for a pick, and is empty with nothing in hand", () => {
    expect(buildingNow([job(1, { state: "queued" }), job(2, { kind: "idea", state: "queued" })])).toEqual([]);
    expect(buildingNow([])).toEqual([]);
  });

  it("names what's built by the Short line, else the title", () => {
    expect(whatOf({ title: "Fix the thing.", short: "" })).toBe("Fix the thing");
    expect(whatOf({ title: "Fix the thing", short: "Fixing the thing" })).toBe("Fixing the thing");
  });
});

describe("just shipped and queued", () => {
  it("shows the last few issues that shipped, newest first, and skips pull requests with no issue", () => {
    const log = [change(1, 10), change(2, 30), { ...change(3, 50), issue: null, key: "pr-3" }, ...[4, 5, 6, 7, 8].map((n) => change(n, n))];
    const out = justShipped(log);
    expect(out).toHaveLength(JUST_SHIPPED);
    expect(out.map((c) => c.issue!.number)).toEqual([2, 1, 8, 7, 6]);
  });

  it("queues the approved work nobody holds yet, oldest first", () => {
    expect(queued([job(9, { state: "queued" }), job(4, { state: "queued" }), job(5)]).map((c) => c.number)).toEqual([4, 9]);
  });

  it("says ages in short words", () => {
    expect(ageWords(0)).toBe("1m");
    expect(ageWords(42 * 60_000)).toBe("42m");
    expect(ageWords(5 * 3_600_000)).toBe("5h");
    expect(ageWords(3 * 86_400_000)).toBe("3d");
  });
});
