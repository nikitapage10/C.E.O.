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
  { id: "tessellate", name: "Tessellate", lineage: "claudari", provider: "claude-code", role: "Builder", home: { room: "foundry", station: "intake" }, script: "foundryBuilder", breakChance: 0.1 },
  { id: "caret", name: "Rocky", lineage: "cursori", provider: "cursor", role: "Engineer", home: { room: "foundry", station: "bench-a" }, script: "foundryBuilder", breakChance: 0.08 },
  { id: "semicolon", name: "Rivet", lineage: "cursori", provider: "cursor", role: "Foreman", home: { room: "foundry", station: "bench-b" }, script: "foundryBuilder", breakChance: 0.12 },
  { id: "ledger", name: "Ledger", lineage: "gepetti", provider: "openai", role: "Operations", home: { room: "spire", station: "desk-1" }, script: "spireOperator", breakChance: 0.12 },
  { id: "memo", name: "Memo", lineage: "unforked", provider: "simulated", role: "Assistant to the assistant", home: { room: "spire", station: "desk-3" }, script: "spireOperator", breakChance: 0.25 },
  { id: "odds", name: "Noco", lineage: "gepetti", provider: "openai", role: "Quant", home: { room: "exchange", station: "terminal" }, script: "exchangeQuant", breakChance: 0.08 },
  { id: "hedge", name: "Hedge", lineage: "claudari", provider: "claude-agent-sdk", role: "Risk desk", home: { room: "exchange", station: "desk-e" }, script: "exchangeQuant", breakChance: 0.1 },
  { id: "gridiron", name: "Gridiron", lineage: "claudari", provider: "claude-agent-sdk", role: "Coach", home: { room: "green", station: "depth-chart" }, script: "greenCoach", breakChance: 0.1 },
  { id: "punt", name: "Punt", lineage: "unforked", provider: "simulated", role: "Morale", home: { room: "green", station: "huddle" }, script: "greenPlayer", breakChance: 0.15 },
  { id: "postmaster", name: "Blasto", lineage: "claudari", provider: "claude-agent-sdk", role: "Correspondence", home: { room: "relay", station: "tubes" }, script: "relayClerk", breakChance: 0.08 },
  { id: "dialtone", name: "Dialtone", lineage: "manusi", provider: "manus", role: "Switchboard", home: { room: "relay", station: "switchboard" }, script: "relaySwitchboard", breakChance: 0.15 },
  { id: "loremaster", name: "Loremaster", lineage: "gepetti", provider: "openai", role: "Scribe", home: { room: "archive", station: "shelves" }, script: "archiveScribe", breakChance: 0.08 },
  { id: "heimerdinger", name: "Heimerdinger", lineage: "claudari", provider: "claude-agent-sdk", role: "Researcher", home: { room: "archive", station: "lab" }, script: "archiveResearcher", breakChance: 0.1 },
  { id: "d20", name: "D20", lineage: "manusi", provider: "manus", role: "Game master's hands", home: { room: "archive", station: "dice-table" }, script: "archiveDiceRoller", breakChance: 0.15 },
  { id: "kevin", name: "Kevin", lineage: "unforked", provider: "simulated", role: "On break", home: { room: "breakroom", station: "couch" }, script: "breakroomRegular", breakChance: 0 },
];
