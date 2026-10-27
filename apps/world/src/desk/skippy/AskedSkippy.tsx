import { AnswerCard } from "./AnswerCard.tsx";
import { useEffect, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { handedName, modelName, useAsked, whenAsked, type AskedRoom } from "./asked.ts";
import { useSkippy } from "./chat.ts";
import "./asked.css";

/**
 * "Asked Skippy" on a room's Desk page (#273): what Nikita asked Skippy that he filed under this room, newest first,
 * each collapsed to its question and the start of the answer (tap to read the rest). Signed-in only; every word is
 * wrapped in <Private> for Hide mode. Reads again when sign-in changes and after each new answer from Skippy.
 */

const ROOM_NAME: Record<AskedRoom, string> = { green: "the Green", exchange: "the Exchange", boiler: "the Boiler Room", foundry: "the Foundry", relay: "Relay", kernel: "the Kernel" };
/** Shown before "Show all". */
const FIRST = 4;

export function AskedSkippy({ room, className = "" }: { room: AskedRoom; className?: string }) {
  const view = useAsked((s) => s.rooms[room]);
  const refresh = useAsked((s) => s.refresh);
  const auth = useDeskAuth((s) => s.auth.status);
  const answered = useSkippy((s) => s.turns.length);
  const [all, setAll] = useState(false);

  useEffect(() => {
    void refresh(room);
  }, [room, auth, answered, refresh]);

  const status = view?.status ?? "idle";
  if (status === "off") return null;
  const turns = view?.turns ?? [];
  const shown = all ? turns : turns.slice(0, FIRST);
  const now = Date.now();

  return (
    <section className={`skp-asked ${className}`} aria-label="Asked Skippy" data-room={room}>
      <div className="skp-asked__head">
        <p className="wv-eyb">Asked Skippy</p>
        {turns.length > 0 && <span className="skp-asked__count">{turns.length === 1 ? "1 ask" : `${turns.length} asks`}</span>}
      </div>
      {status === "signed-out" ? (
        <p className="wv-note">Sign in on the Desk to see what you asked Skippy about {ROOM_NAME[room]}.</p>
      ) : status === "idle" && !turns.length ? (
        <p className="wv-note">Reading…</p>
      ) : !turns.length ? (
        <p className="wv-note">{status === "failed" ? "Couldn't read what you asked Skippy just now." : `Nothing asked about ${ROOM_NAME[room]} yet. Ask Skippy on Today and he files it here.`}</p>
      ) : (
        <>
          <ol className="skp-asked__list">
            {shown.map((t) => (
              <li key={`${t.at}|${t.question}`}>
                <details>
                  <summary>
                    <Private as="b" className="skp-asked__q">
                      {t.question}
                    </Private>
                    <Private as="span" className="skp-asked__a">
                      {t.answer}
                    </Private>
                    <span className="skp-asked__meta">
                      <time dateTime={t.at}>{whenAsked(t.at, now)}</time>
                      {t.model && <span> · {modelName(t.model)}</span>}
                      {t.needs && <span className="skp-asked__handed"> · {t.followUp ? `${handedName(t.followUp.from)} answered` : `with ${handedName(t.needs)}`}</span>}
                    </span>
                  </summary>
                  {t.followUp && (
                    <p className="skp-asked__follow">
                      <b>{handedName(t.followUp.from)}:</b>{" "}
                      <Private as="span">{t.followUp.text}</Private>
                    </p>
                  )}
                  {t.followUp?.card && (
                    <Private block as="div">
                      <AnswerCard card={t.followUp.card} />
                    </Private>
                  )}
                </details>
              </li>
            ))}
          </ol>
          {turns.length > FIRST && (
            <button type="button" className="skp-asked__more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? "Show fewer" : `Show all ${turns.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
