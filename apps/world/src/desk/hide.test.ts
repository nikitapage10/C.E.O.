import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A stand-in for the browser's localStorage, optionally one that refuses every call (private windows, blocked storage). */
function stubStorage(initial: Record<string, string> = {}, blocked = false) {
  const store = new Map(Object.entries(initial));
  const refuse = () => {
    throw new Error("blocked");
  };
  const localStorage = blocked
    ? { getItem: refuse, setItem: refuse, removeItem: refuse }
    : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  vi.stubGlobal("window", { localStorage });
  return store;
}

/** hide.ts and Private.tsx, loaded fresh so the store starts from the stubbed storage. */
async function load() {
  vi.resetModules();
  const hide = await import("./hide.ts");
  const ui = await import("./Private.tsx");
  return { ...hide, ...ui };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Hide, for showing the Desk to someone", () => {
  it("starts off on a device that never chose, and remembers the choice per device", async () => {
    const store = stubStorage();
    const { useHide, HIDE_KEY } = await load();
    expect(useHide.getState().on).toBe(false);
    useHide.getState().toggle();
    expect(useHide.getState().on).toBe(true);
    expect(store.get(HIDE_KEY)).toBe("1");
    useHide.getState().toggle();
    expect(useHide.getState().on).toBe(false);
    expect(store.has(HIDE_KEY)).toBe(false);
  });

  it("comes back on when this device last left it on", async () => {
    stubStorage({ "desk.hide": "1" });
    const { useHide, readHide } = await load();
    expect(readHide()).toBe(true);
    expect(useHide.getState().on).toBe(true);
  });

  it("still works, for the visit only, when storage is blocked", async () => {
    stubStorage({}, true);
    const { useHide, readHide, writeHide } = await load();
    expect(readHide()).toBe(false);
    expect(() => writeHide(true)).not.toThrow();
    useHide.getState().set(true);
    expect(useHide.getState().on).toBe(true);
  });

  it("marks private values for the CSS veil, and keeps them from screen readers only while hidden", async () => {
    const { privateAttrs } = await load();
    expect(privateAttrs(false)).toEqual({ "data-private": "", "aria-hidden": undefined });
    expect(privateAttrs(true)).toEqual({ "data-private": "", "aria-hidden": true });
    expect(privateAttrs(true, true)["data-private"]).toBe("block");
  });

  it("shows a <Private> value as it is while Hide is off", async () => {
    stubStorage();
    const { Private } = await load();
    const html = renderToStaticMarkup(createElement(Private, { children: "Reply to Sam" }));
    expect(html).toBe('<span class="wv-private" data-private="">Reply to Sam</span>');
  });

  it("while Hide is on, hides the real value from screen readers and says “hidden” instead", async () => {
    stubStorage({ "desk.hide": "1" });
    const { Private } = await load();
    const html = renderToStaticMarkup(createElement(Private, { block: true, label: "none yet", children: "$1,200" }));
    expect(html).toContain('data-private="block" aria-hidden="true">$1,200</span>');
    expect(html).toContain('<span class="wv-sr">none yet</span>');
  });

  it("puts an eye in the bar that says whether it's on", async () => {
    stubStorage({ "desk.hide": "1" });
    const { HideButton } = await load();
    const html = renderToStaticMarkup(createElement(HideButton));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Hidden");
    expect(html).toContain("wv-navbtn");
  });

  it("swaps a name in a label for a plain word while hidden", async () => {
    stubStorage({ "desk.hide": "1" });
    const { useMasked } = await load();
    let out = "";
    function Probe() {
      out = useMasked()("Sam", "them");
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(out).toBe("them");
  });
});
