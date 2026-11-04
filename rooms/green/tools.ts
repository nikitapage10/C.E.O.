import type { RoomTool } from "@ceo/engine/tools";

/** The Green's tools for Skippy (#646): its live board, read-only. Data only. */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "green_board",
    room: "green",
    title: "Read the Green's board",
    description:
      "Read Nikita's fantasy football league as the Green shows it now: record, rank, this week's matchup and win chance, the top start/sit calls (FantasyPros decides) and the Commentator's latest take.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
];
