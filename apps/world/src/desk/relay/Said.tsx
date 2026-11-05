import { useState } from "react";
import { Private } from "../Private.tsx";
import { initialOf, type Exchange } from "./thread.ts";

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

/** Their own texts (#758): real words, oldest first; in a group each line with its sender's face and name. */
export function Said({ messages, hidden }: { messages: NonNullable<Exchange["messages"]>; hidden: boolean }) {
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
          <Private>{m.text}</Private>
        </li>
      ))}
    </ol>
  );
}
