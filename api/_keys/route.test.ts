import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SECRET_SETTINGS } from "../../azure/src/env.ts";
import { CHALLENGE_COOKIE, SESSION_COOKIE } from "../_desk/session.ts";
import { SoftPasskey } from "../_desk/softPasskey.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { handlePost as authPost } from "../desk-auth.ts";
import { KEY_PLACEHOLDER, MAX_VALUE, NEVER_SETTABLE, SETTABLE_KEYS, cleanValue, settable } from "./allowlist.ts";
import { STEPUP_S, handleGet, handlePost, writeHash, type KeysDeps } from "./route.ts";
import { MemoryKeyTrail } from "./trail.ts";
import type { KeyWriter, SecretDates } from "./vault.ts";

/**
 * The Desk's Keys form (#330): write-only, allowlisted, behind a passkey session and a fresh step-up. A software
 * passkey stands in for Nikita's device (api/_desk/softPasskey.ts).
 */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-10-23T23:30:00Z");
/** Looks like a key; is not one. Must never come back in an answer, a log line or the trail. */
const VALUE = "test-value-0123456789-never-echoed";

class FakeVault implements KeyWriter {
  written = new Map<string, string>();
  stamps = new Map<string, SecretDates>([
    ["claude-api-key", { enabled: true, updated: NOW - 86_400_000 }],
    ["foundry-desk-key", { enabled: true, updated: NOW - 86_400_000 }],
    // Created by the role paste so it can have its own role; not a key yet.
    ["polymarket-us-key-id", { enabled: true, updated: NOW - 86_400_000, placeholder: true }],
  ]);
  fail = false;
  writes = 0;
  async dates() {
    return new Map(this.stamps);
  }
  async set(name: string, value: string) {
    if (this.fail) throw new Error(`refused ${value}`);
    this.writes += 1;
    this.written.set(name, value);
    // A new version, untagged: a placeholder stops being one.
    this.stamps.set(name, { enabled: true, updated: NOW });
    return { updated: NOW };
  }
}

class Browser {
  jar = new Map<string, string>();
  logs: string[] = [];
  readonly store = new MemoryAuthStore();
  readonly vault = new FakeVault();
  readonly trail = new MemoryKeyTrail();
  now = NOW;
  constructor(readonly ip = "203.0.113.9") {}
  deps(): KeysDeps {
    return { desk: { deskKey: DESK, store: this.store, now: this.now }, writer: this.vault, trail: this.trail, log: (l) => this.logs.push(l) };
  }
  headers(extra: Record<string, string> = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return { "x-real-ip": this.ip, ...(cookie && { cookie }), ...extra };
  }
  keep(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const at = pair!.indexOf("=");
      if (/Max-Age=0\b/.test(c)) this.jar.delete(pair!.slice(0, at));
      else this.jar.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
    return res;
  }
  async signIn(passkey: SoftPasskey) {
    const auth = { deskKey: DESK, store: this.store, now: this.now };
    const post = async (body: unknown) =>
      this.keep(await authPost(new Request(`${ORIGIN}/api/desk-auth`, { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) }), auth));
    const opts = await post({ action: "enrol-options", key: DESK, label: "Windows PC" });
    await post({ action: "enrol", response: passkey.create((await opts.json()) as { challenge: string; rp: { id: string } }) });
    expect(this.jar.has(SESSION_COOKIE)).toBe(true);
  }
  async post(body: unknown, extra: Record<string, string> = {}) {
    return this.keep(await handlePost(new Request(`${ORIGIN}/api/keys`, { method: "POST", headers: this.headers({ "Content-Type": "application/json", ...extra }), body: JSON.stringify(body) }), this.deps()));
  }
  async get() {
    return this.keep(await handleGet(new Request(`${ORIGIN}/api/keys`, { headers: this.headers() }), this.deps()));
  }
  /** The step-up's passkey request, for one name and value (by hash), as the Desk asks for it. */
  async options(name = "claude-api-key", value = VALUE) {
    return this.post({ action: "options", h: writeHash(name, value.trim()) });
  }
  /** The whole step-up and write, as the Desk does it. */
  async set(passkey: SoftPasskey, name: string, value = VALUE) {
    const opts = await this.options(name, value);
    if (!opts.ok) return opts;
    return this.post({ action: "set", name, value, response: passkey.get((await opts.json()) as { challenge: string; rpId: string }) });
  }
}

const signedIn = async () => {
  const b = new Browser();
  const passkey = new SoftPasskey();
  await b.signIn(passkey);
  return { b, passkey };
};

describe("the allowlist (#330)", () => {
  it("is exactly the third-party keys and settings Nikita pastes in", () => {
    expect(SETTABLE_KEYS.map((k) => k.secret)).toEqual([
      "claude-api-key",
      "fantasypros",
      "polymarket-us-key-id",
      "polymarket-us-secret-key",
      "gmail-client-id",
      "gmail-client-secret",
      "paypal-client-id",
      "paypal-client-secret",
      "elevenlabs",
      "openai",
      "email-skip-terms",
      "email-priority",
    ]);
  });

  it("never lets the lock's, the crew's or the sealed data's keys through", () => {
    const never = ["foundry-desk-key", "site-bypass-token", "desk-pings-secret", "foundry-github-token", "foundry-app-id", "foundry-app-installation-id", "foundry-app-private-key", "desk-vapid-public-key", "desk-vapid-private-key", "desk-vapid-subject", "gmail-token-key", "submind-feed-token"];
    for (const name of never) expect(settable(name), name).toBeNull();
    // Even a future name of the same kind.
    for (const name of ["foundry-app-new", "desk-vapid-x", "submind-relay-token", "site-session-secret", "some-token"]) expect(settable(name), name).toBeNull();
    for (const k of SETTABLE_KEYS) expect(NEVER_SETTABLE.some((n) => (typeof n === "string" ? n === k.secret : n.test(k.secret))), k.secret).toBe(false);
  });

  it("puts every secret in the template on exactly one list, with the template's own setting", () => {
    const bicep = readFileSync(new URL("../../infra/resources.bicep", import.meta.url), "utf8");
    const pairs = [...bicep.matchAll(/\{ setting: '([A-Z0-9_]+)', secret: '([a-z0-9-]+)' \}/g)].map((m) => ({ setting: m[1]!, secret: m[2]! }));
    expect(pairs.length).toBeGreaterThan(20);
    for (const p of pairs) {
      const on = SETTABLE_KEYS.find((k) => k.secret === p.secret);
      const off = NEVER_SETTABLE.some((n) => (typeof n === "string" ? n === p.secret : n.test(p.secret)));
      expect(Boolean(on) !== off, `${p.secret} on exactly one list`).toBe(true);
      if (on) expect(on.setting, p.secret).toBe(p.setting);
    }
    for (const k of SETTABLE_KEYS) expect((SECRET_SETTINGS as readonly string[]).includes(k.setting), k.setting).toBe(true);
  });

  it("refuses unknown names, odd types and values that aren't one line of text", () => {
    for (const name of ["", "CLAUDE_API_KEY", "claude-api-key ", "../foundry-desk-key", null, 7, { secret: "claude-api-key" }]) expect(settable(name), String(name)).toBeNull();
    expect(cleanValue("  k  ")).toBe("k");
    for (const v of ["", "   ", "a\nb", "a\u0000b", "x".repeat(MAX_VALUE + 1), 42, null]) expect(cleanValue(v), JSON.stringify(v)).toBeNull();
  });
});

describe("setting a key from the Desk (#330)", () => {
  it("with a session and a fresh passkey answer, writes the value and answers only its name and time", async () => {
    const { b, passkey } = await signedIn();
    const res = await b.set(passkey, "claude-api-key", `  ${VALUE}\n`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "claude-api-key", updated: NOW });
    expect(b.vault.written.get("claude-api-key")).toBe(VALUE);
    expect(b.trail.entries).toEqual([{ name: "claude-api-key", at: NOW }]);
    expect(b.logs).toEqual([`keys: set claude-api-key at ${new Date(NOW).toISOString()}`]);
    // The step-up is spent with the write: the next one needs the passkey again.
    expect(b.jar.has(CHALLENGE_COOKIE.keys)).toBe(false);
  });

  it("refuses without a session, before looking at anything else", async () => {
    const b = new Browser();
    for (const body of [{ action: "options", h: writeHash("claude-api-key", VALUE) }, { action: "set", name: "claude-api-key", value: VALUE }, { action: "set", name: "foundry-desk-key", value: VALUE }]) {
      const res = await b.post(body);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "signed-out" });
    }
    expect((await b.get()).status).toBe(401);
    expect(b.vault.written.size).toBe(0);
  });

  it("refuses a session without the step-up, a made-up answer, or someone else's passkey", async () => {
    const { b, passkey } = await signedIn();
    // A stolen session cookie and nothing else.
    let res = await b.post({ action: "set", name: "claude-api-key", value: VALUE });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "step-up" });
    // A real challenge, answered by a passkey that isn't this session's.
    const opts = (await (await b.options()).json()) as { challenge: string; rpId: string; allowCredentials: { id: string }[] };
    expect(opts.allowCredentials.map((c) => c.id)).toEqual([passkey.get(opts).id]);
    res = await b.post({ action: "set", name: "claude-api-key", value: VALUE, response: new SoftPasskey().get(opts) });
    expect(res.status).toBe(401);
    // An answer to a challenge the server never gave.
    await b.options();
    res = await b.post({ action: "set", name: "claude-api-key", value: VALUE, response: passkey.get({ challenge: "made-up", rpId: "ceo.test" }) });
    expect(res.status).toBe(401);
    expect(b.vault.written.size).toBe(0);
  });

  it("refuses one answer twice, and a step-up older than two minutes", async () => {
    const { b, passkey } = await signedIn();
    const opts = (await (await b.options("polymarket-us-key-id")).json()) as { challenge: string; rpId: string };
    const cookie = b.jar.get(CHALLENGE_COOKIE.keys)!;
    let res = await b.post({ action: "set", name: "polymarket-us-key-id", value: VALUE, response: passkey.get(opts) });
    expect(res.status).toBe(200);
    // The same challenge cookie and a fresh signature over the same challenge, for the same write: spent.
    b.jar.set(CHALLENGE_COOKIE.keys, cookie);
    res = await b.post({ action: "set", name: "polymarket-us-key-id", value: VALUE, response: passkey.get(opts) });
    expect(res.status).toBe(401);
    // A new challenge, answered too late.
    const late = (await (await b.options()).json()) as { challenge: string; rpId: string };
    b.now = NOW + (STEPUP_S + 1) * 1000;
    res = await b.post({ action: "set", name: "claude-api-key", value: VALUE, response: passkey.get(late) });
    expect(res.status).toBe(401);
    expect([...b.vault.written.keys()]).toEqual(["polymarket-us-key-id"]);
  });

  it("binds the step-up to one name and value: any other is refused, and so is a request without the hash", async () => {
    const { b, passkey } = await signedIn();
    // No hash, or one that isn't sha256 hex: no passkey request at all.
    for (const h of [undefined, "", "abc", writeHash("claude-api-key", VALUE).toUpperCase(), 7]) expect((await b.post({ action: "options", h })).status, String(h)).toBe(400);
    // Asked for claude-api-key with VALUE; answered, then sent with another name, then another value.
    let opts = (await (await b.options("claude-api-key", VALUE)).json()) as { challenge: string; rpId: string };
    let res = await b.post({ action: "set", name: "polymarket-us-key-id", value: VALUE, response: passkey.get(opts) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "step-up" });
    opts = (await (await b.options("claude-api-key", VALUE)).json()) as { challenge: string; rpId: string };
    res = await b.post({ action: "set", name: "claude-api-key", value: `${VALUE}-swapped`, response: passkey.get(opts) });
    expect(res.status).toBe(401);
    expect(b.vault.written.size).toBe(0);
    // The hash is over the stored (trimmed) value, and the cookie never carries it plain.
    opts = (await (await b.options("claude-api-key", VALUE)).json()) as { challenge: string; rpId: string };
    expect(b.jar.get(CHALLENGE_COOKIE.keys)).not.toContain(writeHash("claude-api-key", VALUE));
    res = await b.post({ action: "set", name: "claude-api-key", value: ` ${VALUE} `, response: passkey.get(opts) });
    expect(res.status).toBe(200);
    expect(b.vault.written.get("claude-api-key")).toBe(VALUE);
  });

  it("spends a challenge once even when two requests race with the same answer", async () => {
    const { b, passkey } = await signedIn();
    const opts = (await (await b.options("openai")).json()) as { challenge: string; rpId: string };
    const first = passkey.get(opts);
    const second = passkey.get(opts);
    const results = await Promise.all([
      b.post({ action: "set", name: "openai", value: VALUE, response: first }),
      b.post({ action: "set", name: "openai", value: VALUE, response: second }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(b.vault.writes).toBe(1);
    // And a later replay of it, too.
    expect((await b.post({ action: "set", name: "openai", value: VALUE, response: passkey.get(opts) })).status).toBe(401);
    expect(b.vault.writes).toBe(1);
  });

  it("won't take the role paste's placeholder as a key", async () => {
    const { b, passkey } = await signedIn();
    const res = await b.set(passkey, "claude-api-key", KEY_PLACEHOLDER);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad-value" });
  });

  it("refuses names off the allowlist, even with a good step-up", async () => {
    const { b, passkey } = await signedIn();
    for (const name of ["foundry-desk-key", "site-bypass-token", "desk-pings-secret", "foundry-github-token", "gmail-token-key", "submind-feed-token", "nope"]) {
      const res = await b.set(passkey, name);
      expect(res.status, name).toBe(400);
      expect(await res.json()).toEqual({ error: "not-allowed" });
    }
    expect(b.vault.written.size).toBe(0);
  });

  it("refuses other sites, other content types and oversized bodies", async () => {
    const { b } = await signedIn();
    expect((await b.post({ action: "options", h: writeHash("claude-api-key", VALUE) }, { origin: "https://evil.test" })).status).toBe(403);
    const form = await handlePost(new Request(`${ORIGIN}/api/keys`, { method: "POST", headers: b.headers({ "Content-Type": "text/plain" }), body: "{}" }), b.deps());
    expect(form.status).toBe(415);
    expect((await b.post({ action: "set", name: "claude-api-key", value: "x".repeat(20_000) })).status).toBe(413);
    expect((await b.post({ action: "set", name: "claude-api-key", value: "x".repeat(MAX_VALUE + 1) })).status).toBe(400);
  });

  it("limits writes: six in a row, then a wait", async () => {
    const { b, passkey } = await signedIn();
    for (let i = 0; i < 6; i++) {
      b.now = NOW + i * 1000;
      expect((await b.set(passkey, "claude-api-key")).status, `write ${i + 1}`).toBe(200);
    }
    b.now = NOW + 7000;
    expect((await b.set(passkey, "claude-api-key")).status).toBe(200);
    b.now = NOW + 8000;
    const res = await b.set(passkey, "claude-api-key");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("never echoes or logs the value, even when the vault fails", async () => {
    const { b, passkey } = await signedIn();
    const spy = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const ok = await b.set(passkey, "openai");
    b.vault.fail = true;
    const failed = await b.set(passkey, "polymarket-us-key-id");
    expect(failed.status).toBe(502);
    const status = await b.get();
    const everything = [await ok.text(), await failed.text(), await status.text(), ...b.logs, JSON.stringify(b.trail.entries), ...[spy, warn, error].flatMap((s) => s.mock.calls.flat().map(String))];
    for (const text of everything) expect(text).not.toContain(VALUE);
    expect(b.logs).toContain("keys: polymarket-us-key-id not set (the vault refused)");
    spy.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("what the Desk is shown (#330)", () => {
  it("names, whether each is set and when, and never anything off the allowlist", async () => {
    const { b, passkey } = await signedIn();
    await b.set(passkey, "fantasypros");
    const res = await b.get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as { vault: string; keys: { name: string; set: boolean; updated: number | null; lastSet: number | null }[] };
    expect(body.vault).toBe("ok");
    expect(body.keys.map((k) => k.name)).toEqual(SETTABLE_KEYS.map((k) => k.secret));
    expect(body.keys.find((k) => k.name === "claude-api-key")).toMatchObject({ set: true, updated: NOW - 86_400_000, lastSet: null });
    expect(body.keys.find((k) => k.name === "fantasypros")).toMatchObject({ set: true, updated: NOW, lastSet: NOW });
    expect(body.keys.find((k) => k.name === "openai")).toMatchObject({ set: false, updated: null });
    expect(body.keys.find((k) => k.name === "polymarket-us-key-id")).toMatchObject({ set: false });
    expect(JSON.stringify(body)).not.toContain("foundry-desk-key");
  });

  it("says when there is no vault here (the Vercel copy)", async () => {
    const { b } = await signedIn();
    const res = await handleGet(new Request(`${ORIGIN}/api/keys`, { headers: b.headers() }), { ...b.deps(), writer: null });
    const body = (await res.json()) as { vault: string; keys: { set: boolean | null }[] };
    expect(body.vault).toBe("none");
    expect(body.keys.every((k) => k.set === null)).toBe(true);
  });
});
