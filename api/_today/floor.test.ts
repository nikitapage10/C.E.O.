import { describe, expect, it } from "vitest";
import { floorMessage, floorQuestion, handedState, readFloor, readItemReply, type FloorItem } from "./floor.ts";
import { readTalkBack } from "./parse.ts";

const NOW = Date.parse("2026-11-05T03:59:00Z");
const REPAIR: FloorItem = { kind: "repair", room: "Boiler Room", by: "boiler", what: "Boiler Room needs a look", cause: "Nightly browser tests is down", fix: "open Boiler Room and see what it says" };
const DECISION: FloorItem = { kind: "decision", room: "Foundry", by: "foundry", what: "which idea the Foundry builds next", option: "Speed up the Lattice" };
const DUTY: FloorItem = { kind: "duty", room: "Relay", by: "relay", what: "a reply on iMessage waiting on you" };

describe("a reply to an item on Today's floor, read in its context", () => {
  it("hands a yes on a Repair or a Decision to Skippy, approved (the 2026-11-05 miss)", () => {
    for (const said of ["yeah, go ahead and fix this", "go ahead", "fix it", "do it", "yes", "Yes.", "ship it", "approve", "approved", "ok go for it", "sure, let's do it", "please fix it"]) {
      expect(readItemReply(said, REPAIR, NOW), said).toEqual({ ok: "skippy", approve: true });
      expect(readItemReply(said, DECISION, NOW), said).toEqual({ ok: "skippy", approve: true });
    }
    // Before: the rules couldn't tell, and the Desk fell back to the note/to-do chooser.
    expect(readTalkBack("yeah, go ahead and fix this", NOW)).toBeNull();
  });

  it("never approves a yes that is a no", () => {
    for (const said of ["don't fix it", "no, don't do it", "not yet, wait", "hold off on it"]) {
      const r = readItemReply(said, REPAIR, NOW);
      expect(r && r.ok === "skippy" && r.approve, said).toBeFalsy();
    }
  });

  it("puts it off on a no, a later or a dismiss", () => {
    for (const said of ["no", "nope", "not now", "later", "skip it"]) {
      const r = readItemReply(said, REPAIR, NOW);
      expect(r && r.ok === true && r.intent.kind, said).toBe("snooze");
    }
    const d = readItemReply("dismiss", REPAIR, NOW);
    expect(d && d.ok === true && d.intent.kind).toBe("done");
  });

  it("keeps the held row's own words: notes, reminders, done, a to-do", () => {
    const kinds = ["note: waiting on Azure", "remind me Friday", "done", "make it a to-do"].map((s) => {
      const r = readItemReply(s, REPAIR, NOW);
      return r && r.ok === true ? r.intent.kind : null;
    });
    expect(kinds).toEqual(["note", "remind", "done", "todo"]);
  });

  it("sends anything else to Skippy to decide, never the note/to-do chooser", () => {
    for (const said of ["why did it break?", "what's the risk if we wait", "hmm, is this the same as yesterday"]) {
      expect(readItemReply(said, REPAIR, NOW), said).toEqual({ ok: "skippy", approve: false });
    }
    // A yes on a duty has nothing to approve: Skippy decides what it means.
    expect(readItemReply("go ahead", DUTY, NOW)).toEqual({ ok: "skippy", approve: false });
    expect(readItemReply("   ", REPAIR, NOW)).toBeNull();
  });
});

describe("what goes to Skippy with an item", () => {
  it("leads a Repair's hand-off with the fix, then the item's context and Nikita's words", () => {
    const q = floorQuestion(REPAIR, "yeah, go ahead and fix this");
    expect(q).toBe(
      'Fix the Boiler Room: Nightly browser tests is down (approved on Today\'s floor). Repair item from the Boiler Room: Boiler Room needs a look. Cause: Nightly browser tests is down. Fix ready: open Boiler Room and see what it says. Reported by the Pessimist. Nikita said: "yeah, go ahead and fix this"',
    );
    expect(floorQuestion(DECISION, "yes")).toMatch(/^Go ahead on the Foundry decision: which idea the Foundry builds next, Speed up the Lattice/);
    expect(floorQuestion(REPAIR, "x".repeat(2000)).length).toBeLessThanOrEqual(600);
  });

  it("frames anything else as a chat message about the item", () => {
    expect(floorMessage(REPAIR, "why did it break?")).toMatch(/^About an item on Today's floor\. Repair item from the Boiler Room: .* Nikita says: "why did it break\?"$/);
  });

  it("checks a hand-off's body: only a Repair or a Decision, with its words", () => {
    expect(readFloor({ floor: REPAIR, message: "fix it" })).toEqual({ item: REPAIR, said: "fix it" });
    expect(readFloor({ floor: DUTY, message: "fix it" })).toBeNull();
    expect(readFloor({ floor: { ...REPAIR, by: "../x" }, message: "fix it" })).toBeNull();
    expect(readFloor({ floor: { ...REPAIR, what: "" }, message: "fix it" })).toBeNull();
    expect(readFloor({ message: "fix it" })).toBeNull();
  });

  it("reads where a hand-off stands from its answer", () => {
    expect(handedState(null)).toBe("sent");
    expect(handedState({ text: "Oh, a question that needs the real me.", final: false })).toBe("pondering");
    expect(handedState({ text: "Filed as number 812; the crew will pick it up." })).toBe("builder");
    expect(handedState({ text: "On it: #812 is open.", final: false })).toBe("builder");
    expect(handedState({ text: "It was a flaky runner; it passed on retry." })).toBe("answered");
  });
});
