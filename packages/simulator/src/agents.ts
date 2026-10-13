import type { Agent } from "@ceo/core";
import type { ScriptId } from "./scripts.ts";

export interface SimAgent extends Agent {
  script: ScriptId;
  /** Chance per routine of wandering to the Break Room first. */
  breakChance: number;
}

/**
 * The sample cast. Providers are what each one *will* be driven by once the hub exists
 * (see docs/AGENT_STACK.md); in phase 1 they are all played by the simulator.
 */
export const SAMPLE_AGENTS: SimAgent[] = [
  { id: "tessellate", name: "Rusty", lineage: "claudari", provider: "claude-code", role: "Upkeep and ideas", home: { room: "foundry", station: "intake" }, script: "foundryIdle", breakChance: 0.1 },
  { id: "caret", name: "Rocky", lineage: "cursori", provider: "claude-code", role: "Master builder", home: { room: "foundry", station: "bench-a" }, script: "foundryIdle", breakChance: 0.08 },
  { id: "semicolon", name: "Ember", lineage: "cursori", provider: "claude-code", role: "Foundry lead and first responder", home: { room: "foundry", station: "bench-b" }, script: "submindPatrol", breakChance: 0.05 },
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
  // Skippy's subminds: one leads each room, picks who and what runs its work, and sends up what it can't settle.
  { id: "gilt", name: "Gilt", lineage: "cursori", provider: "openai", role: "Spire lead", home: { room: "spire", station: "meeting" }, script: "submindPatrol", breakChance: 0.05 },
  { id: "ticker", name: "Ticker", lineage: "cursori", provider: "openai", role: "Exchange lead", home: { room: "exchange", station: "vault" }, script: "submindPatrol", breakChance: 0.05 },
  { id: "turf", name: "Turf", lineage: "cursori", provider: "openai", role: "Green lead", home: { room: "green", station: "bench" }, script: "submindPatrol", breakChance: 0.05 },
  { id: "static", name: "Static", lineage: "cursori", provider: "openai", role: "Relay lead", home: { room: "relay", station: "outbox" }, script: "submindPatrol", breakChance: 0.05 },
  { id: "vellum", name: "Vellum", lineage: "cursori", provider: "openai", role: "Archive lead", home: { room: "archive", station: "reading" }, script: "submindPatrol", breakChance: 0.05 },
  { id: "fizz", name: "Fizz", lineage: "cursori", provider: "openai", role: "Break Room lead", home: { room: "breakroom", station: "bar" }, script: "submindPatrol", breakChance: 0 },
  { id: "soot", name: "Soot", lineage: "cursori", provider: "openai", role: "Boiler Room lead", home: { room: "boiler", station: "sign" }, script: "submindPatrol", breakChance: 0.05 },
  { id: "putty", name: "Putty", lineage: "cursori", provider: "openai", role: "Workshop lead", home: { room: "workshop", station: "shelves" }, script: "submindPatrol", breakChance: 0.05 },
  { id: "kevin", name: "Kevin", lineage: "unforked", provider: "simulated", role: "On break", home: { room: "breakroom", station: "couch" }, script: "breakroomRegular", breakChance: 0 },
];

/** Skippy's subminds, by agent id, with the colour each wears: the room leads (docs/SKIPPY.md). Ember is also the Foundry's first responder. */
export const SUBMINDS: Record<string, { room: SimAgent["home"]["room"]; colour: string }> = {
  semicolon: { room: "foundry", colour: "#ff7a3d" },
  gilt: { room: "spire", colour: "#e8b84a" },
  ticker: { room: "exchange", colour: "#4fd18b" },
  turf: { room: "green", colour: "#a3e04f" },
  static: { room: "relay", colour: "#4fa8ff" },
  vellum: { room: "archive", colour: "#a07aff" },
  fizz: { room: "breakroom", colour: "#ff6fae" },
  soot: { room: "boiler", colour: "#c9d3d8" },
  putty: { room: "workshop", colour: "#3fd6c8" },
};
export const isSubmind = (id: string) => id in SUBMINDS;
