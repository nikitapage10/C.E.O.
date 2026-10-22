import { useEffect, useMemo, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { STATE_WORD, checkForm, formTotal, invoicesLine, startInvoices, useInvoices, type DraftForm, type InvoiceItem, type LineInput } from "./invoices.ts";
import "./invoices.css";

/**
 * The Spire page's Invoices panel (#279, docs/PAYPAL.md). Fill in a client, lines, a due date and a note, and it makes
 * a PayPal DRAFT: nothing reaches the client. Each draft has a Send button that asks again in the page ("Send to the
 * client?" with Yes, send it / Not yet) before it goes. Open invoices can be cancelled the same way. The list shows
 * where each one stands (draft, sent and unpaid, viewed, paid, overdue, cancelled). Private: served only to the
 * passkey session, and every client, email and amount is wrapped in <Private> for Hide mode. Drawn as text only.
 */

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"];
const emptyLine = (): LineInput => ({ name: "", description: "", quantity: "1", unitAmount: "" });

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function inDays(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * 86_400_000));
}

const blankForm = (): DraftForm => ({ clientName: "", clientEmail: "", currency: "USD", dueDate: inDays(14), note: "", items: [emptyLine()] });

export function money(value: string | number, currency: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function NewInvoice({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<DraftForm>(blankForm);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useInvoices((s) => s.busy);
  const createDraft = useInvoices((s) => s.createDraft);
  const total = formTotal(form);
  const set = (patch: Partial<DraftForm>) => setForm((f) => ({ ...f, ...patch }));
  const setLine = (i: number, patch: Partial<LineInput>) => setForm((f) => ({ ...f, items: f.items.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const wrong = checkForm(form, today());
    setProblem(wrong);
    if (wrong) return;
    if (await createDraft(form)) {
      setForm(blankForm());
      onDone();
    }
  };

  return (
    <form className="iv-form" onSubmit={(e) => void submit(e)} noValidate data-private="">
      <div className="iv-row">
        <label>
          <span>Client name</span>
          <input className="wv-input" value={form.clientName} onChange={(e) => set({ clientName: e.target.value })} maxLength={120} autoComplete="off" required />
        </label>
        <label>
          <span>Client email</span>
          <input className="wv-input" type="email" value={form.clientEmail} onChange={(e) => set({ clientEmail: e.target.value })} maxLength={254} autoComplete="off" required />
        </label>
      </div>
      <fieldset className="iv-lines">
        <legend>Lines</legend>
        {form.items.map((l, i) => (
          <div className="iv-line" key={i}>
            <input className="wv-input iv-l-name" placeholder="What it's for" aria-label={`Line ${i + 1}: name`} value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} maxLength={120} />
            <input className="wv-input iv-l-desc" placeholder="Details (optional)" aria-label={`Line ${i + 1}: details`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} maxLength={300} />
            <input className="wv-input iv-l-qty" inputMode="decimal" aria-label={`Line ${i + 1}: quantity`} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} maxLength={8} />
            <input className="wv-input iv-l-amt" inputMode="decimal" placeholder="0.00" aria-label={`Line ${i + 1}: price each`} value={l.unitAmount} onChange={(e) => setLine(i, { unitAmount: e.target.value })} maxLength={10} />
            {form.items.length > 1 && (
              <button type="button" className="wv-btn is-sm" aria-label={`Remove line ${i + 1}`} onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}>
                Remove
              </button>
            )}
          </div>
        ))}
        {form.items.length < 20 && (
          <button type="button" className="wv-btn is-sm" onClick={() => setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }))}>
            Add a line
          </button>
        )}
      </fieldset>
      <div className="iv-row">
        <label>
          <span>Due</span>
          <input className="wv-input" type="date" value={form.dueDate} min={today()} max={inDays(366)} onChange={(e) => set({ dueDate: e.target.value })} />
        </label>
        <label>
          <span>Currency</span>
          <select className="wv-input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="iv-note">
        <span>Note to the client (optional)</span>
        <textarea className="wv-input" rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={1000} />
      </label>
      {problem && <p className="iv-msg is-bad">{problem}</p>}
      <div className="iv-do">
        <span className="iv-total">
          Total <Private>{money(total / 100, form.currency)}</Private>
        </span>
        <button type="submit" className="wv-btn is-pri" disabled={busy}>
          {busy ? "Making the draft…" : "Make a draft"}
        </button>
      </div>
      <p className="iv-fine">A draft stays in PayPal until you press Send on it. Nothing goes to the client from this button.</p>
    </form>
  );
}

function Invoice({ item }: { item: InvoiceItem }) {
  const busy = useInvoices((s) => s.busy);
  const act = useInvoices((s) => s.act);
  const [asking, setAsking] = useState<"send" | "cancel" | null>(null);
  const word = item.state === "unpaid" && item.viewed ? "Sent, viewed" : item.partial ? "Part paid" : STATE_WORD[item.state];
  return (
    <li className="iv-item" data-state={item.state}>
      <div className="iv-head">
        <b>
          <Private>{item.clientName || "No name"}</Private>
        </b>
        <span className="iv-badge">{word}</span>
      </div>
      <p className="iv-meta">
        <Private>{item.clientEmail}</Private>
        {item.number && <> · No. <Private>{item.number}</Private></>}
        {item.dueDate && <> · due {item.dueDate}</>}
      </p>
      <p className="iv-amount">
        <Private>{money(item.total, item.currency)}</Private>
        {item.partial && item.due && (
          <span className="iv-due">
            {" "}
            · <Private>{money(item.due, item.currency)}</Private> still due
          </span>
        )}
      </p>
      {asking ? (
        <div className="iv-confirm" role="alertdialog" aria-label={asking === "send" ? "Send this invoice?" : "Cancel this invoice?"}>
          <p>
            {asking === "send" ? "Send this invoice to " : "Cancel this invoice? PayPal will tell "}
            <Private>{item.clientEmail || "the client"}</Private>
            {asking === "send" ? "? PayPal emails it to them now." : "."}
          </p>
          <button
            type="button"
            className="wv-btn is-sm is-pri"
            disabled={busy}
            onClick={() => {
              void act(asking, item.id, true).then(() => setAsking(null));
            }}
          >
            {asking === "send" ? "Yes, send it" : "Yes, cancel it"}
          </button>
          <button type="button" className="wv-btn is-sm" disabled={busy} onClick={() => setAsking(null)}>
            Not yet
          </button>
        </div>
      ) : (
        <div className="iv-acts">
          {item.state === "draft" && (
            <button type="button" className="wv-btn is-sm is-pri" disabled={busy} onClick={() => setAsking("send")}>
              Send
            </button>
          )}
          {(item.state === "unpaid" || item.state === "overdue") && (
            <button type="button" className="wv-btn is-sm" disabled={busy} onClick={() => setAsking("cancel")}>
              Cancel invoice
            </button>
          )}
          {item.link && (
            <a className="wv-btn is-sm" href={item.link} target="_blank" rel="noopener noreferrer">
              Open in PayPal
            </a>
          )}
        </div>
      )}
    </li>
  );
}

export function InvoicesSection() {
  const load = useInvoices((s) => s.load);
  const status = useInvoices((s) => s.status);
  const view = useInvoices((s) => s.view);
  const error = useInvoices((s) => s.error);
  const notice = useInvoices((s) => s.notice);
  const auth = useDeskAuth((s) => s.auth.status);
  const signIn = useDeskAuth((s) => s.signIn);
  const [making, setMaking] = useState(false);

  useEffect(() => startInvoices(), []);

  const items = useMemo(() => {
    const order: Record<string, number> = { overdue: 0, draft: 1, unpaid: 2, paid: 3, refunded: 4, cancelled: 5 };
    return [...(view?.items ?? [])].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  }, [view]);

  return (
    <section className="iv" aria-label="Invoices" data-room="spire">
      <header className="iv-top">
        <div>
          <p className="wv-eyb">Invoices · through PayPal</p>
          <h2 className="iv-title">{invoicesLine(load, status)}</h2>
        </div>
        {view && <span className="iv-mode" data-mode={view.env}>{view.env === "live" ? "Live PayPal" : "PayPal sandbox: test money only"}</span>}
      </header>

      {notice && <p className="iv-msg">{notice}</p>}
      {error && <p className="iv-msg is-bad">{error}</p>}

      {load === "off" ? (
        <p className="iv-msg">Invoicing runs on the Azure copy, where the PayPal keys are. Open the Desk there to make and send invoices.</p>
      ) : auth !== "in" ? (
        <div className="iv-gate">
          <p className="iv-msg">Clients and amounts show here only behind your passkey.{status && status.paypal === "live" ? ` ${status.drafts} drafts, ${status.open} open.` : ""}</p>
          <button type="button" className="wv-btn is-pri" onClick={() => void signIn()}>
            Sign in
          </button>
        </div>
      ) : !view ? (
        <p className="iv-msg">Reading…</p>
      ) : view.status.paypal === "waiting" ? (
        <p className="iv-msg">Waiting for the PayPal keys on the Azure copy (docs/PAYPAL.md).</p>
      ) : (
        <>
          {making ? (
            <NewInvoice onDone={() => setMaking(false)} />
          ) : (
            <button type="button" className="wv-btn is-pri iv-new" onClick={() => setMaking(true)}>
              New invoice
            </button>
          )}
          {items.length ? (
            <ul className="iv-list">
              {items.map((i) => (
                <Invoice key={i.id} item={i} />
              ))}
            </ul>
          ) : (
            <p className="iv-msg">No invoices yet.</p>
          )}
          <p className="iv-fine">The newest 50 invoices, read from PayPal each minute while this page is open. The Lattice only ever sees the counts.</p>
        </>
      )}
    </section>
  );
}
