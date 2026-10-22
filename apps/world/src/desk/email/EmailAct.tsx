import { portrait } from "../deskData.ts";
import { link } from "../nav.ts";
import { useEmail } from "./email.ts";

/**
 * Today's email card (#263): "N emails need you", from the agent's public counts, and the way to the Relay page where
 * the mail itself waits behind the passkey. No subject or sender on Today: the count is the whole card.
 */
export function EmailAct({ count, style }: { count: number; style?: React.CSSProperties }) {
  const paused = useEmail((s) => s.status?.agent === "paused");
  const pf = portrait("Dialtone");
  return (
    <article className="wv-act" data-room="relay" style={style}>
      <div className="wv-act-top">
        <i className="wv-dot" />
        <span>Email</span>
      </div>
      <div className="wv-act-body">
        {pf && <img className="wv-act-pf" src={pf} alt="Dialtone" />}
        <div>
          <h3 className="wv-h3">{count === 1 ? "1 email needs you" : `${count} emails need you`}</h3>
          <p className="wv-act-p">{paused ? "Email agent paused: monthly cap reached. New mail is counted, not sorted." : "Dialtone sorted them out of your inbox; Blasto has advice and a draft for each on the Relay page."}</p>
        </div>
      </div>
      <div className="wv-act-do">
        <a className="wv-btn is-pri" href="/relay" onClick={link("relay")}>
          Open Relay
        </a>
      </div>
    </article>
  );
}
