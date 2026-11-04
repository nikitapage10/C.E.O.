import { defineRoom } from "@ceo/engine/manifest";

/** The Boiler Room: every connection, security and the house. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "boiler",
  name: "Boiler Room",
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
  // The Haven's connections (#637, docs/HOME-DEVICES.md): Google (Nest, Tasks) and Instacart.
  keys: ["HOME_TOKEN_KEY", "PETLIBRO_EMAIL", "PETLIBRO_LOGIN_DIGEST", "WHISKER_EMAIL", "WHISKER_SRP_DIGEST", "HAVEN_GOOGLE_CLIENT_ID", "HAVEN_GOOGLE_CLIENT_SECRET", "HAVEN_NEST_PROJECT_ID", "INSTACART_API_KEY"],
  usesClaude: false,
  threat: ["TB6", "TB8", "TB10", "R7", "R8"],
  budgetKb: 200,
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
      { name: "Instacart", use: "the Kitchen list as a shopping list page" },
    ],
    measure: "pipes up and pipes down on the Systems page",
  },
  lore: { submind: "soot", agents: ["drop", "clause"], house: ["unforked", "gepetti"], section: "The Boiler Room", lines: "boiler" },
});
