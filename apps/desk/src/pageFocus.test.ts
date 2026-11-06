import { describe, expect, it, vi } from "vitest";
import { focusPage, SHOWN_MAIN } from "./pageFocus.ts";
import { isTalkSpace } from "./holdToTalk.ts";

/** Focus after a menu click (#934): the page on screen takes focus, so a held Space talks instead of pressing the link. */

/** A stand-in element: `closest` answers for the selectors its tag or role is in. */
const node = (match: string[], inside?: object) => {
  const n = {
    closest: (sel: string) => (match.some((m) => sel.includes(m)) ? n : null),
    focus: vi.fn(),
    contains: (o: unknown) => o === n || o === inside,
  };
  return n;
};

describe("focus after a change of page (#934)", () => {
  it("moves focus from the bar's link to the page on screen, without scrolling, so Space is hold-to-talk's", () => {
    const link = node(["a[href]"]);
    const main = node([]);
    const doc = { activeElement: link, querySelector: (s: string) => (s === SHOWN_MAIN ? main : null) };
    const space = { code: "Space", key: " ", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false };
    expect(isTalkSpace({ ...space, target: link as unknown as EventTarget })).toBe(false);
    expect(focusPage(doc)).toBe(true);
    expect(main.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(isTalkSpace({ ...space, target: main as unknown as EventTarget })).toBe(true);
  });

  it("takes focus from the body too (a number key, the back button)", () => {
    const main = node([]);
    expect(focusPage({ activeElement: node([]), querySelector: () => main })).toBe(true);
    expect(main.focus).toHaveBeenCalled();
  });

  it("leaves focus a page put inside itself, or in Skippy's dialogue", () => {
    const box = node(["textarea"]);
    const main = node([], box);
    expect(focusPage({ activeElement: box, querySelector: () => main })).toBe(false);
    const chat = node(["[role='dialog']"]);
    expect(focusPage({ activeElement: chat, querySelector: () => main })).toBe(false);
    expect(main.focus).not.toHaveBeenCalled();
  });

  it("does nothing with no page on screen", () => {
    expect(focusPage({ activeElement: null, querySelector: () => null })).toBe(false);
  });
});
