import { Private } from "@ceo/engine/web/Private.tsx";
import { useState } from "react";
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
 * Their own texts (#758). In a group, each line with its sender's face and name, oldest first. In a one-to-one thread
 * the card is the conversation (#904, Nikita: "like iMessage"): their lines on the left, his own (`me: true`) on the
 * right, the older ones dimmer above, and the newest at the bottom, large. Nothing is blurred: the context stays
 * readable, and brightens on hover or keyboard focus.
 */
export function Said({ messages, hidden }: { messages: NonNullable<Exchange["messages"]>; hidden: boolean }) {
  const group = messages.some((m) => m.from !== undefined && m.from !== "me");
  if (group) {
    return (
      <ol className="cx-said">
        {messages.map((m, i) => (
          <li key={`${m.at}-${i}`} className="cx-msg">
            {m.from !== undefined && (
              <span className="cx-who">
                <MemberFace name={m.from} photo={m.photo} hidden={hidden} />
                <Private>{m.from}</Private>
              </span>
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
        <ol className="cx-ctx" tabIndex={0} aria-label="Earlier in the conversation">
          {before.map((m, i) => (
            <li key={`${m.at}-${i}`} className="cx-bub" data-me={mine(m) || undefined} style={{ ["--d" as string]: Math.min(4, before.length - i) }}>
              <span className="cx-sr">{mine(m) ? "You: " : "Them: "}</span>
              <span className="cx-msg cx-ctxline">
                <Words m={m} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="cx-bub cx-bub-hero" data-me={mine(hero) || undefined}>
        <span className="cx-sr">{mine(hero) ? "You, last: " : "Their latest: "}</span>
        <span className="cx-msg cx-hero">
          <Words m={hero} />
        </span>
      </p>
    </div>
  );
}
