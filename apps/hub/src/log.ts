import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * The hub's log (docs/RELAY-PRIVACY.md, "Mac to logs"): an event kind from a closed list and numbers, nothing else.
 * No message text, name, number, chat id, draft, prompt, answer or header can be written, because the only string a
 * line takes is one of LOG_KINDS and every field must be a finite number (anything else is dropped, not written).
 * Errors are logged by class name only, from ERROR_CLASSES. One file per day in ~/Library/Logs/CEO Relay, mode 0600,
 * 14 days kept.
 */

export const LOG_KINDS = [
  "hub started",
  "hub stopped",
  "hub paused",
  "hub resumed",
  "webhook in",
  "webhook refused",
  "thread owed",
  "thread settled",
  "thread replied",
  "group summarised",
  "sorted",
  "draft ready",
  "draft refused",
  "sent",
  "send failed",
  "later",
  "model call",
  "model refused",
  "model error",
  "budget stop",
  "status sent",
  "status refused",
  "status failed",
  "skip terms",
  "skip terms failed",
  "sweep",
  "request refused",
  "error",
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

/** The only error words a line may carry. */
export const ERROR_CLASSES = ["TypeError", "SyntaxError", "RangeError", "AbortError", "TimeoutError", "FetchError", "HttpError", "KeychainError", "StoreError", "Error"] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export type LogFields = Record<string, number>;

export interface Logger {
  log(kind: LogKind, fields?: LogFields): void;
  error(kind: LogKind, err: unknown, fields?: LogFields): void;
}

/** An error's class, from the closed list: its name if listed, else "Error". Never its message. */
export function errorClass(err: unknown): ErrorClass {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  return (ERROR_CLASSES as readonly string[]).includes(name) ? (name as ErrorClass) : "Error";
}

const FIELD = /^[a-z][a-zA-Z]{0,23}$/;

/** One line: the time, the kind and the numeric fields, as JSON. Anything off the allowlist is left out. */
export function line(at: number, kind: LogKind, fields: LogFields = {}, err?: ErrorClass): string | null {
  if (!(LOG_KINDS as readonly string[]).includes(kind)) return null;
  const out: Record<string, string | number> = { at: new Date(at).toISOString(), kind };
  for (const [k, v] of Object.entries(fields)) if (FIELD.test(k) && typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 1_000_000) / 1_000_000;
  if (err) out.error = err;
  return JSON.stringify(out);
}

/** Logs to the day's file in `dir` (and keeps 14 days). */
export function fileLogger(dir: string, now: () => number = Date.now): Logger {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let pruned = "";
  const write = (text: string | null) => {
    if (!text) return;
    const day = new Date(now()).toISOString().slice(0, 10);
    try {
      appendFileSync(join(dir, `hub-${day}.log`), `${text}\n`, { mode: 0o600 });
      if (pruned !== day) {
        pruned = day;
        const cutoff = new Date(now() - 14 * 86_400_000).toISOString().slice(0, 10);
        for (const f of readdirSync(dir)) {
          const m = /^hub-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
          if (m && m[1]! < cutoff) rmSync(join(dir, f), { force: true });
        }
      }
    } catch {
      // A log that can't be written is dropped; the hub carries on.
    }
  };
  return {
    log: (kind, fields) => write(line(now(), kind, fields)),
    error: (kind, err, fields) => write(line(now(), kind, fields, errorClass(err))),
  };
}

/** For tests: every line in memory. */
export function memoryLogger(now: () => number = Date.now): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: (kind, fields) => {
      const l = line(now(), kind, fields);
      if (l) lines.push(l);
    },
    error: (kind, err, fields) => {
      const l = line(now(), kind, fields, errorClass(err));
      if (l) lines.push(l);
    },
  };
}
