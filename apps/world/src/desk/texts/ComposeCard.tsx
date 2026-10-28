import { useEffect, useId, useState } from "react";
import { Private } from "../Private.tsx";
import { sendWords, useCompose } from "./compose.ts";
import { startTexts, useTexts } from "./texts.ts";
import "./compose.css";

/**
 * A text Skippy is having Blasto write (#536), in his chat: who it goes to (the contact's name, the last 4 digits of
 * the number or a masked address, the channel) and the full text, with Send, Edit and Cancel. An edit refreshes the
 * card and asks again. Send is the texts line's own send request (this device's passkey unlock, single use, 10
 * minutes, bound to this card and this text); nothing goes without a tap here, or, on a call, Nikita saying "send"
 * after Skippy read him this very text. Every word of it is wrapped in <Private>, so Hide masks it.
 */
export function ComposeCard({ id }: { id: string }) {
  const c = useCompose((s) => s.items[id]);
  const view = useTexts((s) => s.view);
  const busy = useTexts((s) => s.busy);
  const unlock = useTexts((s) => s.unlock);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [edited, setEdited] = useState(false);
  const boxId = useId();
  useEffect(() => startTexts(), []);
  if (!c) return null;
  const card = view?.cards.find((x) => x.id === c.card);
  const req = c.rid ? view?.requests.find((r) => r.rid === c.rid) : undefined;
  const unlocked = !!view?.unlockedUntil && view.unlockedUntil > Date.now();
  const failed = sendWords(req);
  const store = useCompose.getState();

  if (c.phase === "cancelled") return <p className="txc txc--quiet">Dropped. Nothing was sent.</p>;
  if (c.phase === "asking" || c.phase === "drafting")
    return (
      <div className="txc" aria-busy="true">
        <p className="txc__k">New text · only you send it</p>
        <p className="txc__wait">
          Blasto is writing it for <Private>{c.who}</Private>…
        </p>
      </div>
    );
  if (c.phase === "error" || c.phase === "none" || c.phase === "off")
    return (
      <div className="txc txc--quiet">
        <p className="txc__k">New text</p>
        <p>
          {c.phase === "none" ? (
            <>
              No contact called “<Private>{c.who}</Private>” on the Mac. Ask again with the name as your contacts have it.
            </>
          ) : c.phase === "off" ? (
            "Relay keeps that one from Blasto (money, legal, a code or the skip list). Text it yourself."
          ) : (
            c.note || "That didn't work."
          )}
        </p>
      </div>
    );
  if (c.phase === "choices")
    return (
      <div className="txc">
        <p className="txc__k">New text · which one?</p>
        <p>
          “<Private>{c.who}</Private>” fits more than one contact. Pick who it goes to:
        </p>
        <div className="txc__choices">
          {(card?.choices ?? []).map((x) => (
            <button key={x.pick} type="button" onClick={() => void store.pick(c.key, x.pick)}>
              <Private as="b">{x.name}</Private> <small>{x.mask} · {x.channel}</small>
            </button>
          ))}
        </div>
      </div>
    );

  const canSend = c.phase === "ready" && !editing && !!c.text.trim();
  return (
    <div className="txc" data-phase={c.phase}>
      <p className="txc__k">New text · only you send it</p>
      <dl className="txc__to">
        <dt>To</dt>
        <dd>
          <Private as="b">{card?.name ?? c.who}</Private> <small className="fl-num">{card?.mask ?? ""}</small> <small>{card?.channel ?? ""}</small>
        </dd>
      </dl>
      {editing ? (
        <>
          <label className="skp-sr" htmlFor={boxId}>
            The text
          </label>
          <textarea id={boxId} rows={3} maxLength={2_000} value={draft} onChange={(e) => setDraft(e.target.value)} data-private="" autoFocus />
        </>
      ) : (
        <Private as="p" className="txc__text">
          {c.text}
        </Private>
      )}
      {edited && c.phase === "ready" && !editing && <p className="txc__note">Edited. Check the card again before you send.</p>}
      {c.via === "talk" && c.phase === "ready" && !editing && <p className="txc__note">Say “send”, or tap Send.</p>}
      <div className="txc__do">
        {editing ? (
          <>
            <button
              type="button"
              className="txc__go"
              disabled={!draft.trim()}
              onClick={() => {
                store.edit(c.key, draft);
                setEditing(false);
                setEdited(true);
              }}
            >
              Done editing
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Keep it as it was
            </button>
          </>
        ) : c.phase === "ready" || c.phase === "unsent" ? (
          <>
            {c.phase === "ready" &&
              (unlocked ? (
                <button type="button" className="txc__go" disabled={!canSend} onClick={() => void store.send(c.key, { tapped: true })}>
                  Send
                </button>
              ) : (
                <button type="button" className="txc__go" disabled={busy === "unlock"} onClick={() => void unlock()} title="One passkey check unlocks Send on this device for 72 hours">
                  Unlock sending
                </button>
              ))}
            {failed?.resend && (
              <button type="button" disabled={!unlocked} onClick={() => void store.resend(c.key)}>
                Resend
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDraft(c.text);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button type="button" onClick={() => void store.cancel(c.key)}>
              Cancel
            </button>
          </>
        ) : null}
      </div>
      {c.phase === "sending" && <p className="txc__note">On its way to the Mac…</p>}
      {c.phase === "sent" && <p className="txc__note txc__note--ok">Sent.</p>}
      {failed && <p className="txc__note txc__note--warn">{failed.text}</p>}
      {c.note && c.phase === "ready" && <p className="txc__note txc__note--warn">{c.note}</p>}
    </div>
  );
}
