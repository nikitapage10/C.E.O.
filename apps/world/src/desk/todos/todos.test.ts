import { describe, expect, it } from "vitest";
import { atWall } from "../../../../../api/_today/parse.ts";
import { keepState, mergeState, type TodoState } from "../../../../../api/_today/todos.ts";
import { awayRefs, changesFor, openTodos } from "./todos.ts";

/** Today's talk-back (#622), browser side: what each intent changes, and how Undo puts it back. */

const NOW = Date.UTC(2026, 10, 3, 23, 35);
const ISO = (ms: number) => new Date(ms).toISOString();
const TOMORROW_9 = atWall(2026, 11, 4, 9);
const EMPTY: TodoState = { todos: [], marks: [] };

/** Applies changes, then their undo a moment later, the way the store does. */
function roundTrip(state: TodoState, c: ReturnType<typeof changesFor>) {
  const after = mergeState(state, c, NOW);
  const at = ISO(NOW + 1);
  const stamp = <T extends { updated: string }>(xs?: T[]) => xs?.map((x) => ({ ...x, updated: at }));
  const undone = mergeState(after, { todos: stamp(c.undo?.todos), marks: stamp(c.undo?.marks), drop: c.undo?.drop }, NOW + 1);
  return { after, undone };
}

describe("what an intent changes", () => {
  it("adds a to-do of Nikita's own; Undo drops it", () => {
    const c = changesFor(EMPTY, null, { kind: "add", text: "Respond to the dermatologist", due: TOMORROW_9 }, NOW, "todo-test1");
    const { after, undone } = roundTrip(EMPTY, c);
    expect(openTodos(after, NOW)).toEqual([expect.objectContaining({ id: "todo-test1", text: "Respond to the dermatologist", due: ISO(TOMORROW_9) })]);
    expect(undone.todos).toEqual([]);
  });

  it("snoozes a held row until its time, and it comes back then; Undo brings it back now", () => {
    const target = { type: "held" as const, ref: "q42", text: "Answer Rivet" };
    const c = changesFor(EMPTY, target, { kind: "snooze", until: TOMORROW_9 }, NOW);
    const { after, undone } = roundTrip(EMPTY, c);
    expect(awayRefs(after, NOW).has("q42")).toBe(true);
    expect(awayRefs(after, TOMORROW_9).has("q42")).toBe(false);
    expect(awayRefs(undone, NOW).has("q42")).toBe(false);
  });

  it("notes and reminders stay on the row; done puts it away", () => {
    const target = { type: "held" as const, ref: "relay-1", text: "Reply" };
    let s = mergeState(EMPTY, changesFor(EMPTY, target, { kind: "note", text: "Waiting on their reply" }, NOW), NOW);
    s = mergeState(s, changesFor(s, target, { kind: "remind", at: TOMORROW_9 }, NOW + 1), NOW + 1);
    expect(s.marks[0]).toMatchObject({ ref: "relay-1", notes: ["Waiting on their reply"], remind: ISO(TOMORROW_9) });
    expect(awayRefs(s, NOW).has("relay-1")).toBe(false);
    s = mergeState(s, changesFor(s, target, { kind: "done" }, NOW + 2), NOW + 2);
    expect(awayRefs(s, NOW + 2).has("relay-1")).toBe(true);
  });

  it("makes a held row a to-do of Nikita's own, and the row steps aside; Undo reverses both", () => {
    const target = { type: "held" as const, ref: "setup", text: "Finish the Desk's setup steps" };
    const c = changesFor(EMPTY, target, { kind: "todo", due: TOMORROW_9 }, NOW, "todo-test2");
    const { after, undone } = roundTrip(EMPTY, c);
    expect(after.todos[0]).toMatchObject({ id: "todo-test2", text: "Finish the Desk's setup steps", from: "setup", due: ISO(TOMORROW_9) });
    expect(awayRefs(after, NOW).has("setup")).toBe(true);
    expect(undone.todos).toEqual([]);
    expect(awayRefs(undone, NOW).has("setup")).toBe(false);
  });

  it("talks back to Nikita's own to-do: snooze, remind, done, with Undo", () => {
    const s = keepState({ todos: [{ id: "todo-test3", text: "Call the bank", at: ISO(NOW - 1000), updated: ISO(NOW - 1000) }] }, NOW);
    const target = { type: "todo" as const, id: "todo-test3" };
    const snoozed = roundTrip(s, changesFor(s, target, { kind: "snooze", until: TOMORROW_9 }, NOW));
    expect(openTodos(snoozed.after, NOW)).toEqual([]);
    expect(openTodos(snoozed.after, TOMORROW_9)).toHaveLength(1);
    expect(openTodos(snoozed.undone, NOW)).toHaveLength(1);
    const reminded = mergeState(s, changesFor(s, target, { kind: "remind", at: TOMORROW_9 }, NOW), NOW);
    expect(reminded.todos[0]!.due).toBe(ISO(TOMORROW_9));
    const done = roundTrip(s, changesFor(s, target, { kind: "done" }, NOW));
    expect(openTodos(done.after, NOW)).toEqual([]);
    expect(openTodos(done.undone, NOW)).toHaveLength(1);
  });

  it("lists due ones first", () => {
    const s = keepState({ todos: [
      { id: "todo-late1", text: "Later", at: ISO(NOW - 3), updated: ISO(NOW - 3), due: ISO(NOW + 5_000_000) },
      { id: "todo-none1", text: "Whenever", at: ISO(NOW - 2), updated: ISO(NOW - 2) },
      { id: "todo-due01", text: "Now", at: ISO(NOW - 1), updated: ISO(NOW - 1), due: ISO(NOW - 1) },
    ] }, NOW);
    expect(openTodos(s, NOW).map((t) => t.id)).toEqual(["todo-due01", "todo-late1", "todo-none1"]);
  });
});

describe("an item handed to Skippy from the floor", () => {
  it("keeps the hand-off's turn on the item's mark, through later words, and only a turn id", () => {
    const s = keepState({ marks: [{ ref: "down-boiler", updated: ISO(NOW), handed: "0123456789abcdef" }, { ref: "q12", updated: ISO(NOW), handed: "not-a-turn" }] }, NOW);
    expect(s.marks.find((m) => m.ref === "down-boiler")?.handed).toBe("0123456789abcdef");
    expect(s.marks.find((m) => m.ref === "q12")).not.toHaveProperty("handed");
    const noted = mergeState(s, changesFor(s, { type: "held", ref: "down-boiler", text: "" }, { kind: "note", text: "Asked Skippy" }, NOW + 1), NOW + 1);
    expect(noted.marks.find((m) => m.ref === "down-boiler")).toMatchObject({ handed: "0123456789abcdef", notes: ["Asked Skippy"] });
  });
});
