import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";
import { TOOLS } from "./tools.ts";

/** The Boiler Room: every connection, security and the house. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "boiler",
  ...nav,
  path: "/boiler",
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
  // The home devices (#632, docs/HOME-DEVICES.md): the sealing key and the Petlibro and Whisker logins.
  // The Haven's connections (#637, docs/HOME-DEVICES.md): Google (Nest, Tasks), and King Soopers through Kroger (#664;
  // MEALME_API_KEY is kept unread, from before King Soopers replaced MealMe).
  // The Haven's lights (#931): SwitchBot's token and secret and Govee's key.
  keys: ["HOME_TOKEN_KEY", "PETLIBRO_EMAIL", "PETLIBRO_LOGIN_DIGEST", "WHISKER_EMAIL", "WHISKER_SRP_DIGEST", "HAVEN_GOOGLE_CLIENT_ID", "HAVEN_GOOGLE_CLIENT_SECRET", "HAVEN_NEST_PROJECT_ID", "KROGER_CLIENT_ID", "KROGER_CLIENT_SECRET", "MEALME_API_KEY", "SWITCHBOT_TOKEN", "SWITCHBOT_SECRET", "GOVEE_API_KEY"],
  usesClaude: false,
  threat: ["TB6", "TB8", "TB10", "R7", "R8"],
  budgetKb: 200,
  tools: [...TOOLS],
  purpose: {
    goal: "Watches every real integration, key and security check in one place, so each new agent link is wired, guarded and seen working.",
    agents: [
      { name: "GitHub", use: "checks, CodeQL and the security posture" },
      { name: "Gemini", use: "Visual QA reviews of the Lattice" },
      { name: "Roborock", use: "the vacuum, read and run from the Azure copy" },
      { name: "Petlibro", use: "the cat's feeders and fountain" },
      { name: "Whisker", use: "the Litter-Robot 5 Pro" },
      { name: "Google Nest", use: "the thermostat, read and set within 60 to 80 °F" },
      { name: "Google Tasks", use: "quick-adds onto the Kitchen list" },
      { name: "Kroger", use: "the Kitchen list matched at King Soopers, picks added to the cart" },
      { name: "SwitchBot", use: "the Haven's lights, scenes and the projector's remote" },
      { name: "Govee", use: "the Haven's Govee lights, on and off" },
    ],
    measure: "pipes up and pipes down on the Systems page",
  },
  lore: { submind: "soot", agents: ["drop", "clause"], house: ["unforked", "gepetti"], section: "The Boiler Room", lines: "boiler" },
});
