import { describe, expect, it } from "vitest";
import type { GreenBoard, GreenPlayer } from "../_green/types.ts";
import { slimPlayers } from "../_green/sleeper.ts";
import { greenLines } from "./rooms.ts";
import { greenText, lineupAlert } from "./voicereads.ts";

const pl = (id: string, name: string, pos: string, over: Partial<GreenPlayer> = {}): GreenPlayer =>
  ({ id, name, pos, team: "BAL", inj: null, proj: 18, src: "fp", avg: null, last: null, wk: null, ecr: null, posRank: null, bye: null, ...over }) as GreenPlayer;

// Lamar is Out and FantasyPros has no line on him (proj 0, no fp); Stroud is on the bench at 19.4.
const LAMAR = pl("4881", "Lamar Jackson", "QB", { inj: "O", proj: 0, src: "none", fp: null });
const STROUD = pl("8150", "C.J. Stroud", "QB", { team: "HOU", proj: 19.4, fp: 19.4 });
const board = (over: Partial<GreenBoard["roster"]> = {}) =>
  ({
    ok: true, week: 8, byes: [], swaps: [], pickups: [], sources: { calls: "fp" },
    league: { name: "L", teams: 10 }, me: { team: "Mine", record: "5-2", rank: 2 }, matchup: null,
    roster: { starters: [{ slot: "QB", player: LAMAR, pts: 0 }, { slot: "RB", player: pl("1", "Chuba Hubbard", "RB"), pts: 0 }], bench: [STROUD], reserve: [], ...over },
  }) as unknown as GreenBoard;

describe("the lineup flag (#520)", () => {
  it("keeps an Out starter Sleeper lists, whatever the projections say", () => {
    const slim = slimPlayers({ "4881": { position: "QB", team: "BAL", full_name: "Lamar Jackson", injury_status: "Out", injury_body_part: "Ankle" } });
    expect(slim["4881"]).toMatchObject({ n: "Lamar Jackson", inj: "O" });
  });

  it("leads with the Out starter and the healthy bench replacement", () => {
    expect(lineupAlert(board())).toBe("Heads up: your starting QB Lamar Jackson is Out. C.J. Stroud is on your bench.");
    expect(greenText(board()).split("\n")[1]).toMatch(/^Heads up: your starting QB Lamar Jackson is Out/);
    expect(greenLines(board())[0]).toMatch(/^Heads up: your starting QB Lamar Jackson is Out/);
  });

  it("lists every starter and bench player with the injury, no projection needed", () => {
    const t = greenText(board());
    expect(t).toMatch(/Starters: QB Lamar Jackson[^;]* O;/);
    expect(t).toMatch(/Injury list \(Sleeper\): Lamar Jackson QB Out\./);
  });

  it("flags a bye, IR and Doubtful starter, and says when the bench has nobody", () => {
    expect(lineupAlert(board({ starters: [{ slot: "QB", player: pl("1", "A B", "QB", { bye: 8 }), pts: 0 }] as never, bench: [] }))).toMatch(/is on bye this week\. No healthy QB/);
    expect(lineupAlert(board({ starters: [{ slot: "QB", player: pl("1", "A B", "QB", { inj: "D" }), pts: 0 }] as never }))).toMatch(/is Doubtful/);
    expect(lineupAlert(board({ starters: [{ slot: "QB", player: pl("1", "A B", "QB", { inj: "Q" }), pts: 0 }] as never }))).toBe("");
  });
});
