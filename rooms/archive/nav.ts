/**
 * The Archive's place in the Desk's bar: its name and, for a page past Today, its lazy page loader. The manifest
 * (room.ts) takes both; they live apart so the Desk's shell loads only this, never the whole manifest (#617, step 3).
 */
export const nav = {
  name: "Archive",
  page: () => import("./web/Archive.tsx").then((m) => ({ default: m.Archive })),
};
