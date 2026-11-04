import { relayHandle } from "../../apps/world/src/desk/relay/bridge.ts";

/**
 * Relay's voice intent handler (#642), the room's `voice` hook (#638, `@ceo/engine/voice`): what Nikita says on /relay
 * goes to the Thread on screen, which reads it as a command or through the intent layer (one Haiku call under the email
 * cap) and answers in the Messenger's voice. One listener: the Desk's room mic hears it, nothing else does. With no
 * Thread on screen it returns null and Static, the room's submind, answers as usual.
 *
 * The types are structural so this file stands on its own until the hook's types are on main.
 */

interface Utterance {
  text: string;
  room: string;
  via: "tap" | "hands-free";
}

interface Reply {
  say: string;
  actions?: readonly { label: string; run: () => unknown }[];
}

export async function intent(u: Utterance): Promise<Reply | null> {
  if (u.room !== "relay") return null;
  return relayHandle(u.text);
}
