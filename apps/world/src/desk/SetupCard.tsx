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
                <Tick state={status.pings.vercel} /> Keys in Vercel
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
