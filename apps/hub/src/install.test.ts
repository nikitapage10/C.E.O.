import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `relay wipe` and `relay wipe --verify` (apps/hub/install.sh, docs/RELAY-PRIVACY.md, "The off switch and the full
 * wipe"), run against a made-up HOME with macOS's commands stubbed: what it removes, and that the check says so.
 */

const SCRIPT = join(import.meta.dirname, "..", "install.sh");

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "relay-wipe-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const calls = join(root, "calls.log");
  mkdirSync(bin, { recursive: true });
  for (const dir of ["Library/Application Support/CEO Relay/hub", "Library/Logs/CEO Relay", "Library/LaunchAgents", ".local/bin"]) mkdirSync(join(home, dir), { recursive: true });
  writeFileSync(join(home, "Library/Application Support/CEO Relay/relay.json"), "{}");
  writeFileSync(join(home, "Library/Logs/CEO Relay/hub-2026-10-28.log"), "{}\n");
  writeFileSync(join(home, "Library/LaunchAgents/page.nikita.ceo.relay.plist"), "<plist/>");
  writeFileSync(join(home, ".local/bin/relay"), "#!/bin/sh\n");
  writeFileSync(join(home, ".zprofile"), 'export EDITOR=vim\nexport PATH="$HOME/.local/bin:$PATH" # CEO Relay\n');
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub("launchctl", 'case "$1" in print) exit 1;; *) exit 0;; esac');
  stub("security", 'case "$1" in find-generic-password) exit 44;; *) exit 0;; esac');
  stub("tmutil", "exit 0");
  stub("nc", "exit 1");
  stub("osascript", "exit 0");
  stub("curl", `echo '{"ok":true,"status":{"hub":"wiped"}}'`);
  const tty = join(root, "tty");
  writeFileSync(tty, "wipe\n");
  const run = (...args: string[]) => spawnSync("bash", [SCRIPT, ...args], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, RELAY_TTY: tty }, encoding: "utf8" });
  return { home, run, calls: () => (existsSync(calls) ? readFileSync(calls, "utf8") : "") };
};

describe("relay wipe", () => {
  it("removes every file, the job, the Keychain items and the PATH line, and the check passes", () => {
    const f = fixture();
    const out = f.run("wipe");
    expect(out.status).toBe(0);
    expect(existsSync(join(f.home, "Library/Application Support/CEO Relay"))).toBe(false);
    expect(existsSync(join(f.home, "Library/Logs/CEO Relay"))).toBe(false);
    expect(existsSync(join(f.home, "Library/LaunchAgents/page.nikita.ceo.relay.plist"))).toBe(false);
    expect(existsSync(join(f.home, ".local/bin/relay"))).toBe(false);
    expect(readFileSync(join(f.home, ".zprofile"), "utf8")).toBe("export EDITOR=vim\n");
    for (const item of ["bluebubbles-password", "hub-token", "send-key", "local-key"]) expect(f.calls()).toContain(`security delete-generic-password -s CEO Relay -a ${item}`);
    expect(f.calls()).toContain("launchctl bootout");
    expect(out.stdout).toContain("All clear.");
    expect(out.stdout).not.toContain("FAIL");
    expect(out.stdout).toContain("Unpair");
  });

  it("does nothing unless wipe is typed", () => {
    const f = fixture();
    const out = spawnSync("bash", [SCRIPT, "wipe"], { env: { PATH: process.env.PATH, HOME: f.home, RELAY_TTY: "/dev/null" }, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(existsSync(join(f.home, "Library/Application Support/CEO Relay/relay.json"))).toBe(true);
  });

  it("--verify names what is left", () => {
    const f = fixture();
    const out = f.run("wipe", "--verify");
    expect(out.status).not.toBe(0);
    expect(out.stdout).toContain("FAIL  Relay's folder is gone");
    expect(out.stdout).toContain("pass  nothing listens on port 7420");
  });
});
