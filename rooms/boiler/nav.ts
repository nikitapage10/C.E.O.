import { SECTIONS } from "./sections.ts";

/**
 * The Boiler Room's place in the Desk's bar: its name, its lazy page loader and its sub-menu. The manifest (room.ts)
 * takes them all; they live apart so the Desk's shell loads only this, never the whole manifest (#617, step 3).
 * `sections` are its subpages (`sections.ts`).
 */
export const nav = {
  name: "Boiler Room",
  page: () => import("../../apps/world/src/desk/SystemsHub.tsx").then((m) => ({ default: m.SystemsHub })),
  sections: SECTIONS,
};
