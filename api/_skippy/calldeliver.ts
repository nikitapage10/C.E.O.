/**
 * A Talk call's question that couldn't be answered inside the tool's five seconds (#1054): the answer is worked out
 * here, on the instance that took the question, and kept on its turn in the `kernel` log the moment it is in, so the
 * call's chat (which looks every two seconds on a live call) puts it straight into the call.
 *
 * Nikita, 2026-11-12: a plain web question waited two minutes on filler and the answer never came. The call's own web
 * search was dropped once it ran past the tool's budget, and the deeper run was started by a request to the Function
 * App's own address, which the Static Web App's linked backend refuses (401), so nothing ever answered.
 *
 * So, in order, all inside CALL_ANSWER_MS:
 *   1. The search the call already started, when there is one: its answer is kept as soon as it is in (usually 8 to
 *      15 s after the question). No second search, no deeper run.
 *   2. Otherwise (no search, or it found nothing or failed): Skippy's one brain, deeper (api/skippy.ts deepAnswer),
 *      for whatever time is left.
 *   3. Nothing by the deadline: an honest final line ("I couldn't get that answer in time"), so the call is never left
 *      on filler.
 *
 * Exactly one final answer is kept per question, and its time from the question is noted (#1065, answertimes.ts). Pure apart from what is handed in; the tests drive it with fakes.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { AnswerKind } from "./answertimes.js";
import { fitAnswer, withoutMoney } from "./kernelagent.js";
import { STILL_SEARCHING, isEmptyLookup, withoutMeta } from "./voicelookups.js";

/** The longest a call's question waits for its answer before Skippy says plainly he couldn't get it. */
export const CALL_ANSWER_MS = 45_000;
/** The longest the call's own search is waited on before the deeper run takes the question instead. */
export const SEARCH_WAIT_MS = 25_000;
/** The least time worth giving the deeper run; with less left, the honest line goes in at once. */
export const DEEP_MIN_MS = 4_000;

/** Said when no answer came in time: final, so the call stops waiting and says it once. */
export const NO_ANSWER = "I couldn't get that answer in time, so I won't guess. Ask me again in a moment, or type it into the chat.";
/** Said when the answer that came back can't be kept (a money figure or something private in it). */
export const UNFIT = "That answer had a money figure or something private in it, so I'm keeping it off the call.";

/** One question to answer: its kept turn, the words, how deep, and the call's search for it when one is running. */
export interface CallJob {
  id: string;
  ask: string;
  depth: "talk" | "hard";
  /** The search the call started for this question (voicelookups.ts webSearch), still running. */
  search?: Promise<string> | null;
  /** When the question reached the call's tools (ms); left out, timed from the start here. */
  asked?: number;
}

export interface DeliverDeps {
  /** Keeps the final answer on the turn; whether it was kept. */
  keep(id: string, text: string): Promise<boolean>;
  /** Skippy's one brain, deeper; left out, only the search can answer. */
  deep?: ((ask: string, depth: "talk" | "hard") => Promise<string>) | null;
  now(): number;
  /** One line of state for the Function's log: never the question or the answer. */
  log?: (line: string) => void;
  /** Notes how long the question took and how it ended (#1065): only the kind and the milliseconds. */
  timed?: ((kind: AnswerKind, ms: number) => Promise<void> | void) | null;
}

export type Delivered = "search" | "deep" | "unfit" | "timeout";

/** A promise's value, or null once `ms` has passed or when it fails. */
export function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
  });
  return Promise.race([work.catch(() => null), late]).finally(() => clearTimeout(timer));
}

/**
 * A search's text as an answer to keep: its summary without the "Web search for …:" label, its narration or its doubts
 * about a page's date (#1069); "" when it has none. A usable answer is final: a date mentioned in it never sends the
 * question deeper.
 */
export function searchAnswer(text: string | null): string {
  if (!text || text === STILL_SEARCHING || isEmptyLookup(text)) return "";
  const body = withoutMeta(text.replace(/^Web search for "[^"]*":\s*/, ""));
  return body ? fitAnswer(withoutMoney(body)) : "";
}

/** Works out one call question's answer and keeps it (see the top of this file). Never throws. */
export async function deliverCallAnswer(job: CallJob, d: DeliverDeps, limits: { totalMs?: number; searchMs?: number } = {}): Promise<Delivered> {
  const start = d.now();
  const total = limits.totalMs ?? CALL_ANSWER_MS;
  const left = () => total - (d.now() - start);
  const done = async (how: Delivered, text: string): Promise<Delivered> => {
    const kept = await d.keep(job.id, text).catch(() => false);
    const end = d.now();
    d.log?.(`skippy-call answer ${how} ms=${end - start}${kept ? "" : " unkept"}`);
    // Timed after the answer is kept, so noting it never holds the answer up.
    await Promise.resolve()
      .then(() => d.timed?.(how === "search" || how === "timeout" ? how : "deeper", Math.max(0, end - (job.asked ?? start))))
      .catch(() => undefined);
    return how;
  };
  try {
    if (job.search) {
      const got = searchAnswer(await within(job.search, Math.min(limits.searchMs ?? SEARCH_WAIT_MS, left())));
      if (got) return await done("search", got);
    }
    if (d.deep && left() >= DEEP_MIN_MS) {
      const said = await within(d.deep(job.ask, job.depth), left());
      if (typeof said === "string" && said.trim()) {
        // Without its narration ("so I'll search", "this looks surprising, so I'll verify it", #1116): only the answer.
        const text = fitAnswer(withoutMeta(said));
        return await done(text ? "deep" : "unfit", text || UNFIT);
      }
    }
  } catch {
    /* falls through to the honest line */
  }
  return done("timeout", NO_ANSWER);
}
