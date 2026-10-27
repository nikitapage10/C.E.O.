import { describe, expect, it } from "vitest";
import { boilerLine, exchangeLine, greenLines, relayLine, roomLines, takeLine } from "./rooms.ts";
import type { GreenAnalysis, GreenBoard } from "../_green/types.ts";
import type { EmailStatus } from "../_email/status.ts";

const NOW = Date.parse("2026-10-27T16:00:00Z");
const player = (name: string) => ({ id: name, name, pos: "WR", team: "KC", inj: null, proj: 10, src: "fp" }) as unknown as GreenBoard["roster"]["bench"][number];
const board = {
  ok: true,
  at: "2026-10-27T15:59:00Z",
  season: "2026",
  week: 8,
  league: { id: "1", name: "League", teams: 12, scoring: "half PPR", faab: 100 },
  me: { rosterId: 1, team: "Mine", record: "5-2", rank: 3, pf: 800, pa: 700, benchLeft: null, faabLeft: 40, streak: null },
  matchup: { week: 8, me: { proj: 112.4 }, them: { proj: 104.1 }, win: 0.63, live: false },
  sources: { sleeper: "live", fantasypros: "live", fpAt: null, calls: "fp", fpParts: null },
  calls: [
    { slot: "FLEX", start: player("Ace Runner"), sit: player("Bo Catcher"), change: true, edge: 3.2, slEdge: -1, sleeper: "disagrees", split: true, tiebreak: null, why: "" },
    { slot: "WR2", start: player("Cy Wide"), sit: player("Di Slot"), change: false, edge: 1.1, slEdge: 1, sleeper: "agrees", split: false, tiebreak: null, why: "" },
  ],
} as unknown as GreenBoard;
const take = { week: 8, headline: "Start the runner, the matchup is soft." } as GreenAnalysis;
const mail = { v: 1, at: NOW, gmail: "connected", agent: "listening", needsYou: 2, fyi: 5, noise: 9, newToday: 14, unsorted: 0, skipped: 1, budgetPct: 12, lastCheck: NOW } as EmailStatus;

describe("the live rooms Skippy is told (#478)", () => {
  it("writes the Green's record, matchup, top calls and the Commentator's take", () => {
    const [head, calls] = greenLines(board);
    expect(head).toBe("Green (week 8): record 5-2, rank 3 of 12; this week projected 112.4 to 104.1, win chance 63%.");
    expect(calls).toBe("Green start/sit (FantasyPros decides): FLEX start Ace Runner over Bo Catcher (edge 3.2, Sleeper disagrees); WR2 keep Cy Wide over Di Slot (edge 1.1).");
    expect(takeLine(take)).toBe("Green, the Commentator's take (week 8): Start the runner, the matchup is soft.");
  });

  it("gives Relay counts only, and the Exchange's positions in words", () => {
    expect(relayLine(mail)).toBe("Relay: 2 need Nikita, 5 FYI, 14 new today, 9 noise, 1 skipped as private; the agent is listening.");
    expect(relayLine({ ...mail, gmail: "refused" })).toBe("Relay: Gmail needs reconnecting.");
    expect(exchangeLine({ open: 3, value: 41.5, pnl: -2.25 })).toBe("Exchange: 3 open positions on Polymarket, worth 41.50 dollars, P&L minus 2.25 dollars.");
    expect(exchangeLine({ open: 0, value: 0, pnl: 0 })).toBe("Exchange: 0 open positions on Polymarket.");
  });

  it("writes the Boiler Room's pipes from the reads that answered", () => {
    expect(boilerLine({ Sleeper: "ok", Gmail: "quiet" }, [{ name: "checks", status: "completed", conclusion: "success" }], "2026-10-27T15:20:00Z", NOW)).toBe(
      "Boiler Room: pipes: Sleeper flowing, Gmail not answering; main: checks success; world step 40 min ago.",
    );
  });

  it("puts every room together, scrubbed, and leaves out a room that fails or is slow", async () => {
    const out = await roomLines(
      {
        green: async () => board,
        take: async () => ({ ...take, headline: "Mail nikita@example.com about it" }),
        relay: async () => Promise.reject(new Error("blob down")),
        exchange: () => new Promise(() => undefined),
        checks: async () => [{ name: "checks", status: "in_progress", conclusion: null }],
        clock: async () => "2026-10-27T15:00:00Z",
      },
      NOW,
      50,
    );
    expect(out).toContain("Green (week 8): record 5-2");
    expect(out).toContain("[private]");
    expect(out).not.toContain("nikita@example.com");
    expect(out).toContain("Relay: its counts aren't answering right now.");
    expect(out).toContain("Exchange: Polymarket isn't answering right now.");
    expect(out).toContain("Boiler Room: pipes: Sleeper flowing, FantasyPros flowing, Gmail not answering, Polymarket not answering; main: checks in_progress; world step 60 min ago.");
    expect(out.split("\n").every((l) => l.length <= 300)).toBe(true);
  });

  it("says nothing for a room that isn't connected here", async () => {
    expect(await roomLines({}, NOW)).toBe("");
    const odd = await roomLines({ green: async () => ({ ok: true }) as unknown as GreenBoard }, NOW, 50);
    expect(odd).not.toContain("undefined");
  });
});
