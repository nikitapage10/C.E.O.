import { usePop } from "../Popovers.tsx";
import type { Explain } from "./explain.ts";
import { RISK_STATUS_LABEL, type RiskStatus } from "./model.ts";

/** Shared pieces of the Security and Compliance pages. */

/** A line from the threat model, with its `code` spans drawn as code. React escapes the rest. */
export function Rich({ text }: { text: string }) {
  const parts = text.split("`");
  return <>{parts.map((p, i) => (i % 2 === 1 ? <code key={i}>{p}</code> : p))}</>;
}

const RISK_TONE: Record<RiskStatus, string> = {
  covered: "ok",
  tracked: "ok",
  open: "slow",
  accepted: "off",
  "not-applicable": "off",
};

export function RiskPill({ status }: { status: RiskStatus }) {
  return (
    <span className={`pill pill--${RISK_TONE[status]} risk-pill risk-pill--${status}`}>
      <i aria-hidden="true" />
      {RISK_STATUS_LABEL[status]}
    </span>
  );
}

/** Where the threat model and the repo's security views live on GitHub (plain links, opened in a new tab). */
export const REPO_URL = "https://github.com/nikitapage10/C.E.O.";
export const DOC_URL = `${REPO_URL}/blob/main/docs/THREAT-MODEL.md`;

export function Out({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="sec-out" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

/**
 * The pop-over that explains an item on Security or Compliance (#90): what it is, what it connects to, why it
 * matters. Spread `anchor` on the item and render `card` beside it. An item whose click already does something (a
 * summary that opens its details) passes `pin: false`, and shows the same words inline once opened on a touch screen.
 */
export function useExplain(id: string, title: string, e: Explain, { kicker, pin }: { kicker?: string; pin?: boolean } = {}) {
  const pop = usePop(id, { pin });
  return {
    anchor: pop.anchor,
    open: pop.open,
    card: pop.card(
      <>
        <div className="conn-pop__top">
          <span className="conn-pop__name">{title}</span>
          {kicker && <span className="exp-pop__kicker">{kicker}</span>}
        </div>
        <ExplainFacts e={e} />
      </>,
      { className: "exp-pop" },
    ),
  };
}

function ExplainFacts({ e }: { e: Explain }) {
  return (
    <dl className="exp-facts">
      <div>
        <dt>What it is</dt>
        <dd>{e.what}</dd>
      </div>
      <div>
        <dt>Connects to</dt>
        <dd>{e.connects}</dd>
      </div>
      <div>
        <dt>Why it matters</dt>
        <dd>{e.why}</dd>
      </div>
    </dl>
  );
}

/** The same words inside an opened item, for touch screens, which have no hover to show the pop-over. */
export function ExplainInline({ e }: { e: Explain }) {
  return (
    <div className="exp-inline" aria-hidden="true">
      <ExplainFacts e={e} />
    </div>
  );
}
