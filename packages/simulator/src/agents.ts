import type { Agent } from "@ceo/core";
import type { ScriptId } from "./scripts.ts";
import { SUBMINDS } from "./subminds.ts";

export * from "./subminds.ts";

export interface SimAgent extends Agent {
  script: ScriptId;
  /** Chance per routine of wandering to the Break Room first. */
  breakChance: number;
}

/**
 * Subminds decide (which agent, which model or API) rather than do the computer work, so they run on OpenAI, by
 * Nikita's provider rule. Each lives on its room's command podium (the can-throne floating high in the back-right corner), directs the room from
 * there, and floats out over the room to give an order.
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
  { id: "tessellate", name: "Rusty", lineage: "claudari", provider: "claude-code", role: "Builder and ideas", home: { room: "foundry", station: "intake" }, script: "foundryIdle", breakChance: 0.1 },
  { id: "semicolon", name: "Rivet", lineage: "cursori", provider: "claude-code", role: "First responder and upkeep", home: { room: "foundry", station: "watch" }, script: "foundryWatch", breakChance: 0.12 },
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
  // The Boiler Room's pair, since Gary retired: Drop keeps the pipes and the door, Clause keeps the rules.
  { id: "drop", name: "Drop", lineage: "unforked", provider: "simulated", role: "Maintenance and security", home: { room: "boiler", station: "pipes" }, script: "boilerKeeper", breakChance: 0.04 },
  { id: "clause", name: "Clause", lineage: "gepetti", provider: "simulated", role: "Compliance", home: { room: "boiler", station: "lectern" }, script: "boilerCompliance", breakChance: 0.05 },
  { id: "daub", name: "Daub", lineage: "manusi", provider: "simulated", role: "Concept painter", home: { room: "workshop", station: "easel" }, script: "workshopPainter", breakChance: 0.1 },
  { id: "chisel", name: "Chisel", lineage: "gepetti", provider: "simulated", role: "Sculptor", home: { room: "workshop", station: "mould" }, script: "workshopSculptor", breakChance: 0.08 },
  { id: "folio", name: "Folio", lineage: "gepetti", provider: "simulated", role: "Scriptwriter", home: { room: "studio", station: "script" }, script: "studioWriter", breakChance: 0.1 },
  { id: "arc", name: "Arc", lineage: "cursori", provider: "simulated", role: "Editor and renderer", home: { room: "studio", station: "edit" }, script: "studioEditor", breakChance: 0.08 },
  { id: "dot", name: "Dot", lineage: "claudari", provider: "simulated", role: "Host", home: { room: "studio", station: "set" }, script: "studioHost", breakChance: 0.12 },
  { id: "kevin", name: "Kevin", lineage: "unforked", provider: "simulated", role: "On break", home: { room: "breakroom", station: "couch" }, script: "breakroomRegular", breakChance: 0 },
  // The subminds: pieces of Skippy, one leading each room from its command podium (docs/SKIPPY.md).
  ...submindAgents(),
];
