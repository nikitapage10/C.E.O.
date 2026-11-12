import { describe, expect, it } from "vitest";
import { NAV_ORDER } from "../../world/src/route.ts";
import { PINNED, phoneShelf } from "./phoneShelf.ts";

describe("the phone's bottom bar (#1045)", () => {
  it("pins the first three pages of the bar's order", () => {
    expect([...PINNED]).toEqual(NAV_ORDER.slice(0, 3));
  });
  it("shows the room on screen in the last slot only when it isn't pinned", () => {
    expect(phoneShelf("haven").other).toBeNull();
    expect(phoneShelf("today").other).toBeNull();
    expect(phoneShelf("studio").other).toBe("studio");
    expect(phoneShelf("boiler").other).toBe("boiler");
  });
});
