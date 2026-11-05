import { useEffect, useState } from "react";
import { link } from "./nav.ts";
import { Panel } from "./ui.tsx";
import { isDone, readSetupStatus, readTicked, remaining, SETUP_LIST, stepParts, writeTicked, type SetupItem, type SetupItemId, type SetupState, type SetupStatus } from "./setupList.ts";

/**
 * Today's setup card (#164): the few things only Nikita can do, each with its link and steps, ticking itself off as
 * the site sees them done (api/_desk/setup.ts). It hides once everything is done, and while it's still asking.
 */

/** Asks api/foundry once per visit; null while asking or when it can't be reached (then the card stays hidden). */
export function useSetupStatus(): SetupStatus | null {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/foundry?setup")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: unknown) => live && setStatus(readSetupStatus(s)))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, []);
  return status;
}

export function SetupCard({ status }: { status: SetupStatus | null }) {
  const [ticked, setTicked] = useState<Set<SetupItemId>>(readTicked);
  const [open, setOpen] = useState<SetupItemId | "none" | null>(null);
  if (!status) return null;
  const left = remaining(status, ticked);
  if (!left.length) return null;
  const done = SETUP_LIST.length - left.length;
  const toggle = (id: SetupItemId) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
    writeTicked(next);
  };
  // The first one still to do opens by itself, so the next step is always in view.
  const shown = open ?? left[0]!.id;

  return (
    <Panel
      eyebrow="Setup"
      label="Setup: things only you can do"
      className="panel--setup"
      aside={
        <span className="setup__count" aria-label={`${done} of ${SETUP_LIST.length} done`}>
          <span className="setup__bar" aria-hidden="true">
            <b style={{ width: `${(done / SETUP_LIST.length) * 100}%` }} />
          </span>
          {done} of {SETUP_LIST.length} done
        </span>
      }
    >
      <p className="setup__lead">A few things only you can do, once. Each one ticks itself off when the site sees it done.</p>
      <ol className="setup">
        {SETUP_LIST.map((item) => {
          const state = status.items[item.id];
          const byHand = state === "unknown" && ticked.has(item.id);
          return (
            <SetupRow
              key={item.id}
              item={item}
              state={isDone(state, byHand) ? "done" : state}
              byHand={byHand}
              status={status}
              open={shown === item.id}
              onOpen={(o) => setOpen(o ? item.id : shown === item.id ? "none" : shown)}
              onTick={() => toggle(item.id)}
            />
          );
        })}
      </ol>
    </Panel>
  );
}

const STATE_WORDS: Record<SetupState, string> = { done: "Done", todo: "To do", unknown: "Can't check yet" };

function Tick({ state }: { state: SetupState }) {
  return (
    <span className={`setup__tick setup__tick--${state}`} aria-hidden="true">
      {state === "done" && (
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function SetupRow({
  item,
  state,
  byHand,
  status,
  open,
  onOpen,
  onTick,
}: {
  item: SetupItem;
  state: SetupState;
  byHand: boolean;
  status: SetupStatus;
  open: boolean;
  onOpen: (open: boolean) => void;
  onTick: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.paste ?? "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard: the line is selectable in the box to copy by hand.
    }
  };
  return (
    <li className={`setup__item setup__item--${state}`}>
      <details open={open} onToggle={(e) => (e.currentTarget.open !== open ? onOpen(e.currentTarget.open) : undefined)}>
        <summary>
          <Tick state={state} />
          <span className="setup__text">
            <span className="setup__title">{item.title}</span>
            <span className="setup__why">{item.why}</span>
          </span>
          <span className={`setup__state setup__state--${state}`}>{byHand ? "Ticked by you" : STATE_WORDS[state]}</span>
          <span className="setup__chev" aria-hidden="true" />
        </summary>
        <div className="setup__body">
          {item.id === "pings" && (
            <ul className="setup__parts" aria-label="The two halves">
              <li>
                <Tick state={status.pings.vercel} /> Keys in the Key Vault
              </li>
              <li>
                <Tick state={status.pings.actions} /> Secret in GitHub
                {status.pings.vercel === "done" && status.pings.actions !== "done" && <small> · seen within the hour, at the next ping check</small>}
              </li>
            </ul>
          )}
          <div className="setup__links">
            {item.links.map((l, i) =>
              l.route ? (
                <a key={l.href} className={`btn btn--sm ${i === 0 && state !== "done" ? "btn--go" : ""}`} href={l.href} onClick={link(l.route)}>
                  {l.label} →
                </a>
              ) : (
                <a key={l.href} className={`btn btn--sm ${i === 0 && state !== "done" ? "btn--go" : ""}`} href={l.href} target="_blank" rel="noreferrer">
                  {l.label} ↗
                </a>
              ),
            )}
          </div>
          <ol className="setup__steps">
            {item.steps.map((s, i) => (
              <li key={i}>
                {stepParts(s).map((p, k) => (p.kind === "bold" ? <b key={k}>{p.text}</b> : p.kind === "code" ? <code key={k}>{p.text}</code> : <span key={k}>{p.text}</span>))}
                {item.paste && i === 1 && (
                  <span className="setup__paste">
                    <code tabIndex={0}>{item.paste}</code>
                    <button type="button" className="btn btn--sm" onClick={copy}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="setup__foot">
            {item.ticks}
            {(state === "unknown" || byHand) && (
              <button type="button" className="btn btn--sm btn--quiet" onClick={onTick}>
                {byHand ? "Untick" : "I've done this"}
              </button>
            )}
          </p>
        </div>
      </details>
    </li>
  );
}

/**
 * The setup list as a Weave card on Today (the approved design's "A setup step"): the next thing only Nikita can do,
 * with its links, and its steps one tap away. The rest wait as small links underneath; each ticks itself off as the
 * site sees it done, or by hand where it can't check.
 */
export function SetupAct({ status, style }: { status: SetupStatus | null; style?: React.CSSProperties }) {
  const [ticked, setTicked] = useState<Set<SetupItemId>>(readTicked);
  const [pick, setPick] = useState<SetupItemId | null>(null);
  const [steps, setSteps] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!status) return null;
  const left = remaining(status, ticked);
  if (!left.length) return null;
  const item = left.find((i) => i.id === pick) ?? left[0]!;
  const state = status.items[item.id];
  const byHand = state === "unknown" && ticked.has(item.id);
  const done = SETUP_LIST.length - left.length;
  const tick = () => {
    const next = new Set(ticked);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    setTicked(next);
    writeTicked(next);
    setSteps(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.paste ?? "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard: the line is selectable in the box to copy by hand.
    }
  };
  return (
    <article className="wv-act wv-act--setup" data-room="boiler" style={style} aria-label="Setup: things only you can do">
      <div className="wv-act-top">
        <i className="wv-dot" />
        <span>A setup step</span>
        <time>
          {done} of {SETUP_LIST.length} done
        </time>
      </div>
      <div className="wv-act-body">
        <span className="wv-act-pf wv-act-can" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.4-.6-.6-2.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h3 className="wv-h3">{item.title}</h3>
          <p className="wv-act-p">{item.why}</p>
        </div>
      </div>
      {item.id === "pings" && (
        <ul className="wv-act-parts" aria-label="The two halves">
          <li className={`is-${status.pings.vercel}`}>Keys in the Key Vault</li>
          <li className={`is-${status.pings.actions}`}>Secret in GitHub</li>
        </ul>
      )}
      {steps && (
        <ol className="wv-act-steps">
          {item.steps.map((s, i) => (
            <li key={i}>
              <span>
                {stepParts(s).map((p, k) => (p.kind === "bold" ? <b key={k}>{p.text}</b> : p.kind === "code" ? <code key={k}>{p.text}</code> : <span key={k}>{p.text}</span>))}
              </span>
              {item.paste && i === 1 && (
                <span className="wv-act-paste">
                  <code tabIndex={0}>{item.paste}</code>
                  <button type="button" className="wv-btn is-sm" onClick={copy}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="wv-act-do">
        {!steps ? (
          <button type="button" className="wv-btn" onClick={() => setSteps(true)} aria-expanded={false}>
            Show me the steps
          </button>
        ) : (
          item.links.map((l, i) =>
            l.route ? (
              <a key={l.href} className={`wv-btn${i === 0 ? " is-pri" : ""}`} href={l.href} onClick={link(l.route)}>
                {l.label}
              </a>
            ) : (
              <a key={l.href} className={`wv-btn${i === 0 ? " is-pri" : ""}`} href={l.href} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            ),
          )
        )}
        {(state === "unknown" || byHand) && (
          <button type="button" className="wv-btn is-ghost" onClick={tick}>
            {byHand ? "Untick" : "I've done it"}
          </button>
        )}
      </div>
      {steps && <p className="wv-act-note">{item.ticks}</p>}
      {left.length > 1 && (
        <p className="wv-act-more">
          Also to do:{" "}
          {left
            .filter((i) => i.id !== item.id)
            .map((i, k, all) => (
              <span key={i.id}>
                <button type="button" className="wv-plain" onClick={() => (setPick(i.id), setSteps(false))}>
                  {i.title}
                </button>
                {k < all.length - 1 ? ", " : ""}
              </span>
            ))}
        </p>
      )}
    </article>
  );
}
