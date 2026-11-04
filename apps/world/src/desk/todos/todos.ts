import { create } from "zustand";
import { readCapture, readTalkBack, fallbackChoices, didLine, type Intent, type Reading } from "../../../../../api/_today/parse.ts";
import { isOpen, keepState, mergeState, type Mark, type Todo, type TodoState } from "../../../../../api/_today/todos.ts";
import { useDeskAuth } from "../signin.ts";

/**
 * Today's own to-dos and talk-back (#622), browser side. What Nikita says into the capture line becomes a to-do of
 * their own; what they say back to a held thing snoozes it, sets a reminder, adds a note, marks it done or turns it
 * into a to-do (api/_today/parse.ts reads the words, in the browser). Every change shows at once, with one line saying
 * what it did and an Undo, and is saved to the private Desk store behind the passkey (/api/today-todos), so the phone
 * and the PC agree. Signed out nothing is fetched or shown, and it is forgotten on sign-out. Where the Desk has no
 * sign-in at all (a local preview) it is kept in this browser instead.
 */

export type TodoStatus = "idle" | "signed-out" | "live" | "local" | "failed";

/** What a talk-back is aimed at: one of Nikita's to-dos, or a held row by its key. */
export type Target = { type: "todo"; id: string } | { type: "held"; ref: string; text: string };

export interface Did {
  line: string;
  /** The changes that put things back. */
  undo: { todos?: Todo[]; marks?: Mark[]; drop?: string[] } | null;
  at: number;
}

const PATH = "/api/today-todos";
const LOCAL_KEY = "ceo-today-todos";
const EMPTY: TodoState = { todos: [], marks: [] };

const iso = (ms: number) => new Date(ms).toISOString();
const newId = () => `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function readLocal(now: number): TodoState {
  try {
    return keepState(JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? "{}"), now);
  } catch {
    return EMPTY;
  }
}
function writeLocal(state: TodoState) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    /* private window: kept for this visit only */
  }
}

/** The to-dos and marks an intent makes, from the state as it stands. Pure, so it is tested on its own. */
export function changesFor(state: TodoState, target: Target | null, intent: Intent, now: number, id = newId()): { todos?: Todo[]; marks?: Mark[]; drop?: string[]; undo: Did["undo"] } {
  const at = iso(now);
  if (intent.kind === "add") {
    const todo: Todo = { id, text: intent.text, at, updated: at, ...(intent.due && { due: iso(intent.due) }) };
    return { todos: [todo], undo: { drop: [id] } };
  }
  if (!target) return { undo: null };
  if (target.type === "todo") {
    const had = state.todos.find((t) => t.id === target.id);
    if (!had) return { undo: null };
    const { pinged: _p, ...base } = had;
    const next: Todo = { ...base, updated: at };
    if (intent.kind === "snooze") Object.assign(next, { until: iso(intent.until) });
    if (intent.kind === "remind" || intent.kind === "todo") {
      const due = intent.kind === "remind" ? intent.at : intent.due;
      if (due) Object.assign(next, { due: iso(due) });
      delete next.until;
    }
    if (intent.kind === "note") next.notes = [...(had.notes ?? []), intent.text].slice(-6);
    if (intent.kind === "done") next.done = at;
    return { todos: [next], undo: { todos: [{ ...base, updated: at }] } };
  }
  // A held row that isn't Nikita's: a mark on its key, or a to-do of their own made from it.
  const had = state.marks.find((m) => m.ref === target.ref);
  const cleared: Mark = { ref: target.ref, updated: at };
  const before: Mark = had ? (({ pinged: _p, ...m }) => m)(had) : cleared;
  if (intent.kind === "todo") {
    const todo: Todo = { id, text: target.text.slice(0, 200) || "Follow up", at, updated: at, from: target.ref, ...(intent.due && { due: iso(intent.due) }) };
    // The held row steps aside for the to-do made from it.
    const mark: Mark = { ...before, updated: at, done: at };
    return { todos: [todo], marks: [mark], undo: { drop: [id], marks: [{ ...before, updated: at }] } };
  }
  const mark: Mark = { ...before, updated: at };
  if (intent.kind === "snooze") mark.until = iso(intent.until);
  if (intent.kind === "remind") {
    mark.remind = iso(intent.at);
    delete mark.until;
  }
  if (intent.kind === "note") mark.notes = [...(before.notes ?? []), intent.text].slice(-6);
  if (intent.kind === "done") mark.done = at;
  return { marks: [mark], undo: { marks: [{ ...before, updated: at }] } };
}

/** The keys of held rows Nikita has put away for now: snoozed until later, done, or made into a to-do. */
export function awayRefs(state: TodoState, now: number): Set<string> {
  return new Set(state.marks.filter((m) => m.done || (m.until && Date.parse(m.until) > now)).map((m) => m.ref));
}

/** Nikita's to-dos still in play, due ones first, then by due time, then newest. */
export function openTodos(state: TodoState, now: number): Todo[] {
  const due = (t: Todo) => (t.due ? Date.parse(t.due) : Infinity);
  return state.todos.filter((t) => isOpen(t, now)).sort((a, b) => due(a) - due(b) || Date.parse(b.at) - Date.parse(a.at));
}

interface TodoStore {
  status: TodoStatus;
  state: TodoState;
  did: Did | null;
  refresh: (doFetch?: typeof fetch) => Promise<void>;
  /** The capture line: a to-do of Nikita's own. False when nothing was said. */
  capture: (text: string, doFetch?: typeof fetch) => Promise<boolean>;
  /** Reads talk-back words: the rules, then Claude when they can't tell, then two fallback chips. */
  read: (text: string, doFetch?: typeof fetch) => Promise<Reading>;
  apply: (target: Target | null, intent: Intent, doFetch?: typeof fetch) => Promise<void>;
  undo: (doFetch?: typeof fetch) => Promise<void>;
  dismissDid: () => void;
}

export const useTodos = create<TodoStore>((set, get) => {
  const save = async (changes: { todos?: Todo[]; marks?: Mark[]; drop?: string[] }, doFetch: typeof fetch) => {
    const now = Date.now();
    // At once on screen; then to the store, whose merged answer is the truth.
    set((s) => ({ state: mergeState(s.state, changes, now) }));
    if (get().status === "local") return writeLocal(get().state);
    if (get().status !== "live") return;
    try {
      const res = await doFetch(PATH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify({ action: "save", ...changes }) });
      if (res.status === 401) {
        useDeskAuth.getState().lost();
        return set({ status: "signed-out", state: EMPTY, did: null });
      }
      const got = res.ok ? ((await res.json().catch(() => null)) as { state?: unknown } | null) : null;
      if (got?.state) set({ state: keepState(got.state, Date.now()) });
    } catch {
      /* kept on screen; the next refresh brings the store's copy back */
    }
  };

  return {
    status: "idle",
    state: EMPTY,
    did: null,
    refresh: async (doFetch = fetch) => {
      const auth = useDeskAuth.getState().auth.status;
      if (auth === "checking") return;
      if (auth === "off") return set({ status: "local", state: readLocal(Date.now()) });
      if (auth !== "in") return set({ status: "signed-out", state: EMPTY, did: null });
      try {
        const res = await doFetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
        if (res.status === 401) {
          useDeskAuth.getState().lost();
          return set({ status: "signed-out", state: EMPTY, did: null });
        }
        const json = (res.headers.get("content-type") ?? "").includes("json");
        // No endpoint here (a preview, or before the Function App has it): kept in this browser for now.
        if (res.status === 404 || res.status === 503 || !json) return set({ status: "local", state: readLocal(Date.now()) });
        const got = res.ok ? ((await res.json().catch(() => null)) as { state?: unknown } | null) : null;
        if (!got?.state) return set({ status: "failed" });
        set({ status: "live", state: keepState(got.state, Date.now()) });
      } catch {
        set({ status: "failed" });
      }
    },
    capture: async (text, doFetch = fetch) => {
      const now = Date.now();
      const intent = readCapture(text, now);
      if (!intent) return false;
      await get().apply(null, intent, doFetch);
      return true;
    },
    read: async (text, doFetch = fetch) => {
      const now = Date.now();
      const ruled = readTalkBack(text, now);
      if (ruled) return ruled;
      if (get().status === "live") {
        try {
          const res = await doFetch(PATH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify({ action: "parse", text, mode: "item" }) });
          const got = res.ok ? ((await res.json().catch(() => null)) as { intent?: Intent | null } | null) : null;
          const intent = got?.intent;
          if (intent && typeof intent === "object" && ["snooze", "remind", "note", "done", "todo"].includes(intent.kind)) return { ok: true, intent };
        } catch {
          /* the chips below */
        }
      }
      return fallbackChoices(text, now);
    },
    apply: async (target, intent, doFetch = fetch) => {
      const now = Date.now();
      const { undo, ...changes } = changesFor(get().state, target, intent, now);
      if (!undo) return;
      set({ did: { line: didLine(intent, now), undo, at: now } });
      await save(changes, doFetch);
    },
    undo: async (doFetch = fetch) => {
      const did = get().did;
      if (!did?.undo) return;
      // Stamped now, so the put-back wins over the change it undoes.
      const at = iso(Math.max(Date.now(), did.at + 1));
      const stamp = <T extends { updated: string }>(xs?: T[]) => xs?.map((x) => ({ ...x, updated: at }));
      set({ did: { line: "Undone", undo: null, at: Date.now() } });
      await save({ todos: stamp(did.undo.todos), marks: stamp(did.undo.marks), drop: did.undo.drop }, doFetch);
    },
    dismissDid: () => set({ did: null }),
  };
});
