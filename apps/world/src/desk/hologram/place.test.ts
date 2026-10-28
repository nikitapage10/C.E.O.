import { describe, expect, it } from "vitest";
import { placeFor } from "./place.ts";

describe("where the hologram call stands (#538)", () => {
  it("takes the open dock over, standing on its foot, with his words beside it on the left", () => {
    const dock = { left: 996, top: 276, width: 420, height: 600 };
    const p = placeFor(1440, 900, dock, false);
    expect(p.kind).toBe("dock");
    expect([p.pl, p.pt, p.pw, p.ph]).toEqual([996, 276, 420, 600]);
    // He fits inside the box.
    expect(p.w).toBeLessThanOrEqual(dock.width);
    expect(p.h).toBeLessThanOrEqual(dock.height);
    // His words end left of the dock, level with its foot.
    expect(p.ux + p.uw).toBeLessThan(dock.left);
    expect(p.ub).toBe(900 - (276 + 600));
  });

  it("on a phone, he fills the sheet and his words go above it", () => {
    const dock = { left: 0, top: 210, width: 390, height: 634 };
    const p = placeFor(390, 844, dock, true);
    expect(p.kind).toBe("phone");
    expect(p.w).toBeLessThanOrEqual(390);
    expect(p.ux).toBeGreaterThanOrEqual(0);
    expect(p.ux + p.uw).toBeLessThanOrEqual(390);
    // Bottom of the words sits just above the sheet's top edge.
    expect(844 - p.ub).toBeLessThan(dock.top);
  });

  it("with the dock closed, he stands where it would be", () => {
    const p = placeFor(1440, 900, null, false);
    expect(p.pw).toBe(420);
    expect(p.pl + p.pw).toBe(1440 - 24);
    expect(p.pt + p.ph).toBe(900 - 24);
  });
});
