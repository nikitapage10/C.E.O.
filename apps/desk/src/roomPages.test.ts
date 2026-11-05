import { describe, expect, it } from "vitest";
import { NAV_ORDER } from "../../world/src/route.ts";
import { PAGE_LOADERS, pageName, pageSections } from "./roomPages.ts";
import { systemsPageOf } from "../../../rooms/boiler/web/SystemsNav.tsx";

/** The Desk's bar and page loaders, read from the room manifests (#617, step 3): the same bar as before. */
describe("the Desk's pages from the manifests", () => {
  it("names every page in the bar as it always has, in the bar's order", () => {
    expect(NAV_ORDER.map(pageName)).toEqual(["Senate", "Haven", "Foundry", "Relay", "Green", "Exchange", "Archive", "Annex", "Spire", "Workshop", "Studio", "Boiler Room"]);
  });

  it("loads every page but Today lazily, from its manifest", () => {
    expect(Object.keys(PAGE_LOADERS)).toEqual(NAV_ORDER.filter((id) => id !== "today"));
    for (const load of Object.values(PAGE_LOADERS)) expect(typeof load).toBe("function");
  });

  it("keeps the Boiler Room's sub-menu as it was, from its room, and the Haven's tabs have theirs (#871)", () => {
    expect(pageSections("boiler").map((s) => [s.label, s.path])).toEqual([
      ["Map", "/boiler"],
      ["Controls", "/boiler/controls"],
      ["Security", "/boiler/security"],
      ["Compliance", "/boiler/compliance"],
    ]);
    expect(pageSections("haven").map((s) => [s.label, s.path])).toEqual([
      ["House", "/haven"],
      ["Kitchen", "/haven/kitchen"],
      ["Hall", "/haven/hall"],
      ["Pets", "/haven/pets"],
      ["Gym", "/haven/gym"],
    ]);
    expect(NAV_ORDER.filter((id) => pageSections(id).length)).toEqual(["haven", "boiler"]);
    expect(["/boiler", "/boiler/", "/boiler/controls", "/systems/security", "/boiler/compliance/", "/boiler/nope"].map(systemsPageOf)).toEqual(["systems", "systems", "controls", "security", "compliance", "systems"]);
  });
});
