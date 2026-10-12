import { useEffect, useState } from "react";

/** The Desk's own small helpers, so it never reaches into the Lattice's code. */

/** Date.now(), refreshed every `ms`. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
