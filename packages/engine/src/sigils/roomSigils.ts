/**
 * The rooms' sigils (#752): one small mark per Desk room, drawn as threads on the C.E.O. mark's 48 grid (the same
 * grid as the Lattice C in scripts/desk-icons.mjs). The room loader's motes gather along these strokes and the
 * hairlines draw in under them; with reduced motion the strokes simply show. Form follows the room: Today's sun over
 * the Rotunda, the Foundry's fire on its anvil, Relay's envelope, the Boiler Room's gauge on its pipe, the Archive's
 * open book, the Spire, the Exchange's rising line, the Green's pitch, the Workshop's cube, the Studio's frame, the
 * Annex's pop-up tent and the Haven's house.
 *
 * Data only, and pure, so it is tested without a browser.
 */

export type Pt = readonly [number, number];
export type Stroke = readonly Pt[];

export interface RoomSigil {
  /** Polylines on the 48 grid; a closed shape repeats its first point. */
  strokes: readonly Stroke[];
  /** Where a gold glint sits once the motes have gathered. */
  nodes: readonly Pt[];
}

/** The grid the sigils are drawn on. */
export const GRID = 48;

/** A circle (or an arc) as a polyline. */
export function arc(cx: number, cy: number, r: number, a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2, seg = 40): Stroke {
  const out: Pt[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    out.push([+(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)]);
  }
  return out;
}

const rays = (cx: number, cy: number, r0: number, r1: number, n: number): Stroke[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? r1 - 1.5 : r1;
    return [
      [+(cx + Math.cos(a) * r0).toFixed(2), +(cy + Math.sin(a) * r0).toFixed(2)],
      [+(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)],
    ];
  });

// The pointy-top hexagon of the C.E.O. mark: centre (24, 24), radius 17.
const H = { t: [24, 7], ur: [38.72, 15.5], lr: [38.72, 32.5], b: [24, 41], ll: [9.28, 32.5], ul: [9.28, 15.5], c: [24, 24] } as const satisfies Record<string, Pt>;

export const ROOM_SIGILS: Record<string, RoomSigil> = {
  // The sun over the Rotunda, where Skippy chairs the day.
  today: { strokes: [arc(24, 24, 8.5), ...rays(24, 24, 12.5, 18, 8)], nodes: [[24, 24]] },
  // Fire (the alchemists' rising triangle) over the anvil's face.
  foundry: {
    strokes: [
      [[24, 7], [39, 33], [9, 33], [24, 7]],
      [[24, 18], [30, 29], [18, 29], [24, 18]],
      [[6, 40], [42, 40]],
    ],
    nodes: [[24, 7]],
  },
  // The switchboard's envelope, sealed at the fold.
  relay: {
    strokes: [
      [[8, 13], [40, 13], [40, 35], [8, 35], [8, 13]],
      [[8, 13], [24, 26], [40, 13]],
    ],
    nodes: [[24, 26]],
  },
  // A gauge on its pipe, the needle just shy of the red.
  boiler: {
    strokes: [arc(24, 25, 11.5), [[24, 25], [31, 18]], [[3, 25], [12.5, 25]], [[35.5, 25], [45, 25]], [[24, 13.5], [24, 16.5]]],
    nodes: [[24, 25]],
  },
  // The open book the Historian writes the day into.
  archive: {
    strokes: [
      [[24, 14], [16, 11], [8, 12], [8, 37], [16, 36], [24, 39]],
      [[24, 14], [32, 11], [40, 12], [40, 37], [32, 36], [24, 39]],
      [[24, 14], [24, 39]],
    ],
    nodes: [[24, 14], [24, 39]],
  },
  // The gilded spire, banded like a ledger.
  spire: {
    strokes: [
      [[24, 4], [31, 40], [17, 40], [24, 4]],
      [[19.6, 27], [28.4, 27]],
      [[21.6, 16], [26.4, 16]],
      [[12, 44], [36, 44]],
    ],
    nodes: [[24, 4]],
  },
  // A line climbing the floor's axes.
  exchange: {
    strokes: [
      [[7, 8], [7, 41], [42, 41]],
      [[11, 34], [19, 26], [26, 30], [34, 18], [41, 12]],
    ],
    nodes: [[19, 26], [34, 18], [41, 12]],
  },
  // The pitch under the floodlights.
  green: {
    strokes: [[[6, 11], [42, 11], [42, 37], [6, 37], [6, 11]], [[24, 11], [24, 37]], arc(24, 24, 6), [[6, 19], [11, 19], [11, 29], [6, 29]], [[42, 19], [37, 19], [37, 29], [42, 29]]],
    nodes: [[24, 24]],
  },
  // The maker's cube, on the mark's own hexagon: from a prompt to a thing on the shelf.
  workshop: {
    strokes: [
      [H.t, H.ur, H.lr, H.b, H.ll, H.ul, H.t],
      [H.ul, H.c, H.ur],
      [H.c, H.b],
    ],
    nodes: [H.c],
  },
  // A tall frame with play in it.
  studio: {
    strokes: [
      [[13, 6], [35, 6], [35, 42], [13, 42], [13, 6]],
      [[20, 17], [30, 24], [20, 31], [20, 17]],
    ],
    nodes: [[30, 24]],
  },
  // The pop-up's tent and its pennant.
  annex: {
    strokes: [
      [[6, 40], [24, 9], [42, 40]],
      [[3, 40], [45, 40]],
      [[19, 40], [24, 30], [29, 40]],
      [[24, 9], [24, 3], [30, 5], [24, 7]],
    ],
    nodes: [[24, 9]],
  },
  // The house, its door and its chimney: lamplight on a night house.
  haven: {
    strokes: [
      [[6, 24], [24, 9], [42, 24]],
      [[11, 20], [11, 40], [37, 40], [37, 20]],
      [[21, 40], [21, 30], [27, 30], [27, 40]],
      [[31, 14], [31, 9], [35, 9], [35, 17.4]],
    ],
    nodes: [[24, 9]],
  },
};

/** The Lattice C (#640), for a page with no sigil of its own. */
export const LATTICE_C: RoomSigil = {
  strokes: [
    [H.ur, H.t, H.ul, H.ll, H.b, H.lr],
    [H.ur, H.c, H.lr],
  ],
  nodes: [H.c],
};

export const sigilOf = (room: string): RoomSigil => ROOM_SIGILS[room] ?? LATTICE_C;

const segLen = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** A stroke's length on the grid. */
export const strokeLength = (s: Stroke) => s.reduce((sum, p, i) => (i ? sum + segLen(s[i - 1]!, p) : 0), 0);

/** The point a fraction `u` (0..1) of the way along a stroke. */
export function pointOn(s: Stroke, u: number): Pt {
  const total = strokeLength(s);
  if (!total) return s[0] ?? [GRID / 2, GRID / 2];
  let left = Math.min(1, Math.max(0, u)) * total;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!;
    const b = s[i]!;
    const l = segLen(a, b);
    if (left <= l || i === s.length - 1) {
      const f = l ? Math.min(1, left / l) : 0;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    left -= l;
  }
  return s[s.length - 1]!;
}

/** Where a mote rests: which stroke, and how far along it. */
export interface Seat {
  stroke: number;
  u: number;
}

/**
 * `n` seats spread evenly along all of a sigil's strokes by length (so a long stroke gets more motes than a short
 * one), each nudged by up to `jitter` of its share so the line reads as particles, not a dotted rule.
 */
export function seats(sigil: RoomSigil, n: number, rand: () => number = Math.random, jitter = 0.45): Seat[] {
  const lens = sigil.strokes.map(strokeLength);
  const total = lens.reduce((a, b) => a + b, 0);
  if (!total || n <= 0) return [];
  const out: Seat[] = [];
  for (let i = 0; i < n; i++) {
    let at = ((i + 0.5 + (rand() - 0.5) * jitter) / n) * total;
    at = Math.min(total - 1e-6, Math.max(0, at));
    let k = 0;
    while (k < lens.length - 1 && at > lens[k]!) at -= lens[k++]!;
    out.push({ stroke: k, u: lens[k] ? at / lens[k]! : 0 });
  }
  return out;
}

/** The sigil as one SVG path (for the reduced-motion still). */
export const sigilPath = (sigil: RoomSigil) => sigil.strokes.map((s) => s.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("")).join("");

/** "#f0c987" or "rgb(240, 201, 135)" as "240,201,135"; the Desk's ice when it can't be read. */
export function rgbOf(css: string): string {
  const s = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  return rgb ? `${rgb[1]},${rgb[2]},${rgb[3]}` : "159,210,255";
}
