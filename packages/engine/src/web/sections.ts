/**
 * A room's sub-menu (#617): the sections a room's page splits into, each with its own address under the room's, so
 * it can be linked to and reloaded (the Boiler Room's Map, Controls, Security and Compliance, #82). A room declares
 * them in its `rooms/<id>/nav.ts` as `sections` (the manifest takes them in with `...nav`); the Desk names the tab
 * from them and the room's page draws them with `<RoomSections>`. The first section is the room's front page, at the
 * room's own path. Pure: no routes, no React, so the shell and tests can read it.
 */

export interface RoomSection {
  /** Its id, unique in the room (e.g. "controls"). */
  id: string;
  /** What the sub-menu calls it. */
  label: string;
  /** Its address: the room's path for the first, `<room path>/<id>` for the rest. */
  path: string;
  /** The line shown when it is pointed at. */
  hint: string;
}

/** The section a path opens: the one whose address is the path's second part, or the first (the room's front page). */
export function sectionOf<S extends RoomSection>(sections: readonly S[], pathname: string): S {
  const sub = pathname.replace(/\/+$/, "").split("/")[2];
  return (sub && sections.slice(1).find((s) => s.path.split("/")[2] === sub)) || sections[0]!;
}

/** The browser tab's title for a room with sections: the room's on its front page, else the section's then the room's. */
export function sectionTitle(room: string, sections: readonly RoomSection[], pathname: string, site = "C.E.O."): string {
  const s = sectionOf(sections, pathname);
  return s === sections[0] ? `${room} · ${site}` : `${s.label} · ${room} · ${site}`;
}
