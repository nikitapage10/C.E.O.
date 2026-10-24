import { Chronicle } from "./Chronicle.tsx";
import { Tide } from "./rooms/Tide.tsx";
import "./rooms/rooms.css";
import "./archive.css";

/**
 * The Archive (#225, redesigned in #366): the Chronicle of Ilyr and the Tide. The latest edition of Today in Ilyr up
 * front, the week in Ilyr as its centrepiece, the shown day hour by hour, the bonds it moved and a shelf of past days,
 * and the Tide, Nikita's campaign, waiting for its own connection.
 */
export function Archive({ now, awaySince }: { now: number; awaySince: number }) {
  return (
    <Chronicle now={now} awaySince={awaySince}>
      <Tide />
    </Chronicle>
  );
}
