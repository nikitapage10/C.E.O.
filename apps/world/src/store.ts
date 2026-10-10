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
  /** Real time each agent's latest quip arrived, so bubbles last a fixed real duration. */
  quipShownAt: Record<string, number>;
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
}

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let localCounter = 0;

export const useWorld = create<WorldStore>((set, get) => ({
  lattice: emptyState(),
  quipShownAt: {},
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

  dispatch: (events) => {
    if (events.length === 0) return;
    const now = performance.now();
    const quipShownAt = { ...get().quipShownAt };
    for (const e of events) if (e.type === "agent.quip") quipShownAt[e.agentId] = now;
    set({ lattice: applyEvents(get().lattice, events), quipShownAt });
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
  emote: (agentId, glyph, ms) => set({ emotes: { ...get().emotes, [agentId]: { glyph, until: performance.now() + ms } } }),
  startGlitch: (g) => set({ activeGlitch: g, flashUntil: performance.now() + 260 }),
  endGlitch: () => set({ activeGlitch: null, flashUntil: performance.now() + 140 }),
  flash: (ms = 300) => set({ flashUntil: performance.now() + ms }),
}));

/** Advance the simulator to the current Lattice time and feed the store. Called once per frame. */
export function pumpSimulator() {
  const events = simulator.advanceTo(clock.sim);
  if (events.length) useWorld.getState().dispatch(events);
}
