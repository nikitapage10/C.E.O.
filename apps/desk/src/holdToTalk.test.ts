import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOLD_TO_TALK_MS,
  PRIORITY,
  activeHandler,
  holdHint,
  isTalkSpace,
  nativeSpaceTarget,
  onHoldBlur,
  onHoldKeyDown,
  onHoldKeyUp,
  registerHoldToTalk,
  resetHoldToTalk,
  useHoldToTalk,
} from "./holdToTalk.ts";

/** Hold Space to talk on every Desk page (#905): hold vs tap, what is left to native Space, and who gets the hold. */

/** A stand-in element: `closest` answers whether it sits inside one of the given tags. */
const el = (tag: string, extra: Partial<{ isContentEditable: boolean }> = {}) => ({
  ...extra,
  closest: (sel: string) => (sel.split(",").some((s) => s.trim().split(/[[:.]/)[0] === tag || (tag.startsWith("[") && s.includes(tag))) ? {} : null),
});
const body = el("body");

function key(type: "down" | "up", over: Partial<KeyboardEvent> = {}) {
  const e = {
    code: "Space",
    key: " ",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    target: body,
    preventDefault: vi.fn(),
    ...over,
  };
  if (type === "down") onHoldKeyDown(e as unknown as KeyboardEvent);
  else onHoldKeyUp(e as unknown as KeyboardEvent);
  return e;
}

const handler = () => ({ start: vi.fn(), end: vi.fn(), cancel: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers();
  resetHoldToTalk();
});
afterEach(() => {
  resetHoldToTalk();
  vi.useRealTimers();
});

describe("which Space is the Desk's (#905)", () => {
  it("takes a plain Space on the page", () => {
    expect(isTalkSpace({ code: "Space", key: " ", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target: body as unknown as EventTarget })).toBe(true);
  });

  it("leaves fields, controls and links to native Space", () => {
    for (const tag of ["input", "textarea", "select", "button", "a", "summary"]) expect(nativeSpaceTarget(el(tag) as unknown as EventTarget), tag).toBe(true);
    expect(nativeSpaceTarget(el("div", { isContentEditable: true }) as unknown as EventTarget)).toBe(true);
    expect(nativeSpaceTarget(el("[role='button']") as unknown as EventTarget)).toBe(true);
    expect(nativeSpaceTarget(body as unknown as EventTarget)).toBe(false);
    expect(nativeSpaceTarget(null)).toBe(false);
  });

  it("leaves a Space with a modifier, one already taken, and other keys alone", () => {
    const base = { code: "Space", key: " ", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target: body as unknown as EventTarget };
    expect(isTalkSpace({ ...base, metaKey: true })).toBe(false);
    expect(isTalkSpace({ ...base, ctrlKey: true })).toBe(false);
    expect(isTalkSpace({ ...base, altKey: true })).toBe(false);
    expect(isTalkSpace({ ...base, shiftKey: true })).toBe(false);
    expect(isTalkSpace({ ...base, defaultPrevented: true })).toBe(false);
    expect(isTalkSpace({ ...base, code: "Enter", key: "Enter" })).toBe(false);
  });
});

describe("hold vs tap (#905)", () => {
  it("a tap does nothing, and never scrolls", () => {
    const h = handler();
    registerHoldToTalk(h);
    const d = key("down");
    vi.advanceTimersByTime(HOLD_TO_TALK_MS - 50);
    const u = key("up");
    vi.advanceTimersByTime(1_000);
    expect(d.preventDefault).toHaveBeenCalled();
    expect(u.preventDefault).toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
    expect(h.end).not.toHaveBeenCalled();
  });

  it("a hold starts listening, and letting go sends", () => {
    const h = handler();
    registerHoldToTalk(h);
    key("down");
    vi.advanceTimersByTime(HOLD_TO_TALK_MS);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(useHoldToTalk.getState().held).toBe(true);
    // The key repeats while held: still one start, and no scroll.
    const r = key("down", { repeat: true });
    expect(r.preventDefault).toHaveBeenCalled();
    expect(h.start).toHaveBeenCalledTimes(1);
    key("up");
    expect(h.end).toHaveBeenCalledTimes(1);
    expect(h.cancel).not.toHaveBeenCalled();
    expect(useHoldToTalk.getState().held).toBe(false);
  });

  it("a Space in a field types, and starts nothing", () => {
    const h = handler();
    registerHoldToTalk(h);
    const d = key("down", { target: el("textarea") as unknown as EventTarget });
    vi.advanceTimersByTime(HOLD_TO_TALK_MS * 4);
    expect(d.preventDefault).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
  });

  it("a Space with a modifier is left alone", () => {
    const h = handler();
    registerHoldToTalk(h);
    const d = key("down", { shiftKey: true });
    vi.advanceTimersByTime(HOLD_TO_TALK_MS * 4);
    expect(d.preventDefault).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
  });

  it("losing the window mid-hold, or Escape, cancels without sending", () => {
    const h = handler();
    registerHoldToTalk(h);
    key("down");
    vi.advanceTimersByTime(HOLD_TO_TALK_MS);
    onHoldBlur();
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.end).not.toHaveBeenCalled();

    key("down");
    vi.advanceTimersByTime(HOLD_TO_TALK_MS);
    onHoldKeyDown({ key: "Escape", code: "Escape", preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(h.cancel).toHaveBeenCalledTimes(2);
    key("up");
    expect(h.end).not.toHaveBeenCalled();
  });

  it("with no one to talk to, Space still doesn't scroll", () => {
    const d = key("down");
    vi.advanceTimersByTime(HOLD_TO_TALK_MS);
    key("up");
    expect(d.preventDefault).toHaveBeenCalled();
    expect(useHoldToTalk.getState().held).toBe(false);
  });
});

describe("who gets the hold (#905)", () => {
  it("the highest priority wins, the newest among equals; only one fires", () => {
    const page = handler();
    const senate = handler();
    const relay = handler();
    const offPage = registerHoldToTalk(page, PRIORITY.page);
    const offRelay = registerHoldToTalk(relay, PRIORITY.room);
    expect(activeHandler()).toBe(relay);
    const offSenate = registerHoldToTalk(senate, PRIORITY.senate);
    key("down");
    vi.advanceTimersByTime(HOLD_TO_TALK_MS);
    key("up");
    expect(senate.start).toHaveBeenCalledTimes(1);
    expect(relay.start).not.toHaveBeenCalled();
    expect(page.start).not.toHaveBeenCalled();
    offSenate();
    offRelay();
    expect(activeHandler()).toBe(page);
    offPage();
    expect(activeHandler()).toBeNull();
  });

  it("a handler out of sight (a room kept mounted on another page) is passed over", () => {
    const page = handler();
    let shown = false;
    const senate = { ...handler(), when: () => shown };
    registerHoldToTalk(page, PRIORITY.page);
    registerHoldToTalk(senate, PRIORITY.senate);
    expect(activeHandler()).toBe(page);
    shown = true;
    expect(activeHandler()).toBe(senate);
  });

  it("a handler that goes mid-hold still gets its end", () => {
    const h = handler();
    const off = registerHoldToTalk(h);
    key("down");
    vi.advanceTimersByTime(HOLD_TO_TALK_MS);
    off();
    key("up");
    expect(h.end).toHaveBeenCalledTimes(1);
  });
});

describe("the hint (#905)", () => {
  it("shows for a moment, then goes", () => {
    holdHint("Sign in on the Desk to talk to Skippy.");
    expect(useHoldToTalk.getState().hint).toBe("Sign in on the Desk to talk to Skippy.");
    vi.advanceTimersByTime(5_000);
    expect(useHoldToTalk.getState().hint).toBeNull();
  });
});
