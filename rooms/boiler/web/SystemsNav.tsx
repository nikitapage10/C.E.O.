import { RoomSections, type SectionScores } from "@ceo/engine/web/RoomSections.tsx";
import { sectionOf } from "@ceo/engine/web/sections.ts";
import { navigateTo, usePathname } from "../../../apps/world/src/route.ts";
import { SECTIONS } from "../sections.ts";

/**
 * The Boiler Room's sub-navigation (#82; the Systems hub until #225) and its addresses: /boiler, /boiler/controls (#647),
 * /boiler/security, /boiler/compliance (the old /systems ones still work). Each subpage has its own address, so it can be linked to and
 * reloaded. The sections come from the room (rooms/boiler/sections.ts, its manifest's `sections`, #617), the engine draws the sub-menu
 * (`@ceo/engine/web/RoomSections.tsx`) and the Desk names the tab from them. SystemsHub.tsx picks the page.
 */

export type SystemsPage = "systems" | "controls" | "security" | "compliance";

export function systemsPageOf(pathname: string): SystemsPage {
  return sectionOf(SECTIONS, pathname).id as SystemsPage;
}

/** A tab's count beside its name (the Map's tabs, #732): states and counts only, so it reads the same signed out. */
export type TabScores = SectionScores & Partial<Record<SystemsPage, { v: string; warn?: boolean }>>;

/** The hub's sub-navigation, under each page's head; on the Map, tabs in its top bar with a count each. */
export function SystemsNav({ scores, className = "wv-subnav" }: { scores?: TabScores; className?: string } = {}) {
  const current = systemsPageOf(usePathname());
  return <RoomSections sections={SECTIONS} current={current} go={(path) => navigateTo(path + window.location.search)} label="Boiler Room sections" scores={scores} className={className} />;
}
