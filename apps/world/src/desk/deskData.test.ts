import { describe, expect, it } from "vitest";
import { byWait, EMPTY_DESK, useDesk, type DeskData } from "./deskData.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const midnight = (now: number) => new Date(now).setHours(0, 0, 0, 0);

/** A made-up day, for the tests only; the Desk never shows it. */
function demoDesk(now = Date.now()): DeskData {
  const ago = (ms: number) => now - ms;
  const today = midnight(now);
  const medians = [95, 140, 62, 210, 48, 175, 70];
  const sent = [9, 6, 11, 4, 13, 5, 3];
  return {
    owed: [
      {
        id: "mom",
        name: "Mom",
        preview: "Are you still coming Sunday? Dad wants to know if he should do the grill",
        since: ago(26 * HOUR),
        urgency: "sooner",
        channel: "iMessage",
        voice: "tell her yes I'm coming sunday and tell dad to do the grill and I'll bring dessert",
        draft: "yes!! coming sunday, tell dad grill for sure. I'll bring dessert",
        thread: [
          { from: "me", text: "made it home, thanks for dinner", at: ago(4 * 24 * HOUR) },
          { from: "them", text: "Of course sweetheart ❤️", at: ago(4 * 24 * HOUR - 20 * MIN) },
          { from: "them", text: "Are you still coming Sunday? Dad wants to know if he should do the grill", at: ago(26 * HOUR) },
        ],
      },
      {
        id: "priya",
        name: "Priya",
        preview: "ok be honest did you finish expedition 33 yet or are you still stuck on that boss",
        since: ago(9 * HOUR),
        urgency: "sooner",
        channel: "iMessage",
        voice: "no still stuck on that boss, it's attacking me personally, I'll finish this weekend",
        draft: "still stuck lmao. that boss is personally attacking me. this weekend for sure",
        thread: [
          { from: "them", text: "the soundtrack in act 2 though", at: ago(10 * HOUR) },
          { from: "them", text: "ok be honest did you finish expedition 33 yet or are you still stuck on that boss", at: ago(9 * HOUR) },
        ],
      },
      {
        id: "jordan",
        name: "Jordan",
        preview: "Are you around Thursday for the show? I can grab tickets tonight",
        since: ago(5 * HOUR + 40 * MIN),
        urgency: "normal",
        channel: "iMessage",
        voice: "yeah thursday works, grab them and I'll venmo you",
        draft: "thursday works! grab them and I'll venmo you",
        thread: [
          { from: "me", text: "that set was insane", at: ago(3 * 24 * HOUR) },
          { from: "them", text: "Are you around Thursday for the show? I can grab tickets tonight", at: ago(5 * HOUR + 40 * MIN) },
        ],
      },
      {
        id: "sam",
        name: "Sam",
        preview: "sending you the photos from saturday, some of these are rough 😂",
        since: ago(2 * HOUR + 15 * MIN),
        urgency: "normal",
        channel: "iMessage",
        voice: "send them all but I'm deleting the bad ones of me",
        draft: "omg send them all. deleting the bad ones of me though",
        thread: [{ from: "them", text: "sending you the photos from saturday, some of these are rough 😂", at: ago(2 * HOUR + 15 * MIN) }],
      },
      {
        id: "landlord",
        name: "Dave (landlord)",
        preview: "Hi, the plumber can come Wednesday between 10 and 2. Does that work?",
        since: ago(48 * MIN),
        urgency: "normal",
        channel: "SMS",
        thread: [{ from: "them", text: "Hi, the plumber can come Wednesday between 10 and 2. Does that work?", at: ago(48 * MIN) }],
      },
    ],
    settled: 14,
    week: medians.map((m, i) => ({ day: today - (6 - i) * DAY, medianMinutes: m, sent: sent[i]! })),
    streakDays: 3,
    sentToday: 3,
    actions: [
      { id: "foundry-pr", room: "foundry", agent: "Rocky", kind: "decide", when: "now", title: "Ship the faster sign-in page?", detail: "Built and checked. Goes live on the site when you say so.", choices: ["Ship it", "Let me look"] },
      { id: "spire-invoice", room: "spire", agent: "Ledger", kind: "decide", when: "now", title: "Send the October invoice to Harbor Bakery?", detail: "$1,240 for 31 hours. Same terms as September.", choices: ["Send", "Hold"] },
      { id: "green-lineup", room: "green", agent: "Gridiron", kind: "decide", when: "now", title: "Swap your flex before Sunday's lock?", detail: "Your WR3 is questionable. The bench back has the easier matchup.", due: "Locks Sun 13:00", choices: ["Swap", "Keep"] },
      { id: "exchange-fed", room: "exchange", agent: "Noco", kind: "decide", when: "later", title: "Hold the November Fed position?", detail: "Up 18% since Friday. Hedge says take half off.", due: "Market closes Wed", choices: ["Take half", "Hold"] },
      { id: "archive-recap", room: "archive", agent: "Loremaster", kind: "check", when: "later", title: "Read the Session 14 recap for The Tide", detail: "Two pages. Flagged one continuity slip about the lighthouse.", due: "Before Friday's session", choices: ["Read it", "Skip"] },
      { id: "relay-dave", room: "relay", agent: "Dialtone", kind: "check", when: "later", title: "Remind you about Dave's plumber question", detail: "At the 19:00 nudge, unless you answer first.", due: "19:00", choices: ["OK", "Not needed"] },
    ],
    notes: [
      { room: "foundry", text: "Rivet fixed the slow page load you mentioned." },
      { room: "relay", text: "Dialtone set aside 14 group chats and promo texts." },
      { room: "exchange", text: "Noco closed the rain market. +$22." },
      { room: "boiler", text: "Gary taped a pipe. All lines quiet." },
    ],
    doneToday: 3,
    nudges: [
      [12, 30],
      [19, 0],
    ],
  };
}

describe("the Desk's data", () => {
  it("starts empty: only real work, nothing invented", () => {
    expect(useDesk.getState().data).toBe(EMPTY_DESK);
    expect(EMPTY_DESK.owed).toHaveLength(0);
  });

  it("sorts sooner first, then the longest wait, with replies pushed to later last", () => {
    const owed = demoDesk(Date.now()).owed;
    const order = byWait(owed.map((o) => (o.id === "mom" ? { ...o, later: true } : o))).map((o) => o.id);
    expect(order[0]).toBe("priya");
    expect(order.at(-1)).toBe("mom");
  });

  it("sending a reply clears it and counts it", () => {
    useDesk.setState({ data: demoDesk() });
    const before = useDesk.getState().data;
    useDesk.getState().send("sam");
    const after = useDesk.getState().data;
    expect(after.owed.map((o) => o.id)).not.toContain("sam");
    expect(after.sentToday).toBe(before.sentToday + 1);
    useDesk.setState({ data: EMPTY_DESK, picked: null });
  });
});

describe("Today's actions", () => {
  it("answering one clears it and counts it as done", () => {
    useDesk.setState({ data: demoDesk() });
    const before = useDesk.getState().data;
    useDesk.getState().act("spire-invoice");
    const after = useDesk.getState().data;
    expect(after.actions.find((a) => a.id === "spire-invoice")).toBeUndefined();
    expect(after.doneToday).toBe(before.doneToday + 1);
    useDesk.setState({ data: EMPTY_DESK, picked: null });
  });
});
