import { defineRoom } from "@ceo/engine/manifest";
import { TOOLS } from "./tools.ts";

/** Relay: email and texts (docs/GMAIL.md, docs/RELAY-PRIVACY.md). Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "relay",
  name: "Relay",
  path: "/relay",
  navKey: "3",
  accent: "--room-relay",
  submind: "static",
  live: true,
  auth: {
    email: ["site", "passkey"],
    "gmail-callback": ["passkey"],
    relay: ["public", "passkey"],
    "relay-pair": ["token"],
    "relay-hub": ["token"],
  },
  keys: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_TOKEN_KEY", "EMAIL_SKIP_TERMS", "EMAIL_PRIORITY"],
  usesClaude: true,
  threat: ["TB7", "R5"],
  budgetKb: 64,
  tools: [...TOOLS],
  // The intent layer (#642): what's said on /relay reaches the Thread first (./voice.ts); else Static answers.
  voice: () => import("./voice.ts"),
  purpose: {
    goal: "Hands Nikita's email and texts to Claude agents that sort, summarise and draft, with nothing sent without their tap and nothing private leaving the hub.",
    agents: [
      { name: "Gmail", use: "the inbox, read-only, checked every minute" },
      { name: "Claude", use: "Dialtone sorts (Haiku), Blasto advises and drafts (Sonnet)" },
      { name: "BlueBubbles", use: "iMessage and SMS through the Mac hub" },
    ],
    measure: "mail that needs Nikita and texts waiting on a reply",
  },
  lore: { submind: "static", agents: ["postmaster", "dialtone"], house: ["claudari", "manusi"], section: "Letters by the Relay", lines: "relay" },
});
