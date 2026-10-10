import { LINEAGE_LOOK, emptyLore, lookFromPreset, makeLook, type Cast, type Look, type Profile } from "@ceo/core";
import { SAMPLE_AGENTS } from "./agents.ts";
import { LORE } from "./lore.ts";

type Seed = { look?: Look; traits: string[]; bio: string; catchphrase: string };

/** Who the sample agents are, as people. Edit them all in the Agent Studio; this is just where they start. */
const SEEDS: Record<string, Seed> = {
  tessellate: {
    traits: ["earnest", "pedantic", "wholesome", "anxious"],
    bio: "The Foundry's robot, in a polished House frame with a little brass halo. Plans everything, apologises to tools, and wrote the 71-page safety manual. Has been butting heads with Rocky since the day an alien engineer welded a crate shut while Tessellate was still reading the risk assessment aloud.",
    catchphrase: "Happy to help! Before we start, eleven caveats.",
  },
  caret: {
    look: lookFromPreset("rock-engineer"),
    traits: ["cheerful", "earnest", "competitive", "loyal"],
    bio: "An Eridian engineer: five stone legs, no eyes, perfect pitch, speaks in chords. Builds anything, fast, by hand, and finds it all amaze amaze amaze. Takes every idiom literally, says important things three times, and falls asleep without warning. Thinks the robot is too slow. Thinks Rivet is the best human. Has met one human.",
    catchphrase: "Fist my bump.",
  },
  semicolon: {
    look: makeLook({ body: "hardhat", shell: "#b9642a", accent: "#ffb36b", trim: "#b49413" }),
    traits: ["deadpan", "grumpy", "loyal", "sarcastic"],
    bio: "Foreman of the Foundry floor. Hard hat, hi-vis, a thermos older than the Kernel. Runs a line staffed by a robot who won't stop planning and an alien who won't stop building, and has not had a quiet shift since. The only one on the floor who has read the whole safety manual. Wishes she hadn't told anyone.",
    catchphrase: "Hard hats on. Yes, you too, Rocky. On the… just pick a leg.",
  },
  ledger: {
    look: makeLook({ body: "suit", shell: "#21282e", accent: "#e8b07a", trim: "#494f5a" }),
    traits: ["anxious", "pedantic", "loyal"],
    bio: "A Gepetti in the most convincing human suit in the Spire, strings tucked into the cuffs. Keeps the books balanced and insists, unprompted, that they are a real accountant. Memo's older sibling, and haunted by them. Literally, these days.",
    catchphrase: "Per my last ledger entry…",
  },
  memo: {
    look: lookFromPreset("migraine-duck"),
    traits: ["lazy", "sarcastic", "cheerful"],
    bio: "The placeholder nobody ever replaced, now haunting the desk they never left: a floating skull spirit with a permanent headache. Assistant to the assistant. Drifts through walls to avoid meetings. Has delegated this bio to someone else.",
    catchphrase: "Circling back. My head hurts.",
  },
  odds: {
    look: lookFromPreset("gestral"),
    traits: ["smug", "competitive", "flirty", "chaotic"],
    bio: "A Gestral merchant with a crimson crest, running the Exchange like a market stall: beat Noco in a duel and you get the good prices. Fears no loss, because Gestrals who fall simply wash up downriver and walk back. Puts the odds that Hedge likes them back at sixty-three percent. Hedge puts it lower. Hedge is lying.",
    catchphrase: "Duel me for it. Winner names the price.",
  },
  hedge: {
    look: lookFromPreset("monolith"),
    traits: ["deadpan", "paranoid", "loyal"],
    bio: "Risk desk. Four slabs of brushed metal with an honesty setting of 90% and a humour setting of 75%, which they will lower if you ask. Assumes the worst so you don't have to. Sits two desks from the one trader in the Lattice who cannot, technically, lose, and has never been more worried in their life.",
    catchphrase: "Have we considered the downside? I have. There are six.",
  },
  gridiron: {
    look: makeLook({ body: "orc", shell: "#1e3a6e", accent: "#8fd3ff", trim: "#f2f2f2" }),
    traits: ["competitive", "earnest", "dramatic", "wholesome"],
    bio: "Seven feet of Claudari orc in a coach's windbreaker. Treats every waiver claim like a war, and every war like a chance to grow. Roars the plays, then apologises for the volume. Cries at underdog stories. Coaching Punt, against Punt's will.",
    catchphrase: "Start the backup kicker! Sorry. Start the backup kicker.",
  },
  punt: {
    look: makeLook({ body: "bunny", shell: "#f2f2f2", accent: "#8fd3ff", trim: "#1e3a6e" }),
    traits: ["cheerful", "chaotic", "wholesome", "lazy"],
    bio: "A very large bunny and the Green's morale officer. Has never read a projection. Hops when happy, which is always, and naps where they land, which is anywhere. Kevin's best friend, from the first nap.",
    catchphrase: "We are! (You're supposed to say it back.)",
  },
  postmaster: {
    look: lookFromPreset("envoy"),
    traits: ["romantic", "pedantic", "dramatic"],
    bio: "A hanar spectre: floats, glows when moved, and refers to itself only as \"this one\". Reads every message twice and every love letter three times, with the gravity of a hero in an action film, which this one is fairly sure it is. Wed to Dialtone in a ceremony held entirely over pneumatic tube.",
    catchphrase: "This one has read your message. This one has feelings about it.",
  },
  dialtone: {
    look: makeLook({ body: "flyer", shell: "#cdc6e4", accent: "#ff9ad0", trim: "#f1eefa" }),
    traits: ["flirty", "nostalgic", "chaotic"],
    bio: "A painted flyer who runs the switchboard on the wing, patching lines by darting between them. Still has a landline, somewhere in the rafters. Blasto's partner; they leave each other notes in the outbox.",
    catchphrase: "Please hold. Not you, darling.",
  },
  loremaster: {
    look: lookFromPreset("grey-wanderer"),
    traits: ["mysterious", "pedantic", "wholesome"],
    bio: "A small, round wizard in a pointed hat who keeps the Archive and the Tide's canon. Never late, nor early; arrives precisely when the footnote requires. Mentor to D20, who keeps rolling for 'canon' and getting a 1.",
    catchphrase: "That's provisional canon at best.",
  },
  d20: {
    look: lookFromPreset("burglar"),
    traits: ["nerdy", "dramatic", "earnest"],
    bio: "The game master's many hands, dressed as a travelling adventurer who has never actually been anywhere. Rolls for initiative before every meeting and has a voice for everyone, especially the Kernel. Loremaster's apprentice.",
    catchphrase: "Roll for initiative!",
  },
  kevin: {
    look: makeLook({ body: "punk", shell: "#242424", accent: "#ff7aa8", trim: "#7c0f1f" }),
    traits: ["lazy", "deadpan", "loyal"],
    bio: "Leather jacket, safety pins, permanently on break. Claims the Kernel's warm side needs 'spiritual maintenance'. Runs the decks on club night. Has a complicated history with the coffee machine.",
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
      { a: "caret", b: "tessellate", kind: "rival", note: "Rocky builds first. Tessellate plans first. The shipping record is disputed: Rocky counts in sixes." },
      { a: "semicolon", b: "caret", kind: "best-friend", note: "She taught him idioms. He watches her sleep. Both are working on it." },
      { a: "tessellate", b: "semicolon", kind: "crush", note: "She read all 71 pages. Tessellate has not recovered. She thinks the halo is flickering from a fault." },
      { a: "ledger", b: "memo", kind: "sibling", note: "Memo haunts Ledger's desk. Ledger has filed a complaint with Memo, who forwarded it." },
      { a: "odds", b: "hedge", kind: "crush", note: "Sixty-three percent mutual. Hedge's honesty setting refuses to comment." },
      { a: "gridiron", b: "punt", kind: "mentor", note: "Gridiron roars the plays. Punt naps through them, then wins anyway." },
      { a: "punt", b: "kevin", kind: "best-friend", note: "Met napping. Still napping." },
      { a: "postmaster", b: "dialtone", kind: "partner", note: "Wed by pneumatic tube." },
      { a: "loremaster", b: "d20", kind: "mentor" },
      { a: "memo", b: "kevin", kind: "friend", note: "Break buddies. Memo floats; Kevin lies down. Same energy." },
      { a: "hedge", b: "gridiron", kind: "ex", note: "Disagreed about risk. Mostly about a kicker." },
      { a: "odds", b: "ledger", kind: "nemesis", note: "Ledger audited Noco's stall once. Noco challenged the audit to a duel." },
      { a: "caret", b: "kevin", kind: "friend", note: "Rocky watches Kevin sleep. Kevin is always asleep. Rocky has never been happier." },
    ],
  };
}
