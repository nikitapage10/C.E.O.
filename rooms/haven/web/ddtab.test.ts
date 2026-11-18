import { describe, expect, it } from "vitest";
import { activeOrderOf, cartCents, cartCount, glyphOf, initialOf, rememberStore, slotParam, stepOf, storeFacts, storeParam, toneOf, withStore, withStoreInfo } from "./ddtab.ts";
import { ddImage, readMenu, readOrder, readStore } from "./order.ts";

/** The DoorDash tab's small rules (#1195). */
describe("the DoorDash tab (#1195)", () => {
  it("stand-ins: a letter, a steady tint, a cuisine glyph when the name says one", () => {
    expect(initialOf("  sakura sushi")).toBe("S");
    expect(initialOf("—")).toBe("?");
    expect(toneOf("Ramen Bar")).toBe(toneOf("ramen bar"));
    expect(toneOf("x")).toBeGreaterThanOrEqual(0);
    expect(glyphOf("Sakura Sushi")).toBe("🍣");
    expect(glyphOf("La Taqueria")).toBe("🌮");
    expect(glyphOf("Plain Name")).toBeNull();
  });

  it("a store's facts line", () => {
    expect(storeFacts({ rating: 4.6, eta: "25 min", fee: "Free delivery", miles: 1.2 })).toEqual(["★ 4.6", "25 min", "Free delivery", "1.2 mi"]);
    expect(storeFacts({ rating: null, eta: null, fee: null, miles: null })).toEqual([]);
  });

  it("the deep link: a numeric store, other parameters kept", () => {
    expect(storeParam("?store=928163")).toBe("928163");
    expect(storeParam("?store=92;rm")).toBeNull();
    expect(storeParam("")).toBeNull();
    expect(withStore("/haven/doordash", "?slot=sat-dinner", "5")).toBe("/haven/doordash?slot=sat-dinner&store=5");
    expect(withStore("/haven/doordash", "?store=5&slot=sat-dinner", null)).toBe("/haven/doordash?slot=sat-dinner");
    expect(withStore("/haven/doordash", "?store=5", null)).toBe("/haven/doordash");
  });

  it("the meal plan's slot, and remembering a store for it", async () => {
    expect(slotParam("?slot=sat-dinner&week=2026-11-16")).toEqual({ day: "sat", course: "dinner", words: "Saturday dinner" });
    expect(slotParam("?slot=xyz-dinner")).toBeNull();
    expect(slotParam("?slot=sat-brunch")).toBeNull();
    let sent: unknown = null;
    const f = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response("{}", { status: 400 });
    }) as unknown as typeof fetch;
    expect(await rememberStore({ day: "sat", course: "dinner" }, { id: "5", name: "Sakura" }, f)).toBe(false);
    expect(sent).toEqual({ action: "edit", edit: { op: "order-store", day: "sat", course: "dinner", store: { id: "5", name: "Sakura" } } });
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await rememberStore({ day: "sun", course: "dinner" }, null, ok)).toBe(true);
  });

  it("which order the Active strip follows, and its step", () => {
    const now = Date.parse("2026-11-18T02:00:00Z");
    expect(activeOrderOf(["a1"], [], now)).toBe("a1");
    expect(activeOrderOf([], [{ id: "old", when: "2026-11-17T20:00:00Z" }, { id: "x", when: null }], now)).toBeNull();
    expect(activeOrderOf([], [{ id: "new", when: "2026-11-18T01:15:00Z" }], now)).toBe("new");
    expect(["placed", "dasher_at_store", "picked_up", "completed", "order_declined"].map(stepOf)).toEqual([0, 1, 2, 3, -1]);
  });

  it("the cart's count and subtotal", () => {
    const cart = { storeId: "1", storeName: "A", maybeSpent: false, lines: [{ id: "l1", itemId: "i", name: "Roll", qty: 2, unit: null, priceCents: 650 }, { id: "l2", itemId: "j", name: "Fish", qty: 1.5, unit: "lb", priceCents: 1200 }] };
    expect(cartCount(cart)).toBe(3);
    expect(cartCents(cart)).toBe(2500);
    expect(cartCents({ ...cart, lines: [{ ...cart.lines[0]!, priceCents: null }] })).toBeNull();
    expect(cartCount(null)).toBe(0);
  });

  it("pictures from the server are read again: DoorDash's hosts only", () => {
    expect(ddImage("https://img.cdn4dd.com/a.jpg")).toBe("https://img.cdn4dd.com/a.jpg");
    expect(ddImage("https://doordash-static.s3.amazonaws.com/a.jpg")).toBe("https://doordash-static.s3.amazonaws.com/a.jpg");
    expect(ddImage("https://evil.test/a.jpg")).toBeNull();
    expect(ddImage("javascript:alert(1)")).toBeNull();
    const s = readStore({ id: "5", name: "Sakura", image: "https://evil.test/a.jpg", logo: "https://img.cdn4dd.com/l.png", fee: "Free delivery", cuisine: "Sushi" })!;
    expect(s).toMatchObject({ image: null, logo: "https://img.cdn4dd.com/l.png", fee: "Free delivery", cuisine: "Sushi" });
    expect(readMenu({ storeId: "1", menuId: "2", sections: [], image: "https://img.cdn4dd.com/h.jpg" })!.image).toBe("https://img.cdn4dd.com/h.jpg");
    const o = readOrder({ id: "abcdef01-0000", store: "Sakura", storeId: "5", image: "https://img.cdn4dd.com/c.jpg" })!;
    expect(withStoreInfo(o, new Map([["5", s]]))).toEqual({ image: "https://img.cdn4dd.com/c.jpg", facts: ["Free delivery"], cuisine: "Sushi" });
    expect(withStoreInfo({ ...o, image: null }, new Map([["5", s]])).image).toBe("https://img.cdn4dd.com/l.png");
  });
});
