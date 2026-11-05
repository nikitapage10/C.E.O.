import type { ComponentType } from "react";
import type { RoomSection } from "@ceo/engine/web/sections.ts";
import { NAV_ORDER, type Route } from "../route.ts";
import type { DeskData } from "./deskData.ts";

/**
 * The Desk's pages from the rooms (#617, step 3): what the bar calls each page and how each page loads come from
 * each room's `rooms/<id>/nav.ts` (`name`, `page`), which its manifest (room.ts) takes in, not from lists kept here.
 * Only those small files load with the shell; the full manifests (purpose, tools, lore) would add about 40 kB to the
 * first load, and each page's code stays lazy behind its loader. The order of the bar and its number keys stays
 * route.ts `NAV_ORDER`, which the contract test holds the manifests' `navKey` to.
 */

/** What the Desk hands every page; each takes what it needs. */
export interface PageProps {
  data: DeskData;
  now: number;
  connected: boolean;
  awaySince: number;
}

export type DeskPage = Exclude<Route, "lattice">;
type PageLoader = () => Promise<{ default: ComponentType<PageProps> }>;
interface RoomNav {
  name: string;
  page?: () => Promise<{ default: unknown }>;
  sections?: readonly RoomSection[];
}

const NAVS = import.meta.glob<RoomNav>("../../../../rooms/*/nav.ts", { eager: true, import: "nav" });
const BY_ID = new Map(Object.entries(NAVS).map(([path, nav]) => [path.split("/").at(-2)!, nav]));

/** A page's name in the bar (its room's `name`). */
export const pageName = (id: DeskPage): string => BY_ID.get(id)?.name ?? id;

/** A page's sub-menu (its room's `sections`, `@ceo/engine/web/sections.ts`): none for a one-page room. */
export const pageSections = (id: DeskPage): readonly RoomSection[] => BY_ID.get(id)?.sections ?? [];

/** Each page's lazy loader, in the bar's order. Today has none: it is in the first load. */
export const PAGE_LOADERS: Partial<Record<DeskPage, PageLoader>> = Object.fromEntries(
  NAV_ORDER.flatMap((id) => {
    const page = BY_ID.get(id)?.page;
    return page ? [[id, page as PageLoader]] : [];
  }),
);
