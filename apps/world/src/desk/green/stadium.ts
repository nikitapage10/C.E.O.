import { clamp, WHITE } from "../wvCanvas.ts";

/**
 * The Green's stadium (#389): the geometry of the broadcast's field-view, the page's one signature idea. The field is
 * a ground plane seen by one of two cameras (the high sideline camera on a desktop, the camera behind your end zone on
 * a phone); both lineups stand on it in formation, and the flow kit (desk/flow) runs each starter's points from his
 * spot up into his team's score as a particle line. Everything here is pure maths plus the still drawing of the
 * field's hairlines, done on layout only (never in a frame).
 */

export type Mode = "wide" | "tall";
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

/* ── geometry: one ground plane, two cameras ── */

/** Wide: the high sideline camera (length runs left to right). Tall, on a phone: the camera behind your end zone (length runs up). */
export const modeFor = (W: number): Mode => (W >= 640 ? "wide" : "tall");

interface Cam {
  top: number;
  bot: number;
  zFar: number;
  nearW: number;
}
const CAM: Record<Mode, Cam> = {
  wide: { top: 0.43, bot: 0.975, zFar: 1.62, nearW: 1.04 },
  tall: { top: 0.075, bot: 0.985, zFar: 1.55, nearW: 0.98 },
};

/** Length 0..1 runs from your end line to theirs; across 0..1 runs far sideline to near (wide) or left to right (tall). */
export interface Spot {
  /** Position as a share of the canvas's width and height. */
  x: number;
  y: number;
  /** Perspective scale: 1 at the near edge, smaller farther away. */
  s: number;
}

/** Where a spot on the ground lands on screen, as shares of the canvas (so DOM tokens and the canvas agree). */
export function place(mode: Mode, along: number, across: number): Spot {
  const k = CAM[mode];
  const C = (k.bot - k.top) / (1 - 1 / k.zFar);
  const yH = k.bot - C;
  if (mode === "wide") {
    const z = k.zFar + (1 - k.zFar) * across;
    return { x: 0.5 + ((along - 0.5) * k.nearW) / z, y: yH + C / z, s: 1 / z };
  }
  const z = 1 + (k.zFar - 1) * along;
  return { x: 0.5 + ((across - 0.5) * k.nearW) / z, y: yH + C / z, s: 1 / z };
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

/** Draw the field's hairlines into a still canvas: the pitch box (x, y, w, h) inside a W by H canvas. */
export function paintField(cv: HTMLCanvasElement, mode: Mode, box: { x: number; y: number; w: number; h: number }, W: number, H: number, accent: string) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(W * dpr));
  cv.height = Math.max(1, Math.round(H * dpr));
  const c = cv.getContext("2d");
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const at = (u: number, v: number) => {
    const p = place(mode, u, v);
    return [box.x + p.x * box.w, box.y + p.y * box.h] as const;
  };
  const seg = (u0: number, v0: number, u1: number, v1: number) => {
    const [x0, y0] = at(u0, v0);
    const [x1, y1] = at(u1, v1);
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  };
  // Your end zone: the faintest wash of the accent.
  const q = [at(0, 0), at(yardAt(0), 0), at(yardAt(0), 1), at(0, 1)];
  c.fillStyle = `rgba(${accent},.05)`;
  c.beginPath();
  q.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fill();
  c.lineWidth = 1;
  // Every ten yards a dotted hairline, the way the Desk draws what is laid out but not moving.
  c.setLineDash([1.2, 4]);
  for (let yd = 10; yd < 100; yd += 10) {
    c.strokeStyle = `rgba(${WHITE},${yd === 50 ? 0.3 : 0.16})`;
    seg(yardAt(yd), 0, yardAt(yd), 1);
  }
  c.setLineDash([]);
  c.strokeStyle = `rgba(${WHITE},.22)`;
  seg(yardAt(0), 0, yardAt(0), 1);
  seg(yardAt(100), 0, yardAt(100), 1);
  c.strokeStyle = `rgba(${WHITE},.14)`;
  seg(0, 0, 1, 0);
  seg(0, 1, 1, 1);
  seg(0, 0, 0, 1);
  seg(1, 0, 1, 1);
  c.fillStyle = `rgba(${WHITE},.18)`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (let yd = 10; yd < 100; yd += 10) {
    const p = place(mode, yardAt(yd), mode === "wide" ? 0.94 : 0.06);
    c.font = `400 ${Math.round((mode === "wide" ? 15 : 11) * p.s)}px "Jost Variable", Jost, sans-serif`;
    c.save();
    c.translate(box.x + p.x * box.w, box.y + p.y * box.h);
    if (mode === "tall") c.rotate(-Math.PI / 2);
    c.fillText(String(yd <= 50 ? yd : 100 - yd), 0, 0);
    c.restore();
  }
}
