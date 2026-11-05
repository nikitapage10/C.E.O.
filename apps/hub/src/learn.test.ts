import { describe, expect, it } from "vitest";
import { LEARN_CAPS, readLearnInput, trimLearn } from "../../../api/_relay/voice.ts";
import type { Contact } from "./bluebubbles.ts";
import { allot, handleKey, sampleSent, voiceStats, type Said } from "./learn.ts";

/**
 * "Learn from my texts" on the Mac (#758): the numbers, the stratified sample, the skips and the placeholders. Every
 * name, number and text here is made up (555 numbers, example.com).
 */

const NOW = Date.parse("2026-11-05T15:00:00Z");
const DAY = 86_400_000;
const num = (i: number) => `+1555555${String(1000 + i)}`;
const chatOf = (h: string) => `iMessage;-;${h}`;
const PEOPLE: Contact[] = Array.from({ length: 70 }, (_, i) => ({ names: [`Person${String.fromCharCode(65 + (i % 26))}${i} Sample`], handles: [num(i)] }));
const contactOf = (h: string) => PEOPLE.find((p) => p.handles.includes(h));
const mine = (i: number, text: string, at: number): Said => ({ chat: chatOf(num(i)), group: false, fromMe: true, text, at, handle: "" });
const theirs = (i: number, text: string, at: number): Said => ({ chat: chatOf(num(i)), group: false, fromMe: false, text, at, handle: num(i) });

describe("the numbers, on the Mac", () => {
  it("measure length, casing, emoji, punctuation, sign-offs, double texts and reply speed, with no text out", () => {
    const all: Said[] = [];
    for (let k = 0; k < 10; k++) {
      const t0 = NOW - (k + 1) * DAY;
      all.push(theirs(1, "you around later?", t0));
      all.push(mine(1, k % 2 ? "yeah sounds good, see you then x" : "Sure! Omw 😊", t0 + 10 * 60_000));
      if (k < 4) all.push(mine(1, "omw…", t0 + 11 * 60_000));
    }
    const s = voiceStats(all);
    expect(s.texts).toBe(14);
    expect(s.replyMinutes).toBe(10);
    expect(s.replyHour).toBe(1);
    expect(s.emoji).toBeCloseTo(5 / 14, 2);
    expect(s.exclaims).toBeCloseTo(5 / 14, 2);
    expect(s.ellipses).toBeCloseTo(4 / 14, 2);
    expect(s.signOffs).toBeCloseTo(5 / 14, 2);
    expect(s.doubles).toBeCloseTo(4 / 10, 2);
    expect(Object.values(s).every((v) => v === null || typeof v === "number")).toBe(true);
  });

  it("leave reply speed out with too few replies", () => {
    expect(voiceStats([mine(1, "hi", NOW)]).replyMinutes).toBeNull();
    expect(voiceStats([]).texts).toBe(0);
  });
});

describe("the sample for the one style call", () => {
  it("is stratified: 30 per contact at most, about 1,000 in all, the most-texted contacts first", () => {
    expect(allot([500, 200, 40, 10])).toEqual([30, 30, 30, 10]);
    const big = allot(Array.from({ length: 60 }, () => 100));
    expect(Math.max(...big)).toBeLessThanOrEqual(LEARN_CAPS.perContact);
    expect(big.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(LEARN_CAPS.texts);
    expect(big.reduce((a, b) => a + b, 0)).toBeGreaterThan(950);

    const all: Said[] = [];
    for (let i = 0; i < 70; i++) for (let k = 0; k < 40 + i; k++) all.push(mine(i, `text number ${k} to you about the plan`, NOW - (k + 1) * 3_600_000));
    const s = sampleSent(all, contactOf, [], PEOPLE, NOW);
    expect(s.contacts).toBe(LEARN_CAPS.contacts);
    expect(s.from).toBeLessThanOrEqual(LEARN_CAPS.texts);
    expect(s.input.contacts.every((c) => c.texts.length <= LEARN_CAPS.perContact)).toBe(true);
    // The most-texted come first and get labels only; the site reads the shape back.
    expect(s.input.contacts[0]!.label).toBe("C1");
    expect(s.labels.get("C1")).toBe(PEOPLE[69]);
    expect(readLearnInput(s.input)).not.toBeNull();
    expect(trimLearn(s.input)).toEqual(s.input);
  }, 30_000);

  it("skips money and legal, codes, promos, the skip list, strangers, groups, other people's texts and anything over a year old", () => {
    const all: Said[] = [
      ...Array.from({ length: 25 }, (_, k) => mine(1, `sounds good, see you at ${k}`, NOW - k * DAY)),
      mine(1, "I paid the rent invoice, the payment is overdue", NOW - DAY),
      mine(1, "the court date for the settlement moved", NOW - DAY),
      mine(1, "your verification code is 482913", NOW - DAY),
      mine(1, "20% off, reply STOP to opt out", NOW - DAY),
      mine(1, "this one is too old", NOW - 400 * DAY),
      theirs(1, "their words, not Nikita's", NOW - DAY),
      ...Array.from({ length: 5 }, () => mine(2, "skip-listed person text", NOW - DAY)),
      ...Array.from({ length: 5 }, () => ({ ...mine(3, "group text", NOW - DAY), chat: "iMessage;+;chat55", group: true })),
      ...Array.from({ length: 5 }, () => ({ ...mine(3, "a stranger", NOW - DAY), chat: chatOf("+15555559999") })),
    ];
    const s = sampleSent(all, contactOf, [PEOPLE[2]!.names[0]!.toLowerCase()], PEOPLE, NOW);
    const sent = JSON.stringify(s.input);
    expect(s.contacts).toBe(1);
    expect(sent).not.toMatch(/rent|court|verification|STOP|too old|their words|skip-listed|group text|stranger/);
  });

  it("swaps names, numbers and addresses for placeholders before anything leaves the Mac", () => {
    const all = Array.from({ length: 25 }, (_, k) => mine(1, `${PEOPLE[1]!.names[0]} — ask ${PEOPLE[5]!.names[0]} to call +1 (555) 555-0177 or mail riley@example.com, day ${k}`, NOW - k * DAY));
    const s = sampleSent(all, contactOf, [], PEOPLE, NOW);
    const sent = JSON.stringify(s.input);
    expect(sent).not.toMatch(/PersonB1|PersonF5|Sample|555|example\.com/);
    expect(sent).toContain("Contact");
    expect(sent).toContain("Person 1");
    expect(sent).toContain("[email]");
  });

  it("keys a learned relation by a hash of the handle, the same for every way the number is written", () => {
    expect(handleKey("+1 (555) 555-0101")).toBe(handleKey("5555550101"));
    expect(handleKey("Riley@Example.com")).toBe(handleKey("riley@example.com"));
    expect(handleKey("+15555550101")).toMatch(/^[0-9a-f]{16}$/);
  });
});
