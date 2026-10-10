import type { RoomId } from "@ceo/core";

/**
 * What each room is for, in plain words: shown under the room's title ("About this room").
 * `today` is what happens in phase 1 (simulated); `next` is what will drive it once real agents connect.
 */
export const ROOM_ABOUT: Record<RoomId, { blurb: string; stations: Record<string, string>; today: string; next: string }> = {
  foundry: {
    blurb: "Where code gets made. Every crate on the conveyor is a coding task: it's picked up, assembled by the arm, tested in the furnace, then shipped as a pull request.",
    stations: {
      intake: "New coding tasks arrive here as crates.",
      assembler: "The agent writes and edits code.",
      furnace: "Tests run. The window glows green for a pass, red for a fail.",
      shipping: "Finished work leaves as a pull request; merges wait for your approval.",
      "bench-a": "Workbench for background agents.",
      "bench-b": "Workbench for background agents.",
    },
    today: "Simulated Claude Code and Cursor agents working on your repos.",
    next: "Real Claude Code sessions (via hooks) and Cursor background agents.",
  },
  spire: {
    blurb: "The front office for your small online businesses: inbox, orders, listings, invoices and the weekly numbers.",
    stations: {
      "desk-1": "Customer email and support.",
      "desk-2": "Orders and listings.",
      "desk-3": "Admin, invoices, the boring heroic stuff.",
      whiteboard: "The KPI board: this week's numbers.",
      meeting: "Where agents 'align' (they talk).",
      coffee: "The espresso machine. Sentient, unmotivated.",
    },
    today: "Simulated operations agents drafting emails and updating listings.",
    next: "Claude agents with your store, email and payment connectors; outbound email needs your approval.",
  },
  exchange: {
    blurb: "The trading floor for Kalshi and portfolio research. Agents research markets, price them, and bring trade ideas to the vault.",
    stations: {
      terminal: "Market research.",
      "desk-n": "Pricing desk.",
      "desk-e": "Risk desk.",
      "desk-w": "Pricing desk.",
      vault: "The approval vault: it opens while a trade is waiting on you.",
    },
    today: "Simulated quants proposing trades (no real money moves).",
    next: "The Kalshi API, demo environment first, trades always approval-gated with caps.",
  },
  green: {
    blurb: "Fantasy football HQ. Agents read your Sleeper league, projections and injury reports, then suggest waiver claims and lineup changes.",
    stations: {
      "depth-chart": "Projections and injury reports.",
      mailbox: "Waiver claims. The flag goes up when one is waiting on you.",
      sideline: "Lineup suggestions.",
      huddle: "Morale.",
      bench: "Sitting. Thinking. Mostly sitting.",
    },
    today: "Simulated coaches making recommendations.",
    next: "Sleeper's read-only API. You tap the final move in the Sleeper app.",
  },
  relay: {
    blurb: "Your messages. Texts arrive by pneumatic tube, an agent drafts a reply in your voice, and it waits in the outbox until you approve it.",
    stations: {
      tubes: "Incoming messages.",
      "draft-desk": "Replies get drafted here.",
      outbox: "Drafts waiting for your approval (the beacon lights up).",
      switchboard: "Routing: who's urgent, who can wait, who's the group chat.",
    },
    today: "Simulated messages and drafts. Nothing is sent.",
    next: "BlueBubbles on your Mac for iMessage; draft-only at first, then allowlisted auto-replies.",
  },
  archive: {
    blurb: "The Tide's library: worldbuilding, lore and D&D campaign prep. Half arcane library, half research lab, like the world it keeps.",
    stations: {
      shelves: "The lore, shelved by people, place and age.",
      loom: "Lore gets woven and cross-checked against canon.",
      "dice-table": "Session prep and encounter tables.",
      shrine: "Our first Cease & Desist. Framed. With pride.",
      reading: "A quiet chair for long documents.",
      lab: "Heimerdinger's workbench: where the lore gets tested before anyone believes it.",
    },
    today: "Simulated scribes drafting lore and prepping sessions.",
    next: "Agents drafting tide.publication.v1 bundles that go through The Tide's own preview and publish.",
  },
  breakroom: {
    blurb: "Where agents go between tasks: coffee, naps on the server rack, ping-pong, and a window onto the Age of the Veil.",
    stations: {
      couch: "Strategic resting.",
      "ping-pong": "Ping. Pong.",
      "coffee-machine": "Sentient. Unmotivated. Will not make you coffee.",
      "server-rack": "The premium nap spot. It's warm.",
      window: "A view of the Veil, for staring into.",
    },
    today: "Agents on break. Kevin lives here.",
    next: "Same, but with real agents. Morale is a feature.",
  },
};
