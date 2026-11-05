import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { atWall, DEFAULT_HOUR, wall, type Choice, type Reading } from "../../../../../api/_today/parse.ts";
import { HANDED_LINE, readItemReply, type FloorItem } from "../../../../../api/_today/floor.ts";
import type { Todo } from "../../../../../api/_today/todos.ts";
import { askSkippyAbout, handToSkippy } from "./floorTalk.ts";
import { useDictation } from "../dictate.ts";
import { useDeskAuth } from "../signin.ts";
import { Icon } from "../todayIcons.tsx";
import { useTodos, type Target } from "./todos.ts";
import "./todos.css";

/**
 * Today's quick words (#622): the capture line under "Held for you" (a mic, a one-line box, T to jump to it), the line
 * that says what a word did with its Undo, and the talk-back strip a held row opens from its mic or a held Space. None
 * of it is a chat: one line in, one thing done, one line back. Dictation is the browser's own (../dictate.ts).
 */

/** Keeps the store in step with sign-in: read once signed in, forgotten on sign-out. */
export function useTodoSync() {
  const auth = useDeskAuth((s) => s.auth.status);
  const refresh = useTodos((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [auth, refresh]);
  // Another device's changes, when this tab comes back into view.
  useEffect(() => {
    const back = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [refresh]);
}

/** Whether the to-dos can be used here: signed in (or a Desk with no sign-in, kept in this browser). */
export const useTodosOn = () => useTodos((s) => s.status === "live" || s.status === "local" || s.status === "failed");

/** A pause this long after words ends a tap-to-talk. */
const PAUSE_MS = 1_700;

/**
 * Dictation that ends itself after a pause, and hands the finished words over once. `onDone` gets the words when the
 * listening stops (a pause, a second tap, a released Space).
 */
function useSaying(onWords: (words: string) => void, onDone: (words: string) => void) {
  const said = useRef("");
  const timer = useRef<number | undefined>(undefined);
  const done = useRef(onDone);
  done.current = onDone;
  const { supported, listening, error, start, stop } = useDictation((fin, tail) => {
    said.current = `${fin} ${tail}`.trim();
    onWords(said.current);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => stop(), PAUSE_MS);
  });
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !listening) {
      window.clearTimeout(timer.current);
      const words = said.current;
      said.current = "";
      if (words) done.current(words);
    }
    was.current = listening;
  }, [listening]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const begin = useCallback(() => {
    said.current = "";
    start();
  }, [start]);
  return { supported, listening, error, start: begin, stop };
}

function MicButton({ listening, onClick, label }: { listening: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className={`td-mic${listening ? " is-on" : ""}`} aria-pressed={listening} aria-label={listening ? "Stop listening" : label} title={listening ? "Stop listening" : label} onClick={onClick}>
      <Icon name="mic" />
    </button>
  );
}

/** The capture line: say or type a to-do of your own. */
export function TodoCapture() {
  const on = useTodosOn();
  const capture = useTodos((s) => s.capture);
  const local = useTodos((s) => s.status === "local");
  const [text, setText] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const send = useCallback(
    async (words: string) => {
      if (await capture(words)) setText("");
    },
    [capture],
  );
  const mic = useSaying(setText, (w) => void send(w));

  // T, anywhere on the Desk's Today outside a text box: straight to the line.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || (e.key !== "t" && e.key !== "T")) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      box.current?.focus();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  if (!on) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  return (
    <div className="td-cap-wrap">
      <form className={`td-cap${mic.listening ? " is-listening" : ""}`} onSubmit={submit} role="search" aria-label="Add a to-do of your own">
        {mic.supported && <MicButton listening={mic.listening} onClick={mic.listening ? mic.stop : mic.start} label="Say a to-do" />}
        <input
          ref={box}
          className="td-cap-in"
          type="text"
          value={text}
          maxLength={200}
          enterKeyHint="done"
          autoComplete="off"
          aria-label="Add a to-do"
          placeholder={mic.listening ? "Listening…" : "Add a to-do: “tomorrow, call the vet”"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (setText(""), e.currentTarget.blur())}
        />
        <kbd className="td-cap-k" aria-hidden="true">
          T
        </kbd>
      </form>
      {mic.error && <p className="td-cap-err">{mic.error}</p>}
      {local && <p className="td-cap-note">Kept in this browser until the Desk's sign-in is set up.</p>}
      <DidLine />
    </div>
  );
}

/** What the last word did, in one line, with its Undo. Fades after a while. */
export function DidLine() {
  const did = useTodos((s) => s.did);
  const undo = useTodos((s) => s.undo);
  const dismiss = useTodos((s) => s.dismissDid);
  useEffect(() => {
    if (!did) return;
    const t = window.setTimeout(dismiss, did.undo ? 12_000 : 3_000);
    return () => window.clearTimeout(t);
  }, [did, dismiss]);
  return (
    <p className="td-did" role="status" aria-live="polite">
      {did && (
        <>
          <Icon name="todo" />
          <span>{did.line}</span>
          {did.undo && (
            <button type="button" className="td-did-undo" onClick={() => void undo()}>
              Undo
            </button>
          )}
        </>
      )}
    </p>
  );
}

/**
 * The talk-back strip under a held row: speak (or type) one line back to it. `holding` is a held Space: listening
 * starts with it and stops when it is let go. A clear line is done at once; an unclear one asks with two chips.
 */
export function TalkBack({ target, listen, holding, onClose, item }: { target: Target; listen: boolean; holding?: boolean; onClose: () => void; item?: FloorItem }) {
  const read = useTodos((s) => s.read);
  const apply = useTodos((s) => s.apply);
  const hand = useTodos((s) => s.hand);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<Extract<Reading, { ok: false }> | null>(null);
  const [failed, setFailed] = useState("");
  const box = useRef<HTMLInputElement>(null);

  const go = useCallback(
    async (words: string) => {
      if (!words.trim()) return;
      setBusy(true);
      setFailed("");
      // An item on the floor (api/_today/floor.ts): read in its context; what isn't a held row's word is Skippy's.
      const r = item ? readItemReply(words, item, Date.now()) : await read(words);
      if (r && r.ok === "skippy" && item) {
        const sent = r.approve ? await handToSkippy(item, words) : await askSkippyAbout(item, words);
        setBusy(false);
        if (!sent.ok) return setFailed(sent.message);
        await hand(target, r.approve ? HANDED_LINE.sent : "Sent to Skippy", sent.turn);
        return onClose();
      }
      setBusy(false);
      if (!r) return;
      if (r.ok === true) {
        await apply(target, r.intent);
        onClose();
      } else if (r.ok === false) setAsked(r);
    },
    [read, apply, hand, item, target, onClose],
  );
  const mic = useSaying(setText, (w) => void go(w));

  // Opened from the mic or a held Space: listen straight away.
  const started = useRef(false);
  useEffect(() => {
    if (listen && !started.current && mic.supported) {
      started.current = true;
      mic.start();
    } else if (!mic.supported || !listen) box.current?.focus();
  }, [listen, mic]);
  // Space let go: stop, and the words go.
  useEffect(() => {
    if (holding === false && mic.listening) mic.stop();
  }, [holding, mic]);

  const pick = async (c: Choice) => {
    await apply(target, c.intent);
    onClose();
  };
  return (
    <div className={`td-tb${mic.listening ? " is-listening" : ""}`} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), mic.stop(), onClose())}>
      {asked ? (
        <div className="td-tb-ask" role="group" aria-label={asked.ask}>
          <span>{asked.ask}</span>
          {asked.choices.map((c) => (
            <button key={c.label} type="button" className="td-chip" onClick={() => void pick(c)}>
              {c.label}
            </button>
          ))}
          <button type="button" className="td-tb-x" aria-label="Never mind" onClick={onClose}>
            ×
          </button>
        </div>
      ) : (
        <form
          className="td-tb-f"
          onSubmit={(e) => {
            e.preventDefault();
            void go(text);
          }}
        >
          {mic.supported && <MicButton listening={mic.listening} onClick={mic.listening ? mic.stop : mic.start} label="Say it" />}
          <input
            ref={box}
            className="td-cap-in"
            type="text"
            value={text}
            maxLength={200}
            autoComplete="off"
            enterKeyHint="done"
            disabled={busy}
            aria-label="Say something back to it"
            placeholder={mic.listening ? "Listening…" : item && item.kind !== "duty" ? "“Go ahead and fix it”, “why did it break?”, “later”, “note: …”" : "“Snooze till tomorrow”, “remind me Friday”, “note: …”, “done”"}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="td-tb-x" aria-label="Never mind" onClick={onClose}>
            ×
          </button>
        </form>
      )}
      {mic.error && <p className="td-cap-err">{mic.error}</p>}
      {failed && (
        <p className="td-cap-err" role="alert">
          {failed}
        </p>
      )}
    </div>
  );
}

/** 9:00 am Mountain tomorrow. */
function tomorrowAt(now: number): number {
  const w = wall(now);
  return atWall(w.y, w.mo, w.d + 1, DEFAULT_HOUR);
}

/** A to-do of Nikita's own, opened: its notes, and Done or Tomorrow in one tap. */
export function TodoCard({ todo }: { todo: Todo }) {
  const apply = useTodos((s) => s.apply);
  const target: Target = { type: "todo", id: todo.id };
  return (
    <div className="wv-act td-todo-card">
      {todo.notes?.length ? (
        <ul className="td-todo-notes">
          {todo.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="td-todo-acts">
        <button type="button" className="td-chip is-main" onClick={() => void apply(target, { kind: "done" })}>
          Done
        </button>
        <button type="button" className="td-chip" onClick={() => void apply(target, { kind: "snooze", until: tomorrowAt(Date.now()) })}>
          Tomorrow
        </button>
      </div>
    </div>
  );
}
