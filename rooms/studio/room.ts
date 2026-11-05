import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";

/** The Studio: short videos that explain the internet (#311). Not live yet. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "studio",
  ...nav,
  path: "/studio",
  accent: "--room-studio",
  submind: "tally",
  live: false,
  auth: {},
  keys: ["OPENAI_STUDIO_KEY"],
  usesClaude: false,
  threat: [],
  budgetKb: 16,
  purpose: {
    goal: "Will make short explainer videos through writing, voice and render agents, Nikita's path into an agent-run content line once it is real.",
    agents: [],
    measure: "videos rendered, once the line is real",
  },
  lore: { submind: "tally", agents: ["folio", "arc", "dot"], house: ["gepetti", "cursori", "claudari"], section: "The Studio", lines: "studio" },
});
