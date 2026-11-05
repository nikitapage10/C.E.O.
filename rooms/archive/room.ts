import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";

/** The Archive: the day as a story, and the Tide. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "archive",
  ...nav,
  path: "/archive",
  navKey: "7",
  accent: "--room-archive",
  submind: "vellum",
  live: false,
  auth: { "day-story": ["site", "passkey"] },
  keys: [],
  usesClaude: true,
  threat: ["TB2", "TB6"],
  budgetKb: 60,
  purpose: {
    goal: "Keeps the record of what the agents did, written by Claude each hour and read aloud, so the agent system's history stays easy to search and honest.",
    agents: [
      { name: "Claude", use: "the hourly world step and the day's story (Haiku)" },
      { name: "ElevenLabs", use: "Today in Ilyr, read aloud" },
    ],
    measure: "Chronicle entries written today",
  },
  lore: { submind: "vellum", agents: ["loremaster", "heimerdinger", "d20"], house: ["gepetti", "claudari", "geminari"], section: "The Chronicle of Ilyr", lines: "archive" },
});
