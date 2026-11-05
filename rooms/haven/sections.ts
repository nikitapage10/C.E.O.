import type { RoomSection } from "@ceo/engine/web/sections.ts";

/**
 * The Haven's sub-menu (#871, `@ceo/engine/web/sections.ts`): the house first, at /haven, then each of its tabs at its
 * own address (/haven/kitchen and on), so the Desk's bar lists them and each can be linked to and reloaded. The ids
 * past the first are the page's tabs (`Tab` in web/data.ts). Its own small file, so the page reads it without pulling
 * every room's nav into its chunk.
 */
export const SECTIONS: RoomSection[] = [
  { id: "house", label: "House", path: "/haven", hint: "The house in 3D and its readings" },
  { id: "kitchen", label: "Kitchen", path: "/haven/kitchen", hint: "The pantry, meals and shopping" },
  { id: "hall", label: "Hall", path: "/haven/hall", hint: "The vacuum and the hall" },
  { id: "pets", label: "Pets", path: "/haven/pets", hint: "The feeder and the litter box" },
  { id: "gym", label: "Gym", path: "/haven/gym", hint: "This week's sessions" },
];
