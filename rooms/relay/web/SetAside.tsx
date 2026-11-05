import { useState } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import { BACKABLE, type AsideWhy } from "../../../api/_relay/texts.ts";
import { useTexts } from "../data/texts.ts";
import { agoShort } from "../data/thread.ts";

/** Why Relay set a thread aside (#870), in the Desk's words: a kind from a closed list, never the text. */
export const ASIDE_WORDS: Record<AsideWhy, string> = {
  "no-reply": "Dialtone read no reply needed",
  closing: "closed after your reply",
  done: "you marked it done",
  money: "money or legal: text it yourself",
  code: "a code",
  "short-code": "an automated sender",
  promo: "marketing",
};

/**
 * "Relay set these aside" (#870). The hub's action is the `back` request (POST /api/relay { action: "back", thread }).: the one-to-one threads from the last 30 days that aren't in the line, newest first,
 * each with why, and "Bring back" for the ones a model, closing intent or Nikita's own Done set aside (a rule's never
 * reach a model, so they stay). Folded by default; names only, behind the passkey like the rest of the list.
 */
export function SetAside({ now }: { now: number }) {
  const aside = useTexts((s) => s.view?.aside ?? []);
  const ask = useTexts((s) => s.ask);
  const busy = useTexts((s) => s.busy);
  const pending = useTexts((s) => s.view?.requests ?? []);
  const [open, setOpen] = useState(false);
  if (!aside.length) return null;
  return (
    <>
      <p className="cx-ex">
        Relay set {aside.length} aside{" "}
        <button type="button" className="cx-lnk" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "hide them" : "show them"}
        </button>
      </p>
      {open && (
        <ol className="cx-rows cx-older">
          {aside.map((a) => {
            const sent = pending.some((r) => r.kind === "back" && r.thread === a.id && (r.state === "waiting" || r.state === "taken"));
            return (
              <li key={a.id}>
                <span className="cx-still">
                  <Private as="b">{a.name}</Private>
                  <span className="cx-what">
                    {ASIDE_WORDS[a.why]} · {a.channel === "SMS" ? "sms" : "text"}
                  </span>
                  <em>{agoShort(now - a.since)}</em>
                  {BACKABLE.includes(a.why) && (
                    <button type="button" className="cx-lnk" disabled={sent || busy === `back:${a.id}`} onClick={() => void ask({ action: "back", thread: a.id })}>
                      {sent ? "bringing back…" : "Bring back"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
