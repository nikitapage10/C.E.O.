import type { CampaignCostume as Costume } from "../store.ts";
import type { Line, PlayCtx } from "./gatherings.ts";

/**
 * A short D&D campaign for the Archive's long table, made fresh each time: a hook, introductions in costume, a
 * hazard, a parley and a fight, then loot. Players roll real dice (shown on the table) and the DM's narration
 * follows what they rolled.
 */

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

export const CLASS_OF: Record<Costume, string> = {
  "wizard-hat": "Wizard",
  helm: "Paladin",
  hood: "Rogue",
  crown: "Bard",
  horns: "Barbarian",
  "feather-cap": "Ranger",
};

const INTRO: Record<Costume, string[]> = {
  "wizard-hat": ["I have read every book in this Archive. Some of them twice.", "My spellbook is mostly footnotes. Dangerous footnotes.", "I cast Prestidigitation. To tidy the table."],
  helm: ["I have sworn an oath. It's long. Shall I read it?", "My shield has a name. It is also my name.", "I would like to protect everyone. Especially from the Rogue."],
  hood: ["You don't know me. That's the point.", "I'm not stealing. I'm relocating.", "I check the room for traps. Yes, this room. Yes, now."],
  crown: ["I have a song for this. I have a song for everything.", "My instrument is a lute. My weapon is also the lute.", "I'll persuade the dungeon to let us in. Musically."],
  horns: ["I rage. Then I nap. Then I rage again.", "Plan? I am the plan.", "I would like to fight the tavern. Respectfully."],
  "feather-cap": ["I tracked a rumour here. It went that way.", "Seventeen arrows. Named. Don't ask.", "I've slept outdoors so long the indoors frightens me."],
};

const HOOKS = [
  "The tide went out last night and did not come back. Something under Ilyr is drinking it.",
  "A Shoreborn bell has started ringing on its own, out past the Veil. Nobody has rung it for nine epochs.",
  "The loom has woven a map no one asked for. It leads to a door beneath the Archive.",
  "A lantern-keeper from Teruānga is missing, and her lantern keeps lighting itself at the tide line.",
  "The Drowning has reached the old Shoreborn vault, and the vault is knocking back.",
];

const HAZARDS = [
  { scene: "A rope bridge over a black channel. Half the planks are missing; the other half are lying.", act: { hood: "I check the planks for traps.", horns: "I jump it. All of it.", "feather-cap": "I shoot a line across and swing.", "wizard-hat": "I cast Feather Fall, preemptively, on everyone.", helm: "I test each plank with my shield.", crown: "I sing the bridge a lullaby so it holds still." } },
  { scene: "A corridor of tide-glass. Every reflection is a little bit late.", act: { hood: "I move only when my reflection isn't looking.", horns: "I punch the slowest reflection.", "feather-cap": "I watch the floor, not the glass.", "wizard-hat": "I read the glass. It's written backwards, obviously.", helm: "I close my eyes and walk by faith.", crown: "I harmonise with the echo." } },
  { scene: "A locked gate, carved with a hundred little mouths. They are all whispering the same wrong number.", act: { hood: "I pick the lock. Quietly. Very quietly.", horns: "I open the gate. With my head.", "feather-cap": "I listen for the one mouth telling the truth.", "wizard-hat": "I count the mouths. Then I count them again.", helm: "I knock, politely, three times.", crown: "I teach the mouths the right number. As a round." } },
];

const PARLEYS = [
  { npc: "A Shoreborn toll-keeper in a coat of barnacles, who wants a riddle before anyone passes.", ask: "I offer the toll-keeper a riddle of my own." },
  { npc: "A very old crab who claims to own the tunnel and has paperwork to prove it.", ask: "I ask to see the paperwork. Then I negotiate." },
  { npc: "A ghost librarian who will let you through if your library card is up to date.", ask: "I explain that my card is up to date in spirit." },
];

const BOSSES = ["the Undertow Wyrm", "a kraken made of old maps", "the Tidewarden, nine feet of rust and grief", "the Lantern That Eats Light"];

const LOOT = [
  "a pearl that hums the first bar of every song",
  "a key with no door, yet",
  "the missing lantern, still lit, and very relieved",
  "a map of Ilyr with one island nobody remembers",
];

const ATTACK: Record<Costume, string> = {
  "wizard-hat": "I cast Magic Missile. All of them.",
  helm: "I strike with righteous, well-documented fury.",
  hood: "I sneak attack. From behind. Of course from behind.",
  crown: "I insult it in iambic pentameter.",
  horns: "I rage and hit it with the nearest table.",
  "feather-cap": "Two arrows. Same hole.",
};

type Tier = "crit" | "hit" | "graze" | "miss" | "fumble";
const tier = (v: number): Tier => (v === 20 ? "crit" : v >= 13 ? "hit" : v >= 7 ? "graze" : v > 1 ? "miss" : "fumble");

const RESOLVE: Record<Tier, string[]> = {
  crit: ["Natural twenty! It works so well it becomes a local legend.", "Twenty. The dice gods sit up. You do it flawlessly, with a flourish."],
  hit: ["{roll}. That'll do it. You make it, cleanly.", "{roll}. Success, and you look good doing it."],
  graze: ["{roll}. You make it… mostly. You lose a boot.", "{roll}. It works, but now everyone's a little damp."],
  miss: ["{roll}. Ah. It does not go to plan. Nothing is broken. Much.", "{roll}. You try. The world declines."],
  fumble: ["Natural one. Oh no. Oh, that's wonderful. Tell them what happens to your hat.", "One. You succeed at the opposite thing, magnificently."],
};

const HIT: Record<Tier, string[]> = {
  crit: ["Critical! {boss} reels across the chamber!"],
  hit: ["{roll}, a hit. {boss} staggers."],
  graze: ["{roll}. A glancing blow. {boss} is annoyed."],
  miss: ["{roll}. A miss. {boss} laughs in tide-speak."],
  fumble: ["A one. You hit the Bard. The Bard is fine. Ish."],
};

export function composeCampaign(costumes: Costume[]): Line[] {
  const n = costumes.length;
  const hook = pick(HOOKS);
  const hazard = pick(HAZARDS);
  const parley = pick(PARLEYS);
  const boss = pick(BOSSES);
  const loot = pick(LOOT);
  const h = (text: Line["text"], roll?: number): Line => ({ who: "host", text, roll });
  const g = (guest: number, text: Line["text"], roll?: number): Line => ({ who: "guest", guest, text, roll });
  const res = (pool: Record<Tier, string[]>, who: (c: PlayCtx) => string) => (c: PlayCtx) => {
    const v = c.rolls[who(c)] ?? 10;
    return pick(pool[tier(v)]).replace("{roll}", String(v)).replace("{boss}", boss[0]!.toUpperCase() + boss.slice(1));
  };
  const guestId = (i: number) => (c: PlayCtx) => c.guests[i % c.guests.length]!;

  const lines: Line[] = [h("Welcome back to the Tide. Screens up, dice out."), h(hook), h("Introduce yourselves. In character, please.")];
  costumes.forEach((k, i) => lines.push(g(i, (c) => `${c.name(c.guests[i]!)} the ${CLASS_OF[k]}. ${pick(INTRO[k])}`)));

  // The hazard: the first player rolls.
  lines.push(h(hazard.scene), g(0, hazard.act[costumes[0]!], 20), h(res(RESOLVE, guestId(0))));
  // The parley: the Bard if there is one, else the second player.
  const bard = costumes.indexOf("crown");
  const talker = bard >= 0 ? bard : n > 1 ? 1 : 0;
  lines.push(h(parley.npc), g(talker, parley.ask, 20), h(res(RESOLVE, guestId(talker))));
  // The fight: initiative, then everyone has a go.
  lines.push(h(`Roll initiative. ${boss[0]!.toUpperCase() + boss.slice(1)} rises from the deep.`));
  costumes.forEach((k, i) => lines.push(g(i, ATTACK[k], 20), h(res(HIT, guestId(i)))));
  lines.push(
    h((c) => {
      const hits = c.guests.filter((id) => (c.rolls[id] ?? 0) >= 7).length;
      return hits >= Math.ceil(c.guests.length / 2)
        ? `And with that, ${boss} sinks back beneath the tide. You win.`
        : `${boss[0]!.toUpperCase() + boss.slice(1)} slips away into the dark. It will remember you. You survive, which counts.`;
    }),
    h(`In the wreckage you find ${loot}.`),
    g(n - 1, "I'd like to keep it. For safety. For my safety."),
    h("Session over. Same time next epoch? Bring snacks. Not the dice-shaped ones."),
  );
  return lines;
}
