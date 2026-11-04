import { defineRoom } from "@ceo/engine/manifest";
import { TOOLS } from "./tools.ts";

/**
 * The Haven: home and health (#616). A Desk-only room for now (its Lattice room comes later), led by the Steward
 * (DESK_SUBMINDS). Its number key follows the bar (route.ts NAV_ORDER). Data only (docs/ROOMS.md). Its page is in
 * apps/world/src/desk/haven and its endpoints in api/_haven until its migration step. The home devices' and Hey
 * Skippy's endpoints (`haven/devices*`, `haven`, `capture`) stay where #627 and #632 put them; this room adds the
 * floor plan, which only a passkey session reads or writes.
 */
export default defineRoom({
  id: "haven",
  name: "Haven",
  path: "/haven",
  navKey: "2",
  accent: "--room-haven",
  submind: "hearth",
  live: true,
  auth: {
    "haven-plan": ["passkey"],
  },
  keys: [],
  usesClaude: false,
  threat: ["TB1", "TB10", "TB11"],
  budgetKb: 120,
  tools: [...TOOLS],
  purpose: {
    goal: "Runs Nikita's home through its own agents: the vacuum, the cat's feeders and fountain and the Litter-Robot, the Kitchen list Hey Skippy fills, shown on a 3D house that lights where they work.",
    agents: [
      { name: "Roborock", use: "the vacuum: state, alerts, clean by room" },
      { name: "Petlibro", use: "the feeders and the fountain" },
      { name: "Whisker", use: "the Litter-Robot" },
      { name: "Kroger", use: "the Kitchen list matched at King Soopers and sent to the cart on a tap" },
    ],
    measure: "devices live, rooms lit, and Kitchen list items open",
  },
  lore: { submind: "hearth", agents: [], house: [], section: "The Haven", lines: "skippy" },
});
