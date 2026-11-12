import { useEffect, useRef, useState } from "react";
import { atWall, DEFAULT_HOUR, wall, whenLabel } from "../../../api/_today/parse.ts";
import type { Todo } from "../../../api/_today/todos.ts";
import { Private } from "@ceo/engine/web/Private.tsx";
import { TalkBack, TodoCapture } from "@ceo/desk/todos/TodoBits.tsx";
import { openTodos, useTodos, type Target } from "@ceo/desk/todos/todos.ts";
import "./todos.css";

/**
 * The To-dos panel (#1056): the plinth's To-dos gauge opens it, like the other gauges' pop-ups. Nikita's own to-dos
 * moved here from the Senate floor ("still left"): the add line first (a mic, a one-line box, T to jump to it), then
 * each open to-do with Done and Tomorrow in one tap and its mic for anything else ("remind me Friday", "note: …").
 * The same store and words as before (api/_today/todos.ts, @ceo/desk/todos). Signed out it never opens: the gauge
 * shows the count only.
 */

/** 9:00 am Mountain tomorrow. */
function tomorrowAt(now: number): number {
  const w = wall(now);
  return atWall(w.y, w.mo, w.d + 1, DEFAULT_HOUR);
}

function TodoRow({ todo, now, talking, onTalk }: { todo: Todo; now: number; talking: boolean; onTalk: (on: boolean) => void }) {
  const apply = useTodos((s) => s.apply);
  const target: Target = { type: "todo", id: todo.id };
  const due = todo.due ? Date.parse(todo.due) : NaN;
  const isDue = due <= now;
  const note = todo.notes?.at(-1);
  return (
    <li className={`hv-td${isDue ? " is-due" : ""}`}>
      <div className="hv-tdLine">
        <button type="button" className="hv-tdDone" aria-label={`Done: ${todo.text}`} title="Done" onClick={() => void apply(target, { kind: "done" })}>
          <i aria-hidden="true" />
        </button>
        <span className="hv-tdT">
          <Private as="b">{todo.text}</Private>
          {Number.isFinite(due) && <em>{isDue ? `due ${whenLabel(due, now)}` : whenLabel(due, now)}</em>}
          {note && <Private className="hv-tdNote">Note: {note}</Private>}
        </span>
        <button type="button" className="hv-tdBtn" onClick={() => void apply(target, { kind: "snooze", until: tomorrowAt(Date.now()) })}>
          Tomorrow
        </button>
        <button type="button" className={`hv-tdBtn is-mic${talking ? " is-on" : ""}`} aria-expanded={talking} aria-label={`Talk back to this to-do: snooze, remind, note or done`} title="Snooze, remind, note or done" onClick={() => onTalk(!talking)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {talking && <TalkBack key={todo.id} target={target} listen onClose={() => onTalk(false)} />}
    </li>
  );
}

export function TodosPop({ onClose }: { onClose: () => void }) {
  const state = useTodos((s) => s.state);
  const status = useTodos((s) => s.status);
  const [talk, setTalk] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const list = openTodos(state, now);
  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    <div className="hv-dp hv-tdp" role="dialog" aria-label="To-dos" tabIndex={-1} ref={box}>
      <div className="hv-th-top">
        <span className="hv-uk">
          To-dos
          <em> · {list.length ? `${list.length} open` : "clear"}</em>
        </span>
        <button type="button" className="hv-th-x" aria-label="Close To-dos" onClick={onClose}>
          ×
        </button>
      </div>
      <TodoCapture />
      {status === "failed" && <p className="hv-dp-note is-warn">The to-dos didn't load. They'll try again when you come back.</p>}
      {list.length > 0 ? (
        <ol className="hv-tdList" aria-label="Your to-dos">
          {list.map((t) => (
            <TodoRow key={t.id} todo={t} now={now} talking={talk === t.id} onTalk={(on) => setTalk(on ? t.id : null)} />
          ))}
        </ol>
      ) : (
        <p className="hv-dp-note">Nothing left. Say or type one above.</p>
      )}
    </div>
  );
}
