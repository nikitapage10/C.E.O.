import { beforeEach, describe, expect, it } from "vitest";
import { deskKeyFor } from "../_desk/keys.ts";
import { newSession, SESSION_COOKIE, signToken } from "../_desk/session.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { MemoryRoomLog } from "../_skippy/log.ts";
import { MemoryJobsStore, type JobsDeps } from "./jobs.ts";
import { forgetAnnex, gateOf, getElections, getJobs, postAnnex, postJobs, runJobsDaily, runJobsFit, shelfTurn, type AnnexDeps } from "./route.ts";
import { connectionsOn, isShelved, MemoryAnnexStore, PROJECT_PARTS, POPUP_IDS, readState, schedulesOn } from "./state.ts";

/** Shelving stops an Annex project whole (#1079): its timers skip it and its routes refuse its scheduled work. */

const NOW = Date.parse("2026-11-12T13:00:00Z");
const DESK = "a test desk key, not a real one";

async function setup(status: "live" | "archived" = "live") {
  const auth = new MemoryAuthStore();
  await auth.savePasskeys([{ id: "cred-1", publicKey: "AQID", counter: 0, label: "PC", added: "2026-10-14T00:00:00Z" }]);
  const token = signToken(await deskKeyFor(DESK, "session"), newSession("cred-1", NOW));
  const store = new MemoryAnnexStore();
  store.state.popups.jobs = { status, at: null };
  const council = new MemoryRoomLog();
  const outside: string[] = [];
  const annex: AnnexDeps = {
    store,
    desk: { deskKey: DESK, store: auth, now: NOW },
    elections: {
      fetcher: async (url) => {
        outside.push(url);
        return new Response("{}", { status: 503 });
      },
      now: () => NOW,
    },
    council,
    now: NOW,
  };
  const jobsStore = new MemoryJobsStore();
  jobsStore.state.profile.searches = [{ q: "Engineer", location: "Denver" } as never];
  jobsStore.state.jobs = [{ id: "j1", title: "Engineer", company: "Acme", location: "Remote", state: "new" } as never];
  jobsStore.resume = "a resume";
  const ai = {
    check: async () => {
      outside.push("claude:check");
      return null;
    },
    submit: async () => {
      outside.push("claude:submit");
      return "batch-1";
    },
    collect: async () => {
      outside.push("claude:collect");
      return null;
    },
  };
  const jobs: JobsDeps = {
    store: jobsStore,
    key: "test-key",
    budget: 100,
    now: NOW,
    fetcher: async (url) => {
      outside.push(url);
      return Response.json(url.includes("account.json") ? { searches_per_month: 250, total_searches_left: 240 } : { jobs_results: [] });
    },
    ai: ai as unknown as JobsDeps["ai"],
  };
  const req = (path: string, body?: unknown) =>
    new Request(`https://ceo.test${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { annex, jobs, store, jobsStore, council, outside, req };
}

describe("shelving an Annex project (#1079)", () => {
  beforeEach(() => forgetAnnex());

  it("lists each project's connections and schedules, and asks the same two questions of every one", () => {
    for (const id of POPUP_IDS) {
      expect(PROJECT_PARTS[id].connections.length).toBeGreaterThan(0);
      expect(PROJECT_PARTS[id].schedules.length).toBeGreaterThan(0);
    }
    const s = readState({ popups: { jobs: { status: "archived" }, elections: { status: "ended" } } });
    expect([isShelved(s, "jobs"), schedulesOn(s, "jobs"), connectionsOn(s, "jobs")]).toEqual([true, false, false]);
    expect([isShelved(s, "elections"), schedulesOn(s, "elections"), connectionsOn(s, "elections")]).toEqual([false, false, true]);
    // An unreadable record allows nothing.
    expect([schedulesOn(null, "jobs"), connectionsOn(null, "jobs")]).toEqual([false, false]);
  });

  it("skips a shelved project's timers: no SerpApi search, no fit check", async () => {
    const { annex, jobs, outside } = await setup("archived");
    expect(await runJobsDaily(annex, jobs)).toBe("shelved");
    expect(await runJobsFit(annex, jobs)).toBe("shelved");
    expect(outside).toEqual([]);
  });

  it("runs the same timers once it is live", async () => {
    const { annex, jobs, outside } = await setup("live");
    expect(await runJobsDaily(annex, jobs)).toBe("ran");
    expect(outside.some((u) => u.startsWith("https://serpapi.com/search.json"))).toBe(true);
  });

  it("refuses a shelved project's runs and fit checks, and keeps its other changes with every connection off", async () => {
    const { annex, jobs, jobsStore, outside, req } = await setup("archived");
    for (const body of [{ action: "run" }, { action: "fit", id: "j1" }]) {
      const res = await postJobs(req("/api/annex-jobs", body), annex, jobs);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "shelved" });
    }
    const resume = await postJobs(req("/api/annex-jobs", { action: "resume", text: "a newer resume" }), annex, jobs);
    expect(resume.status).toBe(200);
    expect(jobsStore.resume).toBe("a newer resume");
    expect(outside).toEqual([]);
    const view = (await (await getJobs(req("/api/annex-jobs"), annex, jobs)).json()) as { shelved?: boolean; nextRun: string | null; configured: boolean };
    // Paused, not deleted: the key is still there for when it is re-spun.
    expect(view).toMatchObject({ shelved: true, nextRun: null, configured: true });
  });

  it("calls nothing for a shelved Election night", async () => {
    const { annex, store, outside } = await setup();
    store.state.popups.elections = { status: "archived", at: null };
    expect(await (await getElections(new Request("https://ceo.test/api/annex-elections"), annex)).json()).toEqual({ archived: true });
    expect(outside).toEqual([]);
  });

  it("logs shelving and re-spinning to the Council, and re-spinning turns the timers back on", async () => {
    const { annex, jobs, council, outside, req } = await setup("live");
    const shelve = await postAnnex(req("/api/annex", { popup: "jobs", status: "archived" }), annex);
    expect(shelve.status).toBe(200);
    expect((await gateOf("jobs", annex)).shelved).toBe(true);
    expect(await runJobsDaily(annex, jobs)).toBe("shelved");
    expect(outside).toEqual([]);
    await postAnnex(req("/api/annex", { popup: "jobs", status: "live" }), annex);
    expect(await runJobsDaily(annex, jobs)).toBe("ran");
    const turns = await council.list("kernel", NOW);
    expect(turns.map((t) => t.question)).toEqual(["Re-spin Job search", "Shelve Job search"]);
    expect(turns[1]?.answer).toContain("no scheduled runs, connections off");
    expect(turns.every((t) => t.model === "annex")).toBe(true);
    // A follow change or the same status again is not a shelf change.
    expect(shelfTurn("jobs", "live", "live")).toBeNull();
  });
});
