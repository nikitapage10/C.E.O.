import { SUBMIND_TITLE } from "./rite.ts";

/**
 * The Senate in recess (#878). Nikita, 2026-11-05: when nothing needs him, the chamber shouldn't loop the Builder
 * reading out the Foundry's status; the Skippies pick a topic of their own and argue it out, more members joining in.
 * Shows, films, books, opera, games and music. Written here, in the repo, and rotated: no model is asked for them, so
 * they cost nothing past each line's one-time voicing (api/_skippy/rotundavoice.ts keeps every line it makes).
 *
 * Every line is canned and public-safe by construction: opinions on stories, games and songs, in each member's own voice
 * (docs/SKIPPY.md, "Voices"). Never anyone's data, and never a word about whose taste the topics follow. Anything real on
 * the docket preempts a debate at once (rotundaScene.ts, `setDocket`).
 */

/** Opens it, agrees with the floor, or argues against it (the Pessimist's red counter slot, and anyone else's dissent). */
export type Stance = "open" | "aye" | "nay";

export interface DebateLine {
  by: string;
  stance: Stance;
  text: string;
}

export interface Debate {
  key: string;
  /** For the chair: "the motion before the chamber". */
  motion: string;
  lines: DebateLine[];
  /** The chair's closing ruling. */
  close: string;
}

const L = (by: string, stance: Stance, text: string): DebateLine => ({ by, stance, text });

export const DEBATES: Debate[] = [
  {
    key: "red-rising",
    motion: "that the Institute is the finest opening act in modern science fiction",
    lines: [
      L("foundry", "open", "Kids dropped in a valley, told to build or die. That's not a school. That's a job site. Best opening there is."),
      L("archive", "aye", "For the record, the structure borrows from Roman class and Greek myth both. The footnotes alone are a feast."),
      L("boiler", "nay", "Everyone you like in it gets hurt. Every single one. I've read it twice to be sure."),
      L("green", "aye", "AND THE CROWD GOES WILD! Underdog from the mines takes the whole valley! Hail Reaper, folks!"),
    ],
    close: "The motion carries. Break the chains, and somebody fetch the Pessimist a blanket.",
  },
  {
    key: "mass-effect",
    motion: "that a starship crew beats any single hero",
    lines: [
      L("spire", "open", "A crew is just a team with better branding. Loyalty missions are retention strategy, people. Real opportunity there."),
      L("relay", "aye", "And everybody aboard talks to everybody! Who's sweet on whom, who's sulking in the drive core. I'd never leave the ship."),
      L("exchange", "nay", "Odds of the whole crew surviving the last run? Low. I've done the maths. Upgrade the ship or I'm not boarding."),
      L("breakroom", "aye", "Have you SEEN the parties on that ship? Best dancing in the galaxy is the worst dancing in the galaxy!"),
      L("annex", "aye", "Crew call. Everyone at their station. Standby. Go."),
    ],
    close: "Carried. The chair would also like it noted that he would have stopped the Reapers in an afternoon.",
  },
  {
    key: "pokemon",
    motion: "that the first partner you pick says everything about you",
    lines: [
      L("haven", "open", "I pick the one that'll need looking after. Portions measured, bed made, and a hum while I brush it."),
      L("exchange", "nay", "Seventy percent of picks are the fire one. I take the water one. The odds are on the matchup, not the vibes."),
      L("workshop", "aye", "The partner is a mood board with legs! I choose by the colour of its soul, darling, and change my mind twice."),
      L("green", "aye", "First gym, first badge, he's down to one hit point and HE HOLDS ON! Partners are everything!"),
    ],
    close: "Carried, with the chair's pick recorded as all of them, because he can.",
  },
  {
    key: "baldurs-gate",
    motion: "that the best way through any quest is to talk your way out of it",
    lines: [
      L("spire", "open", "Every fight is a negotiation you lost. A good roll on persuasion is the cheapest win on the board."),
      L("foundry", "nay", "Talk all you like. When the rolls go bad somebody still has to swing the hammer. That somebody is me."),
      L("archive", "aye", "Pedantic note: most of that story can be settled without a blade. I have catalogued the dialogue trees. All of them."),
      L("breakroom", "aye", "And the camp at night! Everyone around the fire, someone always flirting. Talk, then party. In that order."),
    ],
    close: "Carried, on a natural twenty. The Builder may keep his hammer.",
  },
  {
    key: "expedition-33",
    motion: "that the best stories are the ones about painting your way past fate",
    lines: [
      L("workshop", "open", "A world painted in grief and gold, and every brushstroke a rebellion. I wept on my easel. Twice."),
      L("studio", "aye", "The framing! Every vista a wide shot, every duel timed to the beat. Cut! Print it! That's the take!"),
      L("boiler", "nay", "Every year the number counts down. Everyone knows how it ends. Sounds about right to me."),
      L("green", "aye", "Perfect parry, perfect parry, PERFECT PARRY! The timing on that battle system, ladies and gentlemen!"),
    ],
    close: "Carried. For those who come after, the chair is still magnificent.",
  },
  {
    key: "hail-mary",
    motion: "that the greatest friendship in fiction is a scientist and an engineer who can't speak a word of each other's language",
    lines: [
      L("foundry", "open", "Two builders, one problem, no shared language. They worked it out with numbers and good welds. Respect."),
      L("archive", "aye", "Correction to the minutes: they built the language out of mathematics first. Primary sources, very satisfying."),
      L("exchange", "nay", "Betting a whole species on one ship? Terrible odds. I'd hedge with three ships. Minimum."),
      L("haven", "aye", "Somebody making sure the other one ate and slept. That's the heart of it. Fist my bump, as they say."),
    ],
    close: "Carried. Amaze, amaze, amaze. The chair concedes it was nearly as clever as he is.",
  },
  {
    key: "star-wars",
    motion: "that the original trilogy outranks everything that came after it",
    lines: [
      L("archive", "open", "Chronologically and critically, the late seventies set the standard. I have the reviews filed by year."),
      L("studio", "aye", "Practical models! Real sets! A trench run you could smell! They don't shoot like that any more. Cut!"),
      L("spire", "nay", "With respect, the franchise only became a real opportunity later. Toys, shows, synergy. Think bigger."),
      L("relay", "aye", "And the twist about his father! Nobody saw it coming and everybody told everybody. I still can't keep quiet about it."),
    ],
    close: "Carried. The chair reminds the Executive that this is not the debate he is looking for.",
  },
  {
    key: "lord-of-the-rings",
    motion: "that the true hero of the long walk is the gardener",
    lines: [
      L("haven", "open", "He packed the pans, rationed the bread and carried his friend up the mountain. That's stewardship."),
      L("annex", "aye", "Never asked for the spotlight. Hit every cue. Carried the set when the lead couldn't. Respect from the wings."),
      L("boiler", "nay", "Long walk, bad weather, one tiny chance. And the eagles were right there. Not one of you mentions the eagles."),
      L("workshop", "aye", "Second breakfast as a form of resistance! The soul of the story is a garden. I'm painting it now."),
    ],
    close: "Carried. The chair thanks the gardener, and will hear nothing further about eagles.",
  },
  {
    key: "nolan",
    motion: "that a film should make you feel time, not just watch it pass",
    lines: [
      L("studio", "open", "Three timelines cut against each other and the score ticking under it all. That's cinema. One more take!"),
      L("archive", "aye", "As historian of this chamber, I appreciate any film that requires a chart to follow. I have made the chart."),
      L("exchange", "nay", "Is it a dream or not? I need to know whether the top falls. Unresolved positions make me sweat."),
      L("green", "aye", "Docking a spinning ship with seconds to spare. NO TIME FOR CAUTION! What a finish!"),
    ],
    close: "Carried, in reverse order. The chair will explain the ending to anyone who asks. Nobody asks.",
  },
  {
    key: "melodic-bass",
    motion: "that the drop is better when it makes you feel something first",
    lines: [
      L("breakroom", "open", "Big pads, a soaring lead, then the drop hits and the whole room is crying and jumping at once. PARTY."),
      L("workshop", "aye", "It's colour you can hear! Pastel chords, then the floor gives way into something enormous. Inspiring."),
      L("boiler", "nay", "Builds for two minutes. Then it drops. Then it builds again. Like pressure in a pipe. I've seen how that ends."),
      L("annex", "aye", "Lights on the drop. Standby. Go."),
    ],
    close: "Carried. The chair calls for a recess with considerably more bass.",
  },
  {
    key: "emo",
    motion: "that the songs of the two-thousands understood feelings better than anything since",
    lines: [
      L("haven", "open", "I hum them while the vacuum runs. Every chorus is a cry and a hug. The black parade marches on, in here."),
      L("relay", "aye", "Every song was a message somebody never sent! Away messages, all of them. I know who they were for."),
      L("spire", "nay", "Respectfully, eyeliner was never a scalable business model. The swoop haircut did not test well."),
      L("breakroom", "aye", "Everybody, together! Arms up, sing the bridge like your heart depends on it! It's not a phase!"),
    ],
    close: "Carried. The chair notes that he was never in a phase. He was always this magnificent.",
  },
  {
    key: "opera",
    motion: "that grand opera was the first blockbuster",
    lines: [
      L("archive", "open", "Spectacle, crowds, a hero's death in the last act. Opera did it centuries first. I have the programmes."),
      L("studio", "aye", "Costumes, sets, a full orchestra and nobody whispering. That's the director's dream. One more aria!"),
      L("foundry", "nay", "Four hours and the stage crew does all the real work. Somebody built those sets. Nobody claps for them."),
      L("annex", "aye", "He's not wrong. Fly the backdrop. Standby. Go."),
    ],
    close: "Carried. The chair has been told he sings like a fallen angel, and will not be taking questions.",
  },
];

/** The debate for this turn of the recess: the list in order, round and round. */
export const debateAt = (k: number): Debate => DEBATES[((k % DEBATES.length) + DEBATES.length) % DEBATES.length]!;

/** The chair's opening, naming the motion. */
export const debateOpen = (d: Debate): string => `The chamber is in recess. The motion before it: ${d.motion}.`;

/** Every line a debate will say, the chair's included, so the voices are fetched before they're needed. */
export const debateLines = (d: Debate): { by: string; text: string }[] => [
  { by: "kernel", text: debateOpen(d) },
  ...d.lines.map((l) => ({ by: l.by, text: l.text })),
  { by: "kernel", text: d.close },
];

/** The members a debate seats: everyone known to the chamber, never the chair. */
export const isMember = (id: string): boolean => id !== "kernel" && Object.hasOwn(SUBMIND_TITLE, id);
