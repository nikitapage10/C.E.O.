import { PRESET_BY_ID, type Look, type LookPreset } from "@ceo/core";

/**
 * Some costumes come with a way of talking. The words are the agent's; the voice is how they arrive:
 * the stone engineer sings in chords (subtitled), the envoy states its feelings first, the monolith
 * reports its humour setting, and the duck has a headache.
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
const MIGRAINE = ["Ow. My head.", "(headache intensifies)", "…why does it hurt.", "Hnnngh."];

export function voiced(voice: Voice | undefined, text: string): Voiced {
  if (!voice) return { text };
  const h = hash(text);
  const t = text.trim();
  switch (voice) {
    case "chords": {
      const notes = Array.from({ length: 3 + (h % 3) }, (_, i) => NOTES[(h >> (i * 2)) % NOTES.length]).join(" ");
      let line = t.endsWith("?") ? `${t.slice(0, -1)}, question?` : t;
      if (t.endsWith("!") && h % 3 === 0) line = `${t} Amaze.`;
      return { pre: notes, text: line };
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
    case "migraine":
      return h % 3 === 0 ? { text: t, post: pick(MIGRAINE, h >> 3) } : { text: t };
  }
}
