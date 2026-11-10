import { describe, expect, it } from "vitest";
import { emptyInvoiceStatus } from "../../../api/_paypal/status.ts";
import { boardView, foldersOf, PILE_MAX } from "./boardroom.ts";

const NOW = Date.UTC(2026, 10, 6, 18);
const live = { ...emptyInvoiceStatus(NOW, "live"), open: 3, overdue: 1, drafts: 2, paid: 5 };

describe("the Spire's boardroom (#825)", () => {
  it("lays the four piles from the public counts, and nothing else", () => {
    const v = boardView("live", live);
    expect(v.state).toBe("live");
    expect(v.piles.map((p) => [p.id, p.n])).toEqual([
      ["drafts", 2],
      ["open", 3],
      ["overdue", 1],
      ["paid", 5],
    ]);
    expect(v.easel).toEqual(["3", "open invoices"]);
    expect(v.word).toBe("chasing");
    // Counts and words only: no currency sign or decimal anywhere a sum could hide.
    expect(JSON.stringify(v)).not.toMatch(/[$€£]|\d+\.\d{2}/);
  });

  it("gives each seat its real job", () => {
    const v = boardView("live", live);
    expect(v.seats.map((s) => s.id)).toEqual(["gilt", "ledger", "memo"]);
    expect(v.seats.find((s) => s.id === "ledger")!.line).toBe("Checking 2 drafts twice");
    expect(v.seats.find((s) => s.id === "memo")!.line).toBe("Haunting 1 late one");
    const calm = boardView("live", { ...live, overdue: 0, drafts: 0, open: 1 });
    expect(calm.word).toBe("collecting");
    expect(calm.easel).toEqual(["1", "open invoice"]);
    expect(calm.seats.find((s) => s.id === "memo")!.line).toBe("Nothing late to haunt");
    expect(calm.seats.find((s) => s.id === "ledger")!.line).toBe("5 paid, reconciled");
  });

  it("says the sandbox plainly", () => {
    expect(boardView("live", { ...live, mode: "sandbox" }).say).toMatch(/sandbox, test money only/);
    expect(boardView("live", { ...live, mode: "live" }).mode).toBe("live");
  });

  it("keeps the table bare until PayPal answers", () => {
    for (const [load, status, state] of [
      ["idle", null, "reading"],
      ["off", null, "off"],
      ["failed", null, "failed"],
      ["live", emptyInvoiceStatus(NOW), "waiting"],
      ["live", { ...live, paypal: "error" as const }, "error"],
    ] as const) {
      const v = boardView(load, status);
      expect(v.state).toBe(state);
      expect(v.piles).toEqual([]);
      expect(v.easel[0]).toBe("–");
      expect(v.mode).toBeNull();
    }
  });

  it("caps a pile's folders", () => {
    expect(foldersOf(0)).toBe(0);
    expect(foldersOf(4)).toBe(4);
    expect(foldersOf(400)).toBe(PILE_MAX);
    expect(foldersOf(-2)).toBe(0);
  });
});
