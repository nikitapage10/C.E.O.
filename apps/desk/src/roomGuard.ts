/**
 * What the Desk's room guard (RoomGuard.tsx, #909) decides, kept apart from React so it can be tested.
 *
 * A page that throws while it renders used to take the whole Desk with it: nothing caught it, React unmounted the
 * tree, and Nikita saw a black page. Two kinds of failure reach the guard:
 *   - a page's code that can't be fetched, mostly a tab left open across a deploy, whose old chunk names are gone.
 *     Only a reload fixes that (React's lazy() keeps the failed import), so the guard reloads once, then shows its card;
 *   - anything else a page throws: the guard shows a card with Retry, and the rest of the Desk stays up.
 */

/** The browsers' words for a dynamic import or a CSS chunk that didn't load (Chromium, Firefox, Safari, Vite). */
const CHUNK = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i;

/** Whether an error is a page's code (or its CSS) failing to load, which a reload fixes. */
export function isChunkError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: unknown; message?: unknown };
  return e.name === "ChunkLoadError" || CHUNK.test(String(e.message ?? error));
}

/** The session key that remembers the last reload the guard made. */
export const RELOAD_KEY = "ceo.roomGuard.reloadedAt";
/** Within this long of the last one, the guard doesn't reload again (a site that really is down shows the card). */
export const RELOAD_GAP_MS = 60_000;

type Store = Pick<Storage, "getItem" | "setItem">;

/** Whether to reload for a chunk failure now; records the reload when yes. No storage (a locked-down browser) means no. */
export function claimReload(store: Store | null, now: number): boolean {
  if (!store) return false;
  try {
    const last = Number(store.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GAP_MS) return false;
    store.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** One line for the card: the error's message, short, with no stack. */
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const line = raw.split("\n")[0]!.trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line || "Something went wrong.";
}
