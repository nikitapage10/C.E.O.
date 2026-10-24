import { chronicleDay, sinceAway, useWorldFeed } from "../chronicle.ts";
import { shippedToday, useFoundry } from "../foundry.ts";
import { loadLattice } from "../route.ts";
import { DESK_ROOMS, roomImage, type DeskAction, type DeskData, type DeskRoom } from "./deskData.ts";
import { roomLink } from "./hero/roomLink.ts";
import { link } from "./nav.ts";
import type { RoomPulse } from "./roomPulse.ts";
import { LaterAct } from "./TodayActs.tsx";
import { ShortVersion, shortVersion, WorthKnowing } from "./TodayWeave.tsx";
import { Avatar } from "./ui.tsx";

/**
 * Today's "Not worth knowing now" (#363; first "More from today", #336): what can wait, the short version of what
 * happened (with yesterday's story to listen to), what's warm but not on fire, and every room as a still to walk into.
 * Loaded only when it is opened. The world clock and what the crew does next moved up to the rail (TodayRail.tsx).
 */
export function TodayMore({ data, now, awaySince, pulses, owed, later, moreReplies }: { data: DeskData; now: number; awaySince: number; pulses: RoomPulse[]; owed: number; later: DeskAction[]; moreReplies: number }) {
  const world = useWorldFeed().feed;
  const foundry = useFoundry((s) => s.data);
  const ilyr = world ? sinceAway(world.recent, awaySince) : [];
  const yesterday = chronicleDay(now - 86_400_000);
  const storyDay = world?.days.includes(yesterday) ? yesterday : null;
  const shipped = shippedToday(foundry.changelog, now);
  const moments = shortVersion({ data, changes: foundry.changelog, ilyr, awaySince });

  return (
    <div className="wv-tmore-in">
      {(later.length > 0 || moreReplies > 0) && (
        <section className="wv-acts wv-acts--later" aria-label="Can wait">
          <LaterAct items={later} moreReplies={moreReplies} />
        </section>
      )}
      <ShortVersion moments={moments} awaySince={awaySince} now={now} storyDay={storyDay} shipped={shipped} />
      <WorthKnowing data={foundry} owed={owed} />

      <section className="wv-section rooms" aria-label="Your rooms">
        <div className="wv-sechead">
          <div>
            <p className="wv-eyb">The rooms</p>
            <h2 className="wv-h2">Walk in anywhere</h2>
          </div>
          <a className="wv-link" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()}>
            Enter the Lattice →
          </a>
        </div>
        <ul className="rooms__grid">
          {(Object.keys(DESK_ROOMS) as DeskRoom[]).map((r) => {
            const waiting = data.actions.filter((a) => a.room === r).length + (r === "relay" ? owed : 0);
            const room = DESK_ROOMS[r];
            const p = pulses.find((x) => x.id === r);
            return (
              <li key={r} className={`room ${waiting ? "room--hot" : ""}`} style={{ "--tone": room.accent } as React.CSSProperties}>
                <a href={p?.href ?? `/lattice?room=${r}`} onClick={roomLink(p?.href ?? "/lattice")}>
                  <img className="room__pic" src={roomImage(r)} alt="" loading="lazy" decoding="async" />
                  <span className="room__text">
                    <span className="room__name">{room.name}</span>
                    <span className="room__what">{p?.status ?? room.what}</span>
                  </span>
                  <span className="room__foot">
                    <Avatar agent={room.lead} size="sm" room={r} />
                    <span className="room__cap">{waiting ? `${waiting} waiting on you` : room.what}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
