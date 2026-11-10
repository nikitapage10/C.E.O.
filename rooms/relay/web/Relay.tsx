import type { DeskData } from "@ceo/desk/deskData.ts";
import { RelayThread } from "./RelayThread.tsx";
import { CodexDeck } from "./CodexDeck.tsx";
import { useEmail } from "../data/email.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";

/**
 * Relay: the Thread (#615). Both lines live, one exchange at a time: Gmail (#263, #429) and texts from the MacBook's
 * hub (#535). Nothing on this page is made up, and nothing sends without a draft on screen and Nikita's yes. The codex
 * under the Thread sits on the mast's deck (CodexDeck.tsx, #977).
 */
export function Relay({ now }: { data: DeskData; now: number; connected: boolean }) {
  useRoomReady(useEmail((s) => s.load) !== "idle");
  return (
    <>
      <RelayThread now={now} />
      <CodexDeck />
    </>
  );
}
