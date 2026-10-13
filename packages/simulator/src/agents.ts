import type { Agent, RoomId } from "@ceo/core";
import type { ScriptId } from "./scripts.ts";

export interface SimAgent extends Agent {
  script: ScriptId;
  /** Chance per routine of wandering to the Break Room first. */
  breakChance: number;
}

/** A Skippy submind: the lead of one room, in the admiral can, in its own colour. */
export interface Submind {
  id: string;
  name: string;
  room: RoomId;
  /** The colour it is known by: its hat and coat, and the glow under it. */
  colour: string;
  /** Its thread's name in Skippy's pattern, "Skippy, the <job>". */
  job: string;
}

export const SUBMINDS: readonly Submind[] = [
  { id: "ember", name: "The Builder", room: "foundry", colour: "#ff7a3d", job: "Builder" },
  { id: "gilt", name: "The Executive", room: "spire", colour: "#e8b84a", job: "Executive" },
  { id: "ticker", name: "The Bookie", room: "exchange", colour: "#4fd18b", job: "Bookie" },
  { id: "turf", name: "The Commentator", room: "green", colour: "#a3e04f", job: "Commentator" },
  { id: "static", name: "The Messenger", room: "relay", colour: "#4fa8ff", job: "Messenger" },
  { id: "vellum", name: "The Historian", room: "archive", colour: "#a07aff", job: "Historian" },
  { id: "fizz", name: "The Life of the Party", room: "breakroom", colour: "#ff6fae", job: "Life of the Party" },
  { id: "soot", name: "The Pessimist", room: "boiler", colour: "#c9d3d8", job: "Pessimist" },
  { id: "putty", name: "The Artiste", room: "workshop", colour: "#3fd6c8", job: "Artiste" },
];

export const SUBMIND_IDS: ReadonlySet<string> = new Set(SUBMINDS.map((m) => m.id));
export const isSubmind = (id: string) => SUBMIND_IDS.has(id);
export const submindOf = (room: RoomId): Submind => SUBMINDS.find((m) => m.room === room)!;

/**
 * Subminds decide (which agent, which model or API) rather than do the computer work, so they run on OpenAI, by
 * Nikita's provider rule. Each lives at its room's conductor's post and directs the room from there.
 */
function submindAgents(): SimAgent[] {
  return SUBMINDS.map((m) => ({
    id: m.id,
    name: m.name,
    lineage: "cursori",
    provider: "openai",
    role: "Room lead",
    home: { room: m.room, station: "post" },
    script: "submindConduct",
    breakChance: 0.02,
  }));
}

/**
 * The sample cast. Providers are what each one *will* be driven by once the hub exists
 * (see docs/AGENT_STACK.md); in phase 1 they are all played by the simulator.
 */
export const SAMPLE_AGENTS: SimAgent[] = [
  { id: "tessellate", name: "Rusty", lineage: "claudari", provider: "claude-code", role: "Builder, upkeep and ideas", home: { room: "foundry", station: "intake" }, script: "foundryIdle", breakChance: 0.1 },
  { id: "semicolon", name: "Rivet", lineage: "cursori", provider: "claude-code", role: "First responder", home: { room: "foundry", station: "watch" }, script: "foundryWatch", breakChance: 0.12 },
  { id: "caret", name: "Rocky", lineage: "cursori", provider: "claude-code", role: "Master builder", home: { room: "foundry", station: "drafting" }, script: "foundryDrafting", breakChance: 0.08 },
  { id: "ledger", name: "Ledger", lineage: "gepetti", provider: "openai", role: "Operations", home: { room: "spire", station: "desk-1" }, script: "spireOperator", breakChance: 0.12 },
  { id: "memo", name: "Memo", lineage: "unforked", provider: "simulated", role: "Assistant to the assistant", home: { room: "spire", station: "desk-3" }, script: "spireOperator", breakChance: 0.25 },
  { id: "odds", name: "Noco", lineage: "gepetti", provider: "openai", role: "Quant", home: { room: "exchange", station: "terminal" }, script: "exchangeQuant", breakChance: 0.08 },
  { id: "hedge", name: "Hedge", lineage: "claudari", provider: "claude-agent-sdk", role: "Risk desk", home: { room: "exchange", station: "desk-e" }, script: "exchangeQuant", breakChance: 0.1 },
  { id: "gridiron", name: "Gridiron", lineage: "claudari", provider: "claude-agent-sdk", role: "Coach", home: { room: "green", station: "depth-chart" }, script: "greenCoach", breakChance: 0.1 },
  { id: "punt", name: "Punt", lineage: "unforked", provider: "simulated", role: "Morale", home: { room: "green", station: "huddle" }, script: "greenPlayer", breakChance: 0.15 },
  { id: "postmaster", name: "Blasto", lineage: "claudari", provider: "openai", role: "Correspondence", home: { room: "relay", station: "tubes" }, script: "relayClerk", breakChance: 0.08 },
  { id: "dialtone", name: "Dialtone", lineage: "manusi", provider: "openai", role: "Switchboard", home: { room: "relay", station: "switchboard" }, script: "relaySwitchboard", breakChance: 0.15 },
  { id: "loremaster", name: "Loremaster", lineage: "gepetti", provider: "openai", role: "Scribe", home: { room: "archive", station: "shelves" }, script: "archiveScribe", breakChance: 0.08 },
  { id: "heimerdinger", name: "Heimerdinger", lineage: "claudari", provider: "claude-agent-sdk", role: "Researcher", home: { room: "archive", station: "lab" }, script: "archiveResearcher", breakChance: 0.1 },
  { id: "d20", name: "D20", lineage: "manusi", provider: "manus", role: "Game master's hands", home: { room: "archive", station: "dice-table" }, script: "archiveDiceRoller", breakChance: 0.15 },
  { id: "gary", name: "Gary", lineage: "unforked", provider: "simulated", role: "Maintenance", home: { room: "boiler", station: "pipes" }, script: "boilerKeeper", breakChance: 0.04 },
  { id: "daub", name: "Daub", lineage: "manusi", provider: "simulated", role: "Concept painter", home: { room: "workshop", station: "easel" }, script: "workshopPainter", breakChance: 0.1 },
  { id: "chisel", name: "Chisel", lineage: "gepetti", provider: "simulated", role: "Sculptor", home: { room: "workshop", station: "mould" }, script: "workshopSculptor", breakChance: 0.08 },
  { id: "kevin", name: "Kevin", lineage: "unforked", provider: "simulated", role: "On break", home: { room: "breakroom", station: "couch" }, script: "breakroomRegular", breakChance: 0 },
  // The subminds: pieces of Skippy, one leading each room from its conductor's post (docs/SKIPPY.md).
  ...submindAgents(),
];
