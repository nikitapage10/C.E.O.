import type { InvoiceStatus, InvoicesLoad } from "./invoices.ts";

/**
 * What the Spire's boardroom shows (#825), worked out from the invoices' public counts alone: the same counts the
 * Lattice and the signed-out page already see (drafts, open, overdue, paid), never a client, an address or a sum. The
 * scene (boardroomScene.ts) and the page over it (Boardroom.tsx) both draw from this, so nothing in 3D can show more
 * than the page does. Pure, so it is tested without three.js.
 */

/** Where the PayPal line stands, in one word. */
export type BoardState = "reading" | "off" | "waiting" | "error" | "failed" | "live";

/** One pile of folders on the table: an invoice state and how many sit in it. */
export interface Pile {
  id: "drafts" | "open" | "overdue" | "paid";
  label: string;
  n: number;
}

/** One seat at the table: who sits there and the one real thing they hold. */
export interface Seat {
  id: "ledger" | "memo" | "gilt";
  name: string;
  /** What they're doing, in a few words, from the counts. */
  line: string;
}

export interface BoardView {
  state: BoardState;
  /** "sandbox" while PayPal is on test money; null until it's live. */
  mode: "live" | "sandbox" | null;
  /** The four piles on the table, in the order they sit; empty until PayPal answers. */
  piles: Pile[];
  /** The Executive's easel: the open-invoice count (big) and the word under it. */
  easel: [string, string];
  seats: Seat[];
  /** The page's headline, after "The board is …". */
  word: string;
  /** One line under it. */
  say: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The most folders the table draws for one pile; beyond it the stack stays this tall and the tag says the count. */
export const PILE_MAX = 12;

/** The folders to draw for a pile of `n`: every one up to PILE_MAX. */
export const foldersOf = (n: number): number => Math.max(0, Math.min(PILE_MAX, Math.floor(n)));

export function boardView(load: InvoicesLoad, status: InvoiceStatus | null): BoardView {
  const state: BoardState =
    load === "off" ? "off" : !status ? (load === "failed" ? "failed" : "reading") : status.paypal === "waiting" ? "waiting" : status.paypal === "error" ? "error" : "live";
  const live = state === "live" && status ? status : null;
  const piles: Pile[] = live
    ? [
        { id: "drafts", label: "Drafts", n: live.drafts },
        { id: "open", label: "Open", n: live.open },
        { id: "overdue", label: "Overdue", n: live.overdue },
        { id: "paid", label: "Paid", n: live.paid },
      ]
    : [];
  const quiet: Record<Exclude<BoardState, "live">, [string, string, string]> = {
    reading: ["in session", "Reading PayPal…", "The board is reading PayPal. Nothing goes on the table until it answers."],
    off: ["adjourned here", "On the Azure copy", "Invoicing lives on the Azure copy, where the PayPal keys are. Here the table stays bare rather than guessing."],
    waiting: ["waiting on its keys", "Waiting on PayPal", "The PayPal keys aren't on the Azure copy yet. The chairs are set; the table stays bare."],
    error: ["on hold", "PayPal isn't answering", "PayPal isn't answering. The table keeps nothing rather than an old guess."],
    failed: ["on hold", "Not answering", "The invoices aren't answering. Trying again every minute."],
  };
  if (!live) {
    const [word, easel, say] = quiet[state as Exclude<BoardState, "live">];
    return {
      state,
      mode: null,
      piles,
      easel: ["–", easel],
      word,
      say,
      seats: [
        { id: "gilt", name: "The Executive", line: "Pitching to an empty easel" },
        { id: "ledger", name: "Ledger", line: "Waiting on the books" },
        { id: "memo", name: "Memo", line: "Delegating the wait" },
      ],
    };
  }
  const word = live.overdue ? "chasing" : live.drafts ? "drafting" : live.open ? "collecting" : "in session";
  const say =
    `${plural(live.open, "invoice is", "invoices are")} open${live.overdue ? `, ${live.overdue} past due` : ""}; ` +
    `${plural(live.drafts, "draft waits", "drafts wait")} for the C.E.O.'s Send. Read from PayPal${live.mode === "sandbox" ? "'s sandbox, test money only" : ""}.`;
  return {
    state,
    mode: live.mode === "live" ? "live" : "sandbox",
    piles,
    easel: [String(live.open), live.open === 1 ? "open invoice" : "open invoices"],
    word,
    say,
    seats: [
      { id: "gilt", name: "The Executive", line: live.open ? `Pitching ${plural(live.open, "open invoice", "open invoices")}` : "Pitching an empty pipeline" },
      { id: "ledger", name: "Ledger", line: live.drafts ? `Checking ${plural(live.drafts, "draft", "drafts")} twice` : `${plural(live.paid, "paid", "paid")}, reconciled` },
      { id: "memo", name: "Memo", line: live.overdue ? `Haunting ${plural(live.overdue, "late one", "late ones")}` : "Nothing late to haunt" },
    ],
  };
}
