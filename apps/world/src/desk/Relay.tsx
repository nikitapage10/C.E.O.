import type { DeskData } from "./deskData.ts";
import { RelayFilter } from "./relay/RelayFilter.tsx";

/**
 * Relay: the filter, with both lines live. Line 1 is Gmail (#263, #429); line 2 is texts from the MacBook's hub
 * (#535, desk/texts), its Texts panel under the stage. The page's earlier sample outbox (and its pretend voice note)
 * is gone with the hub going real: nothing on this page is made up.
 */
export function Relay({ now }: { data: DeskData; now: number; connected: boolean }) {
  return <RelayFilter now={now} />;
}
