import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { useSkippy } from "./chat.ts";
import { useTalk } from "./talk.ts";

/**
 * Skippy's button starts a call (#1120). Nikita, 2026-11-13: "pressing the Skippy button immediately initiates a
 * call, and if I want to do a text chat, I'll just end the call." So the button opens the chat and, signed in with no
 * call already up, starts Talk from the same tap (the mic prompt needs the tap). Ending the call leaves the chat
 * open to type in. Signed out, or where calls can't run, it is the chat as before.
 */
export function askSkippy(): void {
  useSkippy.getState().setOpen(true);
  if (useDeskAuth.getState().auth.status !== "in") return;
  const talk = useTalk.getState();
  if (talk.phase === "idle" && talk.ready !== false) void talk.start();
}
