import { Chronicle } from "./Chronicle.tsx";
import { Tide } from "./rooms/Tide.tsx";
import "./rooms/rooms.css";

/**
 * The Archive (#225; the Chronicle's page until now), as an illuminated codex: the day in Ilyr as a story read aloud,
 * what happened while you were away, the week and the shelf of past days, every hour as it was written, and the Tide,
 * Nikita's campaign, waiting for its own connection.
 */
export function Archive({ now, awaySince }: { now: number; awaySince: number }) {
  return (
    <Chronicle now={now} awaySince={awaySince}>
      <Tide />
    </Chronicle>
  );
}
