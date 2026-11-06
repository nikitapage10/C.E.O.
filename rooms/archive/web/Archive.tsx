import { Chronicle } from "./Chronicle.tsx";
import "./archive.css";

/**
 * The Archive (#225; redesigned in #366, #388 and #431; the war table since #826): the Chronicle of Ilyr as a campaign
 * table that fills the screen, its chart carved with the record's places. Each feature is a miniature on the map:
 * Today in Ilyr at the lighthouse, the Book of Hours in the clock town, the day hour by hour in the citadel, the bonds
 * at the twin towers, past days in the library, the week told in the theatre, what shipped at the harbour, and the
 * Tide's isle, still only wire until its feed is connected. Clicking a place opens the feature beside the table. The
 * page is ready once the table's first frame is drawn (WarTable.tsx).
 */
export function Archive({ now, awaySince }: { now: number; awaySince: number }) {
  return <Chronicle now={now} awaySince={awaySince} />;
}
