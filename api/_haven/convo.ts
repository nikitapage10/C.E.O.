/**
 * A short memory per phone (#627), so a second press follows on from the first ("who do I start at flex?" then "what
 * about Godwin?", or "garlic and lemons" then "and milk too").
 *
 *   - The last CONVO_TURNS turns (what Nikita said, and the `say` that answered), and which way the last capture went,
 *     in the private blob store at `haven/convo/<phone id>.json`. Nowhere else: never logged, never on the Desk.
 *   - Forgotten after CONVO_IDLE_MS of quiet (read as empty, and overwritten by the next turn), and deleted when the
 *     phone is revoked.
 *   - Passed to Desk Skippy's chat as its prior turns (`history`), through the same privacy check as the Desk's.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../_blob.js";
import type { Capture } from "./classify.js";
import { readJson } from "./json.js";

export const CONVO_TURNS = 6;
export const CONVO_IDLE_MS = 10 * 60_000;
const TEXT_MAX = 600;

export interface ConvoTurn {
  who: "nikita" | "skippy";
  text: string;
}

export interface Convo {
  /** When the last turn was kept (ms). */
  at: number;
  /** Which way the last capture went. */
  last: Capture["kind"] | null;
  turns: ConvoTurn[];
}

const EMPTY: Convo = { at: 0, last: null, turns: [] };
export const convoPath = (phoneId: string) => `haven/convo/${phoneId.replace(/[^A-Za-z0-9_-]/g, "")}.json`;

/** A stored conversation, checked; empty once it has been quiet for CONVO_IDLE_MS. */
export function cleanConvo(raw: unknown, now: number): Convo {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const at = typeof c.at === "number" && Number.isFinite(c.at) ? c.at : 0;
  if (now - at > CONVO_IDLE_MS || at > now + 60_000) return EMPTY;
  const last = c.last === "shopping" || c.last === "todo" || c.last === "skippy" ? c.last : null;
  const turns = (Array.isArray(c.turns) ? c.turns : [])
    .filter((t): t is ConvoTurn => !!t && typeof t === "object" && ((t as ConvoTurn).who === "nikita" || (t as ConvoTurn).who === "skippy") && typeof (t as ConvoTurn).text === "string")
    .map((t) => ({ who: t.who, text: t.text.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX) }))
    .filter((t) => t.text)
    .slice(-CONVO_TURNS);
  return { at, last, turns };
}

/** The phone's conversation, kept for ten quiet minutes. */
export class PhoneConvo {
  constructor(private readonly blob: BlobBackend) {}

  async read(phoneId: string, now: number): Promise<Convo> {
    return cleanConvo(await readJson(this.blob, convoPath(phoneId), null), now);
  }

  /** Adds one exchange (what was said, and the answer) and which way it went. */
  async add(phoneId: string, said: string, say: string, kind: Capture["kind"], now: number): Promise<void> {
    const cur = await this.read(phoneId, now);
    const turns = [...cur.turns, { who: "nikita" as const, text: said }, { who: "skippy" as const, text: say }];
    const next: Convo = { at: now, last: kind, turns: turns.map((t) => ({ ...t, text: t.text.slice(0, TEXT_MAX) })).slice(-CONVO_TURNS) };
    await this.blob.put(convoPath(phoneId), JSON.stringify(next), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  }

  async forget(phoneId: string): Promise<void> {
    await this.blob.del(convoPath(phoneId));
  }
}
