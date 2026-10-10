import {
  ROOM_IDS,
  applyEvents,
  emptyState,
  type Activity,
  type AgentEvent,
  type LatticeState,
  type RoomId,
} from "@ceo/core";
import { Simulator } from "@ceo/simulator";
import { create } from "zustand";
import { clock } from "./clock.ts";
import type { LegalFollowUp } from "./glitches/registry.ts";
import type { GlitchLevel } from "./glitches/scheduler.ts";
import { PARAMS } from "./params.ts";

/** Phase 1's only event source. Phase 2 swaps this for a hub connection that speaks the same events. */
export const simulator = new Simulator({ seed: PARAMS.seed });

export interface ActiveGlitch {
  id: string;
  /** performance.now() when it started. */
  startedAt: number;
  durationMs: number;
  room: RoomId | null;
  legal: LegalFollowUp | null;
  /** An agent the glitch is about (the chest pet's owner, the starer…). */
  agentId: string | null;
  /** A line picked when it fired, so it doesn't change on re-render. */
  line: string;
  /** Set when Counsel.exe pulls it early. */
  yanked?: boolean;
}

/** World-only behaviour that isn't part of an agent's real routine (fourth-wall reactions). */
export interface Override {
  mode: "stare" | "face" | Activity;
  until: number;
  /** For "face": the agent to turn toward. */
  target?: string;
}

interface WorldStore {
  lattice: LatticeState;
  /** What each agent is saying right now, shown long enough to read. */
  speech: Record<string, { text: string; until: number }>;
  /** Lines waiting their turn, so a new quip never cuts off the last one. */
  speechQueue: Record<string, string[]>;
  /** The Kernel's current PA announcement. */
  announcement: { text: string; until: number; tone: AnnouncementTone; room: RoomId | null } | null;
  /** Everything the Kernel has said, newest first (shown in Signals). */
  kernelLog: KernelLine[];
  focus: RoomId | null;
  selectedAgent: string | null;
  hoveredAgent: string | null;
  timeScale: number;
  glitchLevel: GlitchLevel;
  sound: boolean;
  quality: "high" | "low";
  activeGlitch: ActiveGlitch | null;
  /** Real time until which the screen-glitch transition plays. */
  flashUntil: number;
  overrides: Record<string, Override>;
  /** Little floating symbols over an agent's head (hearts, sparks…), from the social life of the Lattice. */
  emotes: Record<string, { glyph: string; until: number }>;
  /** The gathering under way (a club night, a one-shot…), so its room can dress up for it. */
  gathering: Gathering | null;
  /** Costume pieces worn for a gathering (a wizard's hat at the D&D table), by agent. */
  costumes: Record<string, Costume>;
  /** Dice on the table: the latest roll by each agent. */
  rolls: Record<string, DiceRoll>;

  dispatch: (events: AgentEvent[]) => void;
  setFocus: (room: RoomId | null) => void;
  cycleFocus: (dir: 1 | -1) => void;
  selectAgent: (id: string | null) => void;
  hoverAgent: (id: string | null) => void;
  setTimeScale: (n: number) => void;
  setGlitchLevel: (level: GlitchLevel) => void;
  setSound: (on: boolean) => void;
  setQuality: (q: "high" | "low") => void;
  resolveApproval: (id: string, decision: "approved" | "denied") => void;
  /** A world-side line from an agent (fourth-wall material), shown and logged like any quip. */
  say: (agentId: string, text: string) => void;
  override: (agentId: string, mode: Override["mode"], ms: number, target?: string) => void;
  emote: (agentId: string, glyph: string, ms: number) => void;
  startGlitch: (g: ActiveGlitch) => void;
  endGlitch: () => void;
  flash: (ms?: number) => void;
  announce: (text: string, tone: AnnouncementTone, room?: RoomId | null) => void;
  setGathering: (g: Gathering | null) => void;
  setCostumes: (c: Record<string, Costume>) => void;
  /** Roll a die for an agent (shown on the table), returning the result. */
  roll: (agentId: string, sides?: number) => number;
}

export interface Gathering {
  id: string;
  room: RoomId;
  host: string;
  guests: string[];
  /** performance.now() when it started; `live` once the scene is playing (everyone seated). */
  since: number;
  live: boolean;
}

export type Costume = "wizard-hat" | "helm" | "hood" | "crown" | "horns" | "feather-cap";

export interface DiceRoll {
  sides: number;
  value: number;
  /** performance.now() of the throw. */
  at: number;
}

export interface KernelLine {
  id: string;
  ts: number;
  text: string;
  tone: AnnouncementTone;
  room: RoomId | null;
}

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let localCounter = 0;

export const useWorld = create<WorldStore>((set, get) => ({
  lattice: emptyState(),
  speech: {},
  speechQueue: {},
  announcement: null,
  kernelLog: [],
  focus: null,
  selectedAgent: null,
  hoveredAgent: null,
  timeScale: PARAMS.speed,
  glitchLevel: PARAMS.glitches ?? (prefersReducedMotion ? "off" : "normal"),
  sound: false,
  quality: PARAMS.quality,
  activeGlitch: null,
  flashUntil: 0,
  overrides: {},
  emotes: {},
  gathering: null,
  costumes: {},
  rolls: {},

  dispatch: (events) => {
    if (events.length === 0) return;
    let speechQueue = get().speechQueue;
    for (const e of events) {
      if (e.type !== "agent.quip" || !get().lattice.agents[e.agentId]) continue;
      // Keep at most two lines waiting per agent; older chatter is still in the feed.
      speechQueue = { ...speechQueue, [e.agentId]: [...(speechQueue[e.agentId] ?? []), e.text].slice(-2) };
    }
    set({ lattice: applyEvents(get().lattice, events), speechQueue });
    pumpSpeech();
  },
  setFocus: (room) => set({ focus: room }),
  cycleFocus: (dir) => {
    const current = get().focus;
    const i = current ? ROOM_IDS.indexOf(current) : dir === 1 ? -1 : 0;
    set({ focus: ROOM_IDS[(i + dir + ROOM_IDS.length) % ROOM_IDS.length]! });
  },
  selectAgent: (id) => {
    const rt = id ? get().lattice.agents[id] : null;
    set({ selectedAgent: id, ...(rt ? { focus: rt.place.room } : {}) });
  },
  hoverAgent: (id) => set({ hoveredAgent: id }),
  setTimeScale: (n) => set({ timeScale: n }),
  setGlitchLevel: (glitchLevel) => set({ glitchLevel }),
  setSound: (sound) => set({ sound }),
  setQuality: (quality) => set({ quality }),
  resolveApproval: (id, decision) => get().dispatch(simulator.resolveApproval(id, decision, clock.sim)),
  say: (agentId, text) =>
    get().dispatch([{ id: `world-${++localCounter}`, ts: clock.sim, source: "simulated", type: "agent.quip", agentId, text }]),
  override: (agentId, mode, ms, target) =>
    set({ overrides: { ...get().overrides, [agentId]: { mode, until: performance.now() + ms, target } } }),
  setGathering: (gathering) => set({ gathering }),
  setCostumes: (costumes) => set({ costumes }),
  roll: (agentId, sides = 20) => {
    const value = 1 + Math.floor(Math.random() * sides);
    set({ rolls: { ...get().rolls, [agentId]: { sides, value, at: performance.now() } } });
    return value;
  },
  emote: (agentId, glyph, ms) => set({ emotes: { ...get().emotes, [agentId]: { glyph, until: performance.now() + ms } } }),
  startGlitch: (g) => set({ activeGlitch: g, flashUntil: performance.now() + 260 }),
  endGlitch: () => set({ activeGlitch: null, flashUntil: performance.now() + 140 }),
  flash: (ms = 300) => set({ flashUntil: performance.now() + ms }),
  announce: (text, tone, room = null) =>
    set({
      announcement: { text, tone, room, until: performance.now() + readingTime(text) + 1200 },
      kernelLog: [{ id: `k-${++localCounter}`, ts: clock.sim, text, tone, room }, ...get().kernelLog].slice(0, 40),
    }),
}));

/** Advance the simulator to the current Lattice time and feed the store. Called once per frame. */
/** How long a line stays up: long enough to read comfortably. */
export function readingTime(text: string) {
  return Math.min(11_000, Math.max(4_200, 2_600 + text.length * 70));
}

/** At most this many bubbles at once, so the room stays readable. */
const MAX_SPEAKING = 4;

/** Promote queued lines to bubbles when an agent has finished its last one. */
export function pumpSpeech() {
  const s = useWorld.getState();
  const now = performance.now();
  let speaking = Object.values(s.speech).filter((x) => x.until > now).length;
  let speech = s.speech;
  let queue = s.speechQueue;
  let changed = false;
  for (const [id, lines] of Object.entries(queue)) {
    if (!lines.length || (speech[id] && speech[id].until > now) || speaking >= MAX_SPEAKING) continue;
    const [text, ...rest] = lines;
    speech = { ...speech, [id]: { text: text!, until: now + readingTime(text!) } };
    queue = { ...queue, [id]: rest };
    speaking++;
    changed = true;
  }
  if (changed) useWorld.setState({ speech, speechQueue: queue });
}

export type AnnouncementTone = "status" | "assign" | "scold" | "nag" | "praise";

export function pumpSimulator() {
  const events = simulator.advanceTo(clock.sim);
  if (events.length) useWorld.getState().dispatch(events);
}
