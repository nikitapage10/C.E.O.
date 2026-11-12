import type { DeskPage } from "./roomPages.ts";

/**
 * The phone's bottom bar (#1045, PhoneNav.tsx): the three pages pinned beside Skippy, the first three of the bar's order
 * (route.ts NAV_ORDER: the Senate, the Haven and Relay, Nikita 2026-11-06, #934), and the room on screen when it is
 * another one, which the last slot then shows in place of "Rooms".
 */
export const PINNED = ["today", "haven", "relay"] as const satisfies readonly DeskPage[];

export function phoneShelf(route: DeskPage): { pinned: typeof PINNED; other: DeskPage | null } {
  return { pinned: PINNED, other: (PINNED as readonly DeskPage[]).includes(route) ? null : route };
}
