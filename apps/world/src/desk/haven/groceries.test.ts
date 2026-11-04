import { describe, expect, it } from "vitest";
import { krogerImage, readGroceries } from "./groceries.ts";

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
