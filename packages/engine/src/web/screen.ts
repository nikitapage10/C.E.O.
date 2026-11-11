import { useEffect, useId } from "react";
import { setScreen, type ScreenFacts } from "./screenFacts.ts";

/** The screen-context registry's React side (#1027); the registry and its pure helpers are in ./screenFacts.ts. */
export * from "./screenFacts.ts";

/**
 * A view's facts while it's mounted, gone when it unmounts. Pass null while there's nothing to say. Cheap: the facts
 * are compared as JSON, so a new object each render sets nothing new.
 */
export function useScreenContext(facts: ScreenFacts | null, isBase = false): void {
  const id = useId();
  const key = facts ? JSON.stringify(facts) : "";
  useEffect(() => {
    setScreen(id, key ? (JSON.parse(key) as ScreenFacts) : null, isBase);
  }, [id, key, isBase]);
  useEffect(() => () => setScreen(id, null), [id]);
}
