/**
 * The Boiler Room's place in the Desk's bar: its name and, for a page past Today, its lazy page loader. The manifest
 * (room.ts) takes both; they live apart so the Desk's shell loads only this, never the whole manifest (#617, step 3).
 */
export const nav = {
  name: "Boiler Room",
  page: () => import("../../apps/world/src/desk/SystemsHub.tsx").then((m) => ({ default: m.SystemsHub })),
};
