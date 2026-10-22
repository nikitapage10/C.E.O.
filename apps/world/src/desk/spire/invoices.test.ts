import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyInvoiceStatus } from "../../../../../api/_paypal/status.ts";
import { useSystems } from "../../systems.ts";
import { checkForm, draftPayload, formTotal, invoicesLine, linkOf, readItem, readView, useInvoices, type DraftForm } from "./invoices.ts";

const NOW = Date.UTC(2026, 9, 22, 18);
const live = { ...emptyInvoiceStatus(NOW, "live"), open: 2, overdue: 1, drafts: 1 };
const form: DraftForm = { clientName: "A client", clientEmail: "a@example.com", currency: "USD", dueDate: "2026-11-05", note: "", items: [{ name: "Work", description: "", quantity: "2", unitAmount: "12.50" }, { name: "", description: "", quantity: "1", unitAmount: "" }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Spire's invoices on the Desk", () => {
  it("says where invoicing stands in counts only", () => {
    expect(invoicesLine("off", null)).toBe("Invoices: on the Azure copy");
    expect(invoicesLine("live", emptyInvoiceStatus(NOW))).toBe("Invoices: waiting for the PayPal keys");
    expect(invoicesLine("live", { ...live, paypal: "error" })).toBe("Invoices: PayPal isn't answering");
    expect(invoicesLine("live", live)).toBe("2 open invoices, 1 overdue");
    expect(invoicesLine("live", { ...live, open: 1, overdue: 0 })).toBe("1 open invoice");
  });

  it("lights the PayPal pipe from the counts", () => {
    expect(linkOf(null)).toBe("off");
    expect(linkOf(emptyInvoiceStatus(NOW))).toBe("off");
    expect(linkOf(live)).toBe("ok");
    expect(linkOf({ ...live, paypal: "error" })).toBe("down");
  });

  it("reads the private view defensively", () => {
    const item = { id: "INV2-AAAA-BBBB-CCCC-DDDD", number: "0042", state: "draft", viewed: false, partial: false, clientName: "A client", clientEmail: "a@example.com", total: "25.00", due: "25.00", currency: "USD", invoiceDate: "2026-10-22", dueDate: "2026-11-05", link: "https://www.sandbox.paypal.com/invoice/details/INV2-AAAA-BBBB-CCCC-DDDD" };
    expect(readItem(item)).toEqual(item);
    expect(readItem({ ...item, link: "javascript:alert(1)" })?.link).toBeNull();
    expect(readItem({ ...item, state: "sent" })).toBeNull();
    const view = readView({ ok: true, status: live, env: "sandbox", items: [item, { bad: true }] });
    expect(view?.items).toHaveLength(1);
    expect(readView({ ok: true, status: { ...live, client: "x" }, items: [] })).toBeNull();
  });

  it("checks the form like the server, and drops blank lines", () => {
    expect(checkForm(form, "2026-10-22")).toBeNull();
    expect(checkForm({ ...form, clientEmail: "nope" }, "2026-10-22")).toMatch(/email/);
    expect(checkForm({ ...form, dueDate: "2026-10-21" }, "2026-10-22")).toMatch(/due date/);
    expect(checkForm({ ...form, items: [{ name: "x", description: "", quantity: "1", unitAmount: "1.999" }] }, "2026-10-22")).toMatch(/Prices/);
    expect(formTotal(form)).toBe(2500);
    expect(draftPayload(form).items).toEqual([{ name: "Work", description: "", quantity: "2", unitAmount: "12.50" }]);
  });

  it("never asks the server to send without the page's confirm step", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await useInvoices.getState().act("send", "INV2-AAAA-BBBB-CCCC-DDDD", false)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the Vercel copy waiting: the route isn't there", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html>", { status: 404, headers: { "content-type": "text/html" } })),
    );
    await useInvoices.getState().refresh();
    expect(useInvoices.getState().load).toBe("off");
    expect(invoicesLine(useInvoices.getState().load, useInvoices.getState().status)).toBe("Invoices: on the Azure copy");
    expect(useSystems.getState().links.find((l) => l.id === "paypal")?.state).toBe("off");
  });
});
