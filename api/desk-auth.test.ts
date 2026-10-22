import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { describe, expect, it } from "vitest";
import { CHALLENGE_COOKIE, SESSION_COOKIE } from "./_desk/session.ts";
import { MemoryAuthStore } from "./_desk/store.ts";
import { cleanLabel, handleGet, handlePost } from "./desk-auth.ts";
import { gateRequest } from "./_site/gate.ts";
import { SITE_COOKIE, siteSessionOf } from "./_site/session.ts";
import { MemorySiteStore, forgetCachedState, siteKeys, type SiteStore } from "./_site/state.ts";

/**
 * The Desk's sign-in end to end (#132), with a software passkey standing in for Nikita's device: a P-256 key made
 * here, answering exactly as a platform authenticator would (no attestation, user present and verified).
 */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-10-14T09:00:00Z");
const MIN = 60_000;

const b64 = (b: Uint8Array | Buffer | string) => Buffer.from(b).toString("base64url");
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

class SoftPasskey {
  readonly id = new Uint8Array(Array.from({ length: 16 }, (_, i) => i + 1));
  private readonly key: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  counter = 0;
  constructor(private readonly origin = ORIGIN) {}

  private clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  /** The answer to navigator.credentials.create(), as the Desk sends it. */
  create(options: { challenge: string; rp: { id: string } }) {
    const jwk = this.key.publicKey.export({ format: "jwk" });
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
      ]),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.id.length);
    const authData = Buffer.concat([sha(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLen, this.id, cose]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(authData)]]) as never);
    return {
      id: b64(this.id),
      rawId: b64(this.id),
      type: "public-key",
      response: { clientDataJSON: b64(this.clientData("webauthn.create", options.challenge)), attestationObject: b64(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  /** The answer to navigator.credentials.get(), as the Desk sends it. */
  get(options: { challenge: string; rpId: string }, flags = 0x05) {
    this.counter += 1;
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha(options.rpId), Buffer.from([flags]), count]);
    const clientData = this.clientData("webauthn.get", options.challenge);
    const signature = sign("sha256", Buffer.concat([authData, sha(clientData)]), this.key.privateKey);
    return { id: b64(this.id), rawId: b64(this.id), type: "public-key", response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) }, clientExtensionResults: {} };
  }
}

/** A browser: keeps the Desk's cookies between calls, as one would. */
class Browser {
  jar = new Map<string, string>();
  constructor(
    readonly deps: { deskKey: string; store: MemoryAuthStore | null; now: number; env?: Record<string, string>; site?: SiteStore | null },
    readonly ip = "203.0.113.9",
  ) {}
  private headers(extra: Record<string, string> = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return { "x-real-ip": this.ip, ...(cookie && { cookie }), ...extra };
  }
  private keep(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const at = pair!.indexOf("=");
      const name = pair!.slice(0, at);
      const value = pair!.slice(at + 1);
      if (/Max-Age=0\b/.test(c)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }
  async post(body: unknown, extra: Record<string, string> = {}) {
    return this.keep(await handlePost(new Request(`${ORIGIN}/api/desk-auth`, { method: "POST", headers: this.headers({ "Content-Type": "application/json", ...extra }), body: JSON.stringify(body) }), this.deps));
  }
  async status() {
    return (await this.keep(await handleGet(new Request(`${ORIGIN}/api/desk-auth`, { headers: this.headers() }), this.deps)).json()) as Record<string, unknown>;
  }
  async enrol(passkey: SoftPasskey, key = DESK, label = "Windows PC") {
    const opts = await this.post({ action: "enrol-options", key, label });
    if (!opts.ok) return opts;
    return this.post({ action: "enrol", response: passkey.create((await opts.json()) as { challenge: string; rp: { id: string } }) });
  }
  async signIn(passkey: SoftPasskey, flags?: number) {
    const opts = await this.post({ action: "signin-options" });
    if (!opts.ok) return opts;
    return this.post({ action: "signin", response: passkey.get((await opts.json()) as { challenge: string; rpId: string }, flags) });
  }
}

const setup = () => {
  const store = new MemoryAuthStore();
  const deps = { deskKey: DESK, store, now: NOW };
  return { store, deps, browser: new Browser(deps) };
};

describe("enrolling a device (#132)", () => {
  it("is refused without the Desk key, and stores nothing", async () => {
    const { store, browser } = setup();
    for (const key of [undefined, "", "wrong", `${DESK} `]) {
      const res = await browser.post({ action: "enrol-options", key, label: "PC" });
      expect(res.status === 401 || res.status === 429, String(key)).toBe(true);
    }
    expect(store.keys).toEqual([]);
    expect(browser.jar.has(CHALLENGE_COOKIE.enrol)).toBe(false);
  });

  it("is refused without the challenge the key unlocked, even with a well-formed passkey", async () => {
    const { store, deps } = setup();
    const res = await new Browser(deps).post({ action: "enrol", response: new SoftPasskey().create({ challenge: "made-up", rp: { id: "ceo.test" } }) });
    expect(res.status).toBe(401);
    expect(store.keys).toEqual([]);
  });

  it("with the key, enrols the passkey's public part only, and signs the device in", async () => {
    const { store, browser } = setup();
    const res = await browser.enrol(new SoftPasskey());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, device: "Windows PC" });
    expect(store.keys).toHaveLength(1);
    expect(Object.keys(store.keys[0]!).sort()).toEqual(["added", "counter", "id", "label", "publicKey", "transports"]);
    expect(JSON.stringify(store.keys)).not.toContain(DESK);
    expect(browser.jar.has(SESSION_COOKIE)).toBe(true);
    expect(browser.jar.has(CHALLENGE_COOKIE.enrol)).toBe(false);
    expect(await browser.status()).toMatchObject({ ready: true, signedIn: true, device: "Windows PC", until: NOW + 30 * MIN, hardUntil: NOW + 12 * 60 * MIN });
  });

  it("refuses a passkey made for another site", async () => {
    const { store, browser } = setup();
    expect((await browser.enrol(new SoftPasskey("https://attacker.example"))).status).toBe(401);
    expect(store.keys).toEqual([]);
  });

  it("slows down, then locks out, wrong keys", async () => {
    const { deps, browser } = setup();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await browser.post({ action: "enrol-options", key: `guess ${i}`, label: "PC" })).status);
    // Two free, the third makes it wait 30 s, and while it waits nothing is even tried.
    expect(codes).toEqual([401, 401, 401, 429, 429, 429]);
    const locked = await browser.post({ action: "enrol-options", key: DESK, label: "PC" });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBe("30");
    expect(await locked.json()).toEqual({ error: "locked", wait: 30 });
    // The right key works once the wait is over.
    const later = new Browser({ ...deps, now: NOW + 31_000 });
    expect((await later.enrol(new SoftPasskey())).status).toBe(200);
  });
});

describe("signing in with a passkey (#132)", () => {
  it("opens a session for an enrolled device, and the session renews on use", async () => {
    const { deps, browser } = setup();
    const passkey = new SoftPasskey();
    await browser.enrol(passkey);
    const phone = new Browser({ ...deps, now: NOW + 5 * MIN });
    const res = await phone.signIn(passkey);
    expect(res.status).toBe(200);
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.includes("Max-Age=0"))!;
    expect(set).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800$/);
    const later = new Browser({ ...deps, now: NOW + 25 * MIN });
    later.jar = phone.jar;
    expect(await later.status()).toMatchObject({ signedIn: true, until: NOW + 55 * MIN });
  });

  it("refuses a passkey that isn't enrolled, an answer without the device's own unlock, and a replayed answer", async () => {
    const { store, browser } = setup();
    const passkey = new SoftPasskey();
    await browser.enrol(passkey);
    const stranger = new Browser(browser.deps, "198.51.100.2");
    expect((await stranger.signIn(new SoftPasskey())).status).toBe(401);
    // User present but not verified (no fingerprint, face or PIN).
    expect((await stranger.signIn(passkey, 0x01)).status).toBe(401);
    // An answer captured once doesn't open a session again: its challenge was used up.
    const opts = (await (await stranger.post({ action: "signin-options" })).json()) as { challenge: string; rpId: string };
    const answer = passkey.get(opts);
    const challengeCookie = stranger.jar.get(CHALLENGE_COOKIE.signin)!;
    expect((await stranger.post({ action: "signin", response: answer })).status).toBe(200);
    stranger.jar.clear();
    stranger.jar.set(CHALLENGE_COOKIE.signin, challengeCookie);
    expect((await stranger.post({ action: "signin", response: answer })).status).toBe(401);
    expect(store.keys[0]!.counter).toBe(passkey.counter);
  });

  it("locks an address out after repeated failures, and says for how long", async () => {
    const { browser } = setup();
    const passkey = new SoftPasskey();
    await browser.enrol(passkey);
    const guesser = new Browser(browser.deps, "198.51.100.7");
    const answers: Response[] = [];
    for (let i = 0; i < 4; i++) answers.push(await guesser.signIn(new SoftPasskey()));
    expect(answers.map((r) => r.status)).toEqual([401, 401, 401, 429]);
    expect(answers[3]!.headers.get("Retry-After")).toBe("30");
    expect(await answers[3]!.json()).toEqual({ error: "locked", wait: 30 });
    // Even the enrolled passkey waits its turn from that address.
    expect((await guesser.signIn(passkey)).status).toBe(429);
    expect(await guesser.status()).toMatchObject({ signedIn: false });
    // Nikita's own session, open elsewhere, is untouched.
    expect(await browser.status()).toMatchObject({ signedIn: true });
  });
});

describe("sessions, devices and sign-out (#132)", () => {
  it("ends the session at sign-out", async () => {
    const { browser } = setup();
    await browser.enrol(new SoftPasskey());
    await browser.post({ action: "signout" });
    expect(browser.jar.has(SESSION_COOKIE)).toBe(false);
    expect(await browser.status()).toMatchObject({ ready: true, signedIn: false });
  });

  it("lists the devices only when signed in, and removing one ends its sessions", async () => {
    const { store, deps, browser } = setup();
    await browser.enrol(new SoftPasskey());
    const status = await browser.status();
    expect(status.devices).toEqual([{ id: store.keys[0]!.id, label: "Windows PC", added: new Date(NOW).toISOString(), used: null, current: true }]);
    const outsider = new Browser(deps, "198.51.100.3");
    expect((await outsider.status()).devices).toBeUndefined();
    expect((await outsider.post({ action: "remove", id: store.keys[0]!.id })).status).toBe(401);
    expect(store.keys).toHaveLength(1);
    expect((await browser.post({ action: "remove", id: store.keys[0]!.id })).status).toBe(200);
    expect(store.keys).toEqual([]);
    expect(await browser.status()).toMatchObject({ signedIn: false });
  });

  it("is idle-timed out after 30 minutes and hard-timed out after 12 hours", async () => {
    const { deps, browser } = setup();
    await browser.enrol(new SoftPasskey());
    const idle = new Browser({ ...deps, now: NOW + 31 * MIN });
    idle.jar = new Map(browser.jar);
    expect(await idle.status()).toMatchObject({ signedIn: false });
    // Used every 25 minutes, it lasts all day, and no further.
    let jar = new Map(browser.jar);
    let at = NOW;
    let last: Record<string, unknown> = {};
    while (at < NOW + 12 * 60 * MIN) {
      at += 25 * MIN;
      const b = new Browser({ ...deps, now: at });
      b.jar = jar;
      last = await b.status();
      jar = b.jar;
      if (!last.signedIn) break;
    }
    expect(last.signedIn).toBe(false);
    expect(at).toBeGreaterThanOrEqual(NOW + 12 * 60 * MIN);
  });

  it("refuses requests from another site, and anything but JSON", async () => {
    const { browser } = setup();
    expect((await browser.post({ action: "enrol-options", key: DESK }, { Origin: "https://attacker.example" })).status).toBe(403);
    const form = await handlePost(new Request(`${ORIGIN}/api/desk-auth`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "action=signout" }), browser.deps);
    expect(form.status).toBe(415);
  });

  it("isn't set up without the Desk key or the Blob store", async () => {
    for (const deps of [{ deskKey: "", store: new MemoryAuthStore(), now: NOW }, { deskKey: DESK, store: null, now: NOW }]) {
      const b = new Browser(deps);
      expect(await b.status()).toEqual({ ready: false, signedIn: false });
      expect((await b.post({ action: "signin-options" })).status).toBe(503);
    }
  });

  it("keeps device names plain and short", () => {
    expect(cleanLabel("Nikita's <b>PC</b>\n")).toBe("Nikita's b PC b");
    expect(cleanLabel("x".repeat(80))).toHaveLength(40);
    expect(cleanLabel(42)).toBe("A device");
  });
});

describe("the locked site opens with the Desk passkey (#238)", () => {
  const env = { FOUNDRY_DESK_KEY: DESK };
  const locked = () => {
    forgetCachedState();
    const site = new MemorySiteStore();
    site.record = { v: 1, passkey: true, locked: "2026-10-14T08:00:00.000Z", sv: "lock-version" };
    const store = new MemoryAuthStore();
    return { site, store, deps: { deskKey: DESK, store, now: NOW, env, site } };
  };
  const opens = async (site: SiteStore, jar: Map<string, string>) =>
    (await gateRequest(new Request(`${ORIGIN}/lattice`, { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } }), { env, store: site, now: NOW + MIN })).allow;

  it("a new device added with the Desk key gets the 180-day site cookie with its Desk session", async () => {
    const { site, deps } = locked();
    const browser = new Browser(deps);
    expect(await opens(site, browser.jar)).toBe(false);
    const res = await browser.enrol(new SoftPasskey());
    expect(res.status).toBe(200);
    const line = res.headers.getSetCookie().find((c) => c.startsWith(`${SITE_COOKIE}=`))!;
    expect(line).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=15552000$/);
    expect(siteSessionOf((await siteKeys(env))!.session, browser.jar.get(SITE_COOKIE), NOW)).toMatchObject({ v: "lock-version", f: ["passkey"] });
    expect(browser.jar.has(SESSION_COOKIE)).toBe(true);
    expect(await opens(site, browser.jar)).toBe(true);
  });

  it("a passkey sign-in on another device gets it too; a failed one gets nothing", async () => {
    const { site, deps } = locked();
    const passkey = new SoftPasskey();
    await new Browser(deps).enrol(passkey);
    const phone = new Browser(deps, "198.51.100.7");
    expect((await phone.signIn(passkey, 0x01)).status).toBe(401);
    expect(phone.jar.has(SITE_COOKIE)).toBe(false);
    expect((await phone.signIn(passkey)).status).toBe(200);
    expect(await opens(site, phone.jar)).toBe(true);
  });

  it("sets no site cookie while the site is unlocked, or with no site store in the deps", async () => {
    const { site, deps } = locked();
    site.record = { v: 1, sv: "version-two", open: true };
    const open = new Browser(deps);
    await open.enrol(new SoftPasskey());
    expect(open.jar.has(SITE_COOKIE)).toBe(false);
    const { store } = setup();
    const plain = new Browser({ deskKey: DESK, store, now: NOW });
    await plain.enrol(new SoftPasskey());
    expect(plain.jar.has(SITE_COOKIE)).toBe(false);
  });
});
