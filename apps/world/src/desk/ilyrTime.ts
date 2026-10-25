/** The Mountain clock's formatter, made once: building one costs far more than using it (#417, the Desk asks often). */
let MT: Intl.DateTimeFormat | null = null;

/** What Ilyr's hour is: the Mountain clock, as the world keeps it (hours and a fraction, 0..24). */
export function mountainHour(now: number): number {
  MT ??= new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const parts = MT.formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/** Ilyr's part of the day at an hour. */
export const PART = (h: number) => (h < 5 ? "Night" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : h < 22 ? "Evening" : "Night");
