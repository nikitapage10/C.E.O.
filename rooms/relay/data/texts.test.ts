import { describe, expect, it } from "vitest";
import { asideOf, readPrivateView, requestsOf, useTexts } from "./texts.ts";

/**
 * #909, the black Relay page: when the signed-in read of /api/relay came back unreadable (a 5xx, an older hub's shape),
 * the view went null and SetAside's selector answered a fresh `[]` on every read. zustand hands selectors to React's
 * useSyncExternalStore, which takes a changed snapshot between two reads as a store update and renders again, forever:
 * React error #185, and the whole Desk unmounted. The selectors must answer the same value while nothing changes.
 */
describe("the texts store's selectors (#909)", () => {
  it("answer the same empty lists, read after read, while there is no view", () => {
    useTexts.setState({ view: null });
    const s = useTexts.getState();
    expect(asideOf(s)).toBe(asideOf(s));
    expect(requestsOf(s)).toBe(requestsOf(useTexts.getState()));
    expect(asideOf(s)).toHaveLength(0);
  });

  it("an unreadable private answer leaves no view (the case that blanked the page)", () => {
    for (const body of [null, {}, { ok: false }, { ok: true, status: { v: 0, at: 1, hub: "listening" }, texts: [], requests: [] }, "<html>"]) {
      expect(readPrivateView(body)).toBeNull();
    }
  });

  it("answer the view's own lists when there is one", () => {
    const aside = [{ id: "0123456789abcdef", name: "Sam Test", at: 1, why: "done" as const }];
    const view = { aside, requests: [] } as unknown as NonNullable<ReturnType<typeof useTexts.getState>["view"]>;
    expect(asideOf({ view })).toBe(aside);
    expect(requestsOf({ view })).toBe(view.requests);
  });
});
