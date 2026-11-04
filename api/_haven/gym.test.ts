import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { classify } from "./classify.ts";
import { PhoneKeys } from "./phones.ts";
import { PhoneTodos } from "./todos.ts";
import { capture, havenGet, havenPost, type HavenDeps } from "./route.ts";
import {
  DEFAULT_GYM_PLAN,
  GYM_PATH,
  doseOf,
  editGymPlan,
  gymCounts,
  gymView,
  logGymSession,
  pickSession,
  readGymEdit,
  readGymPlan,
  sayGymLogged,
  unlogGymSession,
  weekStart,
  type GymPlan,
} from "./gym.ts";

/**
 * The Haven Gym's plan (#660): its shape, the seam that edits it, the log, the classifier's "did core day A", and the
 * routes (passkey for the plan, counts for everyone). Every plan and log here is made up.
 */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
/** A Wednesday, 11:00 am Mountain. */
const NOW = Date.parse("2026-11-04T18:00:00Z");
const DAY = 86_400_000;
const PEPPER = Buffer.alloc(32, 7);

function memoryBlob(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/octet-stream" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && opts.allowOverwrite === false && files.has(path)) throw new BlobPreconditionError("exists");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

const fileOf = (blob: ReturnType<typeof memoryBlob>) => new TextDecoder().decode(blob.files.get(GYM_PATH) ?? new Uint8Array());

describe("the gym plan's shape (#660)", () => {
  it("reads the default back as itself, with core twice a week on Tuesday and Friday", () => {
    expect(readGymPlan(DEFAULT_GYM_PLAN)).toEqual(DEFAULT_GYM_PLAN);
    expect(DEFAULT_GYM_PLAN.sessions.map((s) => s.day)).toEqual([2, 5]);
    expect(DEFAULT_GYM_PLAN.rest).toEqual([45, 60]);
    expect(DEFAULT_GYM_PLAN.sessions.map((s) => s.exercises.map(doseOf))).toEqual([
      ["3 × 10 / side", "3 × 10 / side", "3 × 12", "3 × 30 s / side"],
      ["3 × 8", "3 × 10 / side", "3 × 10 / side", "3 × 45 s"],
    ]);
  });

  it("cleans what it reads: markup out, numbers clamped, reps or a hold (never both), bad sessions dropped", () => {
    const got = readGymPlan({
      v: 1,
      name: "<b>Core</b>",
      rest: [90, 30],
      sessions: [
        { id: "B", name: "Day <script>", day: 9, minutes: 999, exercises: [{ name: "Plank", sets: 50, seconds: 2 }, { name: "Both", sets: 3, reps: 5, seconds: 30 }, { name: "Neither", sets: 3 }] },
        { id: "b", day: 1, exercises: [{ name: "Dupe", sets: 1, reps: 1 }] },
        { id: "z", day: 1, exercises: [{ name: "Bad id", sets: 1, reps: 1 }] },
        { id: "c", day: 1, exercises: [] },
      ],
    })!;
    expect(got.name).toBe("bCore/b");
    expect(got.rest).toEqual([30, 90]);
    expect(got.sessions).toHaveLength(1);
    expect(got.sessions[0]).toMatchObject({ id: "b", name: "Day script", day: 6, minutes: 180 });
    expect(got.sessions[0]!.exercises).toEqual([{ name: "Plank", sets: 10, reps: null, seconds: 5, perSide: false }]);
    expect(readGymPlan({ v: 2, sessions: DEFAULT_GYM_PLAN.sessions })).toBeNull();
    expect(readGymPlan({ v: 1, sessions: [] })).toBeNull();
  });
});

describe("the gym's week and log (#660)", () => {
  it("starts the week on Monday at midnight, Mountain", () => {
    expect(new Date(weekStart(NOW)).toISOString()).toBe("2026-11-02T07:00:00.000Z");
    // Sunday night is still the same week; Monday 00:30 is the next.
    expect(weekStart(Date.parse("2026-11-09T06:30:00Z"))).toBe(weekStart(NOW));
    expect(new Date(weekStart(Date.parse("2026-11-09T07:30:00Z"))).toISOString()).toBe("2026-11-09T07:00:00.000Z");
  });

  it("picks the named day, else today's, else the first not done this week", () => {
    const tuesday = NOW - DAY;
    expect(pickSession(DEFAULT_GYM_PLAN, "B", [], NOW)?.id).toBe("b");
    expect(pickSession(DEFAULT_GYM_PLAN, "e", [], NOW)).toBeNull();
    expect(pickSession(DEFAULT_GYM_PLAN, null, [], tuesday)?.id).toBe("a");
    expect(pickSession(DEFAULT_GYM_PLAN, null, [], NOW)?.id).toBe("a");
    expect(pickSession(DEFAULT_GYM_PLAN, null, [{ id: "g-1234", session: "a", at: new Date(tuesday).toISOString(), via: "desk" }], NOW)?.id).toBe("b");
  });

  it("logs, counts by week, takes a log back, and shows counts only in public", async () => {
    const blob = memoryBlob();
    const a = await logGymSession(blob, "a", "desk", NOW - DAY);
    expect(a).toMatchObject({ ok: true, doneThisWeek: 1, perWeek: 2 });
    const lastWeek = await logGymSession(blob, null, "phone", NOW - 7 * DAY);
    expect(lastWeek.ok).toBe(true);
    const view = await gymView(blob, NOW);
    expect(view.isDefault).toBe(true);
    expect(view.week.done.map((e) => e.session)).toEqual(["a"]);
    expect(view.weeks).toHaveLength(8);
    expect(view.weeks.slice(-2)).toEqual([1, 1]);
    expect(await gymCounts(blob, NOW)).toEqual({ perWeek: 2, doneThisWeek: 1 });
    expect(a.ok && sayGymLogged(a)).toBe("Logged Core day A. 1 of 2 this week.");
    expect(await unlogGymSession(blob, a.ok ? a.entry.id : "", NOW)).toBe(true);
    expect(await unlogGymSession(blob, "nope!", NOW)).toBe(false);
    expect(await gymCounts(blob, NOW)).toEqual({ perWeek: 2, doneThisWeek: 0 });
    expect(await logGymSession(blob, "f", "desk", NOW)).toEqual({ ok: false, error: "not-found" });
  });
});

describe("editGymPlan, the seam for room tools (#660, #646)", () => {
  it("puts a session, removes one, sets the whole plan and resets, checking every result", async () => {
    const blob = memoryBlob();
    await logGymSession(blob, "a", "desk", NOW);
    const put = await editGymPlan(blob, { op: "put-session", session: { id: "c", name: "Core day C", day: 0, minutes: 15, exercises: [{ name: "Hollow hold", sets: 3, seconds: 20 }] } }, NOW);
    expect(put.ok && put.plan.sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect((await gymView(blob, NOW)).isDefault).toBe(false);
    // Replacing a session by its letter keeps the rest.
    const swap = await editGymPlan(blob, { op: "put-session", session: { id: "a", day: 1, exercises: [{ name: "Dead bugs", sets: 4, reps: 12, perSide: true }] } }, NOW);
    expect(swap.ok && swap.plan.sessions.find((s) => s.id === "a")).toMatchObject({ day: 1, exercises: [{ sets: 4, reps: 12 }] });
    expect(await editGymPlan(blob, { op: "put-session", session: { id: "a", day: 1, exercises: [] } }, NOW)).toEqual({ ok: false, error: "bad-plan" });
    expect((await editGymPlan(blob, { op: "remove-session", id: "C" }, NOW)).ok).toBe(true);
    expect(await editGymPlan(blob, { op: "remove-session", id: "c" }, NOW)).toEqual({ ok: false, error: "not-found" });
    const one: GymPlan = { ...DEFAULT_GYM_PLAN, sessions: [DEFAULT_GYM_PLAN.sessions[0]!] };
    expect((await editGymPlan(blob, { op: "set", plan: one }, NOW)).ok).toBe(true);
    expect(await editGymPlan(blob, { op: "remove-session", id: "a" }, NOW)).toEqual({ ok: false, error: "last-session" });
    expect(await editGymPlan(blob, { op: "set", plan: { v: 1 } }, NOW)).toEqual({ ok: false, error: "bad-plan" });
    expect(await gymCounts(blob, NOW)).toEqual({ perWeek: 1, doneThisWeek: 1 });
    const reset = await editGymPlan(blob, { op: "reset" }, NOW);
    expect(reset).toMatchObject({ ok: true, isDefault: true });
    // The log outlives every edit.
    expect(await gymCounts(blob, NOW)).toEqual({ perWeek: 2, doneThisWeek: 1 });
    expect(readGymEdit({ op: "drop-table" })).toBeNull();
  });
});

describe("Hey Skippy logs a workout (#660)", () => {
  it("sorts a done session as a workout, with its day when named", () => {
    expect(classify("did core day A")).toEqual({ kind: "workout", session: "a" });
    expect(classify("Skippy, log core workout")).toEqual({ kind: "workout" });
    expect(classify("just finished core day b.")).toEqual({ kind: "workout", session: "b" });
    expect(classify("I did a core workout")).toEqual({ kind: "workout" });
    expect(classify("core workout done")).toEqual({ kind: "workout" });
    expect(classify("finished my workout today")).toEqual({ kind: "workout" });
    expect(classify("logged day B")).toEqual({ kind: "workout", session: "b" });
  });

  it("leaves questions, to-dos and other things alone", () => {
    expect(classify("did I do core this week?").kind).toBe("skippy");
    expect(classify("did I log my workout").kind).toBe("skippy");
    expect(classify("how many workouts this week").kind).toBe("skippy");
    expect(classify("remind me to do core day A tomorrow").kind).toBe("todo");
    expect(classify("add protein bars").kind).toBe("shopping");
    expect(classify("log the time I spent on the quarterly report for the gym membership refund").kind).not.toBe("workout");
  });
});

function havenDeps(blob: BlobBackend, store = new MemoryAuthStore()): HavenDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    desk: { deskKey: DESK, store, now: NOW },
    blob,
    pepper: async () => PEPPER,
    todos: (b) => new PhoneTodos(b),
    skippy: async () => ({ reply: "Ilyr is fine.", handedOff: false }),
    voice: null,
    log: (line) => lines.push(line),
    random: () => 0,
    lines,
  };
}

describe("the gym's routes (#660)", () => {
  it("logs from the phone with a quiet ack, and says aloud a day that isn't in the plan", async () => {
    const blob = memoryBlob();
    const made = (await new PhoneKeys(blob, PEPPER).add("Test phone", NOW))!;
    const deps = havenDeps(blob);
    const ask = async (text: string) => (await capture(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { "Content-Type": "application/json", "x-ceo-phone-key": made.key }, body: JSON.stringify({ text, voice: true }) }), deps)).json();
    expect(await ask("did core day A")).toEqual({ say: "Logged Core day A. 1 of 2 this week.", quiet: true });
    expect(await ask("log core workout")).toEqual({ say: "Logged Core day B. That's the week done.", quiet: true });
    expect(await ask("did core day F")).toEqual({ say: "There's no day F in the Gym's plan.", quiet: false });
    expect(deps.lines).toContain("capture: workout");
    expect(deps.lines.join("\n")).not.toMatch(/core day/i);
  });

  it("shows the plan to a passkey only, counts to everyone, and takes logs and edits from the Desk", async () => {
    const blob = memoryBlob();
    const store = new MemoryAuthStore();
    const deps = havenDeps(blob, store);
    const status = await (await havenGet(new Request(`${ORIGIN}/api/haven?view=status`), deps)).text();
    expect(JSON.parse(status).gym).toEqual({ perWeek: 2, doneThisWeek: 0 });
    expect(status).not.toMatch(/plank|dead bug|pallof/i);
    expect((await havenGet(new Request(`${ORIGIN}/api/haven?view=gym`), deps)).status).toBe(401);
    const cookie = await signedInCookie(DESK, NOW, store);
    const send = (body: unknown) => havenPost(new Request(`${ORIGIN}/api/haven`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }), deps);
    expect((await send({ action: "gym-log" })).status).toBe(200);
    const view = (await (await havenGet(new Request(`${ORIGIN}/api/haven?view=gym`, { headers: { Cookie: cookie } }), deps)).json()) as { plan: GymPlan; week: { done: { id: string }[] } };
    expect(view.plan.sessions).toHaveLength(2);
    expect(view.week.done).toHaveLength(1);
    expect((await send({ action: "gym-unlog", id: view.week.done[0]!.id })).status).toBe(200);
    expect((await send({ action: "gym-unlog", id: view.week.done[0]!.id })).status).toBe(404);
    const edited = (await (await send({ action: "gym-edit", edit: { op: "remove-session", id: "b" } })).json()) as { view: { plan: GymPlan } };
    expect(edited.view.plan.sessions.map((s) => s.id)).toEqual(["a"]);
    expect((await send({ action: "gym-edit", edit: { op: "nope" } })).status).toBe(400);
    expect((await send({ action: "gym-edit", edit: { op: "set", plan: { v: 1 } } })).status).toBe(400);
    expect(deps.lines).toContain("haven: the gym plan was changed (remove-session, 1 sessions)");
    expect(fileOf(blob)).toContain("Dead bugs");
    // Signed out, nothing changes.
    const out = await havenPost(new Request(`${ORIGIN}/api/haven`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "gym-edit", edit: { op: "reset" } }) }), deps);
    expect(out.status).toBe(401);
  });
});
