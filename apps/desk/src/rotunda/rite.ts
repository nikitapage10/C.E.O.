import { versionOf } from "./heard.ts";

/**
 * The Senate's order of business (#740), pure so it can be tested: how each item on Today's docket plays on the
 * chamber floor. Three kinds, each with its own ritual (the round 3 concept Nikita picked, 2026-11-04):
 *
 * - a **duty** (blue) is read by the clerk; its room's pod flies in, says it, and it is moved and seconded onto the
 *   docket, with no debate;
 * - a **decision** (gold) gets a short debate: one advocate pod per option, the Pessimist's counterpoint, then the
 *   question is put to Nikita and the options become buttons;
 * - a **repair** (coral) is reported, cause then fix, with one risk note from the Pessimist, and ends with one button.
 *
 * Everything said here comes from the docket's own real rows (TodayNow.tsx), in words that are safe to show: counts,
 * rooms, public titles. Never a name, an address, an amount or a message's words. The gallery's murmurs are canned
 * flavour, picked by the item's kind.
 */

export type RiteKind = "duty" | "decision" | "repair";

/** What a docket row hands the ritual. Every string must already be safe to show (no personal data). */
export interface RiteInput {
  key: string;
  kind: RiteKind;
  /** The pod that brings it: a Council member's id, or "kernel" for Skippy's own. */
  by: string;
  /** The room's name, for "Item II · Foundry". */
  room: string;
  /** The item in a few safe words, lower case after the first: "a reply waiting on you". */
  what: string;
  /** Duty: what its pod says on the floor. */
  say?: string;
  /** Decision: the options (safe labels), each with an optional line its advocate says. */
  options?: { label: string; say?: string }[];
  /** Repair: the cause and the fix, in plain words. */
  cause?: string;
  fix?: string;
  /**
   * Its content version's seed (#900), for a row whose words move with the clock: said again only when this changes.
   * Without it, the version is taken from everything above.
   */
  ver?: string;
}

export interface RiteLine {
  /** A bold lead-in, e.g. the option's label. */
  lead?: string;
  text: string;
}

export interface RiteItem {
  key: string;
  /** Its content version (heard.ts): the Senate says each version once. */
  ver: string;
  kind: RiteKind;
  /** Roman numeral: "I", "II". */
  n: string;
  room: string;
  by: string;
  clerk: string;
  say?: RiteLine;
  options?: { by: string; label: string; say: RiteLine }[];
  counter?: { on: number; by: string; say: RiteLine };
  report?: RiteLine;
  risk?: { by: string; say: RiteLine };
  done: string;
  /** For the docket card: who moves it, how many advocate, who answers back. */
  meta: string;
  /** The card's stamp once its ritual has run. */
  stamp: string;
}

export const KIND_LABEL: Record<RiteKind, string> = { duty: "Duty", decision: "Decision", repair: "Repair" };
/** The kinds' colours: cool blue, gold, coral. */
export const KIND_COLOUR: Record<RiteKind, string> = { duty: "#8fb4e0", decision: "#e3c98d", repair: "#ff8a6e" };
export const COUNTER_COLOUR = "#ff6b5e";
/** Who gives the counterpoint and the risk note. */
export const PESSIMIST = "boiler";

const ROMAN: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function roman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out || "–";
}

/** The submind titles, for "the chair recognizes the Builder". */
export const SUBMIND_TITLE: Record<string, string> = {
  kernel: "Skippy, the Magnificent",
  foundry: "The Builder",
  relay: "The Messenger",
  exchange: "The Bookie",
  green: "The Commentator",
  spire: "The Executive",
  archive: "The Historian",
  boiler: "The Pessimist",
  breakroom: "The Life of the Party",
  workshop: "The Artiste",
  studio: "The Director",
  annex: "The Stagehand",
  haven: "The Steward",
};
export const lower = (who: string) => who.replace(/^The /, "the ");
const titleOf = (id: string) => SUBMIND_TITLE[id] ?? "the clerk";

/** The Pessimist's counterpoints and risk notes: canned, general, and never about anyone. */
const COUNTERS = [
  "Counterpoint: the first option is only the suggestion. Read the card before it carries.",
  "Counterpoint: whichever way it goes, something else waits a day. Pick the one you'll mind least.",
  "Counterpoint: the easy answer is rarely the cheap one. I'd look twice.",
];
const RISKS = [
  "Risk: a fix in a hurry can knock the next link over. Watch the gauge after.",
  "Risk: it may hold for an hour and fail again. I'll be here, expecting it.",
  "Risk: the fix touches something that works. Nothing that works stays working, in my experience.",
];
const ADVOCATE = ["It's the room's own suggestion.", "Or this. It's on the card too.", "A third road, if neither suits.", "One more, for completeness."];

const pick = <T,>(xs: T[], k: number) => xs[((k % xs.length) + xs.length) % xs.length]!;

/**
 * One docket row's ritual. `n` is its place on the docket (1-based); `bench` lists the pods free to advocate, in order
 * (the active subminds), so a decision's options each get their own advocate.
 */
export function rite(input: RiteInput, n: number, bench: string[]): RiteItem {
  const num = roman(n);
  const base = { key: input.key, ver: versionOf(input), kind: input.kind, n: num, room: input.room, by: input.by };
  const what = input.what.replace(/\.$/, "");
  if (input.kind === "duty") {
    return {
      ...base,
      clerk: `The clerk reads item ${num.toLowerCase()}, a duty: ${what}.`,
      say: { text: input.say ?? "Nothing to debate. It only needs you." },
      done: "Moved and seconded. It goes to your docket.",
      meta: `Moved by ${lower(titleOf(input.by))} · no debate`,
      stamp: "Seconded",
    };
  }
  if (input.kind === "decision") {
    const opts = (input.options ?? []).slice(0, 3);
    const free = bench.filter((id) => id !== input.by && id !== PESSIMIST);
    const options = opts.map((o, k) => ({
      by: k === 0 ? input.by : (free[(k - 1) % Math.max(1, free.length)] ?? input.by),
      label: o.label,
      say: { lead: `${o.label.replace(/\.$/, "")}.`, text: o.say ?? pick(ADVOCATE, k) },
    }));
    return {
      ...base,
      clerk: `Item ${num.toLowerCase()}, a decision: ${what}.`,
      options,
      counter: options.length ? { on: 0, by: PESSIMIST, say: { text: pick(COUNTERS, n - 1) } } : undefined,
      done: "The question is put to you.",
      meta: `${options.length} ${options.length === 1 ? "advocate" : "advocates"} · counterpoint: the Pessimist`,
      stamp: "Put to you",
    };
  }
  return {
    ...base,
    clerk: `Item ${num.toLowerCase()}, a repair: ${what}.`,
    report: { lead: `Fix: ${(input.fix ?? "open the room and look").replace(/\.$/, "")}.`, text: `Cause: ${(input.cause ?? "not known yet").replace(/\.$/, "")}.` },
    risk: { by: PESSIMIST, say: { text: pick(RISKS, n - 1) } },
    done: "One fix stands before you.",
    meta: `Reported by ${lower(titleOf(input.by))} · risk note: the Pessimist`,
    stamp: "Fix ready",
  };
}

/** The whole docket's rituals, numbered in order. */
export const rites = (inputs: RiteInput[], bench: string[]) => inputs.map((r, i) => rite(r, i + 1, bench));

/** The chair's lines between the speakers. */
export const chairLine = {
  recognize: (by: string, label: string) => `The chair recognizes ${lower(titleOf(by))}, for ${label.charAt(0).toLowerCase()}${label.slice(1).replace(/\.$/, "")}.`,
  tradeoff: (by: string) => `The chair recognizes ${lower(titleOf(by))}, on a trade-off.`,
  report: (by: string) => `The chair recognizes ${lower(titleOf(by))}, to report.`,
  risk: () => "A note of risk, from the Boiler Room.",
};

/** Gallery murmurs, by mood. Good-natured, in-world, never about real people or anything of Nikita's. */
export const MURMURS = {
  aye: ["Hear, hear", "Seconded", "About time", "Aye", "Well moved", "So say we all", "Carried, surely", "Finally"],
  nay: ["Order!", "Point of order", "Shame", "Sit down, Builder", "Not this again", "Says who?", "Question!"],
  heckle: ["Who let the Bookie bet on this?", "Put it to the Lattice!", "My pod's older than that idea", "Is the Pessimist ever cheerful?", "Louder, the back tiers can't hear", "Bring back the old cards", "Pass the snacks", "Wake the Historian"],
  groan: ["Again?", "Ugh, the pipes", "Who broke it?", "Every week", "Not the queue…", "Turn it off and on"],
} as const;
export type Mood = keyof typeof MURMURS;
/** Which moods each kind of business draws on. */
export const MOOD: Record<RiteKind | "idle", Mood[]> = {
  duty: ["aye", "aye", "aye", "heckle"],
  decision: ["aye", "nay", "nay", "heckle", "heckle"],
  repair: ["groan", "groan", "heckle", "aye"],
  idle: ["heckle", "aye"],
};
/** At most this many murmurs on screen at once (fewer on a phone). */
export const MURMUR_MAX = { wide: 3, phone: 2 } as const;

/** A murmur for this kind of business, from two random numbers in [0, 1). */
export function murmurFor(kind: RiteKind | "idle", a: number, b: number): string {
  const bag = MOOD[kind];
  const pool = MURMURS[bag[Math.floor(a * bag.length)]!];
  return pool[Math.floor(b * pool.length)]!;
}

/**
 * A written murmur not heard yet (#910: nothing loops): the kind's moods first (in a random order), then any mood; null
 * once every written one has been said, when the gallery takes only the live arguments' new murmurs, or keeps quiet.
 */
export function freshMurmur(kind: RiteKind | "idle", heard: (text: string) => boolean, rnd: () => number = Math.random): string | null {
  const bag = [...MOOD[kind]].sort(() => rnd() - 0.5);
  const order = [...new Set<Mood>([...bag, ...(Object.keys(MURMURS) as Mood[])])];
  for (const mood of order) {
    const left = (MURMURS[mood] as readonly string[]).filter((t) => !heard(t));
    if (left.length) return left[Math.floor(rnd() * left.length)]!;
  }
  return null;
}

/*
 * The pace (#755). Nikita, 2026-11-05: "things are kind of moving pretty quickly right now." With the sound on, a line
 * holds the floor for as long as it is spoken, then a short beat; with it off (or when a line can't be spoken), for its
 * reading time: about 250 ms a word, never under 2.5 s. Between moves and between items the gaps are longer than before.
 */
export const READ_MS_PER_WORD = 250;
export const READ_MIN_MS = 2_500;
/** After a spoken line, before the next move. */
export const SPOKEN_BEAT_MS = 700;
/** Between one speaker and the next. */
export const TURN_GAP_MS = 900;
/** After an item's last word, before the chamber settles. */
export const ITEM_END_MS = 2_400;
/** Between items, once the pods are home. */
export const ITEM_GAP_MS = 4_000;
/** A pod's flight to the floor. */
export const FLY_MS = 2_300;

/** How long a caption holds for reading. */
export function readMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(READ_MIN_MS, words * READ_MS_PER_WORD);
}

/** A caption as it is spoken: its bold lead first, or after (a repair's report reads cause, then fix). */
export const spoken = (line: RiteLine | undefined, leadAfter = false): string =>
  !line ? "" : [leadAfter ? line.text : line.lead, leadAfter ? line.lead : line.text].filter(Boolean).join(" ");

/** Who voices a murmur from the gallery: always the same member for the same words, so each is made once ever. */
export function murmurVoice(text: string): string {
  const members = Object.keys(SUBMIND_TITLE).filter((id) => id !== "kernel");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return members[Math.abs(h) % members.length]!;
}
