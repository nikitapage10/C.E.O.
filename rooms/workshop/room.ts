import { defineRoom } from "@ceo/engine/manifest";

/** The Workshop: from a prompt to a print. Not live yet. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "workshop",
  name: "Workshop",
  path: "/workshop",
  navKey: "0",
  accent: "--room-workshop",
  submind: "putty",
  live: false,
  auth: {},
  keys: [],
  usesClaude: false,
  threat: [],
  budgetKb: 8,
  purpose: {
    goal: "Will take a prompt to a printable 3D model through image and mesh agents, Nikita's path into generative making once its pipeline is real.",
    agents: [],
    measure: "figures finished, once the pipeline is real",
  },
  lore: { submind: "putty", agents: ["daub", "chisel"], house: ["manusi", "gepetti"], section: "The Workshop", lines: "workshop" },
});
