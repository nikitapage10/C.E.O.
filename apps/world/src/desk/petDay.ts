import type { DeviceReading, FeedUnit, MealStatus, PetMeal } from "./homeDevices.ts";

/**
 * The Petlibro day in words (#685): the fountain's intake and due dates, the feeders' visits, amounts and plans, as
 * the Haven's Pets cards and the Home chip show them. Pure; every field may be missing, and then says nothing.
 */

/** "05:00" → "5:00 AM", "21:00" → "9:00 PM", as the Petlibro app writes times. */
export function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Seconds as the app shows them: "2m 04s", "45s". */
export function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** mL as US fluid ounces, one decimal under 10. */
export function ounces(ml: number): string {
  const oz = ml * 0.033814;
  return oz < 10 ? oz.toFixed(1) : String(Math.round(oz));
}

/** A dry amount in the app's unit. A Granary portion is 1/12 cup (about 10 g, 0.35 oz or 20 mL). */
export function amount(portions: number, unit: FeedUnit = "cup"): string {
  if (unit === "oz") return `${(portions * 0.35).toFixed(1)} oz`;
  if (unit === "g") return `${portions * 10} g`;
  if (unit === "ml") return `${portions * 20} mL`;
  if (portions === 0) return "0 cup";
  const whole = Math.floor(portions / 12);
  const rest = portions % 12;
  if (!whole) return `${rest}/12 cup`;
  return `${whole}${rest ? ` ${rest}/12` : ""} ${whole === 1 && !rest ? "cup" : "cups"}`;
}

/** When a filter change or a clean is due: overdue in ember, today, or in so many days. */
export function due(days: number): { text: string; over: boolean } {
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, over: true };
  if (days === 0) return { text: "due today", over: true };
  return { text: `in ${days} day${days === 1 ? "" : "s"}`, over: false };
}

/** A meal's status in the app's words, for the wet bowls and the dry schedule. */
export function statusWord(s: MealStatus | undefined, wet: boolean): string {
  switch (s) {
    case "done":
      return wet ? "Completed" : "Served";
    case "now":
      return "Feeding now";
    case "next":
      return "Next";
    case "skipped":
      return "Skipped";
    case "skip":
      return "Skipping";
    default:
      return "";
  }
}

/** The next meal still to come today, if the plan says. */
export const nextOf = (plan: PetMeal[] | undefined): PetMeal | null => plan?.find((m) => m.status === "next" || m.status === "now") ?? null;

/** The short facts for the Home chip on Today: the day's numbers and what's due. */
export function petFacts(d: DeviceReading): string[] {
  const out: string[] = [];
  if (d.kind === "fountain") {
    if (d.drankMl !== undefined) out.push(`${ounces(d.drankMl)} oz today`);
    if (d.visits !== undefined) out.push(`${d.visits} visit${d.visits === 1 ? "" : "s"}`);
    if (d.filterDays !== undefined && d.filterDays <= 0) out.push(`filter ${due(d.filterDays).text}`);
    if (d.cleanDays !== undefined && d.cleanDays <= 0) out.push(`clean ${due(d.cleanDays).text}`);
  }
  if (d.kind === "wet-feeder") {
    if (d.visits !== undefined) out.push(`${d.visits} visit${d.visits === 1 ? "" : "s"} today`);
    const n = nextOf(d.meals);
    if (n) out.push(n.status === "now" ? `bowl ${n.plate ?? "?"} open now` : `next ${clock(n.time)}${n.plate ? ` (bowl ${n.plate})` : ""}`);
  }
  if (d.kind === "dry-feeder") {
    if (d.fedPortions !== undefined) out.push(`${amount(d.fedPortions, d.feedUnit)} today`);
    const n = nextOf(d.plan);
    if (n) out.push(`next ${clock(n.time)}${n.portions !== undefined ? `, ${amount(n.portions, d.feedUnit)}` : ""}`);
  }
  return out;
}
