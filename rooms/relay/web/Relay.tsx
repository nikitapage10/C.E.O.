import type { DeskData } from "@ceo/desk/deskData.ts";
import { RelayThread } from "./RelayThread.tsx";
import { CodexDeck } from "./CodexDeck.tsx";
import { useEmail } from "../data/email.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { useScreenContext } from "@ceo/engine/web/screen.ts";

/**
 * Relay: the Thread (#615). Both lines live, one exchange at a time: Gmail (#263, #429) and texts from the MacBook's
 * hub (#535). Nothing on this page is made up, and nothing sends without a draft on screen and Nikita's yes. The codex
 * under the Thread sits on the mast's deck (CodexDeck.tsx, #977).
 */
export function Relay({ now }: { data: DeskData; now: number; connected: boolean }) {
  const load = useEmail((s) => s.load);
  useRoomReady(load !== "idle");
  // What Nikita is looking at (#1027): the counts and states only, never a message's words, a sender or a contact.
  const status = useEmail((s) => s.status);
  useScreenContext({
    room: "relay",
    tab: "The Thread",
    stage: load,
    fields: status ? { gmail: status.gmail, agent: status.agent, needsYou: status.needsYou, fyi: status.fyi, noiseToday: status.noise, newToday: status.newToday } : {},
  });
  return (
    <>
      <RelayThread now={now} />
      <CodexDeck />
    </>
  );
}
