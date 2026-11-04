import { describe, expect, it } from "vitest";
import { krogerImage, matchAll, readGroceries, shelfOf, type GAction, type GReply } from "./groceries.ts";

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
  const reply = (matched: number, left: number, ok = true): GReply => ({ ok, status: ok ? 200 : 502, error: ok ? null : "vendor", view: null, url: null, items: 0, already: 0, matched, left });

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
