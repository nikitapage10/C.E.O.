/**
 * Today's small line icons (#363): one per kind of thing on the page, drawn on a 20-unit grid in the current colour so
 * each takes its room's tint from CSS. Strokes only, so they can draw themselves in (`pathLength` 1, see today.css).
 */

export type TodayIcon = "ask" | "decide" | "reply" | "mail" | "idea" | "setup" | "alert" | "shipped" | "clear" | "queue" | "upkeep" | "dawn" | "story" | "hour" | "moon" | "later" | "short" | "warm" | "rooms";

const P: Record<TodayIcon, string[]> = {
  // A speech bubble with a question mark: Rivet asks.
  ask: ["M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z", "M8.2 8a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.8.6-.8 1.2", "M10 12.6v.1"],
  // A path that forks: a decision.
  decide: ["M10 17.5V11", "M10 11 5 6", "M10 11l5-5", "M3.5 7.5V4.5h3", "M16.5 7.5V4.5h-3"],
  // Two bubbles: a reply owed.
  reply: ["M3 5h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H7l-3 2.5V12H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M15 8h2a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1v2.5L13 15h-3"],
  mail: ["M3 5.5h14v9H3z", "M3.5 6l6.5 5 6.5-5"],
  // A spark: ideas to pick.
  idea: ["M10 2.5v3", "M10 14.5v3", "M2.5 10h3", "M14.5 10h3", "M10 6.5c.6 2.2 1.3 2.9 3.5 3.5-2.2.6-2.9 1.3-3.5 3.5-.6-2.2-1.3-2.9-3.5-3.5 2.2-.6 2.9-1.3 3.5-3.5z"],
  // A spanner: setup only Nikita can do.
  setup: ["M12.8 3.2a3.8 3.8 0 0 0-4.6 5L3.5 12.9a1.6 1.6 0 0 0 2.3 2.3l4.7-4.7a3.8 3.8 0 0 0 5-4.6l-2.2 2.2-2.1-.4-.4-2.1z"],
  alert: ["M10 3 18 16.5H2z", "M10 8v4", "M10 14.2v.1"],
  // An arrow leaving a box: shipped.
  shipped: ["M4 11v5.5h12V11", "M10 3.5v9", "M6.5 7 10 3.5 13.5 7"],
  clear: ["M4.5 10.5 8.3 14 15.5 6"],
  // A loop with an arrowhead: the queue check.
  queue: ["M15.6 7.5A6 6 0 1 0 16 11", "M16.2 3.8v3.9h-3.9"],
  upkeep: ["M10 2.5v2.2", "M10 15.3v2.2", "M2.5 10h2.2", "M15.3 10h2.2", "M4.7 4.7l1.5 1.5", "M13.8 13.8l1.5 1.5", "M4.7 15.3l1.5-1.5", "M13.8 6.2l1.5-1.5", "M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"],
  // The sun on the horizon: the morning ideas.
  dawn: ["M2.5 14.5h15", "M5.5 14.5a4.5 4.5 0 0 1 9 0", "M10 5v2", "M4.2 8.2l1.4 1.4", "M15.8 8.2l-1.4 1.4"],
  // An open book: the day becomes a story.
  story: ["M10 5.5C8.3 4.3 5.8 4 3 4.5v10.5c2.8-.5 5.3-.2 7 1 1.7-1.2 4.2-1.5 7-1V4.5c-2.8-.5-5.3-.2-7 1z", "M10 5.5V16"],
  // An hourglass: Ilyr's next hour.
  hour: ["M5.5 3h9", "M5.5 17h9", "M6.5 3c0 4 7 4 7 7s-7 3-7 7", "M13.5 3c0 4-7 4-7 7s7 3 7 7"],
  moon: ["M14.5 13.5A6 6 0 0 1 7 5a6 6 0 1 0 7.5 8.5z"],
  later: ["M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M10 6.5V10l2.5 1.5"],
  short: ["M4 5h12", "M4 8.5h12", "M4 12h8", "M4 15.5h5"],
  warm: ["M10 2.8c2.6 3 4.6 5.3 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-1.5.6-2.7 1.5-3.8.3 1.3 1 2 1.8 2.3-.3-2.5.3-4.7 1.3-6.9z"],
  rooms: ["M3 3.5h6v6H3z", "M11 3.5h6v6h-6z", "M3 11.5h6v5H3z", "M11 11.5h6v5h-6z"],
};

/** One of Today's icons, decorative: whatever it marks says the same thing in words beside it. */
export function Icon({ name, className }: { name: TodayIcon; className?: string }) {
  return (
    <svg className={className ? `td-ic ${className}` : "td-ic"} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {P[name].map((d) => (
        <path key={d} d={d} pathLength={1} />
      ))}
    </svg>
  );
}
