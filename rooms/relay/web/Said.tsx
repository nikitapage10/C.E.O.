import { useState } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
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
const mine = (m: Shown) => (m as Shown & { me?: unknown }).me === true || m.from === "me";

/**
 * Their own texts (#758). In a group, or a small chat of several (#916, where Nikita's own lines read "you"), each
 * line with its sender's face and name, oldest first. In a one-to-one thread
 * (#869, Nikita: "push the text message to be more prominent"; he wants context) the newest is the hero, large; the
 * lines before it recede above it, faint and blurred, and come into focus (unblur, grow, lift) on hover, a tap, keyboard
 * focus or a scroll up over them, falling back when he moves away.
 */
export function Said({ messages, hidden }: { messages: NonNullable<Exchange["messages"]>; hidden: boolean }) {
  const [open, setOpen] = useState(false);
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
            <Private>{m.text}</Private>
          </li>
        ))}
      </ol>
    );
  }
  const hero = messages.at(-1)!;
  const before = messages.slice(0, -1);
  return (
    <div className="cx-conv" data-open={open || undefined} onMouseLeave={() => setOpen(false)} onWheel={(e) => e.deltaY < 0 && before.length > 0 && setOpen(true)}>
      {before.length > 0 && (
        <ol className="cx-ctx" tabIndex={0} aria-label="Earlier in the conversation" onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
          {before.map((m, i) => (
            <li key={`${m.at}-${i}`} className="cx-msg cx-ctxline" data-me={mine(m) || undefined} style={{ ["--d" as string]: before.length - i }}>
              {mine(m) && <span className="cx-lab">you</span>}
              <Private>{m.text}</Private>
            </li>
          ))}
        </ol>
      )}
      <p className="cx-msg cx-hero" data-me={mine(hero) || undefined}>
        <Private>{hero.text}</Private>
      </p>
    </div>
  );
}
