import { create } from "zustand";
import { readInvoiceStatus, type InvoiceStatus } from "../../../../../api/_paypal/status.ts";
import type { InvoiceItem, InvoiceState, InvoicesView } from "../../../../../api/_paypal/types.ts";
import { useSystems, type LinkState } from "../../systems.ts";
import { useDeskAuth } from "../signin.ts";

/**
 * The Spire's invoices (#279, docs/PAYPAL.md), browser side. Two reads of /api/invoices, both on the Azure copy only:
 *
 *   ?view=status   the public counts (drafts, open, overdue, paid): for the Lattice's Spire room, the Spire page's
 *                  ledger and Systems, signed in or not. Counts and states only.
 *   (no query)     the private list for the Spire page: clients, emails, amounts and due dates. Only in the passkey
 *                  session; marked <Private> on the page for Hide mode.
 *
 * Writes (create a draft, send, cancel) go to the same address as JSON in the passkey session. Send and cancel carry
 * `confirm: true`, which the page adds only after its own "Yes, send it" step. On the Vercel copy the route doesn't
 * exist (404), and everything says invoicing lives on the Azure copy.
 */

export type { InvoiceItem, InvoiceState, InvoiceStatus, InvoicesView };

const PATH = "/api/invoices";
const POLL_MS = 60_000;

/** "idle" before the first answer; "off" where the route doesn't exist (the Vercel copy, a local preview). */
export type InvoicesLoad = "idle" | "off" | "live" | "failed";

/** A line on the form, as typed. */
export interface LineInput {
  name: string;
  description: string;
  quantity: string;
  unitAmount: string;
}

/** The form, as typed. */
export interface DraftForm {
  clientName: string;
  clientEmail: string;
  currency: string;
  dueDate: string;
  note: string;
  items: LineInput[];
}

const STATES: readonly string[] = ["draft", "unpaid", "overdue", "paid", "cancelled", "refunded"];
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** One private invoice as the server sent it, or null when it isn't one. */
export function readItem(v: unknown): InvoiceItem | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.id !== "string" || !/^INV2-[A-Z0-9-]{19}$/.test(o.id) || !STATES.includes(o.state as string)) return null;
  const link = typeof o.link === "string" && /^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(o.link) ? o.link : null;
  return {
    id: o.id,
    number: s(o.number, 25),
    state: o.state as InvoiceState,
    viewed: o.viewed === true,
    partial: o.partial === true,
    clientName: s(o.clientName, 200),
    clientEmail: s(o.clientEmail, 254),
    total: s(o.total, 24),
    due: s(o.due, 24),
    currency: /^[A-Z]{3}$/.test(s(o.currency, 3)) ? (o.currency as string) : "",
    invoiceDate: s(o.invoiceDate, 10),
    dueDate: s(o.dueDate, 10),
    link,
  };
}

/** The private view, checked; null when it isn't one. */
export function readView(v: unknown): InvoicesView | null {
  const b = v as Record<string, unknown> | null;
  if (!b || b.ok !== true) return null;
  const status = readInvoiceStatus(b.status);
  if (!status || !Array.isArray(b.items)) return null;
  return { ok: true, status, env: b.env === "live" ? "live" : "sandbox", items: b.items.map(readItem).filter((x): x is InvoiceItem => x !== null) };
}

/** The Boiler Room's PayPal pipe and the Systems light, from the public counts. */
export function linkOf(status: InvoiceStatus | null): LinkState {
  if (!status || status.paypal === "waiting") return "off";
  return status.paypal === "error" ? "down" : "ok";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Where invoicing stands in a few words, for the Lattice, the Spire page and Systems. Counts only. */
export function invoicesLine(load: InvoicesLoad, status: InvoiceStatus | null): string {
  if (load === "off") return "Invoices: on the Azure copy";
  if (!status) return load === "failed" ? "Invoices: not answering" : "Invoices: reading…";
  if (status.paypal === "waiting") return "Invoices: waiting for the PayPal keys";
  if (status.paypal === "error") return "Invoices: PayPal isn't answering";
  const open = plural(status.open, "open invoice", "open invoices");
  return status.overdue ? `${open}, ${status.overdue} overdue` : open;
}

/** The Desk's words for each state. */
export const STATE_WORD: Record<InvoiceState, string> = { draft: "Draft", unpaid: "Sent, unpaid", overdue: "Overdue", paid: "Paid", cancelled: "Cancelled", refunded: "Refunded" };

/** What the server's error codes mean, in the Desk's words. Never echoes a value. */
export const ERROR_TEXT: Record<string, string> = {
  "client-name": "Add the client's name (up to 120 characters).",
  "client-email": "That client email doesn't look right.",
  items: "Add between 1 and 20 lines.",
  "item-name": "Every line needs a name (up to 120 characters).",
  "item-description": "A line's description is too long (300 characters at most).",
  quantity: "Quantities must be above 0, with at most two decimals.",
  amount: "Prices must be above 0, with at most two decimals (up to 100,000).",
  total: "That total is over the 250,000 limit.",
  "due-date": "Pick a due date from today up to a year out.",
  note: "The note is too long (1,000 characters at most).",
  currency: "Pick a currency from the list.",
  confirm: "Sending needs the confirm step.",
  "not-a-draft": "That invoice isn't a draft any more.",
  "not-open": "Only a sent, unpaid invoice can be cancelled.",
  "not-set-up": "PayPal isn't set up on this copy yet.",
  "paypal-keys": "PayPal refused the keys on the Azure copy.",
  "paypal-refused": "PayPal refused that. Check the details and try again.",
  "not-found": "PayPal doesn't know that invoice.",
  paypal: "PayPal didn't answer. Try again in a minute.",
};

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[A-Za-z]{2,}$/;

/** The same checks the server makes, for a message before anything is sent; null when the form looks right. */
export function checkForm(f: DraftForm, today: string): string | null {
  if (!f.clientName.trim() || f.clientName.trim().length > 120) return ERROR_TEXT["client-name"]!;
  if (!EMAIL.test(f.clientEmail.trim())) return ERROR_TEXT["client-email"]!;
  const lines = f.items.filter((i) => i.name.trim() || i.unitAmount.trim());
  if (lines.length < 1 || lines.length > 20) return ERROR_TEXT.items!;
  for (const i of lines) {
    if (!i.name.trim() || i.name.trim().length > 120) return ERROR_TEXT["item-name"]!;
    if (i.description.trim().length > 300) return ERROR_TEXT["item-description"]!;
    const q = i.quantity.trim() || "1";
    if (!MONEY.test(q) || !(Number(q) > 0)) return ERROR_TEXT.quantity!;
    if (!MONEY.test(i.unitAmount.trim()) || !(Number(i.unitAmount) > 0) || Number(i.unitAmount) > 100_000) return ERROR_TEXT.amount!;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate) || f.dueDate < today) return ERROR_TEXT["due-date"]!;
  if (f.note.length > 1000) return ERROR_TEXT.note!;
  return null;
}

/** The form's total, in cents, for the page to show before it's made. */
export function formTotal(f: DraftForm): number {
  return f.items.reduce((sum, i) => {
    const q = Number(i.quantity.trim() || "1");
    const a = Number(i.unitAmount);
    return Number.isFinite(q) && Number.isFinite(a) ? sum + Math.round(q * Math.round(a * 100)) : sum;
  }, 0);
}

/** What goes to the server: lines left blank are dropped. */
export function draftPayload(f: DraftForm) {
  return {
    clientName: f.clientName.trim(),
    clientEmail: f.clientEmail.trim(),
    currency: f.currency || "USD",
    dueDate: f.dueDate,
    note: f.note.trim(),
    items: f.items
      .filter((i) => i.name.trim() || i.unitAmount.trim())
      .map((i) => ({ name: i.name.trim(), description: i.description.trim(), quantity: i.quantity.trim() || "1", unitAmount: i.unitAmount.trim() })),
  };
}

interface InvoicesStore {
  load: InvoicesLoad;
  status: InvoiceStatus | null;
  view: InvoicesView | null;
  /** Set while a write is on its way. */
  busy: boolean;
  error: string | null;
  /** A short line after a write worked. */
  notice: string | null;
  refresh: () => Promise<void>;
  createDraft: (form: DraftForm) => Promise<boolean>;
  /** Sends (or cancels) after the page's confirm step: `confirmed` must be true or nothing is asked of the server. */
  act: (action: "send" | "cancel", id: string, confirmed: boolean) => Promise<boolean>;
}

const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");

function setLink(status: InvoiceStatus | null) {
  const state = linkOf(status);
  useSystems.getState().setLink("paypal", { state, load: status ? Math.min(1, 0.2 + (status.open + status.drafts) / 20) : 0, lastSeen: status?.paypal === "live" ? status.at : null, note: state === "ok" ? (status?.mode === "live" ? "LIVE" : "SANDBOX") : undefined });
}

async function post(body: object): Promise<Response> {
  return fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) });
}

async function errorOf(res: Response): Promise<string> {
  if (res.status === 401) useDeskAuth.getState().lost();
  const got = isJson(res) ? ((await res.json().catch(() => ({}))) as { error?: unknown }) : {};
  return (typeof got.error === "string" && ERROR_TEXT[got.error]) || (res.status === 401 ? "Sign in again to do that." : res.status === 404 ? "Invoicing lives on the Azure copy." : ERROR_TEXT.paypal!);
}

export const useInvoices = create<InvoicesStore>((set, get) => ({
  load: "idle",
  status: null,
  view: null,
  busy: false,
  error: null,
  notice: null,
  refresh: async () => {
    const auth = useDeskAuth.getState().auth.status;
    try {
      if (auth === "in") {
        const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
        if (res.status === 401) useDeskAuth.getState().lost();
        else if (res.status === 404 || !isJson(res)) {
          set({ load: "off", view: null, status: null });
          setLink(null);
          return;
        } else if (res.ok) {
          const view = readView(await res.json());
          if (view) {
            set({ load: "live", view, status: view.status });
            setLink(view.status);
            return;
          }
        }
      }
      // Signed out (or the private read failed): the public counts, and nothing private lingers on the page.
      const res = await fetch(`${PATH}?view=status`, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (res.status === 404 || !isJson(res)) {
        set({ load: "off", view: null, status: null });
        setLink(null);
        return;
      }
      const status = res.ok ? readInvoiceStatus(((await res.json()) as { status?: unknown }).status) : null;
      set({ load: status ? "live" : "failed", status: status ?? get().status, view: null });
      setLink(status ?? get().status);
    } catch {
      set({ load: "failed" });
    }
  },
  createDraft: async (form) => {
    set({ busy: true, error: null, notice: null });
    try {
      const res = await post({ action: "create", draft: draftPayload(form) });
      if (!res.ok) {
        set({ busy: false, error: await errorOf(res) });
        return false;
      }
      set({ busy: false, notice: "Draft made in PayPal. Nothing has gone to the client: tap Send when it's right." });
      await get().refresh();
      return true;
    } catch {
      set({ busy: false, error: ERROR_TEXT.paypal! });
      return false;
    }
  },
  act: async (action, id, confirmed) => {
    if (!confirmed) return false;
    set({ busy: true, error: null, notice: null });
    try {
      const res = await post({ action, id, confirm: true });
      if (!res.ok) {
        set({ busy: false, error: await errorOf(res) });
        return false;
      }
      set({ busy: false, notice: action === "send" ? "Sent. PayPal emailed the client and a copy to you." : "Cancelled. PayPal told the client." });
      await get().refresh();
      return true;
    } catch {
      set({ busy: false, error: ERROR_TEXT.paypal! });
      return false;
    }
  },
}));

let started = false;

/** Start reading (once per page): every minute while the tab is showing, and on sign-in or out. */
export function startInvoices(): void {
  if (started || typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (q.has("offline") || q.has("demo")) return;
  started = true;
  const refresh = () => void useInvoices.getState().refresh();
  refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, POLL_MS);
  let was = useDeskAuth.getState().auth.status;
  useDeskAuth.subscribe((st) => {
    if (st.auth.status !== was) {
      was = st.auth.status;
      if (was !== "checking") refresh();
    }
  });
}
