import type { DeskData } from "./deskData.ts";
import { RelayThread } from "./relay/RelayThread.tsx";

/**
 * Relay: the Thread (#615). Both lines live, one exchange at a time: Gmail (#263, #429) and texts from the MacBook's
 * hub (#535). Nothing on this page is made up, and nothing sends without a draft on screen and Nikita's yes.
 */
export function Relay({ now }: { data: DeskData; now: number; connected: boolean }) {
  return <RelayThread now={now} />;
}
