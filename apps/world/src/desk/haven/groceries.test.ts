import { describe, expect, it } from "vitest";
import { krogerImage, matchAll, readGroceries, reviewOf, shelfOf, VERDICT_BADGE, type GAction, type GReply } from "./groceries.ts";

/** Product photos on the Kitchen page (#677): only Kroger's own https image host ever reaches an <img>. */

describe("grocery photos (#677)", () => {
  it("keeps https photos on kroger.com and drops anything else", () => {
    expect(krogerImage("https://www.kroger.com/product/images/medium/front/0001111000001")).toBe("https://www.kroger.com/product/images/medium/front/0001111000001");
    for (const bad of ["http://www.kroger.com/a.jpg", "https://evil.example/a.jpg", "https://kroger.com.evil.example/a.jpg", "https://www.kroger.com:8443/a.jpg", "data:image/png;base64,AAAA", "javascript:alert(1)", null, 3]) expect(krogerImage(bad)).toBeNull();
  });

  it("reads the photo with each pick and alternative", () => {
    const prod = (productId: string, image: unknown) => ({ productId, description: "Lobster Tails", brand: "", size: "", price: 1999, promo: null, stock: "high", image });
    const view = readGroceries({ ready: true, lines: [{ id: "1", name: "Lobster", key: "lobster", pick: { product: prod("1", "https://www.kroger.com/a.jpg"), alts: [prod("2", "https://evil.example/b.jpg")], at: "2026-11-04T18:00:00Z" } }] });
    expect(view?.lines[0]?.pick?.product?.image).toBe("https://www.kroger.com/a.jpg");
    expect(view?.lines[0]?.pick?.alts[0]?.image).toBeNull();
  });
});

describe("Shopping (#737)", () => {
  const reply = (matched: number, left: number, ok = true): GReply => ({ ok, status: ok ? 200 : 502, error: ok ? null : "vendor", view: null, url: null, items: 0, already: 0, matched, left, by: null, usd: 0 });

  it("matches everything in one press, telling how far it got", async () => {
    const answers = [reply(25, 13), reply(13, 0)];
    const asked: GAction[] = [];
    const seen: string[] = [];
    const r = await matchAll(
      (d, of) => seen.push(`${d} of ${of}`),
      async (b) => (asked.push(b), answers.shift()!),
    );
    expect(r.left).toBe(0);
    expect(asked).toEqual([{ action: "match" }, { action: "match" }]);
    expect(seen).toEqual(["25 of 38", "38 of 38"]);
  });

  it("stops on a failure, a call that matched nothing, or the cap", async () => {
    let n = 0;
    await matchAll(
      () => undefined,
      async () => (n++, reply(0, 5)),
    );
    expect(n).toBe(1);
    n = 0;
    await matchAll(
      () => undefined,
      async () => (n++, reply(3, 4, false)),
    );
    expect(n).toBe(1);
    n = 0;
    await matchAll(
      () => undefined,
      async () => (n++, reply(1, 99)),
      3,
    );
    expect(n).toBe(3);
  });

  it("puts an item on its shelf: Kroger's department once matched, else its words", () => {
    expect(shelfOf("Lemons")).toBe("Produce");
    expect(shelfOf("chicken thighs")).toBe("Meat & seafood");
    expect(shelfOf("chicken stock")).toBe("Pantry");
    expect(shelfOf("tomato paste")).toBe("Pantry");
    expect(shelfOf("heavy cream")).toBe("Dairy & eggs");
    expect(shelfOf("snow peas")).toBe("Produce");
    expect(shelfOf("something odd")).toBe("Other");
    const p = readGroceries({ ready: true, lines: [{ id: "1", name: "x", key: "x", pick: { product: { productId: "1", price: 100, categories: ["Baking Goods"], aisle: "Aisle 12" } } }] })!.lines[0]!.pick!.product!;
    expect(p).toMatchObject({ aisle: "Aisle 12", categories: ["Baking Goods"] });
    expect(shelfOf("panko", p)).toBe("Baking Goods");
  });

  it("reads which picks are already in the cart", () => {
    const v = readGroceries({
      ready: true,
      lines: [
        { id: "1", name: "a", key: "a", pick: null, inCart: true },
        { id: "2", name: "b", key: "b", pick: null, inCart: "yes" },
      ],
    });
    expect(v?.lines.map((l) => l.inCart)).toEqual([true, false]);
  });
});

describe("the quantity check (#761)", () => {
  const prod = { productId: "g1", price: 79, description: "Fresh Garlic", size: "1 ct" };
  it("reads each pick's check, count and staleness strictly", () => {
    const v = readGroceries({
      ready: true,
      plan: { changed: 1, stale: 1, fresh: 2 },
      lines: [
        { id: "1", name: "garlic 30 cloves", key: "garlic 30 clove", qty: 3, stale: true, pick: { product: prod, alts: [], review: { productId: "g1", qty: 3, verdict: "covered", reason: "1 head ≈ 10 cloves", better: null, by: "ai" } } },
        { id: "2", name: "panko", key: "panko", qty: 99, pick: { product: { ...prod, productId: "k1" }, alts: [], review: { productId: "k1", qty: 1, verdict: "great", reason: "x" } } },
        { id: "3", name: "eggs", key: "egg", qty: 2, pick: { product: { ...prod, productId: "e2" }, alts: [], review: { productId: "e1", qty: 2, verdict: "short", reason: "old pick", better: null } } },
      ],
    })!;
    expect(v.plan).toEqual({ changed: 1, stale: 1, fresh: 2 });
    expect(v.lines.map((l) => [l.qty, l.stale])).toEqual([
      [3, true],
      [1, false],
      [2, false],
    ]);
    expect(reviewOf(v.lines[0]!)).toMatchObject({ qty: 3, verdict: "covered", by: "ai" });
    expect(v.lines[1]!.pick!.review).toBeNull();
    // A check made for another product doesn't hold for this one.
    expect(reviewOf(v.lines[2]!)).toBeNull();
    expect(VERDICT_BADGE.covered).toBeNull();
    expect(VERDICT_BADGE.wrong).toBe("wrong product");
  });

  it("an old answer without a plan reads as unchanged", () => {
    expect(readGroceries({ ready: true, lines: [] })!.plan).toEqual({ changed: 0, stale: 0, fresh: 0 });
  });
});
