import { useEffect, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { emailLine, startEmail, takeGmailReturn, useEmail, type EmailItem, type EmailStatus } from "./email.ts";
import "./email.css";

/**
 * The Relay page's Email section (#263): the mail Dialtone sorted as needing Nikita, each with its one-line summary,
 * the suggested step, Blasto's advice and a draft to copy; then FYI, folded. Private: the list is served only to the
 * passkey session, and every subject, sender, summary, advice and draft is wrapped in <Private> for Hide mode. Every
 * word in it came from someone's email or a model reading it, so it is drawn as text only, never as HTML or a link.
 * Nothing is ever sent, archived or deleted from here: the agent's Gmail access is read-only.
 */

const RETURN_TEXT: Record<string, string> = {
  connected: "Gmail is connected. Dialtone catches up on unread mail from the last two days, then watches new mail.",
  cancelled: "Connect Gmail was cancelled at Google. Nothing was connected.",
  refused: "That Connect Gmail link didn't match this session. Try again from here.",
  failed: "Google didn't hand over access. Try Connect Gmail again.",
};

const ago = (at: number, now: number) => {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

function gmailHref(id: string) {
  return `https://mail.google.com/mail/u/0/#inbox/${id}`;
}

function CopyDraft({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="wv-btn is-sm"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? "Copied" : "Copy draft"}
    </button>
  );
}

function NeedsYou({ item, now }: { item: EmailItem; now: number }) {
  const done = useEmail((s) => s.done);
  return (
    <li className="em-item">
      <div className="em-head">
        <b className="em-from">
          <Private>{item.from}</Private>
        </b>
        <time>{ago(item.at, now)}</time>
      </div>
      <p className="em-subject">
        <Private>{item.subject}</Private>
      </p>
      {item.summary && (
        <p className="em-summary">
          <Private>{item.summary}</Private>
        </p>
      )}
      {item.action && <p className="em-action">{<Private>{item.action}</Private>}</p>}
      {item.advice && (
        <div className="em-advice">
          <span className="em-label">Blasto's advice</span>
          <p>
            <Private>{item.advice}</Private>
          </p>
        </div>
      )}
      {item.draft && (
        <div className="em-draft">
          <span className="em-label">A draft, to send yourself</span>
          <Private block as="p">
            {item.draft}
          </Private>
        </div>
      )}
      {item.kind === "unsorted" && <p className="em-note">Came in while the agent was paused: not read by a model.</p>}
      <div className="em-do">
        {item.draft && <CopyDraft text={item.draft} />}
        <a className="wv-btn is-sm" href={gmailHref(item.id)} target="_blank" rel="noopener noreferrer">
          Open in Gmail
        </a>
        <button type="button" className="wv-btn is-sm" onClick={() => void done(item.id)}>
          Done
        </button>
      </div>
    </li>
  );
}

function StateLine({ status, now }: { status: EmailStatus; now: number }) {
  if (status.agent === "paused") return <p className="em-state is-warn">Email agent paused: monthly cap reached. New mail is still counted ({status.unsorted} so far) and waits for next month.</p>;
  if (status.gmail === "refused") return <p className="em-state is-bad">Google stopped accepting the connection. Connect Gmail again to carry on.</p>;
  if (status.agent === "error") return <p className="em-state is-bad">The last check didn't go through. Dialtone tries again every minute.</p>;
  return (
    <p className="em-state">
      Dialtone checks every minute{status.lastCheck ? `, last ${ago(status.lastCheck, now)}` : ""}. {status.newToday} new today, {status.noise} of them noise.
    </p>
  );
}

export function EmailSection({ now }: { now: number }) {
  const load = useEmail((s) => s.load);
  const status = useEmail((s) => s.status);
  const view = useEmail((s) => s.view);
  const busy = useEmail((s) => s.busy);
  const error = useEmail((s) => s.error);
  const privateFail = useEmail((s) => s.privateFail);
  const connect = useEmail((s) => s.connect);
  const disconnect = useEmail((s) => s.disconnect);
  const auth = useDeskAuth((s) => s.auth.status);
  const signIn = useDeskAuth((s) => s.signIn);
  const [back] = useState(() => takeGmailReturn());

  useEffect(() => startEmail(), []);
  useEffect(() => {
    if (back) void useEmail.getState().refresh();
  }, [back]);

  const items = view?.items ?? [];
  const needs = items.filter((i) => !i.done && (i.kind === "needs-you" || i.kind === "unsorted"));
  const fyi = items.filter((i) => !i.done && i.kind === "fyi");
  const connected = status?.gmail === "connected";

  return (
    <section className="em" aria-label="Email" data-room="relay">
      <header className="em-top">
        <div>
          <p className="wv-eyb" style={{ color: "var(--rc-relay)" }}>
            Email
          </p>
          <h2 className="em-title">{emailLine(load, status)}</h2>
        </div>
        {view && (
          <span className="em-spend" title="This month's Claude spend for the email agent, against its own cap">
            ${view.spend.usd.toFixed(2)} of ${view.spend.budget.toFixed(0)}
          </span>
        )}
      </header>

      {back && <p className={`em-state${back === "connected" ? "" : " is-warn"}`}>{RETURN_TEXT[back]}</p>}
      {error && <p className="em-state is-bad">{error}</p>}

      {load === "off" ? (
        <p className="em-state">The email agent runs on the Azure copy, where its keys are. Open the Desk there to connect Gmail and see your mail.</p>
      ) : auth !== "in" ? (
        <div className="em-gate">
          <p className="em-state">Your mail shows here only behind your passkey.{status ? ` ${status.needsYou} need you, ${status.fyi} FYI.` : ""}</p>
          <button type="button" className="wv-btn is-pri" onClick={() => void signIn()}>
            Sign in
          </button>
        </div>
      ) : !view ? (
        <p className={`em-state${privateFail ? " is-warn" : ""}`}>{privateFail ? `Couldn't read your mail just now (${privateFail}). Trying again at the next check.` : "Reading…"}</p>
      ) : !connected ? (
        <div className="em-gate">
          <p className="em-state">
            Connect Gmail and Dialtone reads each new inbox mail once (read-only), sorts it, and Blasto drafts advice for the ones that need you. Nothing is ever sent, archived or deleted.
          </p>
          <button type="button" className="wv-btn is-pri" disabled={!view.canConnect || busy} onClick={() => void connect()} title={view.canConnect ? "Opens Google's consent page" : "Waiting for the Gmail keys on Azure (docs/GMAIL.md)"}>
            {busy ? "Opening Google…" : status?.gmail === "refused" ? "Reconnect Gmail" : "Connect Gmail"}
          </button>
          {!view.canConnect && <p className="em-note">Waiting for the Gmail keys on the Azure copy.</p>}
        </div>
      ) : (
        <>
          {status && <StateLine status={status} now={now} />}
          {needs.length ? (
            <ul className="em-list">
              {needs.map((i) => (
                <NeedsYou key={i.id} item={i} now={now} />
              ))}
            </ul>
          ) : (
            <p className="em-empty">Nothing needs you right now. Dialtone watches mail that arrives after you connect, plus unread mail from the two days before.</p>
          )}
          <p className="em-note">Money and legal mail is skipped unless it's urgent{status?.skipped ? ` (${status.skipped} today)` : ""}.</p>
          {fyi.length > 0 && (
            <details className="em-fyi">
              <summary>FYI · {fyi.length}</summary>
              <ul>
                {fyi.map((i) => (
                  <li key={i.id}>
                    <b>
                      <Private>{i.from}</Private>
                    </b>
                    <span>
                      <Private>{i.summary || i.subject}</Private>
                    </span>
                    <time>{ago(i.at, now)}</time>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="em-foot">
            <span>Read-only Gmail access. Summaries and drafts are kept a week, sealed.</span>
            <button type="button" className="wv-btn is-sm" disabled={busy} onClick={() => void disconnect()}>
              Disconnect Gmail
            </button>
          </div>
        </>
      )}
    </section>
  );
}
