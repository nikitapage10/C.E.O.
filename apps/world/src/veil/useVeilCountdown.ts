import { useEffect, useState } from "react";
import { veilCountdownNights } from "./veil.ts";

/** Nights left to the Veil (see veilCountdownNights), checked once a minute so an open tab rolls over at midnight. */
export function useVeilCountdown(): number | null {
  const [nights, setNights] = useState(() => veilCountdownNights(new Date()));
  useEffect(() => {
    const t = setInterval(() => setNights(veilCountdownNights(new Date())), 60_000);
    return () => clearInterval(t);
  }, []);
  return nights;
}
