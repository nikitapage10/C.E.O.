import type { RoomIntent } from "@ceo/engine/voice";
import { relayHandle } from "./data/bridge.ts";

/**
 * Relay's voice intent handler (#642), the room's `voice` hook (#638, @ceo/engine/voice, docs/ROOMS.md): what Nikita
 * says on /relay through the Desk's room mic or hands-free goes to the Thread on screen, which reads it as a command
 * or through the intent layer (one Haiku call under the email cap, api/_email/intent.ts) and answers in the
 * Messenger's voice. One listener: the room mic hears it, nothing else does. With no Thread on screen, or words it
 * can't use, it returns null and Static, the room's submind, answers as usual.
 */
export const intent: RoomIntent = async (u) => (u.room === "relay" ? relayHandle(u.text) : null);
