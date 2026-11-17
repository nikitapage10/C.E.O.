import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../../_blob.ts";
import { MemoryAuthStore } from "../../_desk/store.ts";
import { signedInCookie } from "../../_desk/testing.ts";
import { HomeVault, homeKey } from "../devices/vault.ts";
import { buildArgs, buildEnv, DD_EXE, DD_VERSION, errorCodeOf, expiryOf, hasCli, kindOf, makeRunner, prepareCli, parseOut, pastedCallback, pendingOk, PENDING_FILE, resultOf, signInUrl, tokenOf, type DdRunner, type Spawn, type Spawned } from "./cli.ts";
import { doordashGet, doordashPost, PENDING_MS, stateOf, type DoorDashDeps } from "./route.ts";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

/**
 * DoorDash, phase 0 (#1195): the CLI runner's pure parts and the sign-in route, with the CLI mocked. Every token, code,
 * state and verifier here is made up; the shapes are the ones the probe on chat/1195-doordash-probe saw.
 */

const NOW = Date.parse("2026-11-17T18:00:00Z");
const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const SEAL = homeKey("a-test-home-token-key-that-is-long-enough-0123", "seal")!;
const TOKEN = "test-dd-access-token-0000000000000000";
const SIGNIN = "https://identity.doordash.com/authorize?client_id=test&code_challenge=abc&code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A4180%2Foauth2%2Fcallback&response_type=code&scope=openid&state=teststate";
const PENDING = JSON.stringify({ code_verifier: "test-verifier", state: "teststate", redirect_uri: "http://localhost:4180/oauth2/callback", created_at: NOW / 1000 });
const PASTED = "http://localhost:4180/oauth2/callback?code=test-code-123&state=teststate";

const spawned = (over: Partial<Spawned> = {}): Spawned => ({ code: 0, stdout: "", stderr: "", killed: false, spawnError: false, ...over });

describe("the runner's pure parts (#1195)", () => {
  it("puts --json-output first and the intent last, and only when there is one", () => {
    expect(buildArgs(["search"], "find a dinner nearby")).toEqual(["--json-output", "search", "--intent", "find a dinner nearby"]);
    expect(buildArgs(["export-token", "--start"])).toEqual(["--json-output", "export-token", "--start"]);
    expect(buildArgs(["auth", "status"], "  ")).toEqual(["--json-output", "auth", "status"]);
    expect(buildArgs(["search"], "one\nline   only")[3]).toBe("one line only");
    expect(buildArgs(["search"], "x".repeat(500))[3]).toHaveLength(200);
  });

  it("hands the CLI a minimal environment, the token only when given", () => {
    expect(buildEnv("/tmp/h")).toEqual({ PATH: "/usr/bin:/bin", HOME: "/tmp/h", XDG_CONFIG_HOME: "/tmp/h/.config", LANG: "C.UTF-8" });
    expect(buildEnv("/tmp/h", TOKEN).DD_CLI_ACCESS_TOKEN).toBe(TOKEN);
  });

  it("maps exit codes and reads stderr's error code, unknown codes as unknown", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 9].map((code) => kindOf({ code, killed: false, spawnError: false }))).toEqual(["ok", "unknown", "usage", "auth", "gated", "temporary", "server", "rejected", "unknown"]);
    expect(kindOf({ code: null, killed: true, spawnError: false })).toBe("timeout");
    expect(kindOf({ code: null, killed: false, spawnError: true })).toBe("spawn");
    expect(errorCodeOf('some text\n{"error": {"code": "auth_expired", "message": "Signed out"}}\n')).toBe("auth_expired");
    expect(errorCodeOf('{"error": {"code": "brand_new_code", "message": "x"}}')).toBe("unknown");
    expect(errorCodeOf("Error: No pending sign-in.")).toBeNull();
  });

  it("parses JSON stdout and leaves plain text as text", () => {
    expect(parseOut('{"cart_id":"c1"}\n')).toEqual({ cart_id: "c1" });
    expect(parseOut(`${SIGNIN}\n`)).toBeNull();
    expect(parseOut("{broken")).toBeNull();
    const r = resultOf(spawned({ code: 3, stderr: '{"error":{"code":"auth_missing","message":"m"}}' }));
    expect(r).toMatchObject({ code: 3, kind: "auth", errorCode: "auth_missing", json: null });
  });

  it("takes only DoorDash's identity host for the sign-in URL", () => {
    expect(signInUrl(`${SIGNIN}\n`)).toBe(new URL(SIGNIN).toString());
    expect(signInUrl(SIGNIN.replace("identity.doordash.com", "identity.doordash.com.evil.test"))).toBeNull();
    expect(signInUrl(SIGNIN.replace("https://", "http://"))).toBeNull();
    expect(signInUrl(SIGNIN.replace("/authorize", "/elsewhere"))).toBeNull();
    expect(signInUrl(SIGNIN.replace("identity.doordash.com", "identity.doordash.com:8443"))).toBeNull();
    expect(signInUrl("https://identity.doordash.com/authorize?client_id=x")).toBeNull();
    expect(signInUrl("no url here")).toBeNull();
  });

  it("takes the pasted address, its query or the code, and nothing else", () => {
    expect(pastedCallback(`  ${PASTED}  `)).toBe(PASTED);
    expect(pastedCallback("code=test-code-123&state=teststate")).toBe("code=test-code-123&state=teststate");
    expect(pastedCallback("test-code-123")).toBe("test-code-123");
    expect(pastedCallback("https://evil.test/oauth2/callback?code=x")).toBeNull();
    expect(pastedCallback("http://localhost:4180/oauth2/callback?state=only")).toBeNull();
    expect(pastedCallback("javascript:alert(1)")).toBeNull();
    expect(pastedCallback("two words")).toBeNull();
    expect(pastedCallback("a\nb")).toBeNull();
    expect(pastedCallback(42)).toBeNull();
    expect(pastedCallback("x".repeat(3000))).toBeNull();
  });

  it("reads the token and its expiry, and checks the pending file's shape", () => {
    expect(tokenOf({ access_token: TOKEN, expires_at: "2026-11-20T18:00:00Z" })).toEqual({ token: TOKEN, expiresAt: "2026-11-20T18:00:00.000Z" });
    expect(tokenOf({ access_token: TOKEN, expires_at: null })).toEqual({ token: TOKEN, expiresAt: null });
    expect(tokenOf({ access_token: "short" })).toBeNull();
    expect(tokenOf({ access_token: "has a space in it 000000000" })).toBeNull();
    expect(tokenOf(null)).toBeNull();
    expect(expiryOf(1795543200)).toBe(new Date(1795543200_000).toISOString());
    expect(expiryOf("1795543200")).toBe(new Date(1795543200_000).toISOString());
    expect(expiryOf("soon")).toBeNull();
    expect(pendingOk(PENDING)).toBe(true);
    expect(pendingOk('{"state":"x"}')).toBe(false);
    expect(pendingOk("not json")).toBe(false);
  });
});

describe("the runner (#1195)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("puts files in a fresh HOME, reads them back, removes the HOME and logs the command and exit only", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "dd-test-"));
    dirs.push(tmp);
    const lines: string[] = [];
    const seen: { args: string[]; env: Record<string, string>; stdin?: string; home: string }[] = [];
    const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
    const spawn: Spawn = async (_file, args, opts) => {
      seen.push({ args, env: opts.env, stdin: opts.stdin, home: opts.cwd });
      expect(readFileSync(join(opts.cwd, PENDING_FILE), "utf8")).toBe(PENDING);
      writeFileSync(join(opts.cwd, PENDING_FILE), "{}");
      return spawned({ stdout: JSON.stringify({ access_token: TOKEN, expires_at: null }) });
    };
    const cli = makeRunner({ dir: "/nowhere", log: (l) => lines.push(l), spawn, prepare: async () => "/fake/dd-cli", tmp, ready: true });
    const r = await cli.run(["export-token", "--finish", "-"], { stdin: `${PASTED}\n`, token: TOKEN, files: { [PENDING_FILE]: PENDING, "../escape.json": "x" }, collect: [PENDING_FILE] });
    expect(r.code).toBe(0);
    expect(tokenOf(r.json)?.token).toBe(TOKEN);
    expect(r.files[PENDING_FILE]).toBe("{}");
    expect(seen[0]!.args).toEqual(["--json-output", "export-token", "--finish", "-"]);
    expect(seen[0]!.env.DD_CLI_ACCESS_TOKEN).toBe(TOKEN);
    expect(seen[0]!.stdin).toBe(`${PASTED}\n`);
    expect(existsSync(seen[0]!.home)).toBe(false);
    expect(existsSync(join(tmp, "escape.json"))).toBe(false);
    expect(lines).toEqual(["doordash: export-token exit 0"]);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("copies the bundled folder to /tmp once and makes the executable executable", async () => {
    const { mkdirSync, writeFileSync, statSync, existsSync } = await import("node:fs");
    const tmp = mkdtempSync(join(tmpdir(), "dd-test-"));
    dirs.push(tmp);
    const src = join(tmp, "bundle");
    mkdirSync(join(src, "_internal"), { recursive: true });
    writeFileSync(join(src, DD_EXE), "not really a program", { mode: 0o644 });
    writeFileSync(join(src, "_internal", "lib.so"), "x");
    expect(hasCli(src)).toBe(true);
    expect(hasCli(join(tmp, "nothing"))).toBe(false);
    const exe = await prepareCli(src, join(tmp, "run"));
    expect(exe).toBe(join(tmp, "run", `ceo-dd-cli-${DD_VERSION}`, DD_EXE));
    expect(statSync(exe).mode & 0o111).toBe(0o111);
    expect(existsSync(join(tmp, "run", `ceo-dd-cli-${DD_VERSION}`, "_internal", "lib.so"))).toBe(true);
    // Twice, and at once: one copy wins, both answer the same path.
    expect(await Promise.all([prepareCli(src, join(tmp, "run")), prepareCli(src, join(tmp, "run2")), prepareCli(src, join(tmp, "run2"))])).toEqual([exe, join(tmp, "run2", `ceo-dd-cli-${DD_VERSION}`, DD_EXE), join(tmp, "run2", `ceo-dd-cli-${DD_VERSION}`, DD_EXE)]);
  });

  it("calls execFile with no shell, and says when it could not start", async () => {
    const { execFile } = await import("node:child_process");
    const mocked = vi.mocked(execFile);
    const stdin = { on: vi.fn(), end: vi.fn() };
    mocked.mockImplementation(((_f: string, _a: string[], _o: unknown, cb: (e: unknown, out: string, err: string) => void) => {
      queueMicrotask(() => cb(Object.assign(new Error("exit"), { code: 3 }), "", '{"error":{"code":"auth_expired","message":"m"}}'));
      return { stdin };
    }) as never);
    const tmp = mkdtempSync(join(tmpdir(), "dd-test-"));
    dirs.push(tmp);
    const lines: string[] = [];
    const cli = makeRunner({ dir: "/nowhere", log: (l) => lines.push(l), prepare: async () => "/fake/dd-cli", tmp, ready: true });
    const r = await cli.run(["auth", "status"], { token: TOKEN });
    expect(r).toMatchObject({ code: 3, kind: "auth", errorCode: "auth_expired" });
    const [file, args, opts] = mocked.mock.calls[0]! as unknown as [string, string[], { shell?: unknown; env: Record<string, string> }];
    expect(file).toBe("/fake/dd-cli");
    expect(args).toEqual(["--json-output", "auth", "status"]);
    expect(opts.shell).toBeUndefined();
    expect(Object.keys(opts.env).sort()).toEqual(["DD_CLI_ACCESS_TOKEN", "HOME", "LANG", "PATH", "XDG_CONFIG_HOME"]);
    expect(stdin.end).toHaveBeenCalledWith("");

    const broken = makeRunner({ dir: "/nowhere", log: (l) => lines.push(l), prepare: async () => Promise.reject(new Error("no")), tmp, ready: true });
    expect((await broken.run(["auth", "status"])).kind).toBe("spawn");
    expect(lines.at(-1)).toBe("doordash: auth status could not start");
  });
});

function memoryBlob(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

/** A CLI that answers the two sign-in steps the way v0.2.6 does. */
function fakeCli(over: { start?: Partial<Spawned>; finish?: Partial<Spawned>; ready?: boolean } = {}): DdRunner & { calls: { cmd: readonly string[]; files?: Record<string, string>; stdin?: string }[] } {
  const calls: { cmd: readonly string[]; files?: Record<string, string>; stdin?: string }[] = [];
  return {
    ready: over.ready ?? true,
    calls,
    async run(cmd, call = {}) {
      calls.push({ cmd, files: call.files, stdin: call.stdin });
      if (cmd[1] === "--start") return resultOf(spawned({ stdout: `${SIGNIN}\n`, ...over.start }), { [PENDING_FILE]: PENDING });
      if (call.files?.[PENDING_FILE] !== PENDING) return resultOf(spawned({ code: 1, stderr: "Error: No pending sign-in." }));
      return resultOf(spawned({ stdout: JSON.stringify({ access_token: TOKEN, expires_at: "2026-11-20T18:00:00Z" }), ...over.finish }));
    },
  };
}

async function setup(over: Partial<DoorDashDeps> = {}) {
  const blob = memoryBlob();
  const store = new MemoryAuthStore();
  const vault = new HomeVault(blob, SEAL);
  const lines: string[] = [];
  const cookie = await signedInCookie(DESK, NOW, store);
  const cli = fakeCli();
  const deps: DoorDashDeps = { desk: { deskKey: DESK, store, now: NOW }, blob, vault, cli, now: NOW, log: (l) => lines.push(l), ...over };
  return { deps, blob, vault, cookie, lines, cli };
}

const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers: { Origin: ORIGIN, ...headers } });
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/haven/doordash`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
const allText = (blob: { files: Map<string, Uint8Array> }) => [...blob.files.values()].map((b) => new TextDecoder().decode(b)).join("\n");

describe("Sign in to DoorDash (#1195)", () => {
  it("states: not set up, signed out, live, expired", () => {
    expect(stateOf(false, null, NOW)).toBe("not-set-up");
    expect(stateOf(true, null, NOW)).toBe("signed-out");
    expect(stateOf(true, { token: TOKEN, expiresAt: null, signedInAt: "" }, NOW)).toBe("live");
    expect(stateOf(true, { token: TOKEN, expiresAt: new Date(NOW + 1000).toISOString(), signedInAt: "" }, NOW)).toBe("live");
    expect(stateOf(true, { token: TOKEN, expiresAt: new Date(NOW).toISOString(), signedInAt: "" }, NOW)).toBe("expired");
  });

  it("the public status is the state alone; without the CLI or the sealing key it is not set up", async () => {
    const { deps } = await setup();
    expect(await (await doordashGet(get("/api/haven/doordash?view=status"), deps)).json()).toEqual({ state: "signed-out" });
    expect(await (await doordashGet(get("/api/haven/doordash?view=status"), { ...deps, cli: fakeCli({ ready: false }) })).json()).toEqual({ state: "not-set-up" });
    expect(await (await doordashGet(get("/api/haven/doordash?view=status"), { ...deps, vault: null })).json()).toEqual({ state: "not-set-up" });
    expect((await doordashGet(get("/api/haven/doordash"), deps)).status).toBe(401);
    expect((await doordashGet(get("/api/haven/doordash?view=other"), deps)).status).toBe(400);
  });

  it("signs in across two instances: start seals the pending sign-in, finish restores it and seals the token", async () => {
    const { deps, cookie, blob, lines, cli } = await setup();
    const start = await doordashPost(post({ action: "signin-start" }, { Cookie: cookie }), deps);
    expect(start.status).toBe(200);
    const s = (await start.json()) as { url: string; until: string };
    expect(new URL(s.url).hostname).toBe("identity.doordash.com");
    expect(s.until).toBe(new Date(NOW + PENDING_MS).toISOString());
    expect(cli.calls[0]!.cmd).toEqual(["export-token", "--start"]);

    // A second instance: a fresh runner, the same private store.
    const other = fakeCli();
    const finish = await doordashPost(post({ action: "signin-finish", pasted: PASTED }, { Cookie: cookie }), { ...deps, cli: other, now: NOW + 60_000 });
    expect(finish.status).toBe(200);
    expect(await finish.json()).toEqual({ ok: true, state: "live", expiresAt: "2026-11-20T18:00:00.000Z" });
    expect(other.calls[0]).toMatchObject({ cmd: ["export-token", "--finish", "-"], stdin: `${PASTED}\n`, files: { [PENDING_FILE]: PENDING } });

    // Sealed: nothing readable in the store, and the pending sign-in is gone.
    expect(allText(blob)).not.toContain(TOKEN);
    expect(allText(blob)).not.toContain("test-verifier");
    expect([...blob.files.keys()]).toEqual(["haven/devices/doordash.json"]);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("test-code-123");

    const status = await doordashGet(get("/api/haven/doordash?view=status", { Cookie: cookie }), { ...deps, now: NOW + 120_000, desk: { ...deps.desk, now: NOW + 120_000 } });
    expect(await status.json()).toEqual({ state: "live", expiresAt: "2026-11-20T18:00:00.000Z" });
    expect(await (await doordashGet(get("/api/haven/doordash?view=status"), deps)).json()).toEqual({ state: "live" });
    const later = NOW + 4 * 24 * 3600_000;
    expect(await (await doordashGet(get("/api/haven/doordash?view=status"), { ...deps, now: later })).json()).toEqual({ state: "expired" });

    const out = await doordashPost(post({ action: "signout" }, { Cookie: cookie }), deps);
    expect(await out.json()).toEqual({ ok: true, state: "signed-out", expiresAt: null });
    expect(blob.files.size).toBe(0);
  });

  it("refuses a finish with no pending sign-in, an old one, or a bad paste", async () => {
    const { deps, cookie, vault } = await setup();
    expect((await doordashPost(post({ action: "signin-finish", pasted: PASTED }, { Cookie: cookie }), deps)).status).toBe(409);
    await vault.write("doordash-pending", { file: PENDING, at: NOW - PENDING_MS - 1 });
    expect((await doordashPost(post({ action: "signin-finish", pasted: PASTED }, { Cookie: cookie }), deps)).status).toBe(409);
    expect(await vault.read("doordash-pending")).toBeNull();
    await vault.write("doordash-pending", { file: PENDING, at: NOW });
    const bad = await doordashPost(post({ action: "signin-finish", pasted: "https://evil.test/?code=x" }, { Cookie: cookie }), deps);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad-paste" });
  });

  it("a refused sign-in keeps the pending one for another paste; an odd answer seals nothing", async () => {
    const { deps, cookie, vault } = await setup({ cli: fakeCli({ finish: { code: 1, stdout: "", stderr: "Error: Authentication/Authorization failed" } }) });
    await vault.write("doordash-pending", { file: PENDING, at: NOW });
    const r = await doordashPost(post({ action: "signin-finish", pasted: PASTED }, { Cookie: cookie }), deps);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "refused" });
    expect(await vault.read("doordash-pending")).not.toBeNull();
    expect(await vault.read("doordash")).toBeNull();

    const odd = await doordashPost(post({ action: "signin-finish", pasted: PASTED }, { Cookie: cookie }), { ...deps, cli: fakeCli({ finish: { stdout: '{"access_token":"x"}' } }) });
    expect(odd.status).toBe(502);
    expect(await vault.read("doordash")).toBeNull();
  });

  it("refuses a start whose URL isn't DoorDash's", async () => {
    const { deps, cookie, vault } = await setup({ cli: fakeCli({ start: { stdout: "https://evil.test/authorize?code_challenge=a&state=b\n" } }) });
    const r = await doordashPost(post({ action: "signin-start" }, { Cookie: cookie }), deps);
    expect(r.status).toBe(502);
    expect(await vault.read("doordash-pending")).toBeNull();
  });

  it("is for a passkey session only: no phone key, no bearer, no session, nothing when not set up", async () => {
    const { deps, cookie } = await setup();
    expect((await doordashPost(post({ action: "signin-start" }), deps)).status).toBe(401);
    expect((await doordashPost(post({ action: "signin-start" }, { Cookie: cookie, Authorization: "Bearer x" }), deps)).status).toBe(401);
    expect((await doordashPost(post({ action: "signin-start" }, { Cookie: cookie, "x-ceo-phone-key": "x" }), deps)).status).toBe(401);
    expect((await doordashPost(post({ action: "signin-start" }, { Cookie: cookie }), { ...deps, cli: fakeCli({ ready: false }) })).status).toBe(503);
    expect((await doordashPost(post({ action: "order" }, { Cookie: cookie }), deps)).status).toBe(400);
  });
});
