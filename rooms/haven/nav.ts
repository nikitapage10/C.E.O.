import { SECTIONS } from "./sections.ts";

/**
 * The Haven's place in the Desk's bar: its name, its lazy page loader and its sub-menu. The manifest (room.ts) takes
 * them all; they live apart so the Desk's shell loads only this, never the whole manifest (#617, step 3). `sections`
 * are the house and its tabs (`sections.ts`, #871).
 */
export const nav = {
  name: "Haven",
  page: () => import("./web/HavenPage.tsx").then((m) => ({ default: m.Haven })),
  sections: SECTIONS,
};
