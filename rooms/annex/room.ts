import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";

/**
 * The Annex: the Desk's staging room for short-run pop-ups (#618), Election night first. A Desk-only room with no
 * Lattice room behind it; led by the Stagehand (DESK_SUBMINDS). Its number key follows the bar (route.ts NAV_ORDER). Data only
 * (docs/ROOMS.md). Its page is in web/ and its stores in data/ (#617); its endpoints are in api/_annex.
 */
export default defineRoom({
  id: "annex",
  ...nav,
  path: "/annex",
  navKey: "7",
  accent: "--room-annex",
  submind: "stagehand",
  live: true,
  auth: {
    annex: ["site", "passkey"],
    "annex-elections": ["public"],
    "annex-jobs": ["site", "passkey"],
  },
  keys: ["SERPAPI_KEY"],
  usesClaude: true,
  threat: ["TB1", "TB2"],
  budgetKb: 64,
  purpose: {
    goal: "Stages short-run pop-ups on the engine (Election night on civicAPI, a private daily Job search on SerpApi) so a new agent feature can be tried before it earns a room.",
    agents: [
      { name: "civicAPI", use: "Election night's live results" },
      { name: "SerpApi", use: "The Job search's Google Jobs results, once a day" },
      { name: "Claude Sonnet", use: "The Job search's fit check: whether each job's requirements line up with the resume" },
    ],
    measure: "pop-ups live, races followed on Election night, and jobs saved and applied to",
  },
  lore: { submind: "stagehand", agents: [], house: [], section: "The Annex", lines: "skippy" },
});
