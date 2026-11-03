import { defineRoom } from "@ceo/engine/manifest";

/** The Boiler Room: every connection, security and the house. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "boiler",
  name: "Boiler Room",
  path: "/boiler",
  navKey: "0",
  accent: "--room-boiler",
  submind: "soot",
  live: true,
  auth: {
    "security-feed": ["site"],
    "visual-qa-feed": ["site"],
    "desk-timing": ["site"],
    "lattice-timing": ["site"],
    "talk-timing": ["site"],
  },
  keys: [],
  usesClaude: false,
  threat: ["TB6", "TB8", "R7", "R8"],
  budgetKb: 200,
  purpose: {
    goal: "Watches every real integration, key and security check in one place, so each new agent link is wired, guarded and seen working.",
    agents: [
      { name: "GitHub", use: "checks, CodeQL and the security posture" },
      { name: "Gemini", use: "Visual QA reviews of the Lattice" },
    ],
    measure: "pipes up and pipes down on the Systems page",
  },
  lore: { submind: "soot", agents: ["drop", "clause"], house: ["unforked", "gepetti"], section: "The Boiler Room", lines: "boiler" },
});
