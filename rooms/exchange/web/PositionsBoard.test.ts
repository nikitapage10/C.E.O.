import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PositionsView } from "./PositionsBoard.tsx";

const p = { market: "Brewers win?", outcome: "Yes", url: null, short: false, contracts: 40, avgPrice: 0.55, value: 25.2, cost: 22, pnl: 3.2, pnlPct: 14.5, realized: 0, expired: false };

describe("the positions board (#253)", () => {
  it("wraps every dollar figure, size and P&L in <Private>, so Hide mode veils them all", () => {
    const html = renderToStaticMarkup(
      createElement(PositionsView, {
        status: "live",
        reason: null,
        onSignIn: () => {},
        data: { ok: true, state: "live", at: "2026-10-22T12:00:00Z", positions: [p], activity: [{ at: "2026-10-21T00:00:00Z", kind: "trade", market: "Brewers win?", url: null, contracts: 40, price: 0.55 }], totals: { open: 1, value: 25.2, cost: 22, pnl: 3.2 }, more: false },
      }),
    );
    expect(html).toContain("$25.20");
    expect(html).toContain('data-private=""');
    // Drop every private element: no money, size or percentage may be left showing.
    const open = html.replace(/<(span|b)[^>]*data-private=""[^>]*>.*?<\/\1>/g, "");
    expect(open).not.toMatch(/\$\d|\d+(\.\d+)?%|\d+ contracts|@ \d/);
  });

  it("waits for the key, saying so, with no figures at all", () => {
    const html = renderToStaticMarkup(createElement(PositionsView, { status: "waiting", data: null, reason: "no-key", onSignIn: () => {} }));
    expect(html).toContain("Waiting for your Polymarket US key");
    expect(html).not.toMatch(/\$\d/);
  });

  it("signed out, shows only where the book is: a state and a sign-in, never a figure (#367)", () => {
    const html = renderToStaticMarkup(createElement(PositionsView, { status: "signed-out", data: null, reason: null, onSignIn: () => {} }));
    expect(html).toContain("behind the Desk&#x27;s passkey");
    expect(html).toContain("Sign in");
    expect(html).not.toMatch(/\$\d|\d+(\.\d+)?%|contracts? ·|@ \d/);
  });
});
