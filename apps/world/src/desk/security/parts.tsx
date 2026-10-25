import type { Explain } from "./explain.ts";

/** Shared pieces of the Security and Compliance pages. */

/** A line from the threat model, with its `code` spans drawn as code. React escapes the rest. */
export function Rich({ text }: { text: string }) {
  const parts = text.split("`");
  return <>{parts.map((p, i) => (i % 2 === 1 ? <code key={i}>{p}</code> : p))}</>;
}

/** Where the threat model and the repo's security views live on GitHub (plain links, opened in a new tab). */
export const REPO_URL = "https://github.com/nikitapage10/C.E.O.";
export const DOC_URL = `${REPO_URL}/blob/main/docs/THREAT-MODEL.md`;

export function Out({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="sx-out" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

/** What an item is, what it connects to, why it matters (#90): shown when its line is opened. */
export function Facts({ e }: { e: Explain }) {
  return (
    <dl className="sx-facts">
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

/** A cell of the threat model split into its parts, as small chips. */
export function Chips({ items }: { items: string[] }) {
  return (
    <ul className="sx-chips">
      {items.map((p) => (
        <li key={p}>
          <Rich text={p} />
        </li>
      ))}
    </ul>
  );
}
