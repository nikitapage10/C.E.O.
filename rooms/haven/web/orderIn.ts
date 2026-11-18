import { mealKey, type Course, type Day, type OrderStore } from "./meals.ts";

/** DoorDash's address inside the Kitchen (#1206), beside meal prep at /haven/kitchen. */
export const KITCHEN_DOORDASH = "/haven/kitchen/doordash";
/** Its old address as a Haven tab of its own (#1195), kept so old links still land. */
const OLD_DOORDASH = "/haven/doordash";

/** Which side of the Kitchen a path opens (#1206): DoorDash at /haven/kitchen/doordash, else meal prep. Pure. */
export function kitchenModeOf(pathname: string): "prep" | "doordash" {
  return pathname.replace(/\/+$/, "") === KITCHEN_DOORDASH ? "doordash" : "prep";
}

/** The old /haven/doordash address's new spelling, its store, slot and week kept; null for any other path. Pure. */
export function doordashMoved(pathname: string, search: string): string | null {
  return pathname.replace(/\/+$/, "") === OLD_DOORDASH ? KITCHEN_DOORDASH + search : null;
}

/**
 * Where Order now goes for an order-in meal (#1195, phase 2): the Kitchen's DoorDash side (#1206), told which meal it's for.
 * `slot` is the day and meal ("sat-dinner"), `week` the week's Monday and `store` the store remembered for that meal,
 * when there is one, so the tab can open on its menu. Placing an order stays the DoorDash tab's own preview and Place.
 */
export function orderInHref(day: Day, course: Course, week: string | null, store?: OrderStore | null): string {
  const q = new URLSearchParams({ slot: mealKey(day, course) });
  if (week) q.set("week", week);
  if (store) q.set("store", store.id);
  return `${KITCHEN_DOORDASH}?${q}`;
}
