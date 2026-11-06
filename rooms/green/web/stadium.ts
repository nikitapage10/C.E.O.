import { clamp } from "@ceo/engine/sigils/wvCanvas.ts";

/**
 * The Green's field (#389, the bowl since #824): where everything stands on the turf, as shares of the field. Length
 * 0..1 runs from your end line to theirs (end zones included); across 0..1 runs from the far sideline to the near one.
 * The bowl's 3D scene (bowl.ts) lays these onto its field; the maths stays here, pure, so it can be tested without
 * three.js.
 */

export type TokState = "" | "sit" | "bye" | "out" | "empty";

export interface Tok {
  id: string;
  slot: string;
  pos: string;
  /** Points scored so far this week (0 before kickoff). */
  banked: number;
  /** Points FantasyPros projects for the week (or the board's projection). */
  proj: number;
  state: TokState;
}

/** A yard line (0 = your goal line, 100 = theirs) as a share of the field's length, end zones included. */
export const yardAt = (yd: number) => (10 + clamp(yd, 0, 100)) / 120;

/* ── the formation ── */

/** Which line a starter stands on: 0 at the line of scrimmage, 3 deepest. */
export function rank(pos: string, slot: string): number {
  if (pos === "WR" || pos === "TE") return 0;
  if (pos === "QB" || /FLEX/.test(slot)) return 1;
  if (pos === "RB") return 2;
  return 3;
}

/** Each starter's spot on his own half: lines from the line of scrimmage back, spread evenly across the field. */
export function formation(toks: readonly Pick<Tok, "pos" | "slot">[], side: "mine" | "theirs"): { along: number; across: number }[] {
  const lines = new Map<number, number[]>();
  toks.forEach((t, i) => {
    const r = rank(t.pos, t.slot);
    lines.set(r, [...(lines.get(r) ?? []), i]);
  });
  const used = [...lines.keys()].sort((a, b) => a - b);
  const out: { along: number; across: number }[] = toks.map(() => ({ along: 0, across: 0 }));
  const gap = used.length > 1 ? Math.min(0.13, 0.36 / (used.length - 1)) : 0;
  used.forEach((r, li) => {
    const at = 0.43 - li * gap;
    const members = lines.get(r)!;
    members.forEach((idx, j) => {
      const across = 0.14 + ((j + 0.5) / members.length) * 0.74;
      // Stagger every other man a touch so a crowded line doesn't read as a ruler.
      const along = at - (members.length > 2 && j % 2 ? 0.026 : 0);
      out[idx] = { along: side === "mine" ? along : 1 - along, across };
    });
  });
  return out;
}
