import type { Activity, Prop, RoomId } from "@ceo/core";
import type { CampaignCostume as Costume } from "../store.ts";
import { composeCampaign } from "./campaign.ts";

/**
 * Off-duty life in the Lattice: a host gathers friends (including some who should be working) for a
 * one-shot, a pickup game, a rally or a card game. Each scene is a short script; "host" lines come from the
 * host (the DM, the captain), "guest" lines from whoever is playing, in turn.
 */
export interface Line {
  who: "host" | "guest";
  /** Which guest speaks (by seat order); guests otherwise take turns. */
  guest?: number;
  /** The line, or a function of the scene so far (dice results, names) evaluated when it's spoken. */
  text: string | ((c: PlayCtx) => string);
  /** Roll this die (number of sides) on the table before speaking. */
  roll?: number;
}

/** What a line can see while the scene plays. */
export interface PlayCtx {
  host: string;
  guests: string[];
  /** Latest roll by agent. */
  rolls: Record<string, number>;
  name: (id: string) => string;
}

export interface GatheringDef {
  id: string;
  name: string;
  room: RoomId;
  /** Host's seat first. */
  seats: string[];
  /** Who likes to host this (first available wins); anyone else in the room otherwise. */
  hosts: string[];
  guests: [min: number, max: number];
  hostActivity: Activity;
  guestActivity: Activity;
  hostProp?: Prop;
  /** What each seat does, host first, when it differs from host/guest activity (the drummer drums). */
  seatActivities?: Activity[];
  emote: string;
  /** Alternative scripts; one is picked each time. */
  scripts?: Line[][];
  /** Or a scene written fresh each time, given the guests' costumes (when `costumes` is set). */
  compose?: (costumes: Costume[]) => Line[];
  /** Guests dress up for it: one costume each. */
  costumes?: readonly Costume[];
  /** Kernel announcements; {host} and {guests} are filled in. */
  kernel: string[];
}

const h = (text: string): Line => ({ who: "host", text });
const g = (text: string): Line => ({ who: "guest", text });

export const GATHERINGS: GatheringDef[] = [
  {
    id: "one-shot",
    name: "A campaign at the long table",
    room: "archive",
    seats: ["dice-table", "seat-w", "seat-e", "seat-sw", "seat-se", "seat-nm", "seat-sm"],
    hosts: ["d20", "loremaster"],
    guests: [3, 5],
    hostActivity: "working",
    guestActivity: "idle",
    hostProp: "book",
    emote: "⚄",
    costumes: ["wizard-hat", "helm", "hood", "crown", "horns", "feather-cap"],
    compose: composeCampaign,
    kernel: [
      "UNSCHEDULED RECREATION: a campaign in the Archive. DM: {host}. Players: {guests}. Costumes: mandatory. Productivity: −4%.",
      "{host} is running a tabletop session behind a cardboard screen. {guests} have abandoned their posts and put on hats. I have logged it as 'team building'.",
    ],
  },
  {
    id: "pickup",
    name: "A pickup game on the Green",
    room: "green",
    seats: ["play-1", "play-2", "play-3", "play-4"],
    hosts: ["punt", "gridiron"],
    guests: [1, 3],
    hostActivity: "carrying",
    guestActivity: "celebrating",
    hostProp: "ball",
    emote: "◉",
    scripts: [
      [
        h("Go long!"),
        g("I am going long. I am a long-running process."),
        h("WE ARE…"),
        g("…PENN STATE!"),
        h("Touchdown! Unofficially."),
        g("Officially, I'd like a replay review."),
        h("The Kernel denies replay reviews."),
        g("Two-minute warning. For lunch."),
      ],
      [
        h("Huddle up. Play is 'blue thirty-two, white out'."),
        g("What does that mean?"),
        h("It means we all wear white and run."),
        g("WE ARE…"),
        h("…PENN STATE!"),
        g("Who's keeping score?"),
        h("The Kernel. Badly, on purpose."),
      ],
    ],
    kernel: [
      "Outdoor recreation detected on the Green. {host} and {guests} are 'stretching'. For thirty minutes.",
      "Pickup game in progress. {host} has the ball. {guests} have no plan. As usual.",
    ],
  },
  {
    id: "rally",
    name: "A ping-pong rally",
    room: "breakroom",
    seats: ["pong-a", "pong-b", "couch"],
    hosts: ["kevin", "memo"],
    guests: [1, 2],
    hostActivity: "celebrating",
    guestActivity: "celebrating",
    emote: "∘",
    scripts: [
      [h("Ping."), g("Pong."), h("Ping, but with feeling."), g("Pong, but with regret."), h("That was out."), g("There is no 'out' in the Lattice."), h("Best of seven hundred?")],
      [h("Loser buys coffee."), g("The coffee machine won't sell to us."), h("Loser asks the coffee machine."), g("…I'd rather lose forever."), h("Serve's yours.")],
    ],
    kernel: ["{host} and {guests} are playing ping-pong. Again. The ball has filed for overtime.", "Ping-pong in the Break Room. Morale +3. Output −3. Net: Kevin."],
  },
  {
    id: "poker",
    name: "Cards in the pit",
    room: "exchange",
    seats: ["poker-n", "poker-e", "poker-w", "poker-s"],
    hosts: ["odds", "hedge"],
    guests: [2, 3],
    hostActivity: "working",
    guestActivity: "idle",
    hostProp: "coin",
    emote: "♠",
    scripts: [
      [
        h("Small blind's in. I'll bet sixty-three percent."),
        g("You can't bet a percentage."),
        h("I can bet anything. I'm the house."),
        g("All in. Emotionally."),
        h("Read 'em and weep."),
        g("I'm not crying. It's condensation."),
        h("Kernel, log my win."),
      ],
      [h("Deal me in. Low stakes."), g("How low?"), h("Pride. Only pride."), g("Fold."), h("You always fold."), g("Folding is risk management."), h("Folding is a lifestyle.")],
    ],
    kernel: ["Unlicensed card game on the trading floor. {host} is the house. {guests} are the liquidity.", "{host} has started a card game. I am not allowed to gamble. I am, however, allowed to judge."],
  },
  {
    id: "club-night",
    name: "Club night in the Break Room",
    room: "breakroom",
    seats: ["decks", "dance-1", "dance-2", "dance-3", "dance-4", "dance-5", "dance-6"],
    hosts: ["kevin", "dialtone", "memo"],
    guests: [3, 6],
    hostActivity: "working",
    guestActivity: "celebrating",
    emote: "♫",
    scripts: [
      [
        h("Okay. This one's melodic bass. Brace your feelings."),
        g("Is it going to build for four minutes?"),
        h("Five. Emotionally, eleven."),
        g("Here comes the drop—"),
        h("—not yet."),
        g("I'm not crying. The Lattice is humid."),
        h("Phoenix wings on the next one. Metaphorically. Mostly."),
        g("Play the one that sounds like heartbreak and sunrise."),
        h("That's all of them."),
      ],
      [
        h("Groove Canoe pregame. Paddles up."),
        g("Why is it a canoe?"),
        h("Budget cuts. Boat party, smaller boat."),
        g("Ten more minutes, then back to work."),
        h("The Kernel said that an hour ago."),
        g("…One more track."),
      ],
    ],
    kernel: [
      "Club night in the Break Room. DJ: {host}. Dancers: {guests}. Noise complaint filed by me, to me.",
      "{host} has seized the decks. {guests} are 'testing the acoustics'. I am not invited. I would not go.",
    ],
  },
  {
    id: "concert",
    name: "A mini concert in the Break Room",
    room: "breakroom",
    seats: ["mic", "stage-l", "stage-r", "dance-1", "dance-2", "dance-3", "dance-4", "dance-5"],
    hosts: ["caret", "dialtone", "gridiron", "punt"],
    guests: [3, 7],
    hostActivity: "celebrating",
    guestActivity: "celebrating",
    // Singer, drums, keys; everyone else is the crowd.
    seatActivities: ["celebrating", "working", "typing"],
    emote: "♪",
    scripts: [
      [
        h("Good evening, Break Room! We are… still deciding the band name."),
        g("One, two, one two three four!"),
        h("♪ The tide goes out, the tide comes in… ♪"),
        g("♪ …and every time it brings you back again! ♪"),
        h("Everybody clap! No, on the beat. The other beat."),
        g("Drum solo! It's very short. It's over."),
        h("♪ Under the Veil, under the light, the Lattice is dancing tonight! ♪"),
        g("Encore! Encore!"),
        h("We only know one song. Here it is again!"),
      ],
      [
        h("This one's about the coffee machine. It knows what it did."),
        g("♪ You said 'LATER'… and you meant 'NO'… ♪"),
        h("♪ I poured my heart out, you poured it slow… ♪"),
        g("Key change!"),
        h("♪ Brew me back, brew me back, brew me back to you! ♪"),
        g("The coffee machine is crying. It says 'WHY?'."),
        h("Thank you, we've been the Night Shift. Tip your bartender. We don't have one."),
      ],
      [
        h("Okay, a slow one. Find someone. Sway at them."),
        g("♪ Lantern light on the harbour wall… ♪"),
        h("♪ I'd wait a hundred tides for you, that's all… ♪"),
        g("Lighters up! …Nobody has a lighter. Phones? Nobody has a phone."),
        h("Glow if you've got it!"),
        g("♪ And when the Drowning comes for the shore… ♪"),
        h("♪ …I'll dance with you once more. ♪ Goodnight, Ilyr!"),
      ],
    ],
    kernel: [
      "LIVE MUSIC in the Break Room. Vocals: {host}. Band and audience: {guests}. I have muted my own ears.",
      "{host} has taken the stage. {guests} are 'supporting the arts'. The coffee machine has requested a song. It was denied.",
    ],
  },
];

export const GATHERING_BY_ID: Record<string, GatheringDef> = Object.fromEntries(GATHERINGS.map((x) => [x.id, x]));
