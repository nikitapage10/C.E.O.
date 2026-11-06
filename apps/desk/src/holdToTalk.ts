import { create } from "zustand";

/**
 * Hold Space to talk, on every Desk page (#905). Nikita, 2026-11-05: "At any point while the skippies are talking in the
 * Senate, I should be able to hold space to engage them directly … holding space or pressing space on any of the other
 * pages … just scrolls the page down. Can we change that?"
 *
 * One window listener for the whole Desk. Space held for `HOLD_TO_TALK_MS` starts whoever has the floor on this page
 * (the page's lead by default, the Senate while it sits, a room's own handler when it registers one); letting go ends
 * listening and the words go. A short tap does nothing at all. Either way Space never scrolls a Desk page. Native Space
 * is left alone where it means something: typing in a field, a select, a focused button or link (Space presses it), a
 * key held with a modifier, or a key a page's own handler already took (`defaultPrevented`).
 *
 * Handlers stack: the most recently registered at the highest priority wins, so a room (Relay's composer, the Senate)
 * takes Space over from the page default while it is mounted and gives it back when it goes. Only one ever fires.
 */

/** Held this long, Space is a hold: listening starts. Shorter is a tap, and a tap does nothing. */
export const HOLD_TO_TALK_MS = 250;
/** How long a hint (signed out, no microphone) stays up. */
export const HINT_MS = 2_800;

export interface HoldHandler {
  /** Space has been held long enough: start listening. */
  start: () => void;
  /** Space was let go: stop listening and send what was heard. */
  end: () => void;
  /** The hold was abandoned (the window lost focus, Escape): stop without sending. Defaults to `end`. */
  cancel?: () => void;
  /** The handler shows its own listening state; the shared pill stays hidden. */
  ownIndicator?: boolean;
  /** Whether it takes Space right now (a room kept mounted out of sight doesn't). Defaults to always. */
  when?: () => boolean;
}

/** Page default 0; a room's own handler or the Senate in session above it. */
export const PRIORITY = { page: 0, room: 10, senate: 20 } as const;

interface Entry {
  h: HoldHandler;
  priority: number;
  seq: number;
}
let entries: Entry[] = [];
let seq = 0;

/** Registers a handler; the returned function takes it off again (call it on unmount). */
export function registerHoldToTalk(h: HoldHandler, priority: number = PRIORITY.page): () => void {
  const e: Entry = { h, priority, seq: ++seq };
  entries.push(e);
  return () => {
    entries = entries.filter((x) => x !== e);
  };
}

/** Whoever would get the next hold: the highest priority, the newest among equals. */
export function activeHandler(): HoldHandler | null {
  let best: Entry | null = null;
  for (const e of entries) {
    if (e.h.when && !e.h.when()) continue;
    if (!best || e.priority > best.priority || (e.priority === best.priority && e.seq > best.seq)) best = e;
  }
  return best?.h ?? null;
}

/** For the tests. */
export function resetHoldToTalk(): void {
  entries = [];
  stopAll();
  useHoldToTalk.setState({ held: false, own: false, heard: "", hint: null });
}

/* ── The pill's state ── */

interface HoldState {
  /** Space is held and someone is listening. */
  held: boolean;
  /** The handler listening shows its own state (the pill stays hidden). */
  own: boolean;
  /** The words so far, for the pill (a handler that has them sets them). */
  heard: string;
  /** A short line instead of listening: signed out, no microphone. */
  hint: string | null;
}
export const useHoldToTalk = create<HoldState>(() => ({ held: false, own: false, heard: "", hint: null }));

let hintTimer: ReturnType<typeof setTimeout> | null = null;
/** Shows a short hint in the pill for a moment (signed out, no microphone, nothing to talk to here). */
export function holdHint(text: string): void {
  if (hintTimer) clearTimeout(hintTimer);
  useHoldToTalk.setState({ hint: text, held: false, heard: "" });
  hintTimer = setTimeout(() => {
    hintTimer = null;
    useHoldToTalk.setState({ hint: null });
  }, HINT_MS);
}
/** The words so far, for the pill. */
export const holdHeard = (heard: string) => useHoldToTalk.setState({ heard });

/* ── Which keys are ours ── */

/** Elements where Space types, picks or presses: native Space is left to them. */
const NATIVE_SPACE =
  "input, textarea, select, option, button, summary, a[href], [contenteditable]:not([contenteditable='false']), [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], [role='menuitem'], [role='option'], [role='tab'], [role='textbox'], [role='combobox'], [role='slider'], [role='spinbutton']";

/** Whether Space on this target belongs to the element itself (a field, a button, a link). */
export function nativeSpaceTarget(target: EventTarget | null): boolean {
  const el = target as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.isContentEditable) return true;
  return !!el.closest(NATIVE_SPACE);
}

type KeyLike = Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target" | "defaultPrevented">;

const isSpace = (e: Pick<KeyboardEvent, "code" | "key">) => e.code === "Space" || e.key === " " || e.key === "Spacebar";

/** Whether this Space key event is the Desk's to handle: no modifier, not already taken, not on a field or a control. */
export function isTalkSpace(e: KeyLike): boolean {
  if (!isSpace(e)) return false;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  if (e.defaultPrevented) return false;
  return !nativeSpaceTarget(e.target);
}

/* ── The listener ── */

let timer: ReturnType<typeof setTimeout> | null = null;
let down = false;
let started: HoldHandler | null = null;

function stopAll(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  down = false;
  started = null;
}

function begin(): void {
  timer = null;
  const h = activeHandler();
  if (!h || !down) return;
  started = h;
  useHoldToTalk.setState({ held: true, own: !!h.ownIndicator, heard: "", hint: null });
  h.start();
}

function finish(cancel: boolean): void {
  const h = started;
  stopAll();
  if (!h) return;
  // A handler may have put up a hint instead of listening; keep it.
  useHoldToTalk.setState({ held: false, heard: "" });
  if (cancel) (h.cancel ?? h.end)();
  else h.end();
}

/** keydown: a Space that is ours never scrolls; held long enough, it starts the floor's handler. */
export function onHoldKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape" && (down || started)) return finish(true);
  if (!isTalkSpace(e)) return;
  e.preventDefault();
  if (e.repeat || down) return;
  down = true;
  timer = setTimeout(begin, HOLD_TO_TALK_MS);
}

/** keyup: the end of a hold sends; a tap was nothing. */
export function onHoldKeyUp(e: KeyboardEvent): void {
  if (!isSpace(e) || !down) return;
  e.preventDefault();
  finish(false);
}

/** The window lost focus mid-hold: the keyup will never come, so stop without sending. */
export function onHoldBlur(): void {
  if (down) finish(true);
}

/** Puts the one listener on the window (the Desk calls it once); the returned function takes it off. */
export function installHoldToTalk(win: Window = window): () => void {
  win.addEventListener("keydown", onHoldKeyDown);
  win.addEventListener("keyup", onHoldKeyUp);
  win.addEventListener("blur", onHoldBlur);
  return () => {
    win.removeEventListener("keydown", onHoldKeyDown);
    win.removeEventListener("keyup", onHoldKeyUp);
    win.removeEventListener("blur", onHoldBlur);
    stopAll();
  };
}
