import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";

/** The Spire: invoices and the idea scout (docs/PAYPAL.md), round the boardroom table (#825). Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "spire",
  ...nav,
  path: "/spire",
  navKey: "8",
  accent: "--room-spire",
  submind: "gilt",
  live: false,
  auth: { invoices: ["site", "passkey"] },
  keys: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
  usesClaude: false,
  threat: ["TB1"],
  budgetKb: 28,
  purpose: {
    goal: "Lets an agent draft PayPal invoices for Nikita's small-business work while only Nikita presses Send, the first agent line that touches money.",
    agents: [{ name: "PayPal", use: "draft, send and track invoices" }],
    measure: "invoices open, paid and overdue",
  },
  lore: { submind: "gilt", agents: ["ledger", "memo"], house: ["gepetti", "unforked"], section: "The ledger by PayPal", lines: "spire" },
});
