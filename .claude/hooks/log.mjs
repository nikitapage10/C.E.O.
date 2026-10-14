// The local tool-call log (#119): one JSON line per tool call in `.claude/logs/tool-calls.jsonl`, gitignored. It
// stays on this machine: nothing reads it but the person at the keyboard, and nothing sends it anywhere. Lines carry
// the time, the tool, a short redacted summary and whether the call worked, never file contents or tool output.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;

/** Appends one line; past 5 MB the old log moves to `tool-calls.1.jsonl` (one generation kept). Never throws. */
export function appendLog(entry, projectDir) {
  try {
    const dir = join(projectDir || process.cwd(), ".claude", "logs");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "tool-calls.jsonl");
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, "tool-calls.1.jsonl"));
    } catch {
      // No log yet.
    }
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    // Logging must never get in the way of work.
  }
}

/** Reads the hook's JSON from stdin. */
export async function readInput() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw);
}
