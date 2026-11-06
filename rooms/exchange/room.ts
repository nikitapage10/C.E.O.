import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";
import { TOOLS } from "./tools.ts";

/** The Exchange: markets, research and money. Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "exchange",
  ...nav,
  path: "/exchange",
  navKey: "5",
  accent: "--room-exchange",
  submind: "ticker",
  live: true,
  auth: {
    "exchange-markets": ["site"],
    "exchange-positions": ["passkey"],
  },
  keys: ["POLYMARKET_US_KEY_ID", "POLYMARKET_US_SECRET_KEY"],
  usesClaude: false,
  threat: ["TB1", "TB6"],
  budgetKb: 40,
  tools: [...TOOLS],
  purpose: {
    goal: "Brings Polymarket's live odds and Nikita's read-only positions to an agent desk, practice for agents that read markets without ever trading.",
    agents: [{ name: "Polymarket", use: "the public odds board and the read-only book" }],
    measure: "markets on the board and positions held",
  },
  lore: { submind: "ticker", agents: ["odds", "hedge"], house: ["gepetti", "claudari"], section: "The cast", lines: "exchange" },
});
