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
  // Live facts on the spot (#1130): "who's playing tonight?" answered from ESPN's public scoreboard, never a hand-off.
  {
    name: "live_scores",
    room: "green",
    title: "Read the scoreboard",
    description:
      "ESPN's live scoreboard, no key: today's games with their scores, status (quarter, inning, final) or start time. Any \"who's playing tonight\", \"is the game on\", score or schedule question for today: call this before and instead of the web. league is nfl, ncaaf, nba, nhl, mlb, wnba, mls or epl (leave it out to search the big leagues); team is a team name, or leave it out for the league's day.",
    input: { type: "object", properties: { league: { type: "string" }, team: { type: "string" } }, required: [], additionalProperties: false },
    effect: "read",
  },
];
