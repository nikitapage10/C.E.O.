import { describe, expect, it } from "vitest";
import type { Product } from "./api.ts";
import { rankProducts, scoreProduct, stem } from "./rank.ts";

/** The default King Soopers pick for a list item (#677). Products are made up in the shape api.ts reads. */

const p = (description: string, brand = "", stock: Product["stock"] = "high") => ({ description, brand, stock });
const order = (term: string, found: ReturnType<typeof p>[]) => rankProducts(term, found).map((x) => x.description);

describe("the default pick (#677)", () => {
  it("picks real lobster over imitation, mixes, ravioli, crab and the Red Lobster brand", () => {
    const found = [
      p("Kroger Lobster Select Chunk Style Imitation Lobster Meat", "Kroger"),
      p("Red Lobster Cheddar Bay Biscuit Mix", "Red Lobster"),
      p("Rana Lobster Ravioli", "Rana"),
      p("Kroger Imitation Crab Flake Style", "Kroger"),
      p("Aqua Star Twin Pack Cold Water Lobster Tails", "Aqua Star"),
      p("Seamazz North Atlantic Lobster Meat", "Seamazz"),
    ];
    const ranked = order("Lobster", found);
    expect(ranked.slice(0, 2)).toEqual(["Aqua Star Twin Pack Cold Water Lobster Tails", "Seamazz North Atlantic Lobster Meat"]);
    expect(ranked.indexOf("Kroger Lobster Select Chunk Style Imitation Lobster Meat")).toBeGreaterThan(ranked.indexOf("Rana Lobster Ravioli"));
    expect(ranked.slice(-2)).toContain("Red Lobster Cheddar Bay Biscuit Mix");
  });

  it("leaves an out-of-stock product behind one in stock", () => {
    expect(order("lemons", [p("Lemons", "", "out"), p("Organic Lemons", "", "low")])[0]).toBe("Organic Lemons");
  });

  it("keeps Kroger's order on a tie", () => {
    expect(order("oat milk", [p("Test Oat Milk"), p("Other Oat Milk")])).toEqual(["Test Oat Milk", "Other Oat Milk"]);
  });

  it("prefers the item as the main noun, and every word of a longer item", () => {
    expect(order("tomato", [p("Tomato Soup"), p("Roma Tomatoes")])[0]).toBe("Roma Tomatoes");
    expect(order("chicken breast", [p("Chicken Thighs"), p("Boneless Skinless Chicken Breasts")])[0]).toBe("Boneless Skinless Chicken Breasts");
  });

  it("doesn't mark down a word the item names itself", () => {
    expect(scoreProduct("pancake mix", p("Buttermilk Pancake Mix"))).toBeGreaterThan(scoreProduct("pancake mix", p("Pancakes")));
    expect(scoreProduct("taco seasoning", p("Mild Taco Seasoning"))).toBeGreaterThan(0);
  });

  it("folds plurals", () => {
    expect(["lemons", "tomatoes", "berries", "peaches", "glass", "eggs"].map(stem)).toEqual(["lemon", "tomato", "berry", "peach", "glass", "egg"]);
  });

  it("puts panko over a plastic cup, and marks a unit-only hit below any food (#737)", () => {
    expect(scoreProduct("panko", p("Solo Plastic Snack Cups 9 oz"))).toBeLessThan(scoreProduct("panko", p("Kroger Plain Bread Crumbs")));
    expect(rankProducts("panko", [p("Party Cups 16 oz"), p("Kikkoman Panko Bread Crumbs")])[0]!.description).toBe("Kikkoman Panko Bread Crumbs");
  });
});
