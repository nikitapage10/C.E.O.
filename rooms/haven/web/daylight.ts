/**
 * Day or night in the Haven's house (#974): where the sun is over Denver (the city the house's night already stands in,
 * night.ts), so the house is lit by daylight while the sun is up and only by its lights once it has set. A standard
 * low-precision solar position (about a degree), enough to tell day from dusk from night. Pure, so it's tested alone.
 */

const RAD = Math.PI / 180;
/** Denver, to the nearest tenth of a degree: the city, not a home. */
export const DENVER = { lat: 39.7, lon: -105.0 } as const;

/** The sun's altitude (radians above the horizon) and azimuth (radians from north, clockwise) at a moment. */
export function sunAt(when: Date, lat: number = DENVER.lat, lon: number = DENVER.lon): { alt: number; az: number } {
  const d = when.getTime() / 86_400_000 - 10_957.5; // days from J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) * RAD - ra) % (2 * Math.PI);
  const la = lat * RAD;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { alt, az: (az + 2 * Math.PI) % (2 * Math.PI) };
}

/** How much daylight, 0 (night) to 1 (day): a smooth dusk from the sun 6° below the horizon to 4° above it. */
export function dayLevel(alt: number): number {
  const t = Math.max(0, Math.min(1, (alt / RAD + 6) / 10));
  return t * t * (3 - 2 * t);
}
