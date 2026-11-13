import { useEffect, useRef, useState } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import { stripTags } from "../hologram/tags.ts";
import { byDay, dayLabel, loadConversation, loadHistory, spanLabel, timeLabel, viaLabel, type ChatConversation, type ChatSummary, type Load } from "./callHistory.ts";

/**
 * Call history (#1160), its own download: opened from the chat's header, it takes the dialogue's place. The list of
 * the last 30 days' calls and chats, newest first, and one read back when tapped. Behind the passkey; read only.
 */

const WHY: Record<string, string> = {
  "signed-out": "Sign in to see past chats.",
  gone: "That one has gone past its 30 days.",
  failed: "The history won't open right now.",
};

export default function HistoryPanel({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Load<ChatSummary[]> | null>(null);
  const [open, setOpen] = useState<ChatSummary | null>(null);
  const [conv, setConv] = useState<Load<ChatConversation> | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const lastTapped = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void loadHistory().then((got) => live && setList(got));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setConv(null);
    void loadConversation(open.id).then((got) => live && setConv(got));
    back.current?.focus();
    return () => {
      live = false;
    };
  }, [open]);

  // Back on the list, focus returns to the conversation that was opened.
  useEffect(() => {
    if (open || !lastTapped.current) return;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-conv="${CSS.escape(lastTapped.current)}"]`)?.focus();
  }, [open]);

  const now = Date.now();

  if (open) {
    return (
      <section className="skp-hist" aria-label="A past conversation">
        <header className="skp-hist__head">
          <button type="button" className="skp-hist__back" ref={back} onClick={() => setOpen(null)}>
            <span aria-hidden="true">‹</span> All chats
          </button>
          <p className="skp-hist__meta">
            {viaLabel(open)} · {dayLabel(open.at, now)} {timeLabel(open.at)}
          </p>
        </header>
        <div className="skp-hist__body">
          {!conv && <p className="skp-hist__muted">Reading it back…</p>}
          {conv && !conv.ok && <p className="skp-hist__muted">{WHY[conv.why]}</p>}
          {conv?.ok && (
            <ol className="skp-hist__read" aria-label="What was said">
              {conv.value.lines.map((l, i) => (
                <li key={`${l.at}-${i}`} className="skp-hist__pair">
                  {l.q && (
                    <div className="skp-turn skp-turn--nikita">
                      <span className="skp-sr">You:</span>
                      <p>
                        <Private>{l.q}</Private>
                      </p>
                    </div>
                  )}
                  {l.a && (
                    <div className="skp-turn skp-turn--skippy">
                      <span className="skp-sr">Skippy:</span>
                      <p>
                        <Private>{stripTags(l.a)}</Private>
                      </p>
                    </div>
                  )}
                  <time className="skp-hist__time" dateTime={l.at}>
                    {timeLabel(l.at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="skp-hist" aria-label="Call history">
      <header className="skp-hist__head">
        <h3>Past chats</h3>
        <span className="skp-hist__meta">last 30 days</span>
        <button type="button" className="skp-hist__back" onClick={onClose}>
          Back to chat
        </button>
      </header>
      <div className="skp-hist__body" ref={listRef}>
        {!list && <p className="skp-hist__muted">Pulling up the history…</p>}
        {list && !list.ok && <p className="skp-hist__muted">{WHY[list.why]}</p>}
        {list?.ok && list.value.length === 0 && <p className="skp-hist__muted">No calls or chats yet. They show here for 30 days.</p>}
        {list?.ok &&
          byDay(list.value, now).map((g) => (
            <div key={g.day} className="skp-hist__day">
              <h4>{g.day}</h4>
              <ul className="skp-hist__list">
                {g.items.map((c) => {
                  const span = c.kind === "talk" ? spanLabel(c) : "";
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="skp-hist__item"
                        data-conv={c.id}
                        onClick={() => {
                          lastTapped.current = c.id;
                          setOpen(c);
                        }}
                      >
                        <span className={`skp-hist__kind skp-hist__kind--${c.kind}`}>{viaLabel(c)}</span>
                        <span className="skp-hist__first">{c.first ? <Private>{c.first}</Private> : <em>Skippy spoke first</em>}</span>
                        <span className="skp-hist__when">
                          <time dateTime={c.at}>{timeLabel(c.at)}</time>
                          {span && ` · ${span}`}
                          {c.turns > 1 && ` · ${c.turns} turns`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
      </div>
    </section>
  );
}
