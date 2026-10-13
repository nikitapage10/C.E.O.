/**
 * The pure half of a speech bubble (SpeechBubble.tsx draws it): how a line breaks into a few short lines, how those
 * lines are paged when there are too many, when each page starts and how much of it is typed out by a given moment,
 * and how bubbles that would sit on top of each other are lifted apart. No DOM, no three.js, so it is all testable.
 */

/** One line of a bubble. `aside` lines are the voice's afterword (a monolith's humour setting), set in a fainter ink. */
export interface SpeechLine {
  text: string;
  aside?: boolean;
}

export interface SpeechPlan {
  pages: SpeechLine[][];
  /** When each page starts, in ms after the bubble appears. */
  starts: number[];
  /** When the bubble starts to leave, in ms after it appears. */
  exitAt: number;
}

export interface PlanOptions {
  /** Characters per line before it wraps. */
  maxChars: number;
  /** Lines per page before it pages. */
  maxLines: number;
  /** Typing speed, characters per second. */
  cps: number;
  /** How long the bubble takes to leave at the end (ms). */
  exitMs?: number;
}

export const ROOM_PLAN: PlanOptions = { maxChars: 30, maxLines: 2, cps: 48, exitMs: 380 };
export const FAR_PLAN: PlanOptions = { maxChars: 24, maxLines: 2, cps: 48, exitMs: 380 };

/** The least a page stays up once typed, so the eye can catch it (ms). */
const MIN_HOLD = 1100;

/** Greedy word wrap to at most `maxChars` per line; a word longer than a line is cut across lines. */
export function wrapLines(text: string, maxChars: number): string[] {
  const width = Math.max(1, Math.floor(maxChars));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let word of words) {
    while (word.length > width) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Word wrap with the lines evened out: the same number of lines as a plain wrap at `maxChars`, but as narrow as
 * that allows, so a short line never trails a long one ("Rusty. Faster. / Properly. Both." over "… Properly. / Both.").
 */
export function balancedLines(text: string, maxChars: number): string[] {
  const lines = wrapLines(text, maxChars);
  if (lines.length < 2) return lines;
  let best = Math.max(1, Math.floor(maxChars));
  for (let w = best - 1; w >= 1; w--) {
    if (wrapLines(text, w).length > lines.length) break;
    best = w;
  }
  return wrapLines(text, best);
}

/** Split lines into pages of at most `perPage`. */
export function paginate<T>(lines: readonly T[], perPage: number): T[][] {
  const n = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < lines.length; i += n) pages.push(lines.slice(i, i + n));
  return pages;
}

const charsOf = (page: readonly SpeechLine[]) => page.reduce((n, l) => n + l.text.length, 0);

/**
 * Lay a spoken line out for a bubble that is up for `durationMs`: wrap it, page it, and share the time between the
 * pages by how much each has to say (but never less than it takes to type a page and glance at it).
 */
export function planSpeech(text: string, durationMs: number, opts: PlanOptions, aside?: string): SpeechPlan {
  const lines: SpeechLine[] = balancedLines(text, opts.maxChars).map((t) => ({ text: t }));
  if (aside?.trim()) lines.push(...balancedLines(aside, opts.maxChars).map((t) => ({ text: t, aside: true })));
  if (!lines.length) lines.push({ text: "…" });
  const pages = paginate(lines, opts.maxLines);
  const exitMs = opts.exitMs ?? 380;
  const exitAt = Math.max(0, durationMs - exitMs);

  const sizes = pages.map(charsOf);
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  const floors = sizes.map((c) => typeMs(c, opts.cps) + MIN_HOLD);
  const starts: number[] = [];
  let at = 0;
  for (let i = 0; i < pages.length; i++) {
    starts.push(Math.round(at));
    at += Math.max(floors[i]!, (exitAt * sizes[i]!) / total);
  }
  // Pages that would start after the bubble leaves are squeezed back in, evenly, before it goes.
  if (pages.length > 1 && starts[starts.length - 1]! > exitAt - MIN_HOLD) {
    const step = Math.max(0, exitAt - MIN_HOLD) / pages.length;
    for (let i = 0; i < starts.length; i++) starts[i] = Math.round(i * step);
  }
  return { pages, starts, exitAt };
}

/** How long typing `chars` characters takes (ms). */
export function typeMs(chars: number, cps: number) {
  return cps > 0 ? (chars / cps) * 1000 : 0;
}

/** Which page is showing `elapsed` ms after the bubble appeared. */
export function pageAt(plan: SpeechPlan, elapsed: number): number {
  let i = 0;
  while (i + 1 < plan.starts.length && elapsed >= plan.starts[i + 1]!) i++;
  return i;
}

/** How many characters of a page are typed out `sincePage` ms after it started (all of them with `cps` 0). */
export function typedAt(page: readonly SpeechLine[], sincePage: number, cps: number): number {
  const all = charsOf(page);
  if (cps <= 0) return all;
  return Math.max(0, Math.min(all, Math.floor((sincePage / 1000) * cps)));
}

/** Split `typed` characters across a page's lines: how many of each line are showing. */
export function typedPerLine(page: readonly SpeechLine[], typed: number): number[] {
  let left = typed;
  return page.map((l) => {
    const n = Math.max(0, Math.min(l.text.length, left));
    left -= n;
    return n;
  });
}

/** A bubble on screen, in CSS pixels: `x` is the centre, `y` the bottom (where its stem meets the speaker). */
export interface BubbleBox {
  id: string;
  x: number;
  y: number;
  /** The full bubble's size. */
  w: number;
  h: number;
  /** Earlier bubbles keep their place; later ones move. */
  order: number;
}

/** Where a bubble goes: how far it is lifted, and whether it is tucked into a small "speaking…" pip for now. */
export interface BubbleSpot {
  lift: number;
  tucked: boolean;
}

export interface ArrangeOptions {
  /** Clear space kept between bubbles (px). */
  gap?: number;
  /** The most a bubble is lifted before it tucks away instead (px). */
  maxLift?: number;
  /** A lifted bubble may not rise above this (px from the top of the view): the top bar lives there. */
  minTop?: number;
  /** A tucked bubble's size (px), stem included. */
  pip?: { w: number; h: number };
}

const ARRANGE: Required<ArrangeOptions> = { gap: 6, maxLift: 150, minTop: 0, pip: { w: 30, h: 26 } };

type Placed = { x: number; w: number; top: number; bottom: number };

/** How far a box of `w`×`h` with its bottom centre at (`x`, `y`) must rise to clear everything already placed. */
function riseClear(x: number, y: number, w: number, h: number, placed: readonly Placed[], gap: number): number {
  let l = 0;
  // A few passes: rising above one bubble can land it on another.
  for (let pass = 0; pass <= placed.length; pass++) {
    let moved = false;
    for (const p of placed) {
      const bottom = y - l;
      const top = bottom - h;
      const sideBySide = Math.abs(x - p.x) >= (w + p.w) / 2 + gap;
      const apart = top >= p.bottom + gap || bottom <= p.top - gap;
      if (sideBySide || apart) continue;
      const need = y - (p.top - gap);
      if (need > l) {
        l = need;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return l;
}

/**
 * Keep talking agents' bubbles off each other. The earliest bubble stays put; each later one that would cover a
 * bubble already placed rises just above it (its stem stretches to keep pointing at the speaker). When there is no
 * room for it within `maxLift`, or it would rise under the top bar, it tucks into a small pip over its speaker until
 * the air clears.
 */
export function arrangeBubbles(boxes: readonly BubbleBox[], options: ArrangeOptions = {}): Record<string, BubbleSpot> {
  const { gap, maxLift, minTop, pip } = { ...ARRANGE, ...options };
  const sorted = [...boxes].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: Placed[] = [];
  const out: Record<string, BubbleSpot> = {};
  for (const b of sorted) {
    const l = riseClear(b.x, b.y, b.w, b.h, placed, gap);
    if (l === 0 || (l <= maxLift && b.y - l - b.h >= minTop)) {
      out[b.id] = { lift: l, tucked: false };
      placed.push({ x: b.x, w: b.w, top: b.y - l - b.h, bottom: b.y - l });
      continue;
    }
    const lp = Math.min(maxLift, riseClear(b.x, b.y, pip.w, pip.h, placed, gap));
    out[b.id] = { lift: lp, tucked: true };
    placed.push({ x: b.x, w: pip.w, top: b.y - lp - pip.h, bottom: b.y - lp });
  }
  return out;
}
