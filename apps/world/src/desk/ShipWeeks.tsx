import { useMemo, useState } from "react";
import { useFoundry, withTrails } from "../foundry.ts";
import { useUsage } from "../usage.ts";
import { ChangePictures } from "./ChangePictures.tsx";
import { Chevron } from "./ChronicleWeave.tsx";
import { shipWeeks, WEEKS_OPEN } from "./shipWeeks.ts";

const day = (monday: string) => new Date(Date.UTC(Number(monday.slice(0, 4)), Number(monday.slice(5, 7)) - 1, Number(monday.slice(8, 10)), 12)).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long" });

/**
 * Week by week (#578): what the Foundry shipped, grouped by week, newest first, read from the changelog the Desk already
 * loads. The newest two weeks stand open; older ones fold away.
 */
export function ShipWeeksFolio({ now }: { now: number }) {
  const changelog = useFoundry((s) => s.data.changelog);
  const connected = useFoundry((s) => s.connected);
  const trails = useUsage().feed?.trails;
  const weeks = useMemo(() => shipWeeks(withTrails(changelog, trails ?? []), now), [changelog, trails, now]);
  const [more, setMore] = useState(false);
  const shown = more ? weeks : weeks.slice(0, WEEKS_OPEN);
  return (
    <section className="ax-ships" aria-label="Week by week: what the Foundry shipped">
      <p className="fl-k">Week by week</p>
      {!weeks.length ? (
        <p className="wv-note">{connected ? "Nothing shipped in the last six weeks." : "Waiting on the Foundry's list of what shipped…"}</p>
      ) : (
        <>
          {shown.map((w) => (
            <div key={w.monday} className="ax-ship-week">
              <h3>
                Week of {day(w.monday)} <small>{w.entries.length} shipped</small>
              </h3>
              <ul>
                {w.entries.map((e) => (
                  <li key={e.key}>
                    {e.pictures.length ? <ChangePictures pictures={e.pictures} title={e.title} /> : null}
                    <span>
                      {e.href ? (
                        <a href={e.href} target="_blank" rel="noreferrer">
                          {e.title}
                        </a>
                      ) : (
                        <b>{e.title}</b>
                      )}
                      {e.short ? <em>{e.short}</em> : null}
                      {e.builder ? <small>Built by {e.builder}</small> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {weeks.length > WEEKS_OPEN && (
            <button className="ax-more" type="button" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? "Fewer weeks" : `${weeks.length - WEEKS_OPEN} earlier ${weeks.length - WEEKS_OPEN === 1 ? "week" : "weeks"}`}
              <Chevron />
            </button>
          )}
        </>
      )}
    </section>
  );
}
