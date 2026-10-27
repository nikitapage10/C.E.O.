import { ponderLine } from "../../../../../api/_skippy/ponder.ts";
import { handedName, readAsked, type AskedCard, type AskedRoom, type AskedTurn } from "./asked.ts";

/**
 * A hand-off's round trip in the Desk's chat (#341). When Desk Skippy hands an ask to a room's submind (or to his own
 * thread), the reply carries the kept turn's id; the chat shows "Checking with the <submind>…" as a pending bubble and
 * waits for the answer here. The submind's thread wakes on its own watcher (scripts/submind-watch.sh), answers on its
 * own session and posts the answer back (POST /api/skippy-answer, docs/SKIPPY.md). The chat reads the room's log, the
 * same signed-in GET the room's "Asked Skippy" panel makes, only while something is pending and the tab is showing, so
 * nothing else on the Desk gets slower; the answer then replaces the bubble in place.
 */

/** The rooms whose asks are kept and can be waited on (asked.ts). */
export const WAIT_ROOMS: readonly AskedRoom[] = ["green", "exchange", "boiler", "foundry", "relay", "kernel"];

/** How long the chat keeps waiting before it says where the answer will show instead. */
export const WAIT_MAX_MS = 2 * 60 * 60_000;

/** How often it looks: every 15 seconds for the first five minutes, then every 30 (a submind's watcher wakes it in about 30 s). */
export const pollEvery = (waitedMs: number): number => (waitedMs < 5 * 60_000 ? 15_000 : 30_000);

/**
 * The pending bubble's words. For his deeper self Skippy stays in character (#498): a rotating line, picked by the kept
 * turn's id so a bubble keeps its line, never "thread" or "Kernel".
 */
export const pendingText = (needs: string, seed?: string): string => (needs === "skippy" ? ponderLine(seed) : `Checking with ${handedName(needs)}…`);

/** Where the answer will still show when the chat stops waiting. */
const PAGE_NAME: Record<Exclude<AskedRoom, "kernel">, string> = { green: "the Green", exchange: "the Exchange", boiler: "the Boiler Room", foundry: "the Foundry", relay: "Relay" };
export const gaveUpText = (needs: string, room: AskedRoom): string =>
  room === "kernel"
    ? "Still pondering. Your phone gets a ping when the answer lands."
    : `${needs === "skippy" ? "Still pondering" : `Still with ${handedName(needs)}`}. The answer will show on ${PAGE_NAME[room]} page, under Asked Skippy.`;

/** What a hand-off waits on: the kept turn, its room and who has it. */
export interface Pending {
  turn: string;
  room: AskedRoom;
  needs: string;
  /** Date.now() when it was handed off. */
  since: number;
  /** When the last interim answer came back (#480), so the same one isn't shown or spoken twice. */
  seen?: string;
}

/** The answer that came back, as the chat shows it. */
export interface Answer {
  from: string;
  text: string;
  at: string;
  card?: AskedCard;
  /** false on an interim answer (#480): the bubble shows it and keeps waiting for the final one. */
  final?: false;
}

/** The answer to `turn` in a room log's answer, when it has come back; null while it is still out. */
export function answerIn(body: unknown, p: Pick<Pending, "turn" | "room">): Answer | null {
  const turns: AskedTurn[] | null = readAsked(body, p.room);
  const t = turns?.find((x) => x.id === p.turn);
  return t?.followUp ? { ...t.followUp } : null;
}

/** One look at the room's log for the answer. "signed-out" on a 401, null while it's still out or the read failed. */
export async function lookForAnswer(p: Pending, doFetch: typeof fetch = fetch): Promise<Answer | "signed-out" | null> {
  try {
    const res = await doFetch(`/api/skippy-log?room=${p.room}`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) return "signed-out";
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return answerIn(await res.json(), p);
  } catch {
    return null;
  }
}
