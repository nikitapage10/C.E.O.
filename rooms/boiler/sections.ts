import type { RoomSection } from "@ceo/engine/web/sections.ts";

/**
 * The Boiler Room's sub-menu (#82, `@ceo/engine/web/sections.ts`): its subpages, each at its own address; the first is
 * the Map. Its own small file, so the room's page reads it without pulling every room's nav into its chunk.
 */
export const SECTIONS: RoomSection[] = [
  { id: "systems", label: "Map", path: "/boiler", hint: "Every pipe, its gauge and what's broken" },
  { id: "controls", label: "Controls", path: "/boiler/controls", hint: "Usage, settings, switches, connections and keys" },
  { id: "security", label: "Security", path: "/boiler/security", hint: "Threat model and scans" },
  { id: "compliance", label: "Compliance", path: "/boiler/compliance", hint: "Frameworks and controls" },
];
