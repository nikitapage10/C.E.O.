/** The median of a list of numbers, or null for none. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/**
 * Did a page get slower lately (#569)? Takes timings newest first: compares the median of the newest 10 with the
 * median of the 10 before, and gives both when the newer is at least 1.5 times the older. Null otherwise, and for
 * fewer than 20 values.
 */
export function slowdown(values: number[]): { now: number; was: number } | null {
  if (values.length < 20) return null;
  const now = median(values.slice(0, 10));
  const was = median(values.slice(10, 20));
  if (now === null || was === null || was <= 0 || now < was * 1.5) return null;
  return { now, was };
}

const sec = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);

/** The one plain line the panels show, or null when nothing slowed. */
export function slowdownLine(values: number[]): string | null {
  const s = slowdown(values);
  return s ? `Slower lately: ${sec(s.now)} now, was ${sec(s.was)}` : null;
}
