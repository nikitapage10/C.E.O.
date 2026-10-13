import type { RoomId } from "@ceo/core";

/**
 * Which of the Kernel's PA notices reach the banner.
 *  - "lattice": true everywhere: real events, achievements Nikita earned, night and day changes.
 *  - "room": a room's own demo drills and the Kernel's demo status lines; heard only in that room (a notice with no
 *    room is nobody's, so it stays off the banner).
 */
export type NoticeScope = "room" | "lattice";

export interface Notice {
  room: RoomId | null;
  scope: NoticeScope;
}

/** Whether a notice shows on the banner when looking at `focus` (null = the Lattice-wide overview). */
export function noticeVisible(notice: Notice, focus: RoomId | null): boolean {
  if (notice.scope === "lattice") return true;
  return focus !== null && notice.room === focus;
}

/** Real events (anything not stamped "simulated") reach every view; the demo stays in its room. */
export const scopeOf = (event: { source: string }): NoticeScope => (event.source === "simulated" ? "room" : "lattice");
