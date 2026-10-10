import { ROOMS, ROOM_IDS, type RoomId } from "@ceo/core";

export type PetKind = "kitten" | "foundling" | "brain";

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
    title: "Grey Maine Coon kitten · root access",
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
    id: "gerald",
    name: "Gerald",
    kind: "brain",
    title: "Brain on legs · Archive research specimen",
    blurb: "Kept in the Archive 'for research'. Wants very badly to be friends, specifically with your head. Leashed, emotionally. Loremaster insists it's 'mostly harmless'.",
    homes: ["archive"],
    speed: 1.3,
    greetings: [
      "Gerald, no. We've talked about ears.",
      "Gerald is skittering again. Everyone keep your helmets on.",
      "Good morning, Gerald. No, you can't have my head. It's using it.",
    ],
  },
];

export const PET_BY_ID: Record<string, PetDef> = Object.fromEntries(PETS.map((p) => [p.id, p]));

/** Places a pet may wander to in a room: every station there. */
export function wanderSpots(room: RoomId): string[] {
  return ROOMS[room].stations.map((s) => s.id);
}
