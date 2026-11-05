/**
 * The Boiler Room's place in the Desk's bar: its name, its lazy page loader and its sub-menu. The manifest (room.ts)
 * takes them all; they live apart so the Desk's shell loads only this, never the whole manifest (#617, step 3).
 * `sections` are its subpages (#82, `@ceo/engine/web/sections.ts`), each at its own address; the first is the Map.
 */
export const nav = {
  name: "Boiler Room",
  page: () => import("../../apps/world/src/desk/SystemsHub.tsx").then((m) => ({ default: m.SystemsHub })),
  sections: [
    { id: "systems", label: "Map", path: "/boiler", hint: "Every pipe, its gauge and what's broken" },
    { id: "controls", label: "Controls", path: "/boiler/controls", hint: "Usage, settings, switches, connections and keys" },
    { id: "security", label: "Security", path: "/boiler/security", hint: "Threat model and scans" },
    { id: "compliance", label: "Compliance", path: "/boiler/compliance", hint: "Frameworks and controls" },
  ],
};
