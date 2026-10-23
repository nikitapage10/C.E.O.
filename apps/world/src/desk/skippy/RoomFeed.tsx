import { useEffect, useState } from "react";
import { submindOf } from "../../../../../packages/simulator/src/subminds.ts";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { whenAsked } from "./asked.ts";
import { useRoomFeed, type FeedRoom } from "./roomFeed.ts";
import "./asked.css";

/**
 * "From the <submind>" on a room's Desk page (#281): the short events the room's submind posted from its project thread
 * with the feed key, newest first. Signed in, each opens to its detail (wrapped in <Private> for Hide mode); signed
 * out, only the scrubbed titles show, as on the Lattice. Hidden where the feed doesn't exist (a local preview).
 */

/** Shown before "Show all". */
const FIRST = 4;
/** Read again every two minutes while the page is open. */
const POLL_MS = 120_000;

export function RoomFeed({ room, className = "" }: { room: FeedRoom; className?: string }) {
  const status = useRoomFeed((s) => s.status);
  const full = useRoomFeed((s) => s.full);
  const all = useRoomFeed((s) => s.events);
  const refresh = useRoomFeed((s) => s.refresh);
  const auth = useDeskAuth((s) => s.auth.status);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(t);
  }, [auth, refresh]);

  if (status === "off" || status === "idle") return null;
  const events = all.filter((e) => e.room === room);
  const shown = open ? events : events.slice(0, FIRST);
  const who = submindOf(room).name;
  const now = Date.now();

  return (
    <section className={`skp-asked skp-feed ${className}`} aria-label={`From ${who}`} data-room={room}>
      <div className="skp-asked__head">
        <p className="wv-eyb">From {who}</p>
        {events.length > 0 && <span className="skp-asked__count">{events.length === 1 ? "1 event" : `${events.length} events`}</span>}
      </div>
      {!events.length ? (
        <p className="wv-note">{status === "failed" ? "Couldn't read the room feed just now." : `Nothing from ${who} yet. It posts here from its own thread.`}</p>
      ) : (
        <>
          <ol className="skp-asked__list">
            {shown.map((e) => (
              <li key={e.id}>
                {full && e.detail ? (
                  <details>
                    <summary>
                      <b className="skp-asked__q">{e.title}</b>
                      <Private as="span" className="skp-asked__a">
                        {e.detail}
                      </Private>
                      <span className="skp-asked__meta">
                        <time dateTime={e.at}>{whenAsked(e.at, now)}</time>
                      </span>
                    </summary>
                  </details>
                ) : (
                  <div className="skp-feed__row">
                    <b className="skp-asked__q">{e.title}</b>
                    <span className="skp-asked__meta">
                      <time dateTime={e.at}>{whenAsked(e.at, now)}</time>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {!full && <p className="wv-note">Sign in on the Desk to read each event's detail.</p>}
          {events.length > FIRST && (
            <button type="button" className="skp-asked__more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Show fewer" : `Show all ${events.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
