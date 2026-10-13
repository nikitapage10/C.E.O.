import { ROOMS, ROOM_IDS, inAir, type RoomId } from "@ceo/core";

export type PetKind = "kitten" | "brogu" | "shiba" | "mushnub" | "owlbear";

export interface PetDef {
  id: string;
  name: string;
  kind: PetKind;
  /** One line for the tag. */
  title: string;
  blurb: string;
  /** Rooms it lives in. More than one and it wanders between them. */
  homes: readonly RoomId[];
  /** Walking speed relative to an agent. */
  speed: number;
  /** Chance, each time it gets up, that it heads for another of its rooms. */
  roam?: number;
  /** What agents say when it turns up. {pet} is its name. */
  greetings: string[];
}

export const PETS: PetDef[] = [
  {
    id: "myshka",
    name: "Myshka",
    kind: "kitten",
    title: "Silver tabby Maine Coon · root access",
    blurb: "Arrived one morning on the Kernel's warm side and was granted root access before anyone could object. Goes everywhere, tail up. Washes in meetings. He's a good boy.",
    homes: ROOM_IDS,
    speed: 0.42,
    greetings: [
      "Myshka! Who's a good boy? You are. Yes you are.",
      "Oh, hello, Myshka. Please don't sit on the keyboard. …Fine. Sit on the keyboard.",
      "Myshka has root access. I have read access. This is the correct hierarchy.",
      "Is that Myshka? Everyone act natural.",
      "He's a good boy. That's not an opinion, it's on file.",
      "Tail up. He's in a good mood. The day is saved.",
      "Myshka's washing again. Mid-meeting. As is his right.",
      "He was a kitten last quarter. Nobody saw it happen. He just has more cat now.",
      "Look at that walk. Head up, chest in. Somebody's been to posture class.",
    ],
  },
  {
    id: "brogu",
    name: "Brogu",
    kind: "brogu",
    title: "Small green foundling · age unknown (fifty?) · says one word",
    blurb: "Found in a floating pod in the lost-and-found. One night he climbed out and walked, and he hasn't stopped. Toddles from room to room on very short legs, eats the snacks without touching them, and says one word: his name. Press B and the C.E.O. can ride along behind his eyes.",
    homes: ROOM_IDS,
    speed: 0.32,
    roam: 0.4,
    greetings: [
      "Brogu! Hello, little one. No, the cookies are not for you. …They are now, apparently.",
      "Did Brogu just float my snack across the room? With his mind?",
      "Don't make eye contact with Brogu. You'll give him everything you own.",
      "Brogu. Brogu. …He only says the one word, but he means it.",
      "Second breakfast? Brogu, you've had four breakfasts.",
      "Who left the pod open? He's on another floor already.",
    ],
  },
  {
    id: "biscuit",
    name: "Biscuit",
    kind: "shiba",
    title: "Shiba Inu · office dog · unpaid",
    blurb: "Wandered in through the Green's turnstile and was put on the org chart before HR noticed. Supervises the pitch and the snack shelf. Has opinions about the ping-pong ball.",
    homes: ["green", "breakroom"],
    speed: 1.1,
    greetings: [
      "Biscuit! Who let you on the pitch? …Fine. You can be the backup kicker.",
      "Biscuit is staring at my sandwich. I am staring back. We are at an impasse.",
      "Good dog. Best dog. Please stop eating the depth chart.",
      "Biscuit has been promoted again. I have not.",
    ],
  },
  {
    id: "spore",
    name: "Spore",
    kind: "mushnub",
    title: "Mushroom familiar · Archive · damp",
    blurb: "Grew out of a footnote in the Archive and refuses to be shelved. Dances when someone rolls a natural 20. Loremaster insists it's 'provisional canon'.",
    homes: ["archive"],
    speed: 0.8,
    greetings: [
      "Spore is dancing again. Did someone crit?",
      "Morning, Spore. Please stop sprouting on the first editions.",
      "Spore, that's a primary source. Do not sit on it.",
    ],
  },
  {
    id: "pudding",
    name: "Pudding",
    kind: "owlbear",
    title: "Owlbear cub · Archive · a natural 1, kept",
    blurb: "D20 rolled a natural 1 on a random-encounter table at the Archive's long table, and he walked off the map. Nobody has rolled to make him leave. Chunky, soft, and his hugs count as a grapple.",
    homes: ["archive", "green"],
    speed: 0.75,
    greetings: [
      "Pudding! Who's a chunky boy? …Yes. All of you. Every feather.",
      "Careful, Pudding's hugs count as a grapple. Don't start one you can't escape.",
      "Pudding, the dice are not food. Spit out the d20. …Thank you.",
      "Is that Pudding, or a random encounter? Same thing, really.",
      "Hoo. Hoo. That's all the owl I speak. He seems satisfied.",
    ],
  },
];

export const PET_BY_ID: Record<string, PetDef> = Object.fromEntries(PETS.map((p) => [p.id, p]));

/** The room a pet starts in: Myshka in the last of his, everyone else in their first. */
export const petStart = (def: PetDef): RoomId => def.homes[def.id === "myshka" ? def.homes.length - 1 : 0]!;

/**
 * Where a pet might stop in a room: any station on the floor (not the submind's floating podium or its command spot,
 * both up in the air). Only Myshka gets in the Archive's loot box.
 */
export function wanderSpots(room: RoomId, pet?: string): string[] {
  return ROOMS[room].stations.filter((s) => !inAir({ room, station: s.id }) && (s.id !== "loot-box" || pet === "myshka")).map((s) => s.id);
}

/** Orders from elsewhere in the Lattice. At 03:00 Myshka gets the zoomies: three times the speed, no stopping. */
export const petOrders = { zoomiesUntil: 0 };
