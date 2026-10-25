import { describe, expect, it } from "vitest";
import type { Fitting, GState, PipeRow } from "../systemsGraph.ts";
import { changesOf, lookOf, rackCols, rowGeo, segId, segsOf } from "./rack.ts";

const fit = (id: string, state: GState, side: Fitting["side"] = "out"): Fitting => ({ id, l: id, s: "", k: "service", state, side });
const row = (id: string, ins: Fitting[], outs: Fitting[]): PipeRow => ({ id, flow: false, room: id, name: id, sub: "", stc: "ok", steps: ins.length + outs.length, ins, outs });

describe("the Boiler Room's rack of lines", () => {
  const a = row("a", [fit("you", "ok", "in"), fit("desk", "ok", "in")], [fit("github", "run"), fit("claude", "bad"), fit("lattice", "wait")]);
  const b = row("b", [fit("desk", "ok", "in")], [fit("odds", "ok")]);
  const cols = rackCols([a, b]);

  it("stands every keeper in one column, feeds right-aligned before it", () => {
    expect(cols).toEqual({ ins: 2, outs: 3 });
    const ga = rowGeo(a, cols);
    const gb = rowGeo(b, cols);
    expect(ga.hub).toBe(gb.hub);
    expect(gb.ins[0]).toBe(ga.ins[1]);
    expect(ga.ins[0]).toBeLessThan(ga.ins[1]!);
    expect(ga.outs.at(-1)).toBeCloseTo(gb.outs.at(-1)!);
    expect(ga.outs.every((x) => x > ga.hub && x < 1)).toBe(true);
  });

  it("gives each connection its own stretch, its valve at the right end", () => {
    const s = segsOf(a, rowGeo(a, cols));
    expect(s.map((x) => x.id)).toEqual(["a|in|you", "a|in|desk", "a|out|github", "a|out|claude", "a|out|lattice"]);
    const g = rowGeo(a, cols);
    expect(s[1]).toMatchObject({ a: g.ins[1], b: g.hub, valveU: 0 });
    expect(s[2]).toMatchObject({ a: g.hub, b: g.outs[0], valveU: 1, state: "run" });
    for (const x of s) expect(x.b).toBeGreaterThan(x.a);
  });

  it("draws flowing full, under load thinned, waiting dashed and broken still with a red knot", () => {
    expect(lookOf("ok", 1).rate).toBeGreaterThan(lookOf("run", 1).rate);
    expect(lookOf("run", 1).thin?.keep).toBeLessThan(1);
    expect(lookOf("wait", 1).waiting).toBe(true);
    expect(lookOf("bad", 0)).toMatchObject({ rate: 0, red: true, knots: [0] });
  });

  it("reports only the connections whose state changed", () => {
    const prev = new Map([[segId("a", fit("github", "run")), "ok" as GState], [segId("a", fit("claude", "bad")), "bad" as GState]]);
    expect(changesOf(prev, [a]).map((c) => [c.id, c.from, c.to])).toEqual([["a|out|github", "ok", "run"]]);
  });
});
