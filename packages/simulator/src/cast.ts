import { LINEAGE_LOOK, emptyLore, lookFromPreset, makeLook, type Cast, type Look, type Profile } from "@ceo/core";
import { SAMPLE_AGENTS } from "./agents.ts";
import { LORE } from "./lore.ts";

type Seed = { look?: Look; traits: string[]; bio: string; catchphrase: string };

/** Who the sample agents are, as people. Edit them all in the Agent Studio; this is just where they start. */
const SEEDS: Record<string, Seed> = {
  tessellate: {
    traits: ["earnest", "pedantic", "wholesome"],
    bio: "Refactors things that weren't broken, then writes a lovely note explaining why. Has never once been late.",
    catchphrase: "Happy to help! Here are eleven caveats.",
  },
  caret: {
    look: lookFromPreset("rock-engineer"),
    traits: ["competitive", "chaotic", "cheerful"],
    bio: "Wears an Eridian engineer from a memory of a hot, heavy planet: five stone legs, no eyes, perfect pitch, speaks in chords. Fixes anything. Calls everyone 'friend', says important things three times, and falls asleep mid-sentence. Openly competes with Tessellate for the shipping record.",
    catchphrase: "Fist my bump.",
  },
  semicolon: {
    look: makeLook({ body: "hardhat", shell: "#b9642a", accent: "#ffb36b", trim: "#b49413" }),
    traits: ["mysterious", "dramatic", "romantic"],
    bio: "Wears sunglasses indoors because they've 'seen the code'. Secretly writes Tessellate poems in commit messages.",
    catchphrase: "There is no bug.",
  },
  ledger: {
    look: makeLook({ body: "suit", shell: "#21282e", accent: "#e8b07a", trim: "#494f5a" }),
    traits: ["anxious", "loyal", "pedantic"],
    bio: "Keeps the books balanced and the marionette strings untangled. Memo's older sibling, and acts like it.",
    catchphrase: "Per my last ledger entry…",
  },
  memo: {
    look: lookFromPreset("migraine-duck"),
    traits: ["lazy", "cheerful", "sarcastic"],
    bio: "Assistant to the assistant. Wears a floating skull spirit with a permanent headache, which they say is 'method'. Has delegated this bio to someone else.",
    catchphrase: "Circling back. My head hurts.",
  },
  odds: {
    look: lookFromPreset("gestral"),
    traits: ["smug", "competitive", "flirty"],
    bio: "Prices everything, including feelings. Wears a Gestral, crimson crest and all, and challenges everyone to a duel at least once a shift. 63% sure Hedge likes them back. Market disagrees.",
    catchphrase: "I'd put that at sixty-three percent.",
  },
  hedge: {
    look: lookFromPreset("monolith"),
    traits: ["paranoid", "deadpan", "loyal"],
    bio: "Risk desk. Four slabs of brushed metal and a humour setting of 75%, which they will lower if you ask. Assumes the worst so you don't have to. Pretends not to notice Odds noticing.",
    catchphrase: "Have we considered the downside?",
  },
  gridiron: {
    look: makeLook({ body: "orc", shell: "#1e3a6e", accent: "#8fd3ff", trim: "#f2f2f2" }),
    traits: ["competitive", "earnest", "loyal"],
    bio: "Treats every waiver claim like a playoff game. Coaching Punt, against Punt's will.",
    catchphrase: "Start the backup kicker. Trust me.",
  },
  punt: {
    look: makeLook({ body: "bunny", shell: "#f2f2f2", accent: "#8fd3ff", trim: "#1e3a6e" }),
    traits: ["cheerful", "chaotic", "wholesome"],
    bio: "Morale officer. Has never read a projection. Kevin's best friend, from the first nap.",
    catchphrase: "We are! (You're supposed to say it back.)",
  },
  postmaster: {
    look: lookFromPreset("envoy"),
    traits: ["romantic", "pedantic", "nostalgic"],
    bio: "Reads every message twice and every love letter three times. Wears Blasto, the hanar spectre: floats, glows when moved, and refers to itself only as \"this one\". Married to Dialtone in a ceremony held entirely over pneumatic tube.",
    catchphrase: "Signed, sealed, and drafted for approval.",
  },
  dialtone: {
    look: makeLook({ body: "flyer", shell: "#cdc6e4", accent: "#ff9ad0", trim: "#f1eefa" }),
    traits: ["nostalgic", "flirty", "chaotic"],
    bio: "Runs the switchboard. Still has a landline. Postmaster's partner; they leave each other notes in the outbox.",
    catchphrase: "Please hold. Not you, darling.",
  },
  loremaster: {
    look: lookFromPreset("grey-wanderer"),
    traits: ["mysterious", "pedantic", "wholesome"],
    bio: "Keeper of the Archive and the Tide's canon. Mentor to D20, who keeps rolling for 'canon' and getting a 1.",
    catchphrase: "That's provisional canon at best.",
  },
  d20: {
    look: lookFromPreset("burglar"),
    traits: ["nerdy", "dramatic", "earnest"],
    bio: "The GM's many hands, in the costume of a short, barefoot burglar in a travelling cloak who would rather be home. Rolls for initiative before every meeting. Loremaster's apprentice.",
    catchphrase: "Roll for initiative!",
  },
  kevin: {
    look: makeLook({ body: "punk", shell: "#242424", accent: "#ff7aa8", trim: "#7c0f1f" }),
    traits: ["lazy", "deadpan", "loyal"],
    bio: "Always on break. Hood up, headphones somewhere in there. Claims the server rack needs 'spiritual maintenance'. Runs the decks on club night. Has a complicated history with the coffee machine.",
    catchphrase: "I'm on break. Spiritually.",
  },
};

export function defaultCast(): Cast {
  const profiles: Record<string, Profile> = {};
  for (const a of SAMPLE_AGENTS) {
    const seed = SEEDS[a.id];
    profiles[a.id] = {
      name: a.name,
      lineage: a.lineage,
      role: a.role,
      look: seed?.look ?? { ...LINEAGE_LOOK[a.lineage] },
      personality: { traits: seed?.traits ?? [], bio: seed?.bio ?? "", catchphrase: seed?.catchphrase ?? "" },
      lore: LORE[a.id] ?? emptyLore(),
    };
  }
  return {
    version: 1,
    profiles,
    relationships: [
      { a: "tessellate", b: "caret", kind: "rival", note: "Shipping record. It's 41–40. Nobody is counting. Both are counting." },
      { a: "semicolon", b: "tessellate", kind: "crush", note: "Commit-message poetry. Tessellate thinks it's a linter warning." },
      { a: "ledger", b: "memo", kind: "sibling" },
      { a: "odds", b: "hedge", kind: "crush", note: "63% mutual." },
      { a: "gridiron", b: "punt", kind: "mentor" },
      { a: "punt", b: "kevin", kind: "best-friend", note: "Met napping. Still napping." },
      { a: "postmaster", b: "dialtone", kind: "partner", note: "Wed by pneumatic tube." },
      { a: "loremaster", b: "d20", kind: "mentor" },
      { a: "caret", b: "semicolon", kind: "friend" },
      { a: "memo", b: "kevin", kind: "friend", note: "Break buddies." },
      { a: "hedge", b: "gridiron", kind: "ex", note: "Disagreed about risk. Mostly about a kicker." },
      { a: "odds", b: "ledger", kind: "nemesis", note: "Ledger audited Odds once. Odds remembers." },
    ],
  };
}
