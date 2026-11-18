import type { RoomSection } from "@ceo/engine/web/sections.ts";

/**
 * The Haven's sub-menu (#871, `@ceo/engine/web/sections.ts`): the house first, at /haven, then each of its tabs at its
 * own address (/haven/kitchen and on), so the Desk's bar lists them and each can be linked to and reloaded. The ids
 * past the first are the page's tabs (`SheetTab` in web/data.ts). Its own small file, so the page reads it without
 * pulling every room's nav into its chunk. DoorDash (#1195) is ordering out, inside the Kitchen beside meal prep (#1206):
 * `/haven/kitchen/doordash?store=<id>` opens a store, and the old `/haven/doordash` lands there.
 */
export const SECTIONS: RoomSection[] = [
  { id: "house", label: "House", path: "/haven", hint: "The house in 3D and its readings" },
  { id: "kitchen", label: "Kitchen", path: "/haven/kitchen", hint: "Meal prep, the shopping list and DoorDash" },
  { id: "hall", label: "Hall", path: "/haven/hall", hint: "The vacuum and the hall" },
  { id: "pets", label: "Pets", path: "/haven/pets", hint: "The feeder and the litter box" },
  { id: "gym", label: "Gym", path: "/haven/gym", hint: "This week's sessions" },
];
