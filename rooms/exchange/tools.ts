import type { RoomTool } from "@ceo/engine/tools";

/** The Exchange's tools for Skippy (#646): the public odds and Nikita's read-only book. Nothing trades. Data only. */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "exchange_odds",
    room: "exchange",
    title: "Read the odds board",
    description: "Read the Exchange's public Polymarket odds board: the markets it follows and their current odds.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
  {
    name: "exchange_book",
    room: "exchange",
    title: "Read Nikita's book",
    description: "Read Nikita's own Polymarket positions, read-only: how many are open, their value and profit or loss. For Nikita only; never put its numbers in a search or a memory.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
];
