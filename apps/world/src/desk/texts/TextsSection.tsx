import { useEffect, useMemo, useState } from "react";
import { formatWait } from "../deskData.ts";
import { useDictation, dictationSupported } from "../dictate.ts";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { startTexts, STALE_MS, textsLine, useTexts, type TextItem, type TextRequestView } from "./texts.ts";
import "./texts.css";

/**
 * Relay's line 2, texts (#535): the Texts panel on the Desk's Relay page.
 *
 * Signed out, counts and states only (the public RelayStatus). Signed in, from the Azure copy behind the passkey:
 * pairing a Mac, and the who's-waiting list the hub pushes (who, how long, Dialtone's gist, Blasto's draft; never a
 * message itself). Every word from it is wrapped in <Private>, so Hide masks it.
 *
 * Nothing sends from here by itself. Send writes one request the Mac picks up (single-use, signed, bound to the draft
 * on screen, 10 minutes); it needs this device's send unlock, one fresh passkey check good for 72 hours. A request the
 * Mac never took says "Not sent, Mac was offline", with Resend making a new one.
 */

export const INSTALL_LINE = "curl -fsSL https://ceo.nikita.page/relay/install.sh | bash";
const CHAIN = ["MacBook awake", "BlueBubbles", "The hub, paired", "Sort and draft", "Your tap"];

const hhmm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** What a request's state says on the row. */
export function requestWords(r: Pick<TextRequestView, "kind" | "state">): { text: string; resend: boolean; warn: boolean } | null {
  if (r.kind !== "send") {
    if (r.state === "waiting" || r.state === "taken") return { text: "On its way to the Mac…", resend: false, warn: false };
    if (r.state === "expired") return { text: "Not done, Mac was offline", resend: false, warn: true };
    return null;
  }
  switch (r.state) {
    case "waiting":
      return { text: "On its way to the Mac…", resend: false, warn: false };
    case "taken":
      return { text: "Sending…", resend: false, warn: false };
    case "sent":
      return { text: "Sent", resend: false, warn: false };
    case "expired":
      return { text: "Not sent, Mac was offline", resend: true, warn: true };
    case "failed":
      // A timeout can't tell us it didn't go. Resend is safe: the Mac refuses it if Messages shows the reply went.
      return { text: "Not confirmed: it may have sent. Check Messages before you resend", resend: true, warn: true };
    case "refused":
      return { text: "Not sent: the Mac refused this request (already answered, the draft changed, or it was too late)", resend: false, warn: true };
    default:
      return null;
  }
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="tx-copy">
      <code>{text}</code>
      <button
        type="button"
        className="fl-btn is-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1_600);
          });
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function Pairing({ now, unlocked }: { now: number; unlocked: boolean }) {
  const code = useTexts((s) => s.code);
  const busy = useTexts((s) => s.busy);
  const pairCode = useTexts((s) => s.pairCode);
  const unlock = useTexts((s) => s.unlock);
  const live = code && code.until > now ? code : null;
  return (
    <div className="tx-pair">
      <p className="fl-k">Pair a Mac</p>
      <ol>
        <li>Get the Mac ready: Messages signed in, BlueBubbles running with the local connection.</li>
        <li>
          On the Mac, paste this into Terminal: <CopyLine text={INSTALL_LINE} />
        </li>
        <li>
          When it asks, type this code:{" "}
          {live ? (
            <>
              <b className="tx-code fl-num">{live.code}</b> <small>good for {formatWait(live.until - now)} more, once</small>
            </>
          ) : unlocked ? (
            <button type="button" className="fl-btn" disabled={busy === "pair"} onClick={() => void pairCode()}>
              Show a pair code
            </button>
          ) : (
            // A paired Mac can push the list and poll for sends, so a code needs this device's send unlock first.
            <button type="button" className="fl-btn" disabled={busy === "unlock"} onClick={() => void unlock()}>
              Unlock with your passkey to show a code
            </button>
          )}
        </li>
      </ol>
    </div>
  );
}

function Row({ item, now, requests, unlocked }: { item: TextItem; now: number; requests: TextRequestView[]; unlocked: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(item.draft?.text ?? "");
  const [said, setSaid] = useState("");
  const draftAt = item.draft?.at ?? 0;
  // A new draft from Blasto replaces what's in the box (the send binds to it).
  useEffect(() => setText(item.draft?.text ?? ""), [item.draft?.at, item.draft?.text]);
  const ask = useTexts((s) => s.ask);
  const unlock = useTexts((s) => s.unlock);
  const busy = useTexts((s) => s.busy);
  const { listening, start, stop } = useDictation((finished, tail) => setSaid(`${finished} ${tail}`.trim()));
  const last = requests.filter((r) => r.thread === item.id).sort((a, b) => b.created - a.created)[0];
  const words = last ? requestWords(last) : null;
  const sending = last && last.kind === "send" && (last.state === "waiting" || last.state === "taken");
  const wait = now - item.since;
  const tag = item.group ? "group" : item.state === "later" ? "later" : item.sort === "sooner" ? "sooner" : null;
  const id = `tx-row-${item.id}`;
  return (
    <li className="tx-row" data-open={open || undefined} data-late={!item.group && wait > 24 * 3_600_000 ? "" : undefined}>
      <button type="button" className="tx-row-h" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="tx-who">
          <Private as="b">{item.name}</Private>
          <small>
            {item.channel}
            {tag && <em data-tag={tag}>{tag}</em>}
          </small>
        </span>
        <Private className="tx-gist">{item.group ? (item.summary?.text ?? "") : item.gist}</Private>
        <span className="tx-wait fl-num">{item.group ? (item.summary?.asked ? "asked you" : "") : formatWait(wait)}</span>
      </button>
      {open && (
        <div className="tx-row-x" id={id}>
          {item.group ? (
            <p className="tx-note">Groups are summarised, never drafted for. Reply in Messages.</p>
          ) : (
            <>
              <label className="fl-k" htmlFor={`${id}-t`}>
                {item.draft ? "Blasto's draft, in your voice · only you send it" : "Your reply"}
              </label>
              <textarea id={`${id}-t`} className="tx-draft" rows={3} maxLength={2_000} value={text} placeholder={item.draft ? "" : "Blasto is drafting… or write your own"} onChange={(e) => setText(e.target.value)} data-private="" />
              {said && (
                <p className="tx-said">
                  <span className="fl-k">You said</span> <Private>{said}</Private>
                </p>
              )}
              <div className="tx-do">
                {unlocked ? (
                  <button type="button" className="fl-btn is-go" disabled={!text.trim() || !!sending || busy !== null} onClick={() => void ask({ action: "send", thread: item.id, draftAt, text })}>
                    Send
                  </button>
                ) : (
                  <button type="button" className="fl-btn is-go" disabled={busy === "unlock"} onClick={() => void unlock()} title="One passkey check unlocks Send on this device for 72 hours">
                    Unlock sending
                  </button>
                )}
                <button type="button" className="fl-btn" disabled={busy !== null || item.state === "later"} onClick={() => void ask({ action: "later", thread: item.id })}>
                  Later
                </button>
                <button type="button" className="fl-btn" disabled={busy !== null} onClick={() => void ask({ action: "done", thread: item.id })}>
                  Done
                </button>
                {dictationSupported() && (
                  <button type="button" className="fl-btn" data-live={listening || undefined} onClick={() => (listening ? stop() : start())} title="Say roughly what you mean; Blasto puts it in your style">
                    {listening ? "Stop" : "Say it"}
                  </button>
                )}
                {said && !listening && (
                  <button
                    type="button"
                    className="fl-btn"
                    disabled={busy !== null}
                    onClick={() => {
                      void ask({ action: "restyle", thread: item.id, text: said }).then((ok) => ok && setSaid(""));
                    }}
                  >
                    Put it in my style
                  </button>
                )}
              </div>
            </>
          )}
          {words && (
            <p className="tx-req" data-warn={words.warn || undefined}>
              {words.text}
              {words.resend && last && (
                <button type="button" className="fl-btn is-sm" disabled={!unlocked || busy !== null} onClick={() => void ask({ action: "resend", rid: last.rid })}>
                  Resend
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** When the 72-hour unlock ends, with the day: "Thu 1:41 PM". */
const untilWords = (t: number) => `${new Date(t).toLocaleDateString(undefined, { weekday: "short" })} ${hhmm(t)}`;

export function TextsSection({ now }: { now: number }) {
  useEffect(() => startTexts(), []);
  const load = useTexts((s) => s.load);
  const status = useTexts((s) => s.status);
  const view = useTexts((s) => s.view);
  const error = useTexts((s) => s.error);
  const busy = useTexts((s) => s.busy);
  const unpair = useTexts((s) => s.unpair);
  const lock = useTexts((s) => s.lock);
  const auth = useDeskAuth((s) => s.auth.status);
  const signedIn = auth === "in";
  const live = !!status && status.hub !== "off" && status.hub !== "wiped";
  const stale = !!status && live && now - status.at > STALE_MS;
  const items = useMemo(() => [...(view?.items ?? [])].sort((a, b) => Number(a.group) - Number(b.group) || (a.state === "later" ? 1 : 0) - (b.state === "later" ? 1 : 0) || (a.sort === "sooner" ? -1 : 0) - (b.sort === "sooner" ? -1 : 0) || a.since - b.since), [view]);
  const unlocked = !!view?.unlockedUntil && view.unlockedUntil > now;
  const at = CHAIN.length - 1 - (live ? (status.hub === "listening" ? 0 : 2) : view?.paired ? 2 : 4);

  const h = !status
    ? "Reading the texts line…"
    : status.hub === "off"
      ? "Waiting on the MacBook."
      : status.hub === "wiped"
        ? "Wiped from the MacBook."
        : stale
          ? "The MacBook went quiet."
          : status.hub === "paused"
            ? "Paused on the MacBook."
            : status.owed === 0
              ? "Nobody is waiting on you."
              : status.owed === 1
                ? "One reply owed."
                : `${status.owed} replies owed.`;

  return (
    <section className="fl-below rl-texts tx" aria-label="Line 2, texts" data-live={live && !stale ? "" : undefined}>
      <div>
        <p className="fl-k">
          <span>Line 2</span> · iMessage and SMS
        </p>
        <h2 className="fl-h2">{h}</h2>
        <p className="rl-texts-p">
          {live
            ? `${textsLine(load, status, now)} · ${status.sooner} sooner · ${status.overdue} overdue · ${status.draftsReady} drafts ready · ${status.sentToday} sent today${status.streakDays ? ` · ${status.streakDays}-day streak` : ""}${stale ? ` · last heard ${formatWait(now - status.at)} ago` : ""}`
            : "Your texts stay on the Mac; the hub sends the Desk who's waiting and Blasto's drafts, and sends a reply only on your tap."}
        </p>
      </div>
      <ol className="rl-chain">
        {CHAIN.map((c, i) => (
          <li key={c} data-at={i <= at ? "" : undefined}>
            {c}
          </li>
        ))}
      </ol>

      {signedIn && view && (
        <div className="tx-panel">
          {error && <p className="tx-req" data-warn="">{error}</p>}
          {!view.paired ? (
            view.ready ? (
              <Pairing now={now} unlocked={unlocked} />
            ) : (
              <p className="tx-note">Texts aren't set up on this copy yet.</p>
            )
          ) : (
            <>
              {items.length ? (
                <ul className="tx-list" aria-label="Who's waiting on a text">
                  {items.map((i) => (
                    <Row key={i.id} item={i} now={now} requests={view.requests} unlocked={unlocked} />
                  ))}
                </ul>
              ) : (
                <p className="tx-note">{live ? "Nobody is waiting. New texts you owe land here, with Blasto's draft." : "Paired. The list fills once the hub reports."}</p>
              )}
              <footer className="tx-foot">
                <span>{unlocked ? `Sending unlocked on this device until ${untilWords(view.unlockedUntil!)}` : "Sending is locked on this device"}</span>
                {unlocked && (
                  <button type="button" className="fl-btn is-sm" onClick={() => void lock()}>
                    Lock
                  </button>
                )}
                <span className="rl-spend" title="This month's Claude spend for texts, against its own cap">
                  ${view.spend.usd.toFixed(2)} of ${view.spend.budget.toFixed(0)}
                </span>
                <button type="button" className="fl-btn is-sm" disabled={busy === "unpair"} onClick={() => void unpair()}>
                  Unpair
                </button>
              </footer>
            </>
          )}
        </div>
      )}
    </section>
  );
}
