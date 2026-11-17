/**
 * DoorDash's own CLI, run inside the Function app (#1195, docs/HOME-DEVICES.md, "DoorDash"). `dd-cli` v0.2.6 is a
 * PyInstaller folder (the executable beside its `_internal/`), fetched and sha256-checked by scripts/fetch-dd-cli.sh
 * and copied into the package as bin/dd-cli/ by azure/build.mjs. The package mount may be read-only or noexec, so the
 * folder is copied once per instance to /tmp and made executable there.
 *
 * Every call is execFile (never a shell) with `--json-output` first, the command, then `--intent "<plain goal>"` for
 * a tool-backed command (the sign-in and `auth` commands take none: `export-token --intent` is a usage error, found by
 * the probe on chat/1195-doordash-probe). The environment is minimal: PATH, a fresh HOME under /tmp for that one call
 * (with XDG_CONFIG_HOME inside it, where the CLI keeps a pending sign-in as `dd-cli/pending-login.json`), and
 * DD_CLI_ACCESS_TOKEN only when a token is given. Files a call needs (a pending sign-in) go in before and come back
 * after, and the HOME is removed.
 *
 * Exit codes (the CLI's own, stable): 0 ok, 1 unknown, 2 usage, 3 auth, 4 gated, 5 temporary (a write may have
 * completed), 6 server, 7 rejected. With --json-output a credential or service failure prints one line on stderr,
 * {"error": {"code": "<code>", "message": "<text>"}}: only the code is read, never the message.
 *
 * Logs carry the command's name and its exit code only: never the token, stdout, a URL with a code, an address or a
 * card.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const DD_VERSION = "0.2.6";
export const DD_EXE = `dd-cli-v${DD_VERSION}-linux-amd64`;
/** Where the CLI keeps a pending sign-in, relative to the call's HOME (XDG_CONFIG_HOME is HOME/.config). */
export const PENDING_FILE = ".config/dd-cli/pending-login.json";
/** Long enough for a sign-in or a search; the CLI's own calls time out sooner. */
export const DD_TIMEOUT_MS = 45_000;
/** A big menu runs to a few hundred kB of JSON; anything past this is cut off and reads as a failure. */
const OUT_MAX = 4 * 1024 * 1024;
const INTENT_MAX = 200;

/** What a non-zero exit means, by the CLI's documented exit codes. */
export type DdKind = "ok" | "unknown" | "usage" | "auth" | "gated" | "temporary" | "server" | "rejected" | "timeout" | "spawn";
const KINDS: Record<number, DdKind> = { 0: "ok", 1: "unknown", 2: "usage", 3: "auth", 4: "gated", 5: "temporary", 6: "server", 7: "rejected" };

/** The CLI's error codes (stderr's `error.code`); a code not listed here counts as `unknown`, as the CLI asks. */
export const DD_ERROR_CODES = ["auth_expired", "auth_forbidden", "auth_missing", "keychain_unavailable", "gated", "timeout", "unreachable", "rate_limited", "server", "bad_response", "tool", "unknown"] as const;
export type DdErrorCode = (typeof DD_ERROR_CODES)[number];

export interface DdResult {
  /** The exit code, or null when the process was killed (timeout) or never started. */
  code: number | null;
  kind: DdKind;
  /** stdout parsed as JSON, or null. */
  json: unknown;
  /** stderr's `error.code`, when the CLI printed one. */
  errorCode: DdErrorCode | null;
  /** stdout as text, for the one command that prints plain text (`export-token --start`). Never logged. */
  out: string;
  /** The files asked for in `collect`, read back from the call's HOME before it is removed. */
  files: Record<string, string>;
}

export interface DdCall {
  /** A plain-language goal for a tool-backed command; left out for the sign-in and `auth` commands. */
  intent?: string;
  token?: string;
  stdin?: string;
  timeoutMs?: number;
  /** Files to write into the call's HOME first, by path relative to it. */
  files?: Record<string, string>;
  /** Files to read back from the call's HOME afterwards, by path relative to it. */
  collect?: string[];
}

/** One process run: what execFile gave back. */
export interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
  spawnError: boolean;
}
export type Spawn = (file: string, args: string[], opts: { env: Record<string, string>; cwd: string; timeoutMs: number; stdin?: string }) => Promise<Spawned>;

/** The arguments for one call: the global flag first, then the command, then its intent when it takes one. */
export function buildArgs(cmd: readonly string[], intent?: string): string[] {
  const goal = (intent ?? "").replace(/\s+/g, " ").trim().slice(0, INTENT_MAX);
  return ["--json-output", ...cmd, ...(goal ? ["--intent", goal] : [])];
}

/** The minimal environment: no setting of the Function app's reaches the CLI. */
export function buildEnv(home: string, token?: string): Record<string, string> {
  return { PATH: "/usr/bin:/bin", HOME: home, XDG_CONFIG_HOME: join(home, ".config"), LANG: "C.UTF-8", ...(token ? { DD_CLI_ACCESS_TOKEN: token } : {}) };
}

/** The one-line `{"error":{"code":...}}` on stderr, if any; an unlisted code is `unknown`. */
export function errorCodeOf(stderr: string): DdErrorCode | null {
  for (const raw of stderr.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const got = JSON.parse(line) as { error?: { code?: unknown } };
      const code = got?.error?.code;
      if (typeof code === "string") return (DD_ERROR_CODES as readonly string[]).includes(code) ? (code as DdErrorCode) : "unknown";
    } catch {
      // Not the error line.
    }
  }
  return null;
}

/** What one exit means. */
export function kindOf(s: Pick<Spawned, "code" | "killed" | "spawnError">): DdKind {
  if (s.spawnError) return "spawn";
  if (s.killed || s.code === null) return "timeout";
  return KINDS[s.code] ?? "unknown";
}

/** stdout as JSON, or null (plain text, or nothing). */
export function parseOut(stdout: string): unknown {
  const t = stdout.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
}

/** The whole result of one run. */
export function resultOf(s: Spawned, files: Record<string, string> = {}): DdResult {
  return { code: s.spawnError ? null : s.code, kind: kindOf(s), json: parseOut(s.stdout), errorCode: errorCodeOf(s.stderr), out: s.stdout, files };
}

/** A relative path inside the call's HOME, or null for anything that would leave it. */
const inside = (home: string, rel: string): string | null => {
  const p = normalize(join(home, rel));
  return p.startsWith(home + "/") ? p : null;
};

/** execFile with stdin, no shell, a timeout and a cap on what it prints. */
export const nodeSpawn: Spawn = (file, args, opts) =>
  new Promise((resolve) => {
    const child = execFile(file, args, { env: opts.env, cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: OUT_MAX, encoding: "utf8", windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
      const spawnError = Boolean(e && typeof e.code === "string" && e.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
      resolve({ code: e ? (typeof e.code === "number" ? e.code : null) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), killed: Boolean(e?.killed), spawnError });
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(opts.stdin ?? "");
  });

/** The bundled folder: DD_CLI_DIR, else bin/dd-cli beside the built module (azure/dist/app/index.mjs). */
export function bundledDir(env: Record<string, string | undefined> = process.env): string {
  if (env.DD_CLI_DIR) return env.DD_CLI_DIR;
  return join(dirname(fileURLToPath(import.meta.url)), "bin", "dd-cli");
}

/** Whether this package carries the CLI at all (not set up otherwise). */
export const hasCli = (dir: string) => existsSync(join(dir, DD_EXE));

/**
 * Copies the folder to /tmp once per instance (a fresh name, then a rename, so two calls never see half a copy) and
 * makes the executable executable. Answers the executable's path.
 */
export async function prepareCli(src: string, tmp = "/tmp"): Promise<string> {
  const dest = join(tmp, `ceo-dd-cli-${DD_VERSION}`);
  const exe = join(dest, DD_EXE);
  const ready = await stat(join(dest, ".ready")).then(() => true, () => false);
  if (!ready) {
    const part = `${dest}.${process.pid}.${randomBytes(4).toString("hex")}`;
    await cp(src, part, { recursive: true, dereference: true });
    await chmod(join(part, DD_EXE), 0o755);
    await writeFile(join(part, ".ready"), DD_VERSION);
    await rename(part, dest).catch(async () => {
      // Another call got there first, or an old half copy sits there: the one that is ready wins.
      await rm(part, { recursive: true, force: true });
      if (!(await stat(join(dest, ".ready")).then(() => true, () => false))) {
        await rm(dest, { recursive: true, force: true });
        throw new Error("dd-cli: could not place the CLI in /tmp");
      }
    });
  }
  await chmod(exe, 0o755);
  return exe;
}

/**
 * The command's name for the log: its words up to the first flag ("order preview"), never a flag's value (a query, a
 * cart, a promo code or an item list stays out of the log).
 */
export function commandName(cmd: readonly string[]): string {
  const words: string[] = [];
  for (const c of cmd) {
    if (c.startsWith("-") || !/^[a-z][a-z-]{0,30}$/.test(c)) break;
    words.push(c);
  }
  return words.join(" ") || "dd-cli";
}

export interface DdRunner {
  /** Whether the CLI is in this package. */
  ready: boolean;
  run(cmd: readonly string[], call?: DdCall): Promise<DdResult>;
}

/** A runner over a bundled folder; `spawn` and `prepare` are swapped out in tests. */
export function makeRunner(opts: { dir: string; log: (line: string) => void; spawn?: Spawn; prepare?: (dir: string) => Promise<string>; tmp?: string; ready?: boolean }): DdRunner {
  const spawn = opts.spawn ?? nodeSpawn;
  const tmp = opts.tmp ?? "/tmp";
  let exe: Promise<string> | null = null;
  const prepared = () => (exe ??= (opts.prepare ?? ((d) => prepareCli(d, tmp)))(opts.dir).catch((e: unknown) => ((exe = null), Promise.reject(e))));
  return {
    ready: opts.ready ?? hasCli(opts.dir),
    async run(cmd, call = {}) {
      const name = commandName(cmd);
      let file: string;
      try {
        file = await prepared();
      } catch {
        opts.log(`doordash: ${name} could not start`);
        return resultOf({ code: null, stdout: "", stderr: "", killed: false, spawnError: true });
      }
      await mkdir(tmp, { recursive: true });
      const home = await mkdtemp(join(tmp, "ceo-dd-home-"));
      try {
        for (const [rel, body] of Object.entries(call.files ?? {})) {
          const p = inside(home, rel);
          if (!p) continue;
          await mkdir(dirname(p), { recursive: true, mode: 0o700 });
          await writeFile(p, body, { mode: 0o600 });
        }
        const s = await spawn(file, buildArgs(cmd, call.intent), { env: buildEnv(home, call.token), cwd: home, timeoutMs: call.timeoutMs ?? DD_TIMEOUT_MS, stdin: call.stdin });
        const files: Record<string, string> = {};
        for (const rel of call.collect ?? []) {
          const p = inside(home, rel);
          const body = p ? await readFile(p, "utf8").catch(() => null) : null;
          if (body !== null) files[rel] = body;
        }
        const r = resultOf(s, files);
        opts.log(`doordash: ${name} exit ${r.code ?? r.kind}`);
        return r;
      } finally {
        await rm(home, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

/* ── The sign-in's own checks ── */

/** The one host the CLI's sign-in URL may point at (the probe: https://identity.doordash.com/authorize?…). */
export const SIGNIN_HOST = "identity.doordash.com";

/** The sign-in URL `export-token --start` printed, or null unless it is https on DoorDash's identity host. */
export function signInUrl(stdout: string): string | null {
  const m = /https:\/\/[^\s"'<>]+/.exec(stdout);
  if (!m || m[0].length > 2048) return null;
  try {
    const u = new URL(m[0]);
    if (u.protocol !== "https:" || u.hostname !== SIGNIN_HOST || u.port || u.username || u.password || u.pathname !== "/authorize") return null;
    if (!u.searchParams.get("code_challenge") || !u.searchParams.get("state")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * What Nikita pasted after signing in: the full address the page landed on (http://localhost:4180/oauth2/callback?…),
 * its part after the ?, or the code alone. One line, no spaces, a URL only on localhost with a code. Null otherwise.
 */
export function pastedCallback(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t.length > 2048 || /\s/.test(t) || [...t].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
      return u.searchParams.get("code") ? t : null;
    } catch {
      return null;
    }
  }
  if (t.includes("=")) return new URLSearchParams(t.replace(/^\?/, "")).get("code") ? t : null;
  return /^[A-Za-z0-9._~-]{4,}$/.test(t) ? t : null;
}

/** The pending sign-in file, kept only when it has the shape the CLI writes (the probe: four fields, 243 bytes). */
export function pendingOk(body: unknown): body is string {
  if (typeof body !== "string" || body.length > 4096) return false;
  try {
    const p = JSON.parse(body) as Record<string, unknown>;
    return Boolean(p) && typeof p.code_verifier === "string" && typeof p.state === "string" && typeof p.redirect_uri === "string";
  } catch {
    return false;
  }
}

/** `export-token --finish` with --json-output: {access_token, expires_at}. The token and its expiry, or null. */
export function tokenOf(json: unknown): { token: string; expiresAt: string | null } | null {
  if (!json || typeof json !== "object") return null;
  const { access_token: token, expires_at: at } = json as Record<string, unknown>;
  if (typeof token !== "string" || token.length < 16 || token.length > 8192 || /\s/.test(token)) return null;
  return { token, expiresAt: expiryOf(at) };
}

/** An expiry as ISO time: an ISO string, or epoch seconds (or milliseconds); null when unknown. */
export function expiryOf(at: unknown): string | null {
  let ms = NaN;
  if (typeof at === "number") ms = at < 1e12 ? at * 1000 : at;
  else if (typeof at === "string" && at.length <= 64) ms = /^\d+(\.\d+)?$/.test(at) ? Number(at) * (Number(at) < 1e12 ? 1000 : 1) : Date.parse(at);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
