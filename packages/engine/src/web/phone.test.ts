/** The phone layout's one rule (#1045): the width every room shares, and the lighter pixel ratio a phone's scene draws at. */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./phone.css", () => ({}));
const { isPhone, PHONE_MAX, PHONE_QUERY, sceneDpr } = await import("./phone.ts");

function screen(width: number, dpr: number) {
  vi.stubGlobal("window", { devicePixelRatio: dpr, matchMedia: (q: string) => ({ matches: q === PHONE_QUERY && width <= PHONE_MAX, addEventListener() {}, removeEventListener() {} }) });
}

afterEach(() => vi.unstubAllGlobals());

describe("the phone layout (#1045)", () => {
  it("is the width the rooms already used", () => {
    expect(PHONE_QUERY).toBe("(max-width: 760px)");
  });
  it("knows a phone from a desktop", () => {
    screen(393, 3);
    expect(isPhone()).toBe(true);
    screen(1440, 2);
    expect(isPhone()).toBe(false);
  });
  it("draws a phone's scene at no more than 1.25x, a desktop's at no more than 1.75x", () => {
    screen(393, 3);
    expect(sceneDpr()).toBe(1.25);
    screen(1440, 3);
    expect(sceneDpr()).toBe(1.75);
    screen(1440, 1);
    expect(sceneDpr()).toBe(1);
  });
  it("is a desktop with no window", () => {
    expect(isPhone()).toBe(false);
  });
});
