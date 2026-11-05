import type { RiteKind } from "./rite.ts";

/** The docket's three kinds of business, each with its own mark (#740): a duty's lines, a decision's fork, a repair's wrench. */
const PATH: Record<RiteKind, string> = {
  duty: "M3 4h10M3 8h10M3 12h6",
  decision: "M8 14V8M8 8L3 3M8 8l5-5",
  repair: "M10.5 2.5a3 3 0 0 0-3.6 3.9L2.5 10.8l2.7 2.7 4.4-4.4a3 3 0 0 0 3.9-3.6l-1.9 1.9-1.8-.4-.4-1.8z",
};

export function KindIcon({ kind }: { kind: RiteKind }) {
  return (
    <svg className="rt-kind-ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATH[kind]} stroke="currentColor" strokeWidth={kind === "repair" ? 1.4 : 1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
