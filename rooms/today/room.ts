import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";
import { TOOLS } from "./tools.ts";

/** The Senate (once Today, #775): the Desk's front page, run by Skippy from the Kernel (docs/SKIPPY.md). Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "today",
  ...nav,
  path: "/",
  navKey: "1",
  accent: "--ice",
  submind: "skippy",
  live: true,
  auth: { "today-todos": ["public", "passkey"] },
  keys: [],
  usesClaude: true,
  threat: ["TB1", "TB2"],
  budgetKb: 16,
  tools: [...TOOLS],
  purpose: {
    goal: "Puts every room's live agents, their submind reports and Skippy's hand-offs on one page, so Nikita can steer the whole agent system from one place.",
    agents: [
      { name: "Claude", use: "Skippy's chat, the Kernel responder's hand-offs, and Haiku for quick words the rules can't read" },
      { name: "ElevenLabs", use: "Talk calls with Skippy" },
    ],
    measure: "hand-offs answered and room events in the Council today",
  },
  lore: { submind: "skippy", agents: [], house: [], section: "The Kernel, and who sits in it", lines: "skippy" },
});
