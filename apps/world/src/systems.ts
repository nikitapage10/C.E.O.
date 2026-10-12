import { create } from "zustand";

/**
 * The real links the C.E.O.'s agents depend on, and whether each is working. Shared by the Desk (Today's
 * agent line, the Systems tab) and the Lattice (the Boiler Room's pipes). Imports nothing from the 3D world,
 * so the Desk can load it alone.
 *
 * Phase 2: the hub on the MacBook reports these. Until it exists, every link is "off" (not connected yet).
 * `?boiler=demo` cycles them through every state, to preview the Boiler Room's gags.
 */

export type LinkState = "off" | "ok" | "slow" | "down";

export interface Link {
  id: string;
  label: string;
  /** What it is, in a few words. */
  what: string;
  kind: "agent" | "service" | "machine";
  state: LinkState;
  /** How busy, 0..1 (the pipe's gauge). */
  load: number;
  /** Date.now() when the hub last heard from it, if ever. */
  lastSeen: number | null;
  note?: string;
}

export const LINK_STATE_LABEL: Record<LinkState, string> = {
  off: "Not connected yet",
  ok: "Working",
  slow: "Slow",
  down: "Down",
};

const LINKS: Link[] = [
  { id: "dialtone", label: "Dialtone", what: "Tracks who you owe a reply", kind: "agent", state: "off", load: 0, lastSeen: null },
  { id: "postmaster", label: "Blasto", what: "Drafts replies in your voice", kind: "agent", state: "off", load: 0, lastSeen: null },
  { id: "hub", label: "Hub", what: "The always-on service on the MacBook", kind: "service", state: "off", load: 0, lastSeen: null },
  { id: "bluebubbles", label: "BlueBubbles", what: "Reads and sends iMessage and SMS", kind: "service", state: "off", load: 0, lastSeen: null },
  { id: "messages", label: "Messages", what: "Signed in on the Mac", kind: "service", state: "off", load: 0, lastSeen: null },
  { id: "openai", label: "OpenAI", what: "Sorting, drafting and voice", kind: "service", state: "off", load: 0, lastSeen: null },
  { id: "mac", label: "MacBook", what: "Awake, on power, online", kind: "machine", state: "off", load: 0, lastSeen: null },
];

interface SystemsStore {
  links: Link[];
  /** Date.now() of the last time any link went down; null if never. */
  lastIncident: number | null;
  setLink: (id: string, patch: Partial<Omit<Link, "id">>) => void;
}

export const useSystems = create<SystemsStore>((set, get) => ({
  links: LINKS,
  lastIncident: null,
  setLink: (id, patch) => {
    const wentDown = patch.state === "down" && get().links.find((l) => l.id === id)?.state !== "down";
    set({
      links: get().links.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      ...(wentDown ? { lastIncident: Date.now() } : {}),
    });
  },
}));

/** Whole days since the last incident: 0 when there has never been a working day to count. */
export function daysSinceIncident(lastIncident: number | null, now = Date.now()): number {
  return lastIncident === null ? 0 : Math.floor((now - lastIncident) / 86_400_000);
}

/** Preview mode: walk every link through every state so the gags can be seen before the hub exists. */
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("boiler") === "demo") {
  const states: LinkState[] = ["ok", "ok", "slow", "ok", "down", "ok"];
  let tick = 0;
  const step = () => {
    const { links, setLink } = useSystems.getState();
    links.forEach((l, i) => {
      const state = states[(tick + i * 2) % states.length]!;
      setLink(l.id, { state, load: state === "ok" ? 0.35 + ((tick * 7 + i * 13) % 50) / 100 : state === "slow" ? 0.92 : 0, lastSeen: Date.now() });
    });
    tick++;
  };
  step();
  setInterval(step, 6000);
}
