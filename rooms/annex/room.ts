import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";

/**
 * The Annex: the Desk's staging room for short-run pop-ups (#618), Election night first. A Desk-only room with no
 * Lattice room behind it; led by the Stagehand (DESK_SUBMINDS). Its number key follows the bar (route.ts NAV_ORDER). Data only
 * (docs/ROOMS.md). Its code is in apps/world/src/desk/annex and api/_annex until its migration step.
 */
export default defineRoom({
  id: "annex",
  ...nav,
  path: "/annex",
  navKey: "8",
  accent: "--room-annex",
  submind: "stagehand",
  live: true,
  auth: {
    annex: ["site", "passkey"],
    "annex-elections": ["public"],
  },
  keys: [],
  usesClaude: false,
  threat: ["TB1"],
  budgetKb: 40,
  purpose: {
    goal: "Stages short-run pop-ups on the engine, starting with live election results read from civicAPI, so a new agent feature can be tried for a night before it earns a room.",
    agents: [{ name: "civicAPI", use: "Election night's live results" }],
    measure: "pop-ups live, and races followed on Election night",
  },
  lore: { submind: "stagehand", agents: [], house: [], section: "The Annex", lines: "skippy" },
});
