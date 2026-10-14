#!/usr/bin/env node
// PostToolUse and PostToolUseFailure hook (#119): appends one line per tool call to the local log (log.mjs). It
// never blocks and never prints, whatever happens.

try {
  const { appendLog, readInput } = await import("./log.mjs");
  const { summarize } = await import("./guard.mjs");
  const input = await readInput();
  const tool = String(input.tool_name ?? "");
  const res = input.tool_response;
  const failed =
    input.hook_event_name === "PostToolUseFailure" ||
    (res !== null && typeof res === "object" && (res.is_error === true || res.success === false || res.interrupted === true));
  appendLog(
    {
      time: new Date().toISOString(),
      session: String(input.session_id ?? "").slice(0, 8),
      tool,
      summary: summarize(tool, input.tool_input),
      ok: !failed,
    },
    process.env.CLAUDE_PROJECT_DIR || input.cwd,
  );
} catch {
  // Fail open.
}
process.exit(0);
