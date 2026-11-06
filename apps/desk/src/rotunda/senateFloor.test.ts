import { describe, expect, it } from "vitest";
import { FLOOR_MAX, asksToDo, floorBlocked, floorChair, floorRoom, routeFloor, speakersOf } from "./senateFloor.ts";

/** Nikita has the floor (#905): who the chair hands his words to, and when he can't have the floor. */

const SEATED = ["foundry", "relay", "exchange", "green", "spire", "archive", "boiler", "breakroom", "workshop", "studio", "annex", "haven"];

describe("routing the floor (#905)", () => {
  it("sends words about a room to its member", () => {
    expect(routeFloor("How's my fantasy lineup looking this week?", SEATED)).toEqual(["green"]);
    expect(routeFloor("Any emails I should reply to?", SEATED)).toEqual(["relay"]);
    expect(routeFloor("Is the vacuum running at home?", SEATED)).toEqual(["haven"]);
  });

  it("brings in at most two, the most-mentioned first", () => {
    const got = routeFloor("Did the deploy break the servers, the security checks or the pipes?", SEATED);
    expect(got.length).toBeLessThanOrEqual(FLOOR_MAX);
    expect(got).toEqual(["boiler", "foundry"]);
  });

  it("gives words about nothing in particular to Skippy himself", () => {
    expect(routeFloor("What do you all think about today?", SEATED)).toEqual(["kernel"]);
    expect(routeFloor("", SEATED)).toEqual(["kernel"]);
  });

  it("only routes to members who are seated and have a voice", () => {
    expect(routeFloor("fantasy football", ["relay"])).toEqual(["kernel"]);
    expect(routeFloor("the breakroom party", SEATED)).toEqual(["kernel"]);
  });

  it("matches whole words, not pieces of them", () => {
    expect(routeFloor("I'm catching up on contexts", SEATED)).toEqual(["kernel"]);
  });

  it("the chair says who has it, and the chair's own answers come from Today", () => {
    expect(floorChair(["green"])).toBe("The chair recognizes the Commentator.");
    expect(floorChair(["boiler", "foundry"])).toBe("The chair recognizes the Pessimist, then the Builder.");
    expect(floorChair(["kernel"])).toMatch(/himself/);
    expect(floorRoom("kernel")).toBe("today");
    expect(floorRoom("relay")).toBe("relay");
  });
});

describe("joining the argument (#925)", () => {
  it("finds who was speaking when he cut in: the last two members heard, newest first, never the chair or him", () => {
    const lines = [
      { by: "boiler", text: "Doubtful." },
      { by: "archive", text: "For the record." },
      { by: "kernel", text: "The Director." },
      { by: "studio", text: "Cut!" },
      { by: "floor", text: "Eagles?" },
    ];
    expect(speakersOf({ motion: "m", lines })).toEqual(["studio", "archive"]);
    expect(speakersOf({ motion: "m", lines: [{ by: "kernel", text: "Order." }] })).toEqual([]);
    expect(speakersOf(null)).toEqual([]);
    // The one he cut off answers first.
    expect(floorChair(speakersOf({ motion: "m", lines }))).toBe("The chair recognizes the Director, then the Historian.");
  });
});

describe("requests never join the debate (#925)", () => {
  it("tells a request or a question for Skippy from a remark for the argument", () => {
    for (const t of ["Can you dispense one portion of dry food?", "Please turn off the lights", "Turn the vacuum on", "Is the feeder full?", "What's on my calendar today?", "Hey Skippy, remind me to call the vet"])
      expect(asksToDo(t)).toBe(true);
    for (const t of ["Why not just fly the eagles to the mountain?", "I think the gardener is overrated", "What about the eagles?", "Honestly the sequel was better"]) expect(asksToDo(t)).toBe(false);
  });

  it("sends the food to the Steward's room", () => {
    expect(routeFloor("can you dispense one portion of dry food", SEATED)).toEqual(["haven"]);
  });
});

describe("when the floor can't be had (#905)", () => {
  it("says so in a short line: signed out, still checking, no microphone", () => {
    expect(floorBlocked("out", true)).toMatch(/Sign in/);
    expect(floorBlocked("unknown", true)).toMatch(/Checking/);
    expect(floorBlocked("in", false)).toMatch(/can't hear/);
    expect(floorBlocked("in", true)).toBeNull();
  });
});
