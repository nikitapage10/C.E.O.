import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";
import { TOOLS } from "./tools.ts";

/** The Green: the fantasy league. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "green",
  ...nav,
  path: "/green",
  navKey: "4",
  accent: "--room-green",
  submind: "turf",
  live: true,
  auth: {
    "green-league": ["site"],
    "green-analysis": ["passkey"],
  },
  keys: ["FANTASYPROS"],
  usesClaude: true,
  threat: ["TB1", "TB2"],
  budgetKb: 60,
  tools: [...TOOLS],
  purpose: {
    goal: "Runs Nikita's Sleeper league through Sleeper, FantasyPros and a Claude analyst, a low-stakes place to tune agents that give weekly advice.",
    agents: [
      { name: "Sleeper", use: "the league, rosters and matchups" },
      { name: "FantasyPros", use: "rankings and start/sit" },
      { name: "Claude", use: "the Commentator's weekly analysis" },
    ],
    measure: "start/sit calls and pickups made this week",
  },
  lore: { submind: "turf", agents: ["gridiron", "punt"], house: ["claudari", "unforked"], section: "The cast", lines: "green" },
});
