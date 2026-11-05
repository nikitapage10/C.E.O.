/**
 * The Thread's ear for the room voice (#638, #642): one listener. The Desk's room mic (or hands-free) hands what Nikita
 * says on /relay to rooms/relay/voice.ts, which asks the Thread on screen through here. The Thread registers its
 * handler while it is mounted; with no Thread on screen the room's submind answers as usual (null).
 */

export interface RelayAnswer {
  say: string;
  actions?: readonly { label: string; run: () => unknown }[];
}

export type RelayHandler = (text: string) => Promise<RelayAnswer | null>;

let current: RelayHandler | null = null;

/** The Thread registers its handler; the returned function takes it back (only if it is still the current one). */
export function setRelayHandler(h: RelayHandler): () => void {
  current = h;
  return () => {
    if (current === h) current = null;
  };
}

/** Words for the Thread: its answer, or null when no Thread is on screen or the words aren't for it. */
export async function relayHandle(text: string): Promise<RelayAnswer | null> {
  const line = text.trim().slice(0, 300);
  if (!line || !current) return null;
  return current(line);
}
