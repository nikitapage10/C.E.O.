import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JOB_FILES, trimRun } from "../../../../api/foundry-feed.ts";
import { cronMatches, JOBS, jobRows, lastSlot, lateLabel, nextSlot, pessimistLine, type GhJob, type GhJobRun } from "./jobs.ts";

const T = (iso: string) => Date.parse(iso);
const run = (over: Partial<GhJobRun> = {}): GhJobRun => ({
  name: "Back up to Azure",
  status: "completed",
  conclusion: "success",
  created_at: "2026-10-22T10:52:30Z",
  run_started_at: "2026-10-22T10:52:40Z",
  html_url: "https://github.com/nikitapage10/C.E.O./actions/runs/123",
  ...over,
});

describe("the job board's crons", () => {
  it("matches minutes, hours and weekdays in UTC", () => {
    expect(cronMatches("41 10 * * *", T("2026-10-22T10:41:00Z"))).toBe(true);
    expect(cronMatches("41 10 * * *", T("2026-10-22T10:42:00Z"))).toBe(false);
    expect(cronMatches("5 * * * *", T("2026-10-22T03:05:00Z"))).toBe(true);
    // 2026-10-19 is a Monday.
    expect(cronMatches("29 4 * * 1", T("2026-10-19T04:29:00Z"))).toBe(true);
    expect(cronMatches("29 4 * * 1", T("2026-10-20T04:29:00Z"))).toBe(false);
    expect(cronMatches("*/15 * * * *", T("2026-10-20T04:45:00Z"))).toBe(true);
    expect(cronMatches("*/15 * * * *", T("2026-10-20T04:46:00Z"))).toBe(false);
    expect(cronMatches("0 9 * * 1-5", T("2026-10-23T09:00:00Z"))).toBe(true);
    expect(cronMatches("not a cron", T("2026-10-23T09:00:00Z"))).toBe(false);
  });

  it("finds the cron minute before a run and the one after it", () => {
    expect(lastSlot("41 10 * * *", T("2026-10-22T10:52:30Z"))).toBe(T("2026-10-22T10:41:00Z"));
    expect(lastSlot("41 10 * * *", T("2026-10-22T10:30:00Z"))).toBe(T("2026-10-21T10:41:00Z"));
    expect(nextSlot("5 * * * *", T("2026-10-22T10:05:00Z"))).toBe(T("2026-10-22T11:05:00Z"));
    expect(nextSlot("29 4 * * 1", T("2026-10-19T04:29:00Z"))).toBe(T("2026-10-26T04:29:00Z"));
  });
});

describe("the job board's rows", () => {
  const now = T("2026-10-22T12:00:00Z");
  const feed = (file: string, r: GhJobRun | null): GhJob[] => [{ file, run: r }];

  it("reads a run's state, how late it started and its link", () => {
    const row = jobRows(feed("backup-azure.yml", run()), now)[0]!;
    expect(row).toMatchObject({ name: "Nightly backup", state: "pass", lateMin: 11, missed: false, url: "https://github.com/nikitapage10/C.E.O./actions/runs/123" });
    expect(lateLabel(row)).toBe("11 min late");
    expect(jobRows(feed("backup-azure.yml", run({ status: "in_progress", conclusion: null })), now)[0]!.state).toBe("running");
    expect(jobRows(feed("backup-azure.yml", run({ conclusion: "failure" })), now)[0]!.state).toBe("fail");
    expect(jobRows(feed("backup-azure.yml", run({ conclusion: "cancelled" })), now)[0]!.state).toBe("other");
  });

  it("lists every job, says when GitHub listed none, and drops links that aren't this repo's runs", () => {
    const rows = jobRows(feed("backup-azure.yml", run({ html_url: "https://evil.test/x" })), now);
    expect(rows.map((r) => r.file)).toEqual(JOBS.map((j) => j.file));
    expect(rows[0]!.url).toBeNull();
    expect(rows[1]).toMatchObject({ state: "none", at: null, lateMin: null });
    expect(jobRows(undefined, now).every((r) => r.state === "none")).toBe(true);
  });

  it("marks a job whose next run never came as missed, and leaves Visual QA without lateness", () => {
    const old = run({ created_at: "2026-10-22T06:07:00Z" });
    expect(jobRows(feed("world-step.yml", old), now)[3]).toMatchObject({ lateMin: 2, missed: true });
    expect(jobRows(feed("world-step.yml", run({ created_at: "2026-10-22T11:09:00Z" })), now)[3]).toMatchObject({ lateMin: 4, missed: false });
    const vqa = jobRows(feed("visual-qa.yml", run()), now).find((r) => r.file === "visual-qa.yml")!;
    expect(vqa).toMatchObject({ state: "pass", lateMin: null, missed: false });
    expect(lateLabel(vqa)).toBe("–");
  });

  it("formats lateness in plain words", () => {
    const at = (lateMin: number | null) => lateLabel({ file: "", name: "", when: "", state: "pass", at: 0, lateMin, missed: false, url: null });
    expect(at(0)).toBe("on time");
    expect(at(60)).toBe("1 h late");
    expect(at(72)).toBe("1 h 12 min late");
  });
});

describe("the Pessimist's line", () => {
  const now = T("2026-10-22T12:00:00Z");
  const all = (over: Record<string, Partial<GhJobRun>> = {}): GhJob[] =>
    JOBS.map((j) => {
      // Each job's last run, three minutes after its own latest cron minute.
      const slot = j.cron ? lastSlot(j.cron, now)! : now - 3_600_000;
      return { file: j.file, run: run({ created_at: new Date(slot + 180_000).toISOString(), ...over[j.file] }) };
    });

  it("grudgingly admits all is well", () => {
    expect(pessimistLine(jobRows(all(), now))).toBe("Everything ran, on time, and passed. Suspicious. ...Fine.");
  });

  it("names what failed, then what started late", () => {
    const rows = jobRows(all({ "backup-azure.yml": { conclusion: "failure" }, "e2e.yml": { created_at: "2026-10-22T10:34:00Z" } }), now);
    expect(pessimistLine(rows)).toBe("Nightly backup failed. Told you. Browser tests started 47 min late. Omens.");
  });

  it("names a job that didn't turn up", () => {
    const rows = jobRows(all({ "desk-pings.yml": { created_at: "2026-10-22T08:04:00Z" } }), now);
    expect(pessimistLine(rows)).toBe("Desk pings didn't turn up when it was due.");
  });

  it("can't see anything without the feed", () => {
    expect(pessimistLine(jobRows(undefined, now))).toBe("Can't see the jobs from here. Never a good sign.");
  });
});

describe("the feed's side of the board", () => {
  it("keeps only a run's name, state, times and link", () => {
    const trimmed = trimRun({ workflow_runs: [{ ...run(), id: 9, actor: { login: "someone" }, head_commit: { message: "secret" }, run_started_at: null }] });
    expect(trimmed).toEqual({ ...run(), run_started_at: null });
    expect(trimRun({ workflow_runs: [] })).toBeNull();
    expect(trimRun(null)).toBeNull();
  });

  it("lists every scheduled workflow, with the same crons as .github/workflows", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../.github/workflows");
    const scheduled = new Map<string, string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
      const cron = /schedule:\s*\n\s*-\s*cron:\s*"([^"]+)"/.exec(readFileSync(join(dir, file), "utf8"));
      if (cron) scheduled.set(file, cron[1]!);
    }
    expect(scheduled.size).toBeGreaterThan(0);
    for (const [file, cron] of scheduled) expect(JOBS.find((j) => j.file === file)?.cron, file).toBe(cron);
    expect(JOBS.filter((j) => j.cron).length).toBe(scheduled.size);
    expect([...JOB_FILES].sort()).toEqual(JOBS.map((j) => j.file).sort());
  });
});
