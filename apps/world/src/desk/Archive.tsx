import { Chronicle } from "./Chronicle.tsx";
import { useChronicle } from "../chronicle.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import "./archive.css";

/**
 * The Archive (#225; redesigned in #366, #388 and #431): the Chronicle of Ilyr on the Desk's flow kit, in Today's
 * language (Bodoni Moda and Jost, the horizon, the ledger) with Historian violet as its accent. Its one idea is the
 * Book of Hours, threaded: the week as rows of hours with each room's day running through as a fine particle line,
 * knotted where the Historian set a scene. Below it Today in Ilyr and Skippy's read-along, the cast's telling of the
 * week, the shown day hour by hour beside the bonds it moved and the case of past days, and the Tide as a folio.
 */
export function Archive({ now, awaySince }: { now: number; awaySince: number }) {
  useRoomReady(useChronicle((s) => s.status !== "idle" && s.status !== "loading"));
  return <Chronicle now={now} awaySince={awaySince} />;
}
