import { describe, expect, it, vi } from "vitest";
import { ddLink, money, noteOf, orderCall, picksOk, placeKey, readCart, readMenu, readPlacement, readPreview, readStatus, tipChoices } from "./order.ts";

/** The Order tab's browser side (#1195): what the server sends is read again as untrusted data. */

const PREVIEW = {
  id: "0123456789abcdef",
  until: "2026-11-17T18:05:00.000Z",
  netCents: 3820,
  lines: [{ name: "Tonkotsu", qty: 2, price: "$15.50" }],
  breakdown: [{ label: "Credits", cents: 100, minus: true }],
  card: "Visa ending in 4242",
  address: "Home",
  tips: [{ label: "20%", cents: 620 }],
  tipDefault: 620,
  windows: [{ label: "7:00 PM-7:20 PM", day: "Tue, Nov 17", at: "2026-11-18T02:10:00.000Z" }],
  capCents: 100000,
};

describe("the Order tab's readers (#1195)", () => {
  it("takes a preview only with its id, total and expiry; drops odd fields", () => {
    const p = readPreview({ ...PREVIEW, card_id: "pmf_v1_x", windows: [...PREVIEW.windows, { label: "x", at: "not a time" }] })!;
    expect(p).toMatchObject({ id: PREVIEW.id, netCents: 3820, card: "Visa ending in 4242", address: "Home", tipDefault: 620, capCents: 100000 });
    expect(p.windows).toHaveLength(1);
    expect(JSON.stringify(p)).not.toContain("pmf_");
    expect(readPreview({ ...PREVIEW, id: "../x" })).toBeNull();
    expect(readPreview({ ...PREVIEW, netCents: 12.5 })).toBeNull();
    expect(readPreview({ ...PREVIEW, netCents: -1 })).toBeNull();
  });

  it("links and pictures only https on DoorDash's own hosts", () => {
    expect(ddLink("https://www.doordash.com/orders/x")).toBe("https://www.doordash.com/orders/x");
    expect(ddLink("https://doordash.com.evil.test/")).toBeNull();
    expect(ddLink("http://www.doordash.com/")).toBeNull();
    expect(readStatus({ status: "picked_up", link: "https://evil.test/", final: false })).toEqual({ status: "picked_up", eta: null, link: null, final: false });
    expect(readStatus({ status: "rm -rf" })).toBeNull();
  });

  it("a menu and a cart with checked ids", () => {
    const m = readMenu({ storeId: "1", menuId: "2", sections: [{ name: "Ramen", items: [{ id: "3", name: "Shoyu", priceCents: 1400, image: "https://evil.test/x.png" }, { id: "<b>", name: "Bad" }] }] })!;
    expect(m.sections[0]!.items).toEqual([{ id: "3", name: "Shoyu", desc: null, priceCents: 1400, image: null, orderable: "asap" }]);
    expect(readCart({ storeName: "Ramen Bar", lines: [{ id: "l1", name: "Shoyu", qty: 2, priceCents: 1400 }, { name: "No qty" }] })!.lines).toHaveLength(1);
    expect(readCart(null)).toBeNull();
    expect(readPlacement({ status: "maybe", orderId: null, totalCents: 3820 })).toEqual({ status: "maybe", orderId: null, error: null, totalCents: 3820 });
    expect(readPlacement({ status: "charged" })).toBeNull();
  });

  it("tip choices: DoorDash's, then no tip; none on pick-up", () => {
    expect(tipChoices({ tips: [{ label: "15%", cents: 465 }, { label: "20%", cents: 620 }], tipDefault: 620, pickup: false, pretippable: true }).map((t) => t.cents)).toEqual([465, 620, 0]);
    expect(tipChoices({ tips: [], tipDefault: null, pickup: false, pretippable: true }).map((t) => t.cents)).toEqual([300, 500, 800, 0]);
    expect(tipChoices({ tips: [{ label: "15%", cents: 465 }], tipDefault: null, pickup: true, pretippable: true })).toEqual([]);
  });

  it("choices meet each group's minimum and maximum", () => {
    const g = [{ id: "g", name: "Noodles", min: 1, max: 1, options: [] }];
    expect(picksOk(g, {})).toBe(false);
    expect(picksOk(g, { g: ["a"] })).toBe(true);
    expect(picksOk(g, { g: ["a", "b"] })).toBe(false);
  });

  it("money, keys and notes", () => {
    expect(money(4440)).toBe("$44.40");
    expect(money(100000)).toBe("$1,000.00");
    expect(placeKey()).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    expect(noteOf({ error: "over-cap", message: null })).toContain("$1,000");
    expect(noteOf({ error: "rejected", message: "Store closed" })).toBe("Store closed");
  });

  it("posts the action and reads errors", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "stale" }), { status: 409, headers: { "content-type": "application/json" } }));
    const r = await orderCall({ action: "place" }, f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 409, error: "stale" });
    const [path, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(path).toBe("/api/haven/doordash/order");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    const off = await orderCall({ action: "home" }, (async () => new Response("", { status: 404 })) as unknown as typeof fetch);
    expect(off.error).toBe("off");
    const down = await orderCall({ action: "home" }, (async () => Promise.reject(new Error("net"))) as unknown as typeof fetch);
    expect(down).toMatchObject({ ok: false, status: 0, error: "failed" });
  });
});
