import type { RoomIntent } from "@ceo/engine/voice";
import { act, focusNow, isQuestion } from "./data/desk.ts";

/**
 * The Studio's voice intent (#1227), the room's `voice` hook (@ceo/engine/voice, docs/ROOMS.md): what Nikita says on
 * /studio with Space held ("the poster's too small", "cut the second joke") is kept as a note for the Director on the
 * episode and stage on screen, and the Director's thread picks it up. A question goes on to the Director, the room's
 * submind, which answers as usual.
 */
export const intent: RoomIntent = async (u) => {
  if (u.room !== "studio" || isQuestion(u.text)) return null;
  const { episode, stage } = focusNow();
  const why = await act({ action: "note", text: u.text, via: "said", ...(episode ? { episode } : {}), ...(stage ? { stage } : {}) });
  return { say: why ?? "Noted. The Director has it." };
};
