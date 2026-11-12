import { DAY_NAME, DAYS, type Day } from "./meals.ts";

/**
 * Where the Kitchen opens and which day it is (#1055). The planner used to open on Shop whenever the week was
 * finalized, even with the shopping long done; it now opens on the step the week is really at, worked out from the
 * week and the Kitchen list (and the last King Soopers send), and Cook says plainly which day each meal is for.
 */

export type Phase = "plan" | "customize" | "shop" | "cook";

/** What the Kitchen knows about the shopping: the list's items (null while it's being read) and the cart's last send. */
export interface ShopState {
  items: ReadonlyArray<{ source: string; done: boolean }> | null;
  /** When the week's picks last went to the King Soopers cart, if they did. */
  cartSentAt?: string | null;
}

/**
 * The step to open on. A draft opens on Plan. A finalized week opens on Cook once its shopping is done: nothing it
 * put on the Kitchen list is still open (ticked off or taken off), it put nothing there at all, or the cart was sent
 * after it was finalized; otherwise on Shop. Items Nikita added himself ("oat milk") don't hold the week at Shop.
 * While the list is still being read it's Shop, unless the cart already says otherwise.
 */
export function openingStep(w: { confirmedAt: string | null; sentAt: string | null }, shop: ShopState): Phase {
  if (!w.confirmedAt) return "plan";
  const sent = shop.cartSentAt ? Date.parse(shop.cartSentAt) : NaN;
  if (Number.isFinite(sent) && sent >= Date.parse(w.confirmedAt)) return "cook";
  if (!w.sentAt) return "cook";
  if (shop.items === null) return "shop";
  return shop.items.some((i) => i.source === "meals" && !i.done) ? "shop" : "cook";
}

export type When = "past" | "today" | "tomorrow" | "ahead";

export interface WeekDay {
  day: Day;
  /** "Thursday" */
  name: string;
  /** "Nov 12" */
  date: string;
  when: When;
  /** "Today", "Tomorrow", "Yesterday", or null. */
  tag: string | null;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The week's seven days with their dates, set against `now` in local time (the week starts on its Monday, YYYY-MM-DD). */
export function weekDays(start: string, now: Date): WeekDay[] {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return DAYS.map((day, i) => {
    const at = new Date(y, m - 1, d + i);
    const key = ymd(at);
    const when: When = key === today ? "today" : key === tomorrow ? "tomorrow" : key < today ? "past" : "ahead";
    return {
      day,
      name: DAY_NAME[day],
      date: at.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      when,
      tag: when === "today" ? "Today" : when === "tomorrow" ? "Tomorrow" : key === yesterday ? "Yesterday" : null,
    };
  });
}
