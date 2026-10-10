import type { Activity, Prop, RoomId } from "@ceo/core";

/**
 * Off-duty life in the Lattice: a host gathers friends (including some who should be working) for a
 * one-shot, a pickup game, a rally or a card game. Each scene is a short script; "host" lines come from the
 * host (the DM, the captain), "guest" lines from whoever is playing, in turn.
 */
export interface Line {
  who: "host" | "guest";
  text: string;
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
  emote: string;
  /** Alternative scripts; one is picked each time. */
  scripts: Line[][];
  kernel: string[];
}

const h = (text: string): Line => ({ who: "host", text });
const g = (text: string): Line => ({ who: "guest", text });

export const GATHERINGS: GatheringDef[] = [
  {
    id: "one-shot",
    name: "A one-shot at the dice table",
    room: "archive",
    seats: ["dice-table", "seat-w", "seat-e", "seat-sw", "seat-se"],
    hosts: ["d20", "loremaster"],
    guests: [2, 4],
    hostActivity: "working",
    guestActivity: "idle",
    hostProp: "book",
    emote: "⚄",
    scripts: [
      [
        h("You all meet in a tavern. Obviously."),
        g("I check the tavern for traps."),
        h("Roll perception."),
        g("Natural 1. I perceive… the floor."),
        g("I try to seduce the dragon."),
        h("There is no dragon. There is a barkeep."),
        g("I try to seduce the barkeep."),
        h("Roll charisma."),
        g("Natural 20!"),
        h("The barkeep agrees to a second date. The party is speechless."),
        g("Can I cast fireball in the tavern?"),
        h("You can. You may not."),
        h("Session over. Same time next epoch?"),
      ],
      [
        h("The Drowning has reached the old Shoreborn vault. The door is sealed."),
        g("I knock."),
        h("…The door opens. Nobody ever knocks."),
        g("I loot everything."),
        h("You find one (1) Cease & Desist. It is framed."),
        g("I roll to understand the lore."),
        h("Natural 1. You understand less than before."),
        g("I'd like to talk to the vault."),
        h("The vault says: 'per my last message'."),
        h("Roll initiative. The paperwork attacks."),
        g("I attack the darkness!"),
        h("The darkness files a complaint. Good session, everyone."),
      ],
    ],
    kernel: [
      "UNSCHEDULED RECREATION: a one-shot in the Archive. DM: {host}. Players: {guests}. Productivity: −4%.",
      "{host} is running a tabletop session. {guests} have abandoned their posts. I have logged it as 'team building'.",
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
    seats: ["decks", "dance-1", "dance-2", "dance-3"],
    hosts: ["kevin", "dialtone", "memo"],
    guests: [2, 3],
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
];

export const GATHERING_BY_ID: Record<string, GatheringDef> = Object.fromEntries(GATHERINGS.map((x) => [x.id, x]));
