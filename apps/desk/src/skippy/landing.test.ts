import { describe, expect, it } from "vitest";
import { createLanding, shortSpoken } from "./landing.ts";
import { landedNote } from "./talk.ts";

describe("an answer that lands on a live call is said once, at once, short (#952)", () => {
  it("is held while a tool is out and put in the moment it is back (the election answer that sat unspoken)", () => {
    const l = createLanding();
    expect(l.landed("Candidate A leads by four points.", true)).toBeNull();
    expect(l.toolsDone()).toBe("Candidate A leads by four points.");
    // Nothing left to put in.
    expect(l.toolsDone()).toBeNull();
  });
  it("is never put in twice (the duplicate a minute later)", () => {
    const l = createLanding();
    expect(l.landed("Candidate A leads by four points.", false)).toBe("Candidate A leads by four points.");
    expect(l.landed("Candidate A  leads by four points.", false)).toBeNull();
    expect(l.landed("Candidate A leads by four points.", true)).toBeNull();
    expect(l.toolsDone()).toBeNull();
    l.reset();
    expect(l.landed("Candidate A leads by four points.", false)).not.toBeNull();
  });
  it("speaks the first sentence or two; the long version stays in the chat", () => {
    const long = "Candidate A leads the sample race by four points. Turnout is up in the made-up county. Results are due at nine. The rest is detail nobody asked for.";
    expect(shortSpoken(long)).toBe("Candidate A leads the sample race by four points. Turnout is up in the made-up county.");
    expect(shortSpoken("x ".repeat(400)).length).toBeLessThanOrEqual(280);
    const note = landedNote(long, true);
    expect(note).toContain("Turnout is up in the made-up county.");
    expect(note).not.toContain("Results are due at nine");
    expect(note).toMatch(/no waiting line/i);
  });
});
