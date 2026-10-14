#!/usr/bin/env node
// PreToolUse hook (#119): runs the builder guard's rules (guard.mjs) on every Bash command and on the file tools'
// paths. A blocked call exits 2 with the reason on stderr, which Claude Code shows the model; anything else exits 0.
// The guard fails open on its own bugs: a crash, bad input or a missing module lets the call through, so only a
// rule's deny decision can stop work.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

function currentBranch(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

let reason = null;
try {
  // Imported inside the try, so a broken module fails open too.
  const { appendLog, readInput } = await import("./log.mjs");
  const { checkCommand, checkFileTool, summarize } = await import("./guard.mjs");
  const input = await readInput();
  const tool = input.tool_name;
  const cwd = input.cwd || process.cwd();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd;
  reason =
    tool === "Bash"
      ? checkCommand(input.tool_input?.command, { cwd, home: homedir(), projectDir, currentBranch })
      : checkFileTool(tool, input.tool_input);
  if (reason) {
    appendLog(
      {
        time: new Date().toISOString(),
        session: String(input.session_id ?? "").slice(0, 8),
        tool,
        summary: summarize(tool, input.tool_input),
        ok: false,
        blocked: reason,
      },
      projectDir,
    );
  }
} catch {
  reason = null;
}

if (reason) {
  process.stderr.write(
    `Blocked by the builder guard (.claude/hooks/guard.mjs): ${reason}. It is on the Foundry's deny list (docs/SECURITY.md, "The builder guard"). Do the work another way, or ask Nikita if it really needs doing.\n`,
  );
  process.exit(2);
}
process.exit(0);
