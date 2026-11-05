import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";

/** The Workshop: from a prompt to a print. Not live yet. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "workshop",
  ...nav,
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
  lore: { submind: "putty", agents: ["daub", "chisel"], house: ["redmondi", "gepetti"], section: "The Workshop", lines: "workshop" },
});
