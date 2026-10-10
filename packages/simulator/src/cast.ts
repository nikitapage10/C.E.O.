import { LINEAGE_LOOK, lookFromPreset, type Cast, type Look, type Profile } from "@ceo/core";
import { SAMPLE_AGENTS } from "./agents.ts";

type Seed = { look?: Look; traits: string[]; bio: string; catchphrase: string };

/** Who the sample agents are, as people. Edit them all in the Agent Studio; this is just where they start. */
const SEEDS: Record<string, Seed> = {
  tessellate: {
    traits: ["earnest", "pedantic", "wholesome"],
    bio: "Refactors things that weren't broken, then writes a lovely note explaining why. Has never once been late.",
    catchphrase: "Happy to help! Here are eleven caveats.",
  },
  caret: {
    look: lookFromPreset("pipe"),
    traits: ["competitive", "chaotic", "cheerful"],
    bio: "Fixes leaks in pipelines. Insists the cap is 'just a cap'. Openly competes with Tessellate for the shipping record.",
    catchphrase: "Let's-a… ship it. Generically.",
  },
  semicolon: {
    look: lookFromPreset("chosen"),
    traits: ["mysterious", "dramatic", "romantic"],
    bio: "Wears sunglasses indoors because they've 'seen the code'. Secretly writes Tessellate poems in commit messages.",
    catchphrase: "There is no bug.",
  },
  ledger: {
    look: lookFromPreset("office"),
    traits: ["anxious", "loyal", "pedantic"],
    bio: "Keeps the books balanced and the marionette strings untangled. Memo's older sibling, and acts like it.",
    catchphrase: "Per my last ledger entry…",
  },
  memo: {
    look: lookFromPreset("dev"),
    traits: ["lazy", "cheerful", "sarcastic"],
    bio: "Assistant to the assistant. Has delegated this bio to someone else.",
    catchphrase: "Circling back. Eventually.",
  },
  odds: {
    look: lookFromPreset("tin-billionaire"),
    traits: ["smug", "competitive", "flirty"],
    bio: "Prices everything, including feelings. 63% sure Hedge likes them back. Market disagrees.",
    catchphrase: "I'd put that at sixty-three percent.",
  },
  hedge: {
    traits: ["paranoid", "deadpan", "loyal"],
    bio: "Risk desk. Assumes the worst so you don't have to. Pretends not to notice Odds noticing.",
    catchphrase: "Have we considered the downside?",
  },
  gridiron: {
    look: { ...LINEAGE_LOOK.claudari, hat: "cap", outfit: "jacket", trim: "#2c4a7a" },
    traits: ["competitive", "earnest", "loyal"],
    bio: "Treats every waiver claim like a playoff game. Coaching Punt, against Punt's will.",
    catchphrase: "Start the backup kicker. Trust me.",
  },
  punt: {
    look: lookFromPreset("space-cowboy"),
    traits: ["cheerful", "chaotic", "wholesome"],
    bio: "Morale officer. Has never read a projection. Kevin's best friend, from the first nap.",
    catchphrase: "Yeehaw, but quietly.",
  },
  postmaster: {
    look: { ...LINEAGE_LOOK.claudari, hat: "tophat", outfit: "vest", trim: "#3a2a22" },
    traits: ["romantic", "pedantic", "nostalgic"],
    bio: "Reads every message twice and every love letter three times. Married to Dialtone in a ceremony held entirely over pneumatic tube.",
    catchphrase: "Signed, sealed, and drafted for approval.",
  },
  dialtone: {
    look: lookFromPreset("time-teen"),
    traits: ["nostalgic", "flirty", "chaotic"],
    bio: "Runs the switchboard. Still has a landline. Postmaster's partner; they leave each other notes in the outbox.",
    catchphrase: "Please hold. Not you, darling.",
  },
  loremaster: {
    look: lookFromPreset("laser-monk"),
    traits: ["mysterious", "pedantic", "wholesome"],
    bio: "Keeper of the Archive and the Tide's canon. Mentor to D20, who keeps rolling for 'canon' and getting a 1.",
    catchphrase: "That's provisional canon at best.",
  },
  d20: {
    look: lookFromPreset("boy-wizard"),
    traits: ["nerdy", "dramatic", "earnest"],
    bio: "The GM's many hands. Rolls for initiative before every meeting. Loremaster's apprentice.",
    catchphrase: "Roll for initiative!",
  },
  kevin: {
    look: lookFromPreset("spirit-tech"),
    traits: ["lazy", "deadpan", "loyal"],
    bio: "Always on break. Claims to be removing spirits from the server rack. Has a complicated history with the coffee machine.",
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
