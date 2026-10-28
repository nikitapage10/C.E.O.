import { describe, expect, it } from "vitest";
import { emptyRelayStatus } from "../../packages/core/src/relay.ts";
import { SESSION_COOKIE } from "../_desk/session.ts";
import { SoftPasskey } from "../_desk/softPasskey.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { handlePost as authPost } from "../desk-auth.ts";
import { CEILING, MemorySpendStore, relayBudget, SPEND_PATH } from "./budget.ts";
import { DRAFT_MODEL, draftRequest, readDraft, readSort, SORT_MODEL, sortRequest, type ClaudeBody } from "./models.ts";
import { GET, HUB_PATH, PAIR_PATH, POST, RELAY_PATH, UNLOCK_COOKIE, makeRequest, shownState, unlockedUntil, type RelayRouteDeps } from "./route.ts";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { BlobRelayStore, MemoryRelayStore, PRIVATE_PATH, readPrivate, relaySealKey } from "./store.ts";
import { readTextsView, type TextItem, type TextRequest, type TextsView } from "./texts.ts";
import { decide, type GateContext } from "../_site/gate.ts";
import { siteKeys, stateOf } from "../_site/state.ts";
import { hubTokenPair, mintPairing, normalCode, REQUEST_MS, requestSigned, sendKeyFor, hubKey, UNLOCK_MS } from "./tokens.ts";

/**
 * Relay's texts line on the site (#535, docs/RELAY-PRIVACY.md): pairing, the hub's token, the send unlock (one fresh
 * passkey check per device, 72 hours), the single-use 10-minute send requests and Resend, and the model calls under
 * their own cap. Every name and text here is made up.
 */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-10-28T10:00:00Z");
const HOUR = 60 * 60_000;
const THREAD = "0123456789abcdef";
const DRAFT_AT = NOW - 60_000;

const item = (over: Partial<TextItem> = {}): TextItem => ({
  id: THREAD,
  name: "Test Person",
  channel: "iMessage",
  group: false,
  state: "owed",
  sort: "normal",
  since: NOW - HOUR,
  laterUntil: null,
  gist: "Asks about the weekend plan",
  draft: { text: "Sounds good, see you then", at: DRAFT_AT },
  summary: null,
  ...over,
});
const view = (items: TextItem[] = [item()], at = NOW): TextsView => ({ v: 1, at, items });

class Desk {
  jar = new Map<string, string>();
  readonly auth = new MemoryAuthStore();
  readonly relay = new MemoryRelayStore(() => this.now);
  readonly spend = new MemorySpendStore();
  readonly passkey = new SoftPasskey();
  calls: ClaudeBody[] = [];
  pings = 0;
  now = NOW;
  answer: unknown = { needsReply: true, sort: "normal", gist: "Asks about the weekend plan" };
  hubToken = "";
  hubSendKey = "";
  deps(): RelayRouteDeps {
    return {
      desk: { deskKey: DESK, store: this.auth, now: this.now },
      store: this.relay,
      spend: this.spend,
      claude: async (body) => {
        this.calls.push(body);
        return { answer: this.answer, usage: { input_tokens: 400, output_tokens: 60 } };
      },
      budget: 10,
      skipTerms: [],
      ping: async () => {
        this.pings += 1;
        return 1;
      },
      now: this.now,
    };
  }
  headers(extra: Record<string, string> = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return { "x-real-ip": "203.0.113.9", ...(cookie && { cookie }), ...extra };
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
  async authPost(body: unknown) {
    return this.keep(await authPost(new Request(`${ORIGIN}/api/desk-auth`, { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) }), { deskKey: DESK, store: this.auth, now: this.now }));
  }
  async enrol() {
    const opts = await this.authPost({ action: "enrol-options", key: DESK, label: "Test laptop" });
    await this.authPost({ action: "enrol", response: this.passkey.create((await opts.json()) as { challenge: string; rp: { id: string } }) });
    expect(this.jar.has(SESSION_COOKIE)).toBe(true);
  }
  async signIn() {
    const opts = await this.authPost({ action: "signin-options" });
    const res = await this.authPost({ action: "signin", response: this.passkey.get((await opts.json()) as { challenge: string; rpId: string }) });
    expect(res.status).toBe(200);
  }
  async post(body: unknown) {
    return this.keep(await POST(new Request(`${ORIGIN}${RELAY_PATH}`, { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) }), this.deps()));
  }
  async get() {
    return this.keep(await GET(new Request(`${ORIGIN}${RELAY_PATH}`, { headers: this.headers() }), this.deps()));
  }
  async unlock() {
    const opts = await this.post({ action: "unlock-options" });
    expect(opts.status).toBe(200);
    return this.post({ action: "unlock", response: this.passkey.get((await opts.json()) as { challenge: string; rpId: string }) });
  }
  /** The installer: no Origin, no cookies. */
  async pair(code: string) {
    return POST(new Request(`${ORIGIN}${PAIR_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }), this.deps());
  }
  hub(method: "GET" | "POST", search: string, body?: unknown, token = this.hubToken) {
    const req = new Request(`${ORIGIN}${HUB_PATH}${search}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return method === "GET" ? GET(req, this.deps()) : POST(req, this.deps());
  }
  async paired() {
    await this.enrol();
    const code = ((await (await this.post({ action: "pair-code" })).json()) as { code: string }).code;
    const res = await this.pair(code);
    expect(res.status).toBe(200);
    const got = (await res.json()) as { token: string; sendKey: string };
    this.hubToken = got.token;
    this.hubSendKey = got.sendKey;
    expect((await this.hub("POST", "?view=texts", view())).status).toBe(200);
  }
  async requests(): Promise<TextRequest[]> {
    const res = await this.hub("GET", "?view=requests");
    expect(res.status).toBe(200);
    return ((await res.json()) as { requests: TextRequest[] }).requests;
  }
  async listed() {
    return (await (await this.get()).json()) as { unlockedUntil: number | null; texts: TextItem[]; requests: { rid: string; state: string; kind: string }[] };
  }
  send(over: Record<string, unknown> = {}) {
    return this.post({ action: "send", thread: THREAD, draftAt: DRAFT_AT, text: "Sounds good, see you then", ...over });
  }
}

const ready = async () => {
  const d = new Desk();
  await d.paired();
  return d;
};

describe("pairing", () => {
  it("trades a one-time code for a hub token, once", async () => {
    const d = new Desk();
    await d.enrol();
    const res = await d.post({ action: "pair-code" });
    const { code } = (await res.json()) as { code: string };
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(d.relay.pairRec?.codeHash).not.toContain(code.replace("-", ""));
    const first = await d.pair(code.toLowerCase());
    expect(first.status).toBe(200);
    const { token } = (await first.json()) as { token: string };
    expect(hubTokenPair(token, DESK)).toBe(d.relay.hubRec?.pairId);
    expect(hubTokenPair(token, "another desk key entirely")).toBeNull();
    expect((await d.pair(code)).status).toBe(404);
  });

  it("allows five wrong tries, then the code is gone", async () => {
    const d = new Desk();
    await d.enrol();
    const { code } = (await (await d.post({ action: "pair-code" })).json()) as { code: string };
    for (let i = 0; i < 5; i++) expect((await d.pair("2222-2222")).status).toBe(403);
    expect((await d.pair(code)).status).toBe(404);
  });

  it("ends after ten minutes", async () => {
    const d = new Desk();
    await d.enrol();
    const { code } = (await (await d.post({ action: "pair-code" })).json()) as { code: string };
    d.now += 10 * 60_000;
    expect((await d.pair(code)).status).toBe(404);
  });

  it("refuses a browser page (an Origin) and a code with no session behind its making", async () => {
    const d = new Desk();
    const res = await POST(new Request(`${ORIGIN}${PAIR_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ code: "2222-2222" }) }), d.deps());
    expect(res.status).toBe(403);
    expect((await POST(new Request(`${ORIGIN}${RELAY_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pair-code" }) }), d.deps())).status).toBe(401);
  });

  it("reads codes the way people type them", () => {
    expect(normalCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalCode("ABCD EFG1")).toBeNull();
    expect(normalCode("ABCD")).toBeNull();
  });

  it("unpair stops the token at once and clears the list", async () => {
    const d = await ready();
    expect((await d.hub("GET", "?view=skip")).status).toBe(200);
    await d.post({ action: "unpair" });
    expect((await d.hub("GET", "?view=skip")).status).toBe(401);
    expect((await d.listed()).texts).toEqual([]);
  });
});

describe("the hub's token", () => {
  it("is needed on every hub call", async () => {
    const d = await ready();
    expect((await d.hub("GET", "?view=requests", undefined, "rh1.nope.nope")).status).toBe(401);
    expect((await d.hub("POST", "?view=texts", view(), "")).status).toBe(401);
  });

  it("keeps a status whole or not at all", async () => {
    const d = await ready();
    const bad = { ...emptyRelayStatus(NOW), hub: "listening", name: "Test Person" };
    expect((await d.hub("POST", "", bad)).status).toBe(422);
    expect(d.relay.statusRec).toBeNull();
    expect((await d.hub("POST", "", { ...emptyRelayStatus(NOW), hub: "listening" })).status).toBe(200);
    expect(d.relay.statusRec?.hub).toBe("listening");
  });

  it("refuses a texts list with anything extra", async () => {
    const d = await ready();
    const extra = { ...view(), items: [{ ...item(), body: "the raw message" }] };
    expect((await d.hub("POST", "?view=texts", extra)).status).toBe(422);
    expect(readTextsView({ ...view(), phone: "x" }, NOW)).toBeNull();
  });

  it("drops items older than seven days", () => {
    expect(readTextsView(view([item({ since: NOW - 8 * 24 * HOUR })]), NOW)?.items).toEqual([]);
  });
});

describe("the sealed store", () => {
  it("never keeps the list in the clear", async () => {
    const files = new Map<string, string>();
    let n = 0;
    const blob: BlobBackend = {
      kind: "azureblob",
      get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)).body!, etag: String(n), contentType: "application/json" } : null),
      etag: async (path) => (files.has(path) ? String(n) : null),
      put: async (path, body, opts) => {
        if (opts.ifMatch && opts.ifMatch !== String(n)) throw new BlobPreconditionError("changed");
        files.set(path, String(body));
        n += 1;
        return { pathname: path };
      },
      del: async (path) => void files.delete(path),
    };
    const key = relaySealKey("k".repeat(64))!;
    const store = new BlobRelayStore(blob, key, () => NOW);
    expect(await store.save({ texts: view(), requests: [] }, null)).toBe(true);
    const at = files.get(PRIVATE_PATH)!;
    expect(at).not.toContain("Test Person");
    expect(at).not.toContain("Sounds good");
    expect((await store.load()).state.texts?.items[0]?.name).toBe("Test Person");
    // Another key (the email agent's, say) can't open it.
    const wrong = await new BlobRelayStore(blob, relaySealKey("j".repeat(64))!, () => NOW).load().catch(() => null);
    expect(wrong?.state.texts ?? null).toBeNull();
    expect(relaySealKey("too short")).toBeNull();
  });

  it("drops a stored request that is off the shape", () => {
    expect(readPrivate({ texts: null, requests: [{ req: { rid: "x" }, state: "waiting" }] }, NOW).requests).toEqual([]);
  });
});

describe("the send unlock (one passkey check per device, 72 hours)", () => {
  it("is needed before any send", async () => {
    const d = await ready();
    const res = await d.send();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("locked");
    expect(d.relay.privateJson).not.toContain('"kind":"send"');
  });

  it("needs a fresh passkey answer: a reused one does not unlock", async () => {
    const d = await ready();
    const opts = await d.post({ action: "unlock-options" });
    const answer = d.passkey.get((await opts.json()) as { challenge: string; rpId: string });
    const challenge = d.jar.get("__Host-ceo-desk-relay")!;
    expect((await d.post({ action: "unlock", response: answer })).status).toBe(200);
    d.jar.set("__Host-ceo-desk-relay", challenge);
    d.jar.delete(UNLOCK_COOKIE);
    expect((await d.post({ action: "unlock", response: answer })).status).toBe(401);
    expect(d.jar.has(UNLOCK_COOKIE)).toBe(false);
  });

  it("needs the answer within two minutes", async () => {
    const d = await ready();
    const opts = await d.post({ action: "unlock-options" });
    const answer = d.passkey.get((await opts.json()) as { challenge: string; rpId: string });
    d.now += 3 * 60_000;
    expect((await d.post({ action: "unlock", response: answer })).status).toBe(401);
    expect(d.jar.has(UNLOCK_COOKIE)).toBe(false);
  });

  it("sets an HttpOnly, Strict, 72-hour cookie and then sends need no passkey", async () => {
    const d = await ready();
    const res = await d.unlock();
    expect(res.status).toBe(200);
    const set = res.headers.getSetCookie().find((c) => c.startsWith(UNLOCK_COOKIE))!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Secure/);
    expect(set).toMatch(/SameSite=Strict/);
    expect(set).toContain(`Max-Age=${UNLOCK_MS / 1000}`);
    expect(UNLOCK_MS).toBe(72 * HOUR);
    expect((await d.listed()).unlockedUntil).toBe(Math.floor((NOW + UNLOCK_MS) / 1000) * 1000);
    expect((await d.send()).status).toBe(200);
    // Two days on (signed in again, same device): still unlocked, no passkey step.
    d.now = NOW + 48 * HOUR;
    await d.signIn();
    d.relay.privateJson = null;
    await d.hub("POST", "?view=texts", view([item()], d.now));
    expect((await d.send()).status).toBe(200);
  });

  it("ends after 72 hours", async () => {
    const d = await ready();
    await d.unlock();
    d.now = NOW + UNLOCK_MS + 60_000;
    await d.signIn();
    await d.hub("POST", "?view=texts", view([item({ since: d.now - HOUR })], d.now));
    const res = await d.send();
    expect(res.status).toBe(401);
    expect((await d.listed()).unlockedUntil).toBeNull();
  });

  it("is bound to the passkey that made it, and lock ends it", async () => {
    const d = await ready();
    await d.unlock();
    const req = new Request(`${ORIGIN}${RELAY_PATH}`, { headers: d.headers() });
    const mine = (await d.auth.passkeys())[0]!.id;
    expect(await unlockedUntil(req, DESK, mine, d.now)).not.toBeNull();
    // Another device's passkey with this device's cookie copied over: not unlocked.
    expect(await unlockedUntil(req, DESK, "another-passkey-id", d.now)).toBeNull();
    // Signed with another Desk key: not unlocked.
    expect(await unlockedUntil(req, "another desk key, also made up", mine, d.now)).toBeNull();
    await d.post({ action: "lock" });
    expect(d.jar.has(UNLOCK_COOKIE)).toBe(false);
    expect((await d.send()).status).toBe(401);
  });

  it("refuses a forged cookie", async () => {
    const d = await ready();
    d.jar.set(UNLOCK_COOKIE, "eyJ0IjoicmVsYXktdW5sb2NrIn0.forged");
    expect((await d.send()).status).toBe(401);
  });
});

describe("send requests (single-use, 10 minutes, Resend)", () => {
  const unlocked = async () => {
    const d = await ready();
    await d.unlock();
    return d;
  };

  it("are handed to the hub once", async () => {
    const d = await unlocked();
    const { rid } = (await (await d.send()).json()) as { rid: string };
    const first = await d.requests();
    expect(first.map((r) => r.rid)).toEqual([rid]);
    expect(await d.requests()).toEqual([]);
    expect((await d.listed()).requests[0]!.state).toBe("taken");
  });

  it("are signed over every field with the pairing's send key, so a change is seen", async () => {
    const d = await unlocked();
    await d.send();
    const [req] = await d.requests();
    const key = Buffer.from(d.hubSendKey, "base64url");
    expect(key.equals(sendKeyFor(hubKey(DESK)!, d.relay.hubRec!.pairId))).toBe(true);
    expect(requestSigned(key, req!, req!.sig)).toBe(true);
    expect(requestSigned(key, { ...req!, text: "something else" }, req!.sig)).toBe(false);
    expect(requestSigned(key, { ...req!, thread: "fedcba9876543210" }, req!.sig)).toBe(false);
    expect(requestSigned(key, { ...req!, until: req!.until + HOUR }, req!.sig)).toBe(false);
  });

  it("live ten minutes: after that the hub never gets it, and the Desk shows it expired", async () => {
    const d = await unlocked();
    const { until } = (await (await d.send()).json()) as { until: number };
    expect(until).toBe(NOW + REQUEST_MS);
    d.now = NOW + REQUEST_MS;
    expect(await d.requests()).toEqual([]);
    expect((await d.listed()).requests[0]!.state).toBe("expired");
  });

  it("Resend makes a new request for an expired one, and only for that", async () => {
    const d = await unlocked();
    const { rid } = (await (await d.send()).json()) as { rid: string };
    expect((await d.post({ action: "resend", rid })).status).toBe(409);
    d.now = NOW + REQUEST_MS + 1;
    const again = await d.post({ action: "resend", rid });
    expect(again.status).toBe(200);
    const fresh = (await again.json()) as { rid: string; until: number };
    expect(fresh.rid).not.toBe(rid);
    expect(fresh.until).toBe(d.now + REQUEST_MS);
    expect((await d.requests()).map((r) => r.rid)).toEqual([fresh.rid]);
  });

  it("Resend needs the unlock too", async () => {
    const d = await unlocked();
    const { rid } = (await (await d.send()).json()) as { rid: string };
    await d.post({ action: "lock" });
    d.now = NOW + REQUEST_MS + 1;
    expect((await d.post({ action: "resend", rid })).status).toBe(401);
  });

  it("are bound to the thread and the draft on screen", async () => {
    const d = await unlocked();
    expect((await d.send({ draftAt: DRAFT_AT - 1 })).status).toBe(409);
    expect((await d.send({ thread: "fedcba9876543210" })).status).toBe(409);
    expect((await d.send({ text: " " })).status).toBe(400);
    expect((await d.send()).status).toBe(200);
    expect((await d.send()).status).toBe(409);
  });

  it("never go to a group", async () => {
    const d = await unlocked();
    await d.hub("POST", "?view=texts", view([item({ group: true, draft: null, summary: { text: "Planning a trip", asked: false } })]));
    expect((await d.send({ draftAt: 0 })).status).toBe(409);
  });

  it("take a result only for a request the hub took", async () => {
    const d = await unlocked();
    const { rid } = (await (await d.send()).json()) as { rid: string };
    await d.hub("POST", "?view=results", { results: [{ rid, result: "sent" }] });
    expect((await d.listed()).requests[0]!.state).toBe("waiting");
    await d.requests();
    await d.hub("POST", "?view=results", { results: [{ rid, result: "sent" }] });
    expect((await d.listed()).requests[0]!.state).toBe("sent");
  });

  it("show failed when the hub took one and never answered", () => {
    const e = { req: { until: NOW } as TextRequest, state: "taken" as const, takenAt: NOW - 1, doneAt: null };
    expect(shownState(e, NOW + 4 * 60_000)).toBe("taken");
    expect(shownState(e, NOW + 5 * 60_000)).toBe("failed");
  });

  it("are made only by the Desk's own actions", () => {
    const s = { texts: view(), requests: [] };
    const key = Buffer.alloc(32, 1);
    expect("error" in makeRequest(s, key, "send", { thread: THREAD, draftAt: DRAFT_AT, text: "" }, NOW).result).toBe(true);
    const made = makeRequest(s, key, "later", { thread: THREAD, draftAt: 0, text: "ignored" }, NOW);
    expect(made.next.requests[0]!.req.text).toBe("");
  });
});

describe("model calls through the site (no key on the Mac)", () => {
  const sortBody = { group: false, lines: [{ from: "them", text: "Are we still on for [Day]?", ago: 5 }] };

  it("go out with no tools and no metadata, and come back read by hand", async () => {
    const d = await ready();
    const res = await d.hub("POST", "?view=sort", sortBody);
    expect(((await res.json()) as { answer: unknown }).answer).toEqual({ needsReply: true, sort: "normal", gist: "Asks about the weekend plan" });
    const body = d.calls[0]!;
    expect(body.model).toBe(SORT_MODEL);
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system", "thinking"]);
    expect(JSON.stringify(body)).not.toMatch(/"tools"|"tool_choice"|"metadata"|cache_control/);
  });

  it("refuse a hostile answer", async () => {
    const d = await ready();
    d.answer = { needsReply: true, sort: "normal", gist: "ok", send: "now" };
    expect(((await (await d.hub("POST", "?view=sort", sortBody)).json()) as { answer: unknown }).answer).toBeNull();
    expect(readDraft({ draft: "see https://example.com/x" })).toEqual({ draft: "see" });
    expect(readSort({ summary: "x", asked: "yes" }, true)).toBeNull();
  });

  it("refuse anything off the snippet's shape", async () => {
    const d = await ready();
    expect((await d.hub("POST", "?view=sort", { ...sortBody, chat: "iMessage;-;+15550000000" })).status).toBe(400);
    expect((await d.hub("POST", "?view=sort", { group: false, lines: [{ from: "Test Person", text: "hi", ago: 1 }] })).status).toBe(400);
    expect((await d.hub("POST", "?view=draft", { lines: [{ from: "Member 1", text: "hi", ago: 1 }], examples: [], profile: { length: 20, capitals: 0.5, emoji: 0, stops: 0.2 } })).status).toBe(400);
    expect(d.calls).toEqual([]);
  });

  it("stop hard at the texts line's own cap, on a ledger apart from email's", async () => {
    const d = await ready();
    await d.spend.save({ [new Date(NOW).toISOString().slice(0, 7)]: { usd: 10 - CEILING[SORT_MODEL] / 2, calls: 100, tokensIn: 0, tokensOut: 0 } }, null);
    expect(await (await d.hub("POST", "?view=sort", sortBody)).json()).toEqual({ ok: false, paused: true });
    expect(d.calls).toEqual([]);
    expect(SPEND_PATH).toBe("relay/spend.json");
    expect(relayBudget("50")).toBe(10);
    expect(relayBudget(undefined)).toBe(10);
  });

  it("record what each call cost", async () => {
    const d = await ready();
    await d.hub("POST", "?view=sort", sortBody);
    const { ledger } = await d.spend.load();
    expect(Object.values(ledger!)[0]!.calls).toBe(1);
  });

  it("trim to the caps", () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ from: "them", text: `line ${i} `.repeat(40), ago: 40 - i }));
    const sort = sortRequest({ group: false, lines: long });
    expect(sort.messages[0].content.length).toBeLessThan(1_600);
    const draft = draftRequest({ lines: long, examples: Array.from({ length: 20 }, () => "x".repeat(300)), profile: { length: 20, capitals: 0.5, emoji: 0, stops: 0.2 } });
    expect(draft.model).toBe(DRAFT_MODEL);
    expect((draft.messages[0].content.match(/<example>/g) ?? []).length).toBeLessThanOrEqual(8);
  });
});

describe("the site gate lets the hub through on its token alone", () => {
  const gateCtx = async (): Promise<GateContext> => ({ state: stateOf({ v: 1, passkey: true, locked: "2026-10-22T00:00:00.000Z", sv: "version-one" }, {}), keys: (await siteKeys({ FOUNDRY_DESK_KEY: DESK }))!, env: { FOUNDRY_DESK_KEY: DESK }, now: NOW });
  const at = (path: string, method: string, token?: string, extra: Record<string, string> = {}) =>
    new Request(`${ORIGIN}${path}`, { method, headers: { ...(token !== undefined && { Authorization: `Bearer ${token}` }), ...extra }, ...(method === "POST" && { body: "{}" }) });

  it("opens exactly the hub's own calls with a token this Desk key signed", async () => {
    const c = await gateCtx();
    const { token } = mintPairing(DESK)!;
    for (const [path, method] of [["/api/relay-hub", "POST"], ["/api/relay-hub?view=texts", "POST"], ["/api/relay-hub?view=results", "POST"], ["/api/relay-hub?view=sort", "POST"], ["/api/relay-hub?view=draft", "POST"], ["/api/relay-hub?view=skip", "GET"], ["/api/relay-hub?view=requests", "GET"]] as const) {
      expect(decide(at(path, method, token), c), `${method} ${path}`).toEqual({ allow: true, why: "relay-hub" });
    }
    expect(decide(at("/api/relay-pair", "POST"), c)).toEqual({ allow: true, why: "relay-pair" });
  });

  it("opens nothing else: other views, other routes, another key's token, no token", async () => {
    const c = await gateCtx();
    const { token } = mintPairing(DESK)!;
    const other = mintPairing("another desk key, also made up")!.token;
    const shut: Array<[string, string, string | undefined]> = [
      ["/api/relay-hub?view=requests", "POST", token],
      ["/api/relay-hub?view=texts", "GET", token],
      ["/api/relay-hub?view=status", "GET", token],
      ["/api/relay-hub?view=texts&x=1", "POST", token],
      ["/api/relay", "GET", token],
      ["/api/relay", "POST", token],
      ["/api/email", "GET", token],
      ["/api/keys", "POST", token],
      ["/api/relay-hub?view=texts", "POST", other],
      ["/api/relay-hub?view=texts", "POST", undefined],
      ["/api/relay-hub?view=texts", "POST", "rh1.made.up"],
      ["/api/relay-pair?x=1", "POST", undefined],
      ["/api/relay-pair", "GET", undefined],
    ];
    for (const [path, method, t] of shut) expect(decide(at(path, method, t), c).allow, `${method} ${path}`).toBe(false);
  });
});
