import { useMemo } from "react";
import { create } from "zustand";
import { CREW, crewOf, useFoundry, type FoundryData } from "../foundry.ts";
import { PORTRAITS } from "./portraits.ts";

/**
 * What the Desk shows, as plain data. Only real work, never samples (Nikita, 2026-10-13): the hub on the MacBook
 * fills in Relay and the rooms; until it does they are honestly empty (`EMPTY_DESK`). The Foundry is real already,
 * from GitHub.
 */

/**
 * The rooms, as the Desk names and tints them. The tints are the rooms' own plinth colours from the Lattice (kept
 * here as CSS variables, so the Desk imports nothing from it); each room has a still from the Lattice under
 * public/desk/ (scripts/desk-images.mjs renders them) and the agent who leads it. Agents' portraits come from
 * scripts/portraits.mjs.
 */
export const DESK_ROOMS = {
  relay: { name: "Relay", accent: "var(--room-relay)", lead: "dialtone", what: "Messages and replies" },
  foundry: { name: "Foundry", accent: "var(--room-foundry)", lead: "semicolon", what: "The coding crew" },
  spire: { name: "Spire", accent: "var(--room-spire)", lead: "ledger", what: "Books and bookings" },
  exchange: { name: "Exchange", accent: "var(--room-exchange)", lead: "odds", what: "Markets and the portfolio" },
  green: { name: "Green", accent: "var(--room-green)", lead: "gridiron", what: "Fantasy football" },
  archive: { name: "Archive", accent: "var(--room-archive)", lead: "loremaster", what: "The Tide's canon" },
  workshop: { name: "Workshop", accent: "var(--room-workshop)", lead: "daub", what: "New models" },
  boiler: { name: "Boiler Room", accent: "var(--room-boiler)", lead: "gary", what: "Systems and upkeep" },
} as const;
export type DeskRoom = keyof typeof DESK_ROOMS;

/** The still of a room, from the Lattice. */
export const roomImage = (room: DeskRoom) => `/desk/room-${room}.webp`;

/** The cast by name, so a card can show who is asking: the portrait id, the room and the job. */
export const AGENTS: Record<string, { id: string; room: DeskRoom; job: string }> = {
  Rusty: { id: "tessellate", room: "foundry", job: "Builder, upkeep and ideas" },
  Rocky: { id: "caret", room: "foundry", job: "Master builder" },
  Rivet: { id: "semicolon", room: "foundry", job: "First responder" },
  "The Builder": { id: "ember", room: "foundry", job: "Room lead" },
  Ledger: { id: "ledger", room: "spire", job: "Operations" },
  Memo: { id: "memo", room: "spire", job: "Assistant to the assistant" },
  Noco: { id: "odds", room: "exchange", job: "Quant" },
  Hedge: { id: "hedge", room: "exchange", job: "Risk desk" },
  Gridiron: { id: "gridiron", room: "green", job: "Coach" },
  Punt: { id: "punt", room: "green", job: "Morale" },
  Blasto: { id: "postmaster", room: "relay", job: "Correspondence" },
  Dialtone: { id: "dialtone", room: "relay", job: "Switchboard" },
  Loremaster: { id: "loremaster", room: "archive", job: "Scribe" },
  Heimerdinger: { id: "heimerdinger", room: "archive", job: "Researcher" },
  Gary: { id: "gary", room: "boiler", job: "Maintenance" },
  Daub: { id: "daub", room: "workshop", job: "Concept painter" },
  Chisel: { id: "chisel", room: "workshop", job: "Sculptor" },
};

/**
 * An agent's portrait by name or id, or null for someone the cast doesn't know. Every agent has one, subminds
 * included: scripts/portraits.mjs photographs each model alone in the portrait studio and lists them in
 * portraits.ts. The Desk's own names (Rusty, Noco…) come first, then the cast's ids and names.
 */
export function portrait(agent: string): string | null {
  const id = AGENTS[agent]?.id ?? (Object.hasOwn(PORTRAITS, agent) ? agent : Object.keys(PORTRAITS).find((k) => PORTRAITS[k]!.name === agent));
  return id ? `/desk/agent-${id}.webp` : null;
}

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


interface DeskStore {
  data: DeskData;
  /** The conversation open on Relay. */
  picked: string | null;
  pick: (id: string | null) => void;
  /** Send a reply (clears it from the list). */
  send: (id: string) => void;
  /** Push a reply to the next nudge: it drops to the bottom until then. */
  later: (id: string) => void;
  setDraft: (id: string, draft: string) => void;
  /** Answer an action (any choice clears it and counts as done). */
  act: (id: string) => void;
}

export const useDesk = create<DeskStore>((set, get) => ({
  data: EMPTY_DESK,
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
export function foundryDesk(f: FoundryData, now = Date.now(), awaySince = now - DAY_MS): { actions: DeskAction[]; notes: DeskNote[] } {
  const actions: DeskAction[] = [];
  const notes: DeskNote[] = [];
  const shipped: { at: number; note: DeskNote }[] = [];
  for (const c of f.crates) {
    const agent = CREW[crewOf(c, f.crates)].name;
    const id = `foundry-${c.number}`;
    if (c.state === "ready") {
      actions.push({ id, room: "foundry", agent, kind: "decide", when: "now", live: true, title: `Ship “${c.title}”?`, detail: "Built and checked. Tap Ship on the card in the Foundry thread and it goes live.", choices: ["Open the Foundry thread", "See the work"], hrefs: [FOUNDRY_THREAD, c.url] });
    } else if (c.state === "stuck") {
      actions.push({ id, room: "foundry", agent, kind: "check", when: "now", live: true, title: `Stuck: ${c.title}`, detail: "Every model rung tried and the checks are still red. The notes on what was tried are on the issue.", choices: ["Read the notes"], hrefs: [c.url] });
    } else if (c.kind === "idea" && c.state === "queued" && !(c.asking && c.question && !c.revising)) {
      // Rivet's open questions lead Today with the answer box (Today.tsx), so they are not also a "later" row.
      actions.push({ id, room: "foundry", agent, kind: "decide", when: "later", live: true, due: "This morning's ideas", title: c.title, choices: ["Pick on the Foundry tab", "Read it"], hrefs: ["/foundry", c.url] });
    } else if (c.state === "shipped") {
      // The ship time is when the issue closed; updatedAt also moves when a comment lands later.
      const at = c.closedAt ?? c.updatedAt;
      if (at > awaySince) shipped.push({ at, note: { room: "foundry", live: true, text: `${agent} shipped “${c.title}”.` } });
    }
  }
  notes.push(...shipped.sort((a, b) => b.at - a.at).map((s) => s.note));
  if (f.checks.state === "fail" && !f.crates.some((c) => c.kind === "fix" && c.state !== "shipped")) {
    notes.unshift({ room: "foundry", live: true, text: "The checks on main went red. Rivet is on her way." });
  }
  return { actions, notes };
}

/** The Desk's data: the store (empty until the hub connects) plus the Foundry's real work from GitHub. */
export function useDeskData(awaySince?: number): DeskData {
  const data = useDesk((s) => s.data);
  const foundry = useFoundry((s) => s.data);
  const connected = useFoundry((s) => s.connected);
  return useMemo(() => {
    if (!connected) return data;
    const f = foundryDesk(foundry, Date.now(), awaySince);
    return { ...data, actions: [...f.actions, ...data.actions], notes: [...f.notes, ...data.notes] };
  }, [data, foundry, connected, awaySince]);
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
