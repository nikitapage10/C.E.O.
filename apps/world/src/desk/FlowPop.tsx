import type { LinkState } from "../systems.ts";
import { usePop } from "./Popovers.tsx";

/**
 * The pieces the Systems page's system diagrams share (issue #94): each part and wire explains itself in a pop-over
 * at the mouse (beside it for keyboard focus and taps), saying what it is, its live reading, and how it connects.
 * Needs a PopScope around the diagram.
 */

const STATE_TONE: Record<LinkState, string> = {
  ok: "var(--mint)",
  slow: "var(--amber)",
  down: "var(--rose)",
  off: "var(--faint)",
};

/** Props for an SVG part or wire that explains itself, and its card. */
export function useFlowPop(id: string, state: LinkState) {
  const pop = usePop(id, { follow: true });
  const props = {
    ...pop.anchor,
    tabIndex: 0,
    role: "button",
    onKeyDown: (e: React.KeyboardEvent<Element>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pop.toggle();
      }
    },
  };
  const card = (children: React.ReactNode) => pop.card(children, { className: `flow-pop flow-pop--${state}`, style: { "--tone": STATE_TONE[state] } as React.CSSProperties });
  return { props, open: pop.open, card };
}

export function StatePill({ state, text }: { state: LinkState; text: string }) {
  return (
    <span className={`pill pill--${state}`}>
      <i aria-hidden="true" />
      {text}
    </span>
  );
}

/** How a part connects: what feeds it and what it feeds, by name. */
export function FlowTies({ from, to }: { from: string[]; to: string[] }) {
  if (!from.length && !to.length) return null;
  return (
    <dl className="conn-pop__facts flow-pop__ties">
      {from.length > 0 && (
        <div>
          <dt>Fed by</dt>
          <dd>{from.join(", ")}</dd>
        </div>
      )}
      {to.length > 0 && (
        <div>
          <dt>Feeds</dt>
          <dd>{to.join(", ")}</dd>
        </div>
      )}
    </dl>
  );
}
