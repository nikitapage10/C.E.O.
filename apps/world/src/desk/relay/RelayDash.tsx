import { useEffect, useRef } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { ago, gmailHref, NeedsYou } from "../email/EmailSection.tsx";
import { useEmail, type EmailItem, type EmailStatus } from "../email/email.ts";

/**
 * Relay's dashboard (#375): a click on Need you or FYI opens it over the page, without leaving it. Signed in, it is the
 * private list (the same mail and the same actions as the Email section below, every word in <Private>); signed out,
 * it carries the two counts and a Sign in, and nothing from any mail. A native modal <dialog>: Escape, the close
 * button or a click outside the card closes it, and focus goes back where it was.
 */

export type DashTab = "needs" | "fyi";

/** The open mail of one kind, from the private list (empty when signed out). */
export const itemsOf = (items: EmailItem[] | undefined, kind: DashTab): EmailItem[] => (items ?? []).filter((i) => !i.done && (kind === "needs" ? i.kind === "needs-you" || i.kind === "unsorted" : i.kind === "fyi"));

export function RelayDash({ tab, status, now, onTab, onClose }: { tab: DashTab; status: EmailStatus; now: number; onTab: (t: DashTab) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const auth = useDeskAuth((s) => s.auth.status);
  const signIn = useDeskAuth((s) => s.signIn);
  const view = useEmail((s) => s.view);
  const privateFail = useEmail((s) => s.privateFail);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    const closed = () => onClose();
    d.addEventListener("close", closed);
    return () => d.removeEventListener("close", closed);
  }, [onClose]);

  const needs = itemsOf(view?.items, "needs");
  const fyi = itemsOf(view?.items, "fyi");
  const tabs: { k: DashTab; label: string; n: number }[] = [
    { k: "needs", label: "Need you", n: view ? needs.length : status.needsYou },
    { k: "fyi", label: "FYI", n: view ? fyi.length : status.fyi },
  ];

  return (
    <dialog
      ref={ref}
      className="rl-dash"
      aria-labelledby="rl-dash-h"
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="rl-dash-card">
        <header className="rl-dash-top">
          <div>
            <p className="wv-eyb" style={{ color: "var(--rc-relay)" }}>
              Relay · what's waiting
            </p>
            <h2 id="rl-dash-h">{tab === "needs" ? (tabs[0]!.n === 1 ? "1 email needs you" : `${tabs[0]!.n} emails need you`) : `${tabs[1]!.n} for your information`}</h2>
          </div>
          <button type="button" className="rl-dash-x" onClick={() => ref.current?.close()} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="rl-dash-tabs" role="tablist" aria-label="Which mail">
          {tabs.map((t) => (
            <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} className="rl-dash-tab" data-k={t.k} onClick={() => onTab(t.k)}>
              {t.label}
              <b>{t.n}</b>
            </button>
          ))}
        </div>

        <div className="rl-dash-body" role="tabpanel">
          {auth !== "in" ? (
            <div className="rl-dash-gate">
              <p>
                {status.needsYou} need you and {status.fyi} are FYI. The mail itself shows only behind your passkey.
              </p>
              <button type="button" className="wv-btn is-pri" onClick={() => void signIn()}>
                Sign in
              </button>
            </div>
          ) : !view ? (
            <p className={`em-state${privateFail ? " is-warn" : ""}`}>{privateFail ? `Couldn't read your mail just now (${privateFail}). Trying again at the next check.` : "Reading…"}</p>
          ) : tab === "needs" ? (
            needs.length ? (
              <ul className="em-list rl-dash-grid">
                {needs.map((i, n) => (
                  <NeedsYou key={i.id} item={i} now={now} index={n} />
                ))}
              </ul>
            ) : (
              <p className="em-empty">Nothing needs you right now.</p>
            )
          ) : fyi.length ? (
            <ul className="rl-dash-fyi">
              {fyi.map((i, n) => (
                <li key={i.id} style={{ "--i": Math.min(n, 10) } as React.CSSProperties}>
                  <div>
                    <Private as="b">{i.from}</Private>
                    <Private as="p" className="rl-dash-fyi-s">
                      {i.subject}
                    </Private>
                    {i.summary && (
                      <Private as="p" className="rl-dash-fyi-m">
                        {i.summary}
                      </Private>
                    )}
                  </div>
                  <span className="rl-dash-fyi-r">
                    <time>{ago(i.at, now)}</time>
                    <a className="wv-btn is-sm" href={gmailHref(i.id)} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="em-empty">No FYI mail right now.</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
