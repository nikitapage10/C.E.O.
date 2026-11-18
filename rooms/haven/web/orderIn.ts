import { mealKey, type Course, type Day, type OrderStore } from "./meals.ts";

/**
 * Where Order now goes for an order-in meal (#1195, phase 2): the Haven's DoorDash tab, told which meal it's for.
 * `slot` is the day and meal ("sat-dinner"), `week` the week's Monday and `store` the store remembered for that meal,
 * when there is one, so the tab can open on its menu. Placing an order stays the DoorDash tab's own preview and Place.
 */
export function orderInHref(day: Day, course: Course, week: string | null, store?: OrderStore | null): string {
  const q = new URLSearchParams({ slot: mealKey(day, course) });
  if (week) q.set("week", week);
  if (store) q.set("store", store.id);
  return `/haven/doordash?${q}`;
}
