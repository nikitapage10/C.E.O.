import { beforeEach, describe, expect, it } from "vitest";
import { LOST_MS, nextToPost, open, prune, SENT_SHOW_MS, settle, useOutbox, type OutMsg } from "./outbox.ts";
import { UNDO_MS } from "./thread.ts";

/** #950: the texts outbox. Every name and text here is made up. */

const NOW = Date.parse("2026-11-06T15:00:00Z");
const base = { thread: "0123456789abcdef", key: "t:0123456789abcdef", who: "Sam Test", draftAt: 0 };

beforeEach(() => useOutbox.getState().set([]));

describe("the texts outbox (#950)", () => {
  it("queues texts in order, each after its own Undo window, one posting at a time", () => {
    const ob = useOutbox.getState();
    const a = ob.add({ ...base, text: "on my way" }, NOW);
    const b = ob.add({ ...base, text: "five minutes" }, NOW + 1_000);
    const list = () => useOutbox.getState().list;
    expect(list().map((m) => m.text)).toEqual(["on my way", "five minutes"]);
    expect(nextToPost(list(), NOW + UNDO_MS - 1)).toBeNull();
    expect(nextToPost(list(), NOW + UNDO_MS)?.id).toBe(a.id);
    useOutbox.getState().patch(a.id, { state: "posting" });
    // Nothing else posts while one is on its way, even once the second's window ended.
    expect(nextToPost(list(), NOW + 2 * UNDO_MS)).toBeNull();
    useOutbox.getState().patch(a.id, { state: "waiting", rid: "1".repeat(24) });
    expect(nextToPost(list(), NOW + 2 * UNDO_MS)?.id).toBe(b.id);
  });

  it("Z takes back the newest one still in its window, never one already posted", () => {
    const ob = useOutbox.getState();
    const a = ob.add({ ...base, text: "first" }, NOW);
    ob.add({ ...base, text: "second" }, NOW);
    expect(useOutbox.getState().undo()?.text).toBe("second");
    useOutbox.getState().patch(a.id, { state: "waiting" });
    expect(useOutbox.getState().undo()).toBeNull();
    expect(useOutbox.getState().list.map((m) => m.text)).toEqual(["first"]);
  });

  it("follows each request's state: sent, or not sent with why and whether Resend can reuse it", () => {
    const m: OutMsg = { ...base, id: "o1", text: "hi", at: NOW, until: NOW, state: "waiting", rid: "1".repeat(24) };
    expect(settle(m, undefined, NOW)).toBe(m);
    expect(settle(m, { state: "taken" }, NOW).state).toBe("waiting");
    expect(settle(m, { state: "sent" }, NOW)).toMatchObject({ state: "sent", doneAt: NOW });
    expect(settle(m, { state: "expired" }, NOW)).toMatchObject({ state: "failed", why: "the Mac was offline.", resendable: true });
    expect(settle(m, { state: "failed", reason: "bb-down" }, NOW)).toMatchObject({ state: "failed", resendable: true });
    expect(settle(m, { state: "refused", reason: "new-message" }, NOW)).toMatchObject({ state: "failed", resendable: false });
    // Never shown on the list long after it ended: not sent, so a Done waiting on it isn't held for ever.
    expect(settle({ ...m, postedAt: NOW }, undefined, NOW + LOST_MS - 1).state).toBe("waiting");
    expect(settle({ ...m, postedAt: NOW }, undefined, NOW + LOST_MS + 1)).toMatchObject({ state: "failed", resendable: false });
    expect(open({ state: "failed" })).toBe(false);
    expect(open({ state: "held" })).toBe(true);
  });

  it("Resend puts a failed one back at the end of the line, to go at its turn; sent ones leave after a few seconds", () => {
    const ob = useOutbox.getState();
    const a = ob.add({ ...base, text: "first" }, NOW);
    const b = ob.add({ ...base, text: "second" }, NOW);
    useOutbox.getState().patch(a.id, { state: "failed", rid: "1".repeat(24), resendable: true });
    useOutbox.getState().patch(b.id, { state: "sent", doneAt: NOW });
    useOutbox.getState().retry(a.id);
    const list = useOutbox.getState().list;
    expect(list.map((m) => [m.text, m.state])).toEqual([
      ["second", "sent"],
      ["first", "held"],
    ]);
    expect(nextToPost(list, NOW)?.rid).toBe("1".repeat(24));
    expect(prune(list, NOW + SENT_SHOW_MS + 1).map((m) => m.text)).toEqual(["first"]);
  });
});
