import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDER, stampInstaller } from "../stamp.mjs";

/**
 * `relay wipe` and `relay wipe --verify` (apps/hub/install.sh, docs/RELAY-PRIVACY.md, "The off switch and the full
 * wipe"), run against a made-up HOME with macOS's commands stubbed: what it removes, and that the check says so.
 */

const SCRIPT = join(import.meta.dirname, "..", "install.sh");

const fixture = (lsof = "") => {
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
  stub("lsof", lsof ? `printf 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\\nBlueBubbles 1 u 1u IPv4 0 0t0 TCP %s (LISTEN)\\n' '${lsof}'` : "exit 1");
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

describe("relay status checks BlueBubbles is closed to the network", () => {
  it("says so when it listens on loopback only", () => {
    const out = fixture("127.0.0.1:1234").run("status");
    expect(out.stdout).toContain("BlueBubbles: closed to the network");
  });

  it("warns, and says which setting closes it, when it listens on every address", () => {
    const out = fixture("*:1234").run("status");
    expect(out.stdout).toContain("BlueBubbles: WARNING, open to the network");
    expect(out.stdout).toContain("Block incoming connections");
  });

  it("says when BlueBubbles isn't running", () => {
    expect(fixture().run("status").stdout).toContain("BlueBubbles: not running");
  });
});

/**
 * The whole install, run against a made-up HOME with macOS's commands, the downloads and the hub stubbed (#749): on a
 * Mac that is already paired it asks for nothing but "Continue?", and it has no webhook step left to fail.
 */
const installFixture = (keychain: string[]) => {
  const root = mkdtempSync(join(tmpdir(), "relay-install-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const calls = join(root, "calls.log");
  const files = join(root, "files");
  for (const d of [home, bin, files]) mkdirSync(d, { recursive: true });
  // The "Node" in the tarball is a stub that logs the hub command it was given.
  const name = "node-v22.20.0-darwin-arm64";
  mkdirSync(join(files, name, "bin"), { recursive: true });
  writeFileSync(join(files, name, "bin", "node"), `#!/bin/bash\nshift\necho "hub $*" >> "${calls}"\ncase "$1" in pair) cat >/dev/null;; esac\nexit 0\n`);
  chmodSync(join(files, name, "bin", "node"), 0o755);
  expect(spawnSync("tar", ["-czf", join(files, "node.tar.gz"), "-C", files, name]).status).toBe(0);
  writeFileSync(join(files, "relay-hub.mjs"), "// a made-up hub\n");
  const sha = (f: string) => spawnSync("sha256sum", [f], { encoding: "utf8" }).stdout.split(" ")[0]!;
  writeFileSync(join(files, "SHASUMS256.txt"), `${sha(join(files, "node.tar.gz"))}  ${name}.tar.gz\n`);
  const script = join(root, "install.sh");
  writeFileSync(script, stampInstaller(readFileSync(SCRIPT, "utf8"), sha(join(files, "relay-hub.mjs"))));
  const stub = (cmd: string, body: string) => {
    writeFileSync(join(bin, cmd), `#!/bin/bash\necho "${cmd} $*" >> "${calls}"\n${body}\n`);
    chmodSync(join(bin, cmd), 0o755);
  };
  stub("uname", 'case "$1" in -s) echo Darwin;; -m) echo arm64;; esac');
  stub("curl", `out=""; url=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; -*) ;; *) url="$1";; esac; shift; done
case "$url" in *.tar.gz) cp "${files}/node.tar.gz" "$out";; *SHASUMS256.txt) cp "${files}/SHASUMS256.txt" "$out";; *relay-hub.mjs) cp "${files}/relay-hub.mjs" "$out";; *) echo '{}';; esac`);
  stub("shasum", 'sha256sum "$3"');
  stub("security", `case "$1" in find-generic-password) for a in ${keychain.join(" ")}; do [ "$5" = "$a" ] && exit 0; done; exit 44;; *) exit 0;; esac`);
  stub("launchctl", 'case "$1" in print) exit 1;; *) exit 0;; esac');
  stub("tmutil", "exit 0");
  stub("nc", "exit 0");
  stub("lsof", "printf 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\\nBlueBubbles 1 u 1u IPv4 0 0t0 TCP 127.0.0.1:1234 (LISTEN)\\n'");
  const tty = join(root, "tty");
  writeFileSync(tty, "y\n");
  const run = () => spawnSync("bash", [script], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, RELAY_TTY: tty }, encoding: "utf8" });
  return { home, run, calls: () => (existsSync(calls) ? readFileSync(calls, "utf8") : "") };
};

describe("the installer run again (#749)", () => {
  it("on a paired Mac: keeps the password and the pairing, asks for no code, and starts the hub", () => {
    const f = installFixture(["bluebubbles-password", "hub-token", "send-key", "local-key"]);
    const out = f.run();
    expect(out.stderr).not.toContain("Relay:");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("already in the Keychain");
    expect(out.stdout).toContain("already paired");
    expect(out.stdout).toContain("Relay is on.");
    expect(f.calls()).not.toContain("hub pair");
    expect(f.calls()).not.toContain("security add-generic-password");
    expect(f.calls()).not.toContain("hub webhook");
    expect(f.calls()).toContain("hub check");
    expect(f.calls()).toContain("hub unhook");
    expect(f.calls()).toContain("launchctl bootstrap");
    expect(existsSync(join(f.home, "Library/LaunchAgents/page.nikita.ceo.relay.plist"))).toBe(true);
  });

  it("on a new Mac: asks for the password and a pair code", () => {
    const f = installFixture([]);
    f.run();
    expect(f.calls()).toContain("security add-generic-password");
    expect(f.calls()).toContain("hub pair");
  });
});

describe("the installer's integrity", () => {
  const script = readFileSync(SCRIPT, "utf8");

  it("checks the hub against a hash stamped into the script, and fetches nothing twice", () => {
    expect(script.split(PLACEHOLDER).length).toBe(2);
    expect(script).not.toMatch(/relay-hub\.mjs\.sha256"/);
    expect(script).not.toMatch(/curl[^\n]*relay\/install\.sh"? -o/);
    const sha = "a".repeat(64);
    const stamped = stampInstaller(script, sha);
    expect(stamped).toContain(`HUB_SHA256="${sha}"`);
    expect(stamped).not.toContain("__HUB_SHA256__");
    expect(() => stampInstaller(script, "nope")).toThrow();
    expect(() => stampInstaller("no placeholder", sha)).toThrow();
  });

  it("writes the relay command from its own functions: valid bash, the same commands, no download", () => {
    const f = fixture();
    const out = f.run("print-command");
    expect(out.status).toBe(0);
    expect(out.stdout.startsWith("#!/bin/bash")).toBe(true);
    expect(out.stdout).toContain('main "$@"');
    expect(out.stdout).toContain("wipe_relay");
    const check = spawnSync("bash", ["-n"], { input: out.stdout, encoding: "utf8" });
    expect(check.status).toBe(0);
  });

  it("hides the pair code as it is typed", () => {
    expect(script).toMatch(/ask_secret\(\) \{ local a; read -rs /);
    expect(script).toMatch(/CODE="\$\(ask_secret /);
  });
});
