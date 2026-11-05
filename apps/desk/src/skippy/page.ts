import type { Link } from "../../../world/src/systems.ts";

/**
 * What the Desk page shows, as lines for Skippy (#341): his quick first take comes from these, so he never says he
 * has no data when the page has it. Built in the browser from what it already loaded (no extra reads, so the chat is
 * no slower), sent with the message as `page`, fenced and capped again by the function (api/_skippy/prompt.ts,
 * `readPage`) and never stored.
 *
 * Small on purpose, to keep the chat inside its monthly share: the Green's start/sit calls first (FantasyPros decides,
 * Sleeper beside it), then the Green's lineup, then the other live rooms in a line or two each: the Exchange's public
 * odds board (questions and probabilities, never Nikita's positions or any amount) and the Boiler Room's links that
 * aren't healthy. No money, messages, contacts or keys.
 *
 * The rooms' own lines come from the rooms (the Green's from rooms/green/skippy.ts, the Exchange's from
 * rooms/exchange/skippy.ts), plugged in by the Desk (skippy/rooms.ts, `addPageSource`): the kit reads no room's data.
 */

/** The function's own caps (api/_skippy/prompt.ts): at most this many characters and lines. */
export const PAGE_MAX = 1_600;
export const PAGE_LINES = 24;
export const LINE_MAX = 360;

/** The Boiler Room's links: how many are healthy, and the ones that aren't. */
export function boilerLines(links: readonly Link[]): string[] {
  const on = links.filter((l) => l.state !== "off");
  if (!on.length) return [];
  const bad = on.filter((l) => l.state !== "ok");
  return [`Systems: ${on.length - bad.length} of ${on.length} connected links healthy${bad.length ? `; ${bad.map((l) => `${l.label} ${l.state}`).join(", ")}` : ""}.`];
}

/** A room's lines, read for this block. `first` leads it wherever Nikita is (the Green's start/sit calls). */
export interface PageLines {
  room: string;
  first?: boolean;
  lines: string[];
}

export interface PageInput {
  /** The Desk page Nikita is on ("/green", "/exchange", "/"). */
  path: string;
  /** The rooms' lines, in the order they were plugged in (skippy/rooms.ts). */
  rooms: readonly PageLines[];
  links: readonly Link[];
}

/**
 * The page block: the leading rooms' rows first (the Green's start/sit calls), then the room of the page Nikita is on,
 * then the other live rooms and the Boiler Room's links, cut at the caps (whole lines only, so a cut drops the other
 * rooms before the Green's calls).
 */
export function pageContext(input: PageInput): string {
  const first = input.rooms.filter((r) => r.first).map((r) => r.lines);
  const rest: PageLines[] = [...input.rooms.filter((r) => !r.first), { room: "boiler", lines: boilerLines(input.links) }];
  const here = /^\/([^/?#]+)/.exec(input.path)?.[1];
  const order = [...first, ...rest.filter((r) => r.room === here).map((r) => r.lines), ...rest.filter((r) => r.room !== here).map((r) => r.lines)];
  const out: string[] = [`Nikita is on the Desk's ${input.path === "/" ? "Senate" : input.path.replace(/^\//, "").split("/")[0]} page.`];
  let size = out[0]!.length + 1;
  for (const l of order.flat()) {
    const line = l.replace(/\s+/g, " ").trim().slice(0, LINE_MAX);
    if (!line) continue;
    if (size + line.length + 1 > PAGE_MAX || out.length === PAGE_LINES) break;
    out.push(line);
    size += line.length + 1;
  }
  return out.length > 1 ? out.join("\n") : "";
}
