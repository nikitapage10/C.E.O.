import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";
import { TOOLS } from "./tools.ts";

/** The Foundry: the coding crew (docs/FOUNDRY.md). Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "foundry",
  ...nav,
  path: "/foundry",
  navKey: "3",
  accent: "--room-foundry",
  submind: "ember",
  live: true,
  auth: {
    foundry: ["passkey"],
    "foundry-image": ["passkey"],
    "foundry-feed": ["site"],
    "foundry-usage": ["site"],
  },
  keys: ["FOUNDRY_APP_ID", "FOUNDRY_APP_INSTALLATION_ID", "FOUNDRY_APP_PRIVATE_KEY", "FOUNDRY_GITHUB_TOKEN"],
  usesClaude: true,
  threat: ["TB3", "TB4", "TB5", "R1", "R2"],
  budgetKb: 90,
  tools: [...TOOLS],
  purpose: {
    goal: "Turns Nikita's ideas into shipped code through Claude Code agents working GitHub issues, the proving ground for running a coding crew end to end.",
    agents: [
      { name: "GitHub", use: "issues, labels and pull requests the crew works from" },
      { name: "Claude Code", use: "the crew's builds, on Nikita's plan" },
      { name: "Claude", use: "Rivet shapes each idea into a card (Haiku)" },
    ],
    measure: "issues shipped this week (foundry:shipped)",
  },
  lore: { submind: "ember", agents: ["tessellate", "semicolon", "caret"], house: ["claudari", "seekari"], section: "The cast", lines: "foundry" },
});
