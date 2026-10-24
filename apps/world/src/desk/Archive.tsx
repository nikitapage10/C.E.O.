import "@fontsource-variable/cinzel/wght.css";
import "@fontsource-variable/crimson-pro/wght.css";
import "@fontsource-variable/crimson-pro/wght-italic.css";
import { Chronicle } from "./Chronicle.tsx";
import "./archive.css";

/**
 * The Archive (#225; redesigned in #366 and #388): the Chronicle of Ilyr as a dark codex in a vitrine. Today in Ilyr
 * and the week's Book of Hours up front, the cast's telling of the week, the shown day unrolled hour by hour beside the
 * bonds it moved and the case of past days, and the Tide, Nikita's campaign, as a folio waiting for its connection.
 * Set in Cinzel and Crimson Pro, Historian violet the one accent.
 */
export function Archive({ now, awaySince }: { now: number; awaySince: number }) {
  return <Chronicle now={now} awaySince={awaySince} />;
}
