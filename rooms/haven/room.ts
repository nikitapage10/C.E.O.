import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";
import { TOOLS } from "./tools.ts";

/**
 * The Haven: home and health (#616). A Desk-only room for now (its Lattice room comes later), led by the Steward
 * (DESK_SUBMINDS). Its number key follows the bar (route.ts NAV_ORDER). Data only (docs/ROOMS.md). Its page is in
 * apps/desk/src/haven and its endpoints in api/_haven until its migration step. The home devices' and Hey
 * Skippy's endpoints (`haven/devices*`, `haven`, `capture`) stay where #627 and #632 put them; this room adds the
 * floor plan, which only a passkey session reads or writes.
 */
export default defineRoom({
  id: "haven",
  ...nav,
  path: "/haven",
  navKey: "2",
  accent: "--room-haven",
  submind: "hearth",
  live: true,
  auth: {
    "haven-plan": ["passkey"],
    "haven-meals": ["passkey"],
    // The meal photo library (#687): passkey session; the feed key may PUT one upload.
    "haven-photos": ["passkey", "token"],
  },
  keys: [],
  usesClaude: false,
  threat: ["TB1", "TB10", "TB11", "TB12", "TB13"],
  budgetKb: 120,
  tools: [...TOOLS],
  purpose: {
    goal: "Runs Nikita's home through its own agents: the vacuum, the cat's feeders and fountain and the Litter-Robot, the Kitchen list Hey Skippy fills, shown on a 3D house that lights where they work.",
    agents: [
      { name: "Roborock", use: "the vacuum: state, alerts, clean by room" },
      { name: "Petlibro", use: "the feeders and the fountain" },
      { name: "Whisker", use: "the Litter-Robot" },
      { name: "Kroger", use: "the Kitchen list matched at King Soopers and sent to the cart on a tap" },
      { name: "SwitchBot", use: "the lights on and off, its scenes, and the projector's power" },
      { name: "Govee", use: "the Govee lights on and off" },
      // DoorDash (#1195): its own CLI in the Function app, signed in from the Kitchen; ordering comes in a later phase.
      // Its endpoint, haven/doordash, is registered like haven/kroger in azure/src/index.ts.
      { name: "DoorDash", use: "signed in from the Kitchen, for ordering to come" },
    ],
    measure: "devices live, rooms lit, and Kitchen list items open",
  },
  lore: { submind: "hearth", agents: [], house: [], section: "The Haven", lines: "skippy" },
});
