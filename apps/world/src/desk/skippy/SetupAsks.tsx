import { useEffect, useState } from "react";
import { submindOf } from "../../../../../packages/simulator/src/subminds.ts";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { whenAsked } from "./asked.ts";
import { ROUTE_LABEL, TRAIL_STEP, useSetupAsks, waiting, type DecideResult, type SetupAsk, type SetupRoom } from "./setupAsks.ts";
import "./asked.css";

/**
 * "Setup asks" on a room's Desk page (#324), beside the hand-off flags (Asked Skippy): what the room's submind wants set
 * up, each as one line (what it will do, and where) and a "What this does" box (the service, what changes, why, the
 * cost and whether it can be undone). Open ones carry Approve and Decline, sent in the passkey session; approved ones
 * say the thread is on it; closed ones end with their Trail line. Signed-in owner only: signed out, or where the route
 * doesn't exist, or with nothing asked, it renders nothing. Every word is wrapped in <Private> for Hide mode.
 */

/** Read again every two minutes while the page is open. */
const POLL_MS = 120_000;
/** Closed asks shown before "Show closed". */
const CLOSED_FIRST = 0;

const SAID: Record<Exclude<DecideResult, "ok">, string> = {
  "signed-out": "Your Desk session ended. Sign in with your passkey and tap again.",
  decided: "That one was already answered.",
  failed: "Couldn't send that just now. Try again.",
};

function Ask({ ask, who, now }: { ask: SetupAsk; who: string; now: number }) {
  const decide = useSetupAsks((s) => s.decide);
  const busy = useSetupAsks((s) => s.busy);
  const [said, setSaid] = useState("");
  const tap = async (d: "approve" | "decline") => {
    setSaid("");
    const r = await decide(ask.id, d);
    if (r !== "ok") setSaid(SAID[r]);
  };
  const step = TRAIL_STEP[ask.state];
  return (
    <li className="skp-setup__ask" data-state={ask.state}>
      <div className="skp-setup__line">
        <Private as="b" className="skp-asked__q">
          {ask.title}
        </Private>
        <span className="skp-asked__meta">
          <Private as="span">{ask.where}</Private> · <time dateTime={ask.at}>{whenAsked(ask.at, now)}</time>
          {ask.state === "approved" && <span className="skp-asked__handed"> · approved, {who} is on it</span>}
        </span>
      </div>
      <div className="skp-setup__box" role="group" aria-label="What this does">
        <p className="skp-setup__boxhead">What this does</p>
        <Private as="p">
          <b>Service:</b> {ask.service}
        </Private>
        <Private as="p">
          <b>Changes:</b> {ask.changes}
        </Private>
        <Private as="p">
          <b>Why:</b> {ask.why}
        </Private>
        <Private as="p">
          <b>Cost:</b> {ask.cost} · {ask.reversible ? "Reversible" : "Can't be undone"}
        </Private>
        <p className="skp-setup__how">{ROUTE_LABEL[ask.route]}</p>
      </div>
      {ask.state === "open" && (
        <div className="skp-setup__acts">
          <button type="button" className="wv-btn is-pri is-sm" disabled={busy !== null} onClick={() => void tap("approve")}>
            Approve
          </button>
          <button type="button" className="wv-btn is-sm" disabled={busy !== null} onClick={() => void tap("decline")}>
            Decline
          </button>
        </div>
      )}
      {step && ask.trail && (
        <p className="skp-setup__trail">
          <b>Trail · {step}:</b> <Private as="span">{ask.trail}</Private>
        </p>
      )}
      {said && (
        <p className="wv-note" role="status">
          {said}
        </p>
      )}
    </li>
  );
}

export function SetupAsks({ room, className = "" }: { room: SetupRoom; className?: string }) {
  const status = useSetupAsks((s) => s.status);
  const all = useSetupAsks((s) => s.asks);
  const refresh = useSetupAsks((s) => s.refresh);
  const auth = useDeskAuth((s) => s.auth.status);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(t);
  }, [auth, refresh]);

  if (auth !== "in" || (status !== "live" && status !== "failed")) return null;
  const mine = all.filter((a) => a.room === room);
  if (!mine.length) return null;
  const open = mine.filter(waiting);
  const closed = mine.filter((a) => !waiting(a));
  const shownClosed = showClosed ? closed : closed.slice(0, CLOSED_FIRST);
  const who = submindOf(room).name;
  const now = Date.now();
  const toTap = open.filter((a) => a.state === "open").length;

  return (
    <section className={`skp-asked skp-setup ${className}`} aria-label="Setup asks" data-room={room}>
      <div className="skp-asked__head">
        <p className="wv-eyb">Setup asks</p>
        <span className="skp-asked__count">{toTap ? `${toTap} waiting for you` : open.length ? `${open.length} in hand` : "all closed"}</span>
      </div>
      {status === "failed" && <p className="wv-note">Couldn't read the setup asks just now.</p>}
      <ol className="skp-asked__list">
        {[...open, ...shownClosed].map((a) => (
          <Ask key={a.id} ask={a} who={who} now={now} />
        ))}
      </ol>
      {closed.length > CLOSED_FIRST && (
        <button type="button" className="skp-asked__more" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed}>
          {showClosed ? "Hide closed" : `Show closed (${closed.length})`}
        </button>
      )}
    </section>
  );
}
