import { useMemo } from "react";
import { create } from "zustand";
import { CREW, crewFor, useFoundry, type FoundryData } from "../foundry.ts";

/**
 * What the Desk shows, as plain data. Phase 2: the hub on the MacBook fills this in. Until it does, the Desk
 * shows a sample day (`demoDesk()`: made-up people, every room) so the C.E.O. can see what it will look like,
 * clearly labelled as samples; `?real` shows only real work, which today is honestly empty (`EMPTY_DESK`).
 */

/** Sample data on, unless `?real`. Nothing sample ever sends. */
export const SAMPLES = typeof window === "undefined" ? false : !new URLSearchParams(window.location.search).has("real");

/** The rooms, as the Desk names and colours them (kept here so the Desk imports nothing from the Lattice). */
export const DESK_ROOMS = {
  relay: { name: "Relay", accent: "#e8c27a" },
  foundry: { name: "Foundry", accent: "#ffb067" },
  spire: { name: "Spire", accent: "#cfd6e4" },
  exchange: { name: "Exchange", accent: "#9fe3c9" },
  green: { name: "Green", accent: "#b8f28a" },
  archive: { name: "Archive", accent: "#b9a6ff" },
  workshop: { name: "Workshop", accent: "#e07a5f" },
  boiler: { name: "Boiler Room", accent: "#ff9a4a" },
} as const;
export type DeskRoom = keyof typeof DESK_ROOMS;

/** Something an agent needs from you: a decision or a quick check, with the answers as buttons. */
export interface DeskAction {
  id: string;
  room: DeskRoom;
  agent: string;
  kind: "decide" | "check";
  title: string;
  detail?: string;
  /** "now" sits in Do now; "later" waits further down with when it's due. */
  when: "now" | "later";
  due?: string;
  /** The buttons; the first is the suggested one. */
  choices: string[];
  /** A link per button, where a button opens something instead of answering here. */
  hrefs?: (string | null)[];
  /** Real work (not a sample), even while samples are showing. */
  live?: boolean;
}

/** One line of what happened while you were away. */
export interface DeskNote {
  room: DeskRoom;
  text: string;
  live?: boolean;
}

export type Urgency = "sooner" | "normal";

export interface OwedReply {
  id: string;
  /** Who is waiting. */
  name: string;
  /** Their last message, short. */
  preview: string;
  /** Date.now() of the message you have not answered. */
  since: number;
  urgency: Urgency;
  channel: "iMessage" | "SMS";
  /** Blasto's draft, if one is ready. */
  draft?: string;
  /** The recent messages, oldest first; the last one from them is `preview`. */
  /** A sample voice note: what you said, before Blasto put it in your style (the styled version is `draft`). */
  voice?: string;
  /** Pushed to the next nudge with "Later". */
  later?: boolean;
  thread?: { from: "them" | "me"; text: string; at: number }[];
}

export interface ReplyDay {
  /** Midnight of the day, Date.now() style. */
  day: number;
  /** Median minutes to reply that day; null when no replies were tracked. */
  medianMinutes: number | null;
  /** Replies sent that day. */
  sent: number;
}

export interface DeskData {
  owed: OwedReply[];
  /** Threads Dialtone looked at and decided need nothing (group chats, codes, promos). */
  settled: number;
  /** The last seven days, oldest first. */
  week: ReplyDay[];
  /** Days in a row with nobody left waiting past their window. */
  streakDays: number;
  sentToday: number;
  actions: DeskAction[];
  notes: DeskNote[];
  /** Things handled today, for the "done" count. */
  doneToday: number;
  /** Dialtone's daily nudges, as [hour, minute]. */
  nudges: [number, number][];
}

/** A reply counts as overdue after this long. */
export const OVERDUE_MS = 4 * 60 * 60 * 1000;

const DAY = 86_400_000;

function midnight(now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Seven empty days ending today: the strip's hairlines, with nothing on them. */
export function emptyWeek(now = Date.now()): ReplyDay[] {
  const today = midnight(now);
  return Array.from({ length: 7 }, (_, i) => ({ day: today - (6 - i) * DAY, medianMinutes: null, sent: 0 }));
}

export const EMPTY_DESK: DeskData = {
  owed: [],
  settled: 0,
  week: emptyWeek(),
  streakDays: 0,
  sentToday: 0,
  actions: [],
  notes: [],
  doneToday: 0,
  nudges: [
    [12, 30],
    [19, 0],
  ],
};

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Sample texts for `?demo`. Made-up people; nothing here is real and nothing sends. */
export function demoDesk(now = Date.now()): DeskData {
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
      { room: "foundry", text: "Skippy fixed the slow page load you mentioned." },
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

interface DeskStore {
  data: DeskData;
  /** The conversation open on Relay. */
  picked: string | null;
  pick: (id: string | null) => void;
  /** Send a reply (demo: just clears it from the list). */
  send: (id: string) => void;
  /** Push a reply to the next nudge: it drops to the bottom until then. */
  later: (id: string) => void;
  setDraft: (id: string, draft: string) => void;
  /** Answer an action (any choice clears it and counts as done). */
  act: (id: string) => void;
}

export const useDesk = create<DeskStore>((set, get) => ({
  data: SAMPLES ? demoDesk() : EMPTY_DESK,
  picked: null,
  pick: (picked) => set({ picked }),
  send: (id) => {
    const { data } = get();
    const owed = data.owed.filter((o) => o.id !== id);
    set({ data: { ...data, owed, sentToday: data.sentToday + 1, doneToday: data.doneToday + 1 }, picked: owed[0]?.id ?? null });
  },
  later: (id) => {
    const { data } = get();
    const owed = data.owed.map((o) => (o.id === id ? { ...o, later: true } : o));
    set({ data: { ...data, owed }, picked: null });
  },
  setDraft: (id, draft) => {
    const { data } = get();
    set({ data: { ...data, owed: data.owed.map((o) => (o.id === id ? { ...o, draft } : o)) } });
  },
  act: (id) => {
    const { data } = get();
    set({ data: { ...data, actions: data.actions.filter((a) => a.id !== id), doneToday: data.doneToday + 1 } });
  },
}));

/** The Foundry thread in Nikita's C.E.O. project, where "Ship?" and the morning ideas are answered. */
export const FOUNDRY_THREAD = "https://claude.ai/code/project/chan_01ADYmBcNXXQp2nFaBGX662Z?thread=cmsg_01ADYmBcNXXQp2nFaBGX662ZH5T27bzSjU4A8MHkVRmdcL";

const DAY_MS = 86_400_000;

/** The Foundry's real work, as Desk cards: things to ship, stuck crates, the morning ideas, and what shipped. */
export function foundryDesk(f: FoundryData, now = Date.now()): { actions: DeskAction[]; notes: DeskNote[] } {
  const actions: DeskAction[] = [];
  const notes: DeskNote[] = [];
  for (const c of f.crates) {
    const agent = CREW[crewFor(c)].name;
    const id = `foundry-${c.number}`;
    if (c.state === "ready") {
      actions.push({ id, room: "foundry", agent, kind: "decide", when: "now", live: true, title: `Ship “${c.title}”?`, detail: "Built and checked. Tap Ship on the card in the Foundry thread and it goes live.", choices: ["Open the Foundry thread", "See the work"], hrefs: [FOUNDRY_THREAD, c.url] });
    } else if (c.state === "stuck") {
      actions.push({ id, room: "foundry", agent, kind: "check", when: "now", live: true, title: `Stuck: ${c.title}`, detail: "Every model rung tried and the checks are still red. The notes on what was tried are on the issue.", choices: ["Read the notes"], hrefs: [c.url] });
    } else if (c.kind === "idea" && c.state === "queued") {
      actions.push({ id, room: "foundry", agent, kind: "decide", when: "later", live: true, due: "This morning's ideas", title: c.title, choices: ["Pick on the Foundry tab", "Read it"], hrefs: ["/foundry", c.url] });
    } else if (c.state === "shipped" && now - c.updatedAt < DAY_MS) {
      notes.push({ room: "foundry", live: true, text: `${agent} shipped “${c.title}”.` });
    }
  }
  if (f.checks.state === "fail" && !f.crates.some((c) => c.kind === "fix" && c.state !== "shipped")) {
    notes.unshift({ room: "foundry", live: true, text: "The checks on main went red. Skippy is on his way." });
  }
  return { actions, notes };
}

/** The Desk's data: the store (Relay's samples until the hub connects) plus the Foundry's real work from GitHub. */
export function useDeskData(): DeskData {
  const data = useDesk((s) => s.data);
  const foundry = useFoundry((s) => s.data);
  const connected = useFoundry((s) => s.connected);
  return useMemo(() => {
    if (!connected) return data;
    const f = foundryDesk(foundry);
    return {
      ...data,
      // Once the Foundry is connected its sample cards give way to the real ones.
      actions: [...f.actions, ...data.actions.filter((a) => a.room !== "foundry")],
      notes: [...f.notes, ...data.notes.filter((n) => n.room !== "foundry")],
    };
  }, [data, foundry, connected]);
}

/** Owed replies, oldest wait first. */
export function byWait(owed: OwedReply[]): OwedReply[] {
  return [...owed].sort((a, b) => (!!a.later !== !!b.later ? (a.later ? 1 : -1) : a.urgency === b.urgency ? a.since - b.since : a.urgency === "sooner" ? -1 : 1));
}

/** "3m", "2h 10m", "3d". */
export function formatWait(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Mean of the days that have a median, in minutes; null when none do. */
export function averageReply(week: ReplyDay[]): number | null {
  const known = week.map((d) => d.medianMinutes).filter((m): m is number => m !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

/** The next nudge after `now`, as Date.now() style. */
export function nextNudge(nudges: [number, number][], now = Date.now()): number | null {
  if (!nudges.length) return null;
  const today = midnight(now);
  const times = nudges.flatMap(([h, m]) => [today + (h * 60 + m) * 60_000, today + DAY + (h * 60 + m) * 60_000]);
  return times.filter((t) => t > now).sort((a, b) => a - b)[0] ?? null;
}
