import { RISK_STATUS_LABEL, type RiskStatus } from "./model.ts";

/** Shared pieces of the Security and Compliance pages. */

/** A line from the threat model, with its `code` spans drawn as code. React escapes the rest. */
export function Rich({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <code key={i}>{p}</code> : p))}
    </>
  );
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
