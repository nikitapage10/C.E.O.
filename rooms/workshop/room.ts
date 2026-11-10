import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";

/** The Workshop: from a picture to a print, one printer and four stages (#827, #989). Not live yet. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "workshop",
  ...nav,
  path: "/workshop",
  navKey: "9",
  accent: "--room-workshop",
  submind: "putty",
  live: false,
  auth: {},
  keys: [],
  usesClaude: false,
  threat: [],
  budgetKb: 48,
  purpose: {
    goal: "Will take a design from an image (ChatGPT) to a mesh (Meshy), through the slicer and onto the one printer, Nikita's path into generative making once its pipeline is real.",
    agents: [],
    measure: "figures finished, once the pipeline is real",
  },
  lore: { submind: "putty", agents: ["daub", "chisel"], house: ["redmondi", "gepetti"], section: "The Workshop", lines: "workshop" },
});
