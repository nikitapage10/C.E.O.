import { Private } from "@ceo/engine/web/Private.tsx";
import { useState, type KeyboardEvent } from "react";
import { initialOf, type Exchange } from "../data/thread.ts";

/** A group member's face beside their line (#758): their contact photo by its opaque id, else their initial. */
function MemberFace({ name, photo, hidden }: { name: string; photo?: string; hidden: boolean }) {
  const [bad, setBad] = useState(false);
  if (photo && !hidden && !bad) return <img className="cx-mface" src={`/api/relay?photo=${photo}`} alt="" width={22} height={22} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />;
  return (
    <span className="cx-mface cx-minit" aria-hidden="true">
      {hidden ? "·" : initialOf(name)}
    </span>
  );
}

type Shown = NonNullable<Exchange["messages"]>[number];

/** Nikita's own line in the context (#869), when the hub marks one (`me: true`, or a `from` of "me"); else theirs. */
export const mine = (m: Shown) => (m as Shown & { me?: unknown }).me === true || m.from === "me";

/** A photo or file with no words (#870): a small "Photo" chip, nothing of the attachment itself. */
const isMedia = (m: Shown) => (m as Shown & { media?: unknown }).media === true;

function Words({ m }: { m: Shown }) {
  if (isMedia(m))
    return (
      <span className="cx-chip">
        <svg viewBox="0 0 16 16" aria-hidden="true" width="13" height="13">
          <rect x="1.5" y="3" width="13" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" />
          <path d="M2.5 12 6.5 8.5l2.5 2 2-1.5 3 2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        Photo
      </span>
    );
  return <Private>{m.text}</Private>;
}

/**
 * Their own texts (#758). In a group, or a small chat of several (#916, Nikita's own lines marked "you"), each line
 * with its sender's face and name, oldest first. In a one-to-one thread
 * the card is the conversation (#904, Nikita: "like iMessage"): their lines on the left, his own (`me: true`) on the
 * right, and the newest at the bottom, large, standing alone. The older ones (#923, Nikita: "the earlier messages
 * take away from the current message") sit darkened and blurred above it, dissolving into Relay's white nanites, and
 * come clear on hover, on keyboard focus, or on a tap (a phone has no hover; a second tap lets them fade again).
 */
export function Said({ messages, hidden, picked = null, onPick }: { messages: NonNullable<Exchange["messages"]>; hidden: boolean; picked?: string | null; onPick?: (ref: string) => void }) {
  const [clear, setClear] = useState(false);
  /**
   * Any of their lines can be picked (#950, Nikita: tapbacks on any earlier message, and an inline reply like iMessage's):
   * a tap (or Enter) on the bubble picks it for the tapbacks and Reply under the card; a second tap lets it go. Picking an
   * older line brings the older lines clear, so the one picked reads.
   */
  const pickProps = (m: Shown) => {
    const ref = (m as Shown & { ref?: string }).ref;
    if (!onPick || !ref || mine(m)) return {};
    const go = (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      setClear(true);
      onPick(ref);
    };
    return {
      role: "button",
      tabIndex: 0,
      "aria-pressed": picked === ref,
      "data-pick": "",
      "data-picked": picked === ref || undefined,
      title: "Pick this message: a tapback, or Reply to it",
      onClick: go,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go(e);
        }
      },
    };
  };
  const group = messages.some((m) => m.from !== undefined && m.from !== "me");
  if (group) {
    return (
      <ol className="cx-said">
        {messages.map((m, i) => (
          <li key={`${m.at}-${i}`} className="cx-msg">
            {m.from !== undefined && m.from !== "me" ? (
              <span className="cx-who">
                <MemberFace name={m.from} photo={m.photo} hidden={hidden} />
                <Private>{m.from}</Private>
              </span>
            ) : (
              mine(m) && <span className="cx-lab">you</span>
            )}
            <Words m={m} />
          </li>
        ))}
      </ol>
    );
  }
  const hero = messages.at(-1)!;
  const before = messages.slice(0, -1);
  return (
    <div className="cx-conv">
      {before.length > 0 && (
        <ol
          className="cx-ctx"
          tabIndex={0}
          aria-label={clear ? "Earlier in the conversation" : "Earlier in the conversation, faded: hover, focus or tap to read"}
          data-clear={clear || undefined}
          onClick={() => setClear((c) => !c)}
        >
          {before.map((m, i) => (
            <li key={`${m.at}-${i}`} className="cx-bub" data-me={mine(m) || undefined} style={{ ["--d" as string]: Math.min(4, before.length - i) }} {...pickProps(m)}>
              <span className="cx-sr">{mine(m) ? "You: " : "Them: "}</span>
              <span className="cx-msg cx-ctxline">
                <Words m={m} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="cx-bub cx-bub-hero" data-me={mine(hero) || undefined} {...pickProps(hero)}>
        <span className="cx-sr">{mine(hero) ? "You, last: " : "Their latest: "}</span>
        <span className="cx-msg cx-hero">
          <Words m={hero} />
        </span>
      </p>
    </div>
  );
}
