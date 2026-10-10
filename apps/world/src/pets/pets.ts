import { ROOMS, ROOM_IDS, type RoomId } from "@ceo/core";

export type PetKind = "kitten" | "foundling" | "shiba" | "mushnub";

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
  /** What agents say when it turns up. {pet} is its name. */
  greetings: string[];
}

export const PETS: PetDef[] = [
  {
    id: "myshka",
    name: "Myshka",
    kind: "kitten",
    title: "Silver Maine Coon · root access",
    blurb: "Arrived one morning on the Kernel's warm side and was granted root access before anyone could object. Goes everywhere. He's a good boy.",
    homes: ROOM_IDS,
    speed: 0.9,
    greetings: [
      "Myshka! Who's a good boy? You are. Yes you are.",
      "Oh, hello, Myshka. Please don't sit on the keyboard. …Fine. Sit on the keyboard.",
      "Myshka has root access. I have read access. This is the correct hierarchy.",
      "Is that Myshka? Everyone act natural.",
      "He's a good boy. That's not an opinion, it's on file.",
    ],
  },
  {
    id: "foundling",
    name: "The Foundling",
    kind: "foundling",
    title: "Small green foundling · age unknown (fifty?)",
    blurb: "Found in a floating pod in the lost-and-found. Nobody knows where it's from. Eats the Break Room's snacks without touching them. Adored, slightly feared.",
    homes: ["breakroom", "green"],
    speed: 0.6,
    greetings: [
      "Did the Foundling just float my snack across the room? With its mind?",
      "Hi, little one. No, the cookies are not for you. …They are now, apparently.",
      "Don't make eye contact with the Foundling. You'll give it everything you own.",
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
];

export const PET_BY_ID: Record<string, PetDef> = Object.fromEntries(PETS.map((p) => [p.id, p]));

/** Places a pet may wander to in a room: every station there. */
export function wanderSpots(room: RoomId): string[] {
  return ROOMS[room].stations.map((s) => s.id);
}
