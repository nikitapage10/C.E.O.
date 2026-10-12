import { create } from "zustand";

/**
 * What the Desk shows, as plain data. Phase 2: the hub on the MacBook fills this in. Until then the Desk
 * renders `EMPTY_DESK`, which is honestly empty: no invented messages, only the shape of what will come.
 * `?demo` swaps in `demoDesk()`, a handful of sample texts (made-up people) to review the layout with.
 */

/** `?demo` (or the older `?boiler=demo`): sample texts on the Desk, links cycling in the Boiler Room. */
export const DEMO =
  typeof window !== "undefined" &&
  (() => {
    const q = new URLSearchParams(window.location.search);
    return q.has("demo") || q.get("boiler") === "demo";
  })();

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

export interface Approval {
  id: string;
  title: string;
  /** Which agent is asking. */
  agent: string;
  detail: string;
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
  approvals: Approval[];
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
  approvals: [],
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
    approvals: [
      { id: "ap-mom", title: "Send Mom's reply", agent: "Blasto", detail: "Draft ready: yes to Sunday, bringing dessert." },
      { id: "ap-later", title: "Remind you about Dave tonight", agent: "Dialtone", detail: "Plumber question, at the 19:00 nudge." },
    ],
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
  resolveApproval: (id: string) => void;
}

export const useDesk = create<DeskStore>((set, get) => ({
  data: DEMO ? demoDesk() : EMPTY_DESK,
  picked: null,
  pick: (picked) => set({ picked }),
  send: (id) => {
    const { data } = get();
    const owed = data.owed.filter((o) => o.id !== id);
    set({ data: { ...data, owed, sentToday: data.sentToday + 1 }, picked: owed[0]?.id ?? null });
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
  resolveApproval: (id) => {
    const { data } = get();
    set({ data: { ...data, approvals: data.approvals.filter((a) => a.id !== id) } });
  },
}));

/** The Desk's data. Phase 2 swaps this for a subscription to the hub. */
export function useDeskData(): DeskData {
  return useDesk((s) => s.data);
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
