import { describe, expect, it } from "vitest";
import { atWall, clock, didLine, fallbackChoices, parseWhen, readCapture, readModelIntent, readTalkBack, tidy, wall, whenLabel, type Intent } from "./parse.ts";

// Tuesday 3 November 2026, 4:35 pm Mountain (MST, UTC-7): 23:35Z, when Nikita asked for this.
const NOW = Date.UTC(2026, 10, 3, 23, 35);
const mt = (d: number, h: number, mi = 0) => atWall(2026, 11, d, h, mi);
const at = (text: string) => parseWhen(text, NOW)?.at;

describe("the Mountain clock", () => {
  it("reads and builds Mountain wall times, across the DST change", () => {
    expect(wall(NOW)).toMatchObject({ y: 2026, mo: 11, d: 3, h: 16, mi: 35, wd: 2 });
    expect(mt(4, 9)).toBe(Date.UTC(2026, 10, 4, 16, 0));
    // Summer time (MDT, UTC-6).
    expect(atWall(2026, 7, 1, 9)).toBe(Date.UTC(2026, 6, 1, 15, 0));
    expect(clock(mt(4, 9))).toBe("9:00 am");
    expect(clock(mt(4, 14, 30))).toBe("2:30 pm");
  });

  it("labels a time from where now stands", () => {
    expect(whenLabel(mt(3, 17), NOW)).toBe("today 5:00 pm");
    expect(whenLabel(mt(3, 20), NOW)).toBe("tonight 8:00 pm");
    expect(whenLabel(mt(4, 9), NOW)).toBe("tomorrow 9:00 am");
    expect(whenLabel(mt(6, 9), NOW)).toBe("Friday 9:00 am");
    expect(whenLabel(mt(12, 9), NOW)).toBe("Nov 12 9:00 am");
  });
});

describe("parseWhen", () => {
  it("tomorrow lands at 9:00 am, with a part of the day or a clock time when said", () => {
    expect(at("tomorrow")).toBe(mt(4, 9));
    expect(at("tomorrow morning")).toBe(mt(4, 9));
    expect(at("tomorrow afternoon")).toBe(mt(4, 14));
    expect(at("tomorrow evening")).toBe(mt(4, 18));
    expect(at("tomorrow at 3")).toBe(mt(4, 15));
    expect(at("tomorrow at 10:30am")).toBe(mt(4, 10, 30));
    expect(at("tomorrow at noon")).toBe(mt(4, 12));
    expect(at("day after tomorrow")).toBe(mt(5, 9));
  });

  it("today and tonight stay today, or an hour on when the time has passed", () => {
    expect(at("today")).toBe(mt(3, 17));
    expect(at("tonight")).toBe(mt(3, 20));
    expect(at("tonight at 9pm")).toBe(mt(3, 21));
    expect(at("this morning")).toBe(NOW + 3_600_000);
    expect(at("end of day")).toBe(mt(3, 17));
    expect(at("later")).toBe(NOW + 3 * 3_600_000);
  });

  it("weekday names are the next one, never today", () => {
    expect(at("friday")).toBe(mt(6, 9));
    expect(at("on Friday at 2pm")).toBe(mt(6, 14));
    expect(at("monday")).toBe(mt(9, 9));
    expect(at("tuesday")).toBe(mt(10, 9));
    expect(at("next thursday")).toBe(mt(5, 9));
    expect(at("by wed")).toBe(mt(4, 9));
  });

  it("stretches from now", () => {
    expect(at("in 2 hours")).toBe(NOW + 2 * 3_600_000);
    expect(at("in an hour")).toBe(NOW + 3_600_000);
    expect(at("in half an hour")).toBe(NOW + 30 * 60_000);
    expect(at("in 20 minutes")).toBe(NOW + 20 * 60_000);
    expect(at("in three days")).toBe(mt(6, 9));
    expect(at("in a week")).toBe(mt(10, 9));
    expect(at("next week")).toBe(mt(9, 9));
    expect(at("this weekend")).toBe(mt(7, 10));
  });

  it("a clock time alone is the next time the clock says it", () => {
    expect(at("at 5pm")).toBe(mt(3, 17));
    expect(at("at 9am")).toBe(mt(4, 9));
  });

  it("names no time in plain words", () => {
    expect(parseWhen("respond to the dermatologist", NOW)).toBeNull();
    expect(parseWhen("waiting on their reply", NOW)).toBeNull();
    expect(parseWhen("look at the sun", NOW)).toBeNull();
    expect(parseWhen("buy 2 bags of rice", NOW)).toBeNull();
  });
});

describe("the capture line", () => {
  it("Nikita's own example: tomorrow, the dermatologist", () => {
    expect(readCapture("okay, tomorrow I need to respond to the dermatologist", NOW)).toEqual({ kind: "add", text: "Respond to the dermatologist", due: mt(4, 9) });
  });

  it("reads the to-do out of the words around it", () => {
    expect(readCapture("remind me to call the bank on Friday at 2pm", NOW)).toEqual({ kind: "add", text: "Call the bank", due: mt(6, 14) });
    expect(readCapture("pick up the dry cleaning in 2 hours", NOW)).toEqual({ kind: "add", text: "Pick up the dry cleaning", due: NOW + 2 * 3_600_000 });
    expect(readCapture("next week book the flights", NOW)).toEqual({ kind: "add", text: "Book the flights", due: mt(9, 9) });
    expect(readCapture("I have to renew my passport", NOW)).toEqual({ kind: "add", text: "Renew my passport" });
    expect(readCapture("tonight water the plants", NOW)).toEqual({ kind: "add", text: "Water the plants", due: mt(3, 20) });
  });

  it("nothing said, nothing added", () => {
    expect(readCapture("   ", NOW)).toBeNull();
    expect(readCapture("tomorrow", NOW)).toBeNull();
  });

  it("tidy drops filler and leads", () => {
    expect(tidy("um so I need to email the landlord.")).toBe("Email the landlord");
    expect(tidy("don't forget to stretch")).toBe("Stretch");
  });
});

describe("talking back to a held thing", () => {
  const ok = (text: string): Intent => {
    const r = readTalkBack(text, NOW);
    if (!r || !r.ok) throw new Error(`not read: ${text}`);
    return r.intent;
  };

  it("snooze, with or without a time", () => {
    expect(ok("snooze till tomorrow")).toEqual({ kind: "snooze", until: mt(4, 9) });
    expect(ok("snooze it")).toEqual({ kind: "snooze", until: mt(4, 9) });
    expect(ok("not now, ask me again Friday")).toEqual({ kind: "snooze", until: mt(6, 9) });
    expect(ok("push it to next week")).toEqual({ kind: "snooze", until: mt(9, 9) });
    expect(ok("I'll deal with it in 2 hours")).toEqual({ kind: "snooze", until: NOW + 2 * 3_600_000 });
  });

  it("remind me, with a time", () => {
    expect(ok("remind me friday")).toEqual({ kind: "remind", at: mt(6, 9) });
    expect(ok("ping me in an hour")).toEqual({ kind: "remind", at: NOW + 3_600_000 });
  });

  it("a note", () => {
    expect(ok("note: waiting on their reply")).toEqual({ kind: "note", text: "Waiting on their reply" });
    expect(ok("add a note they moved it to Thursday")).toEqual({ kind: "note", text: "They moved it to Thursday" });
    expect(ok("waiting on their reply")).toEqual({ kind: "note", text: "Waiting on their reply" });
    expect(ok("left a voicemail")).toEqual({ kind: "note", text: "Left a voicemail" });
  });

  it("done or dismiss", () => {
    for (const t of ["done", "it's done", "dismiss", "never mind", "already replied", "I handled it", "mark it done"]) expect(ok(t), t).toEqual({ kind: "done" });
  });

  it("make it a to-do", () => {
    expect(ok("make it a to-do")).toEqual({ kind: "todo" });
    expect(ok("add it to my list for Friday")).toEqual({ kind: "todo", due: mt(6, 9) });
  });

  it("a bare time asks: snooze or remind, two chips", () => {
    const r = readTalkBack("tomorrow", NOW);
    expect(r).toEqual({
      ok: false,
      ask: "Tomorrow 9:00 am: snooze it or remind you?",
      choices: [
        { label: "Snooze till tomorrow 9:00 am", intent: { kind: "snooze", until: mt(4, 9) } },
        { label: "Remind me tomorrow 9:00 am", intent: { kind: "remind", at: mt(4, 9) } },
      ],
    });
    expect(readTalkBack("friday at 3", NOW)?.ok).toBe(false);
  });

  it("remind with no time asks when", () => {
    const r = readTalkBack("remind me", NOW);
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.choices.map((c) => c.intent.kind)).toEqual(["remind", "remind"]);
  });

  it("can't tell: null, for Claude; then two fallback chips", () => {
    expect(readTalkBack("the blue one I think", NOW)).toBeNull();
    const f = fallbackChoices("the blue one I think", NOW);
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.choices.map((c) => c.intent.kind)).toEqual(["note", "todo"]);
  });

  it("says what it did in one line", () => {
    expect(didLine({ kind: "snooze", until: mt(4, 9) }, NOW)).toBe("Snoozed till tomorrow 9:00 am");
    expect(didLine({ kind: "add", text: "x", due: mt(4, 9) }, NOW)).toBe("Added for tomorrow 9:00 am");
    expect(didLine({ kind: "done" }, NOW)).toBe("Marked done");
  });
});

describe("Claude's answer, read with the same rules", () => {
  it("resolves its time words here, never trusting a time from the model", () => {
    expect(readModelIntent({ kind: "snooze", when: "tomorrow morning" }, "item", NOW)).toEqual({ kind: "snooze", until: mt(4, 9) });
    expect(readModelIntent({ kind: "add", text: "respond to the dermatologist", when: "tomorrow" }, "capture", NOW)).toEqual({ kind: "add", text: "Respond to the dermatologist", due: mt(4, 9) });
    expect(readModelIntent({ kind: "note", text: "They'll call back" }, "item", NOW)).toEqual({ kind: "note", text: "They'll call back" });
  });

  it("drops anything off-shape", () => {
    expect(readModelIntent({ kind: "unclear" }, "item", NOW)).toBeNull();
    expect(readModelIntent({ kind: "launch" }, "item", NOW)).toBeNull();
    expect(readModelIntent({ kind: "remind" }, "item", NOW)).toBeNull();
    expect(readModelIntent({ kind: "snooze", when: "whenever the stars align" }, "item", NOW)).toBeNull();
    expect(readModelIntent("snooze", "item", NOW)).toBeNull();
  });
});
