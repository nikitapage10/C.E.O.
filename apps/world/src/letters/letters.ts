import { create } from "zustand";

/**
 * Letters from the C.E.O. Write to any agent; Blasto takes it from the Relay and delivers it across the Lattice
 * like an action hero, and the agent reads it and answers in their own voice. Letters are kept in this browser
 * only, in the recipient's dossier.
 */
export interface Letter {
  id: string;
  to: string;
  text: string;
  /** ms since epoch. */
  sentAt: number;
  reply?: string;
}

export type LetterMood = "love" | "thanks" | "sorry" | "praise" | "music" | "cat" | "question" | "plain";

/** What the letter is mostly about, judged the way a Syntherion would: by the loudest word in it. */
export function moodOf(text: string): LetterMood {
  const t = text.toLowerCase();
  if (/\b(love|crush|heart|adore|miss you)\b|❤|♥/.test(t)) return "love";
  if (/\b(sorry|apolog|my bad|forgive)/.test(t)) return "sorry";
  if (/\b(thank|grateful|appreciate)/.test(t)) return "thanks";
  if (/\b(great job|good job|well done|proud|amazing|awesome|brilliant|nice work|legend)\b/.test(t)) return "praise";
  if (/\b(club|dance|music|drop|track|dj|bass|song)\b/.test(t)) return "music";
  if (/\b(myshka|cat|kitten|good boy)\b/.test(t)) return "cat";
  if (t.trim().endsWith("?")) return "question";
  return "plain";
}

const GENERIC: Record<LetterMood, string[]> = {
  love: ["A letter from the C.E.O., with a heart on it. I'm going to need a minute.", "Oh. Oh no. I'm keeping this one forever."],
  sorry: ["You don't have to apologise to me. But I'm framing it anyway.", "Apology received. Logged. Forgiven before I finished reading."],
  thanks: ["You're thanking me? I'll be unbearable about this for days.", "Thank you for the thank-you. Now we're in a loop. A nice loop."],
  praise: ["The C.E.O. said I did well. In writing. Everyone look at this.", "Pinning this above my station. Nobody touch it."],
  music: ["Tell Kevin to play the one with the big build. You know the one.", "Club night? I'll clear my schedule. My schedule is already clear."],
  cat: ["Myshka is a good boy. Confirmed. I'll pass on your regards; he'll sit on them.", "News of the cat. Excellent. He's asleep on something important, as usual."],
  question: ["A question from the C.E.O. I'll answer it properly, after a deep think and a short nap.", "Good question. I've added it to the list of things I think about at night."],
  plain: ["A letter! For me! From outside the Veil!", "Read it twice. Then once more, out loud, to the furniture."],
};

/** Each agent's own touch: how they open a reply. Anyone not listed answers plainly. */
const OPENERS: Record<string, string[]> = {
  tessellate: ["I have read your letter in full, including the margins.", "Received, filed and cross-referenced."],
  caret: ["Letter! Letter is amaze!", "Paper with words, from you! Good good."],
  semicolon: ["A letter. I'll read it after the alarm. ...Fine, now.", "Received. Read it with my coffee. Both were good."],
  ember: ["Letter. Read it. Good. Back to work.", "From the C.E.O.? ...Keeping it. Don't tell Rivet."],
  gilt: ["A letter from the top. Love that. Let's put it on a slide.", "What a synergy. I'll circle back with a reply. I won't circle back. Here it is."],
  ticker: ["A letter! Ninety percent it's good news. Eighty-five.", "Opened it with my eyes closed, for safety. It's lovely."],
  turf: ["AND THE C.E.O. WRITES IN. WHAT A MOMENT.", "A LETTER, FOLKS. From the C.E.O. Unbelievable scenes."],
  static: ["Heard it was coming. Read it anyway. Twice.", "A letter—for me—not about someone else—wow."],
  vellum: ["Received, dated and catalogued. Correctly.", "A primary source. From the C.E.O. I'll footnote it forever."],
  fizz: ["A LETTER! This calls for a party.", "Glitter on the envelope? No, that was me. Reading it now!"],
  soot: ["Thought it'd be bad news. Wasn't. Huh.", "Letter. ...Nice."],
  putty: ["A letter. I'm going to need a minute. I'm going to need a mood board.", "Wait. No. I'll frame it. Better idea."],
  ledger: ["Letter received and audited.", "I have logged this as income. Emotional income."],
  memo: ["I'll delegate reading this to myself. Done.", "Oh. Someone wrote to the placeholder."],
  odds: ["I'd price this letter at a hundred percent.", "En garde! …Oh, it's a letter."],
  hedge: ["Risk assessment of this letter: none.", "Letter read. Honesty setting says I liked it."],
  gridiron: ["HUDDLE UP, I GOT A LETTER. Sorry. Sorry. I got a letter.", "That's a game-winning letter."],
  punt: ["Woke up for this.", "Read it. Hopped about it."],
  postmaster: ["I delivered this to myself. It was the most dangerous delivery yet.", "Special delivery, received by the deliverer."],
  dialtone: ["I can hear music in the handwriting.", "Patched straight through to the heart line."],
  loremaster: ["Into the canon it goes.", "I'll shelve this with the true things."],
  heimerdinger: ["A letter! I have tested it. It holds up.", "Remarkable. I'll study the penmanship later."],
  d20: ["Rolled to read it. Natural twenty.", "Best loot I've had this campaign."],
  daub: ["A letter! Can I paint it? I'm going to paint it.", "Read it. Left a green paw-mark on it. That means I love it."],
  chisel: ["A letter, darling. I've read it with all my fingers.", "Beautifully made. Who carved these words?"],
  kevin: ["Read it on my break. Which is always.", "Not a phase. This letter, I mean. It's forever."],
  drop: ["Bweep! (A letter! Clause, read it to me. Exactly as written.)", "Bwoo-wee. (Read it with my eye. Lit up twice.)"],
  clause: ["Oh my, a letter. I have read it, filed it, and read it again.", "How kind. I have drafted a reply, a cover note and a receipt."],
};

/** The agent's answer to a letter. `seed` picks between lines so the same letter always gets the same answer. */
export function replyTo(agentId: string, text: string, seed = 0): string {
  const mood = moodOf(text);
  const pool = GENERIC[mood];
  const body = pool[seed % pool.length]!;
  const openers = OPENERS[agentId];
  return openers ? `${openers[seed % openers.length]} ${body}` : body;
}

/** What Blasto says when a letter lands on the Relay's counter. */
export const BLASTO_DEPARTS = [
  "I have a letter from the C.E.O. for {to}. I will deliver it. Stand back.",
  "Mail for {to}. Nothing will stop me. Not even the stairs.",
  "A letter for {to}. I've never failed a delivery. I've only delayed some, heroically.",
];

export const KERNEL_LETTER = [
  "Letter from the C.E.O. for {to}, routed via the Relay. Blasto insisted.",
  "Correspondence in transit to {to}. Blasto is delivering it personally. Clear the streams.",
];

const KEY = "ceo.letters.v1";
const FLIGHT_MS = 5200;

function load(): Letter[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Letter[]) : [];
  } catch {
    return [];
  }
}

function save(letters: Letter[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(letters.slice(-60)));
  } catch {
    // Private window: the letters still arrive.
  }
}

interface LetterStore {
  letters: Letter[];
  /** A letter on its way: Blasto's envelope flying from the Relay to the recipient. */
  inFlight: { letter: Letter; from: string; startedAt: number; durationMs: number } | null;
  post: (to: string, text: string) => Letter | null;
  answer: (id: string, reply: string) => void;
  land: () => void;
}

let n = 0;

export const useLetters = create<LetterStore>((set, get) => ({
  letters: load(),
  inFlight: null,
  post: (to, text) => {
    const clean = text.trim().slice(0, 600);
    if (!clean || get().inFlight) return null;
    const letter: Letter = { id: `l-${Date.now()}-${++n}`, to, text: clean, sentAt: Date.now() };
    const letters = [...get().letters, letter];
    save(letters);
    set({ letters, inFlight: { letter, from: "postmaster", startedAt: performance.now(), durationMs: FLIGHT_MS } });
    return letter;
  },
  answer: (id, reply) => {
    const letters = get().letters.map((l) => (l.id === id ? { ...l, reply } : l));
    save(letters);
    set({ letters });
  },
  land: () => set({ inFlight: null }),
}));
