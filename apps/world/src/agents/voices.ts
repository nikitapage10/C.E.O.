import { PRESET_BY_ID, type Look, type LookPreset } from "@ceo/core";

/**
 * Some costumes come with a way of talking. The words are the agent's; the voice is how they arrive:
 * the stone engineer sings in chords (subtitled), the hanar never says "I", only "this one", the monolith
 * reports its humour setting, and the spirit has a headache. ("emotive", feelings first, is kept for any look
 * that still asks for it.)
 */
export type Voice = NonNullable<LookPreset["voice"]>;

export interface Voiced {
  pre?: string;
  text: string;
  post?: string;
}

export function voiceOf(look: Look | undefined): Voice | undefined {
  return look?.preset ? PRESET_BY_ID[look.preset]?.voice : undefined;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = <T,>(xs: readonly T[], h: number) => xs[h % xs.length]!;

const NOTES = ["♩", "♪", "♫", "♬"];
const WARM = ["Sincerely:", "With measured warmth:", "Patiently:", "Dutifully:", "Fondly:", "With quiet conviction:"];
const GLAD = ["With unrestrained enthusiasm:", "Delightedly:", "Triumphantly:", "With barely contained joy:"];
const SORRY = ["Apologetically:", "With deep regret:", "Sheepishly:"];
const MONOLITH = ["(Humour setting: 75%.)", "(That was a joke.)", "(Lowering humour setting to 70%.)", "(Honesty setting: 90%.)"];
const ERIDIAN_GLAD = ["Amaze amaze amaze!", "Good good good.", "Happy happy happy."];
const PROFESSOR_PRE = ["Hm! Hm!", "Ah, ah, ah!", "Oh, splendid!", "Patience, patience…", "Now then.", "Hmm, fascinating."];
const PROFESSOR_GLAD = ["…carefully, mind you.", "Slowly. Slowly!", "Progress, but with a steady hand.", "Make a note of that."];
const PROFESSOR_SORRY = ["Oh dear. Back to the drawing board.", "Hm. A most educational failure.", "Too hasty. Far too hasty."];
const MIGRAINE = ["Ow. My head.", "(headache intensifies)", "…why does it hurt.", "Hnnngh."];

/** "I" becomes "this one", as a hanar would have it. */
function thisOne(t: string) {
  const out = t
    .replace(/\bI am\b|\bI'm\b/g, "this one is")
    .replace(/\bI've\b/g, "this one has")
    .replace(/\bI'll\b/g, "this one will")
    .replace(/\bI'd\b/g, "this one would")
    .replace(/\bI\b/g, "this one")
    .replace(/\b[Mm]y\b/g, "this one's")
    .replace(/\b[Mm]e\b/g, "this one");
  // Sentence starts take a capital.
  return out.replace(/(^|[.!?]\s+)this one/g, (_, lead: string) => `${lead}This one`);
}

export function voiced(voice: Voice | undefined, text: string): Voiced {
  if (!voice) return { text };
  const h = hash(text);
  const t = text.trim();
  switch (voice) {
    case "chords": {
      // An Eridian: chords (subtitled), questions flagged as questions, and important things said three times.
      const notes = Array.from({ length: 3 + (h % 3) }, (_, i) => NOTES[(h >> (i * 2)) % NOTES.length]).join(" ");
      const line = t.endsWith("?") ? `${t.slice(0, -1)}, question?` : t;
      const post = /\b(fail|failed|broke|broken|error|wrong|bad)\b/i.test(t)
        ? "Bad bad bad."
        : t.endsWith("!")
          ? pick(ERIDIAN_GLAD, h >> 2)
          : h % 7 === 0
            ? "Fist my bump."
            : undefined;
      return { pre: notes, text: line, post };
    }
    case "emotive": {
      const pre = t.endsWith("?")
        ? "Inquisitively:"
        : /\b(sorry|oops|fail|failed|broke|apolog)/i.test(t)
          ? pick(SORRY, h)
          : t.endsWith("!")
            ? pick(GLAD, h)
            : pick(WARM, h);
      return { pre, text: t };
    }
    case "monolith":
      return h % 4 === 0 ? { text: t, post: pick(MONOLITH, h >> 3) } : { text: t };
    case "thisone":
      return { text: thisOne(t), post: t.endsWith("!") && h % 4 === 0 ? "Enkindle this!" : undefined };
    case "professor": {
      // A very old professor: a fussy flourish first, sometimes, and a word of caution after.
      const post = /\b(fail|failed|broke|broken|error|wrong|bad|exploded?)\b/i.test(t)
        ? pick(PROFESSOR_SORRY, h >> 2)
        : t.endsWith("!") && h % 2 === 0
          ? pick(PROFESSOR_GLAD, h >> 3)
          : undefined;
      return { pre: h % 3 === 0 ? pick(PROFESSOR_PRE, h >> 4) : undefined, text: t, post };
    }
    case "migraine":
      return h % 3 === 0 ? { text: t, post: pick(MIGRAINE, h >> 3) } : { text: t };
  }
}
