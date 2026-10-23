import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { FEED_TOKEN, LOG_TOKEN } from "../_site/roomkeys.ts";
import { MemorySetupStore, SETUP_OPEN_MAX, SETUP_PER_HOUR, asksForSecret, handleGet, handlePost, keepAsks, type SetupAsk, type SetupDeps } from "./setup.ts";

/**
 * Setup asks (#324): a thread posts one with the feed key, only Nikita's passkey session approves or declines it, the
 * thread reads the answer with the read key and closes it with a Trail line, and there is no public view. An ask that
 * looks private, or asks anyone to type or paste a secret, is refused. Test keys only.
 */

// 16:00 UTC is 10 am in Denver: outside quiet hours, so a new ask pings.
const NOW = Date.parse("2026-10-23T16:00:00Z");
const ORIGIN = "https://ceo.test";
const DESK = "test-desk-key";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const ENV = { FOUNDRY_DESK_KEY: DESK, [LOG_TOKEN]: LOG, [FEED_TOKEN]: FEED };

const ASK = {
  action: "ask",
  room: "foundry",
  title: "Create the C.E.O. GitHub App on github.com",
  where: "github.com",
  service: "GitHub Apps",
  changes: "Adds one app to the repo with read access to checks and issues.",
  why: "So the Builder can read check runs without a personal token.",
  cost: "Free",
  reversible: true,
  route: "key-vault-flow",
};

async function setup(over: Partial<SetupDeps> = {}) {
  const auth = new MemoryAuthStore();
  const store = new MemorySetupStore();
  const pings: string[] = [];
  let n = 0;
  const deps: SetupDeps = {
    env: ENV,
    store,
    desk: { deskKey: DESK, store: auth, now: NOW },
    ping: async (t) => (pings.push(t.body), 1),
    now: NOW,
    newId: () => `setup-${String(++n).padStart(4, "0")}`,
    ...over,
  };
  const cookie = await signedInCookie(DESK, NOW, auth);
  const post = (body: unknown, who: { key?: string; cookie?: string } = { key: FEED }, path = "/api/setup-asks") =>
    handlePost(
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(who.key && { "x-ceo-room-key": who.key }), ...(who.cookie && { Cookie: who.cookie }) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      deps,
    );
  const get = (path = "/api/setup-asks", headers: Record<string, string> = {}) => handleGet(new Request(`${ORIGIN}${path}`, { headers }), deps);
  const asks = async () => ((await (await get("/api/setup-asks", { "x-ceo-room-key": LOG })).json()) as { asks: SetupAsk[] }).asks;
  return { deps, store, cookie, pings, post, get, asks };
}

describe("a thread posting a setup ask (the feed key)", () => {
  it("keeps it open, says only that it was kept, and pings counts-only words", async () => {
    const { post, asks, pings } = await setup();
    const res = await post(ASK);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ok: true, id: "setup-0001" });
    const [a] = await asks();
    expect(a).toMatchObject({ id: "setup-0001", state: "open", room: "foundry", route: "key-vault-flow", reversible: true, title: ASK.title });
    expect(pings).toEqual(["A setup ask on the Desk is waiting for your OK."]);
    expect(pings.join(" ")).not.toContain("GitHub");
  });

  it("holds the ping in quiet hours but keeps the ask", async () => {
    const night = Date.parse("2026-10-24T06:00:00Z");
    const { post, pings, store } = await setup({ now: night });
    expect((await post(ASK)).status).toBe(201);
    expect(pings).toEqual([]);
    expect(await store.all(night)).toHaveLength(1);
  });

  it("is refused without the feed key: none, the read key, a wrong one", async () => {
    const { post, store } = await setup();
    expect((await post(ASK, {})).status).toBe(401);
    expect((await post(ASK, { key: LOG })).status).toBe(401);
    expect((await post(ASK, { key: "not-the-key-but-long-enough-0123456789" })).status).toBe(401);
    expect(store.asks).toEqual([]);
  });

  it("refuses a bad shape: an unknown field, room or route, a missing part, a query", async () => {
    const { post } = await setup();
    expect((await post({ ...ASK, extra: 1 })).status).toBe(400);
    expect((await post({ ...ASK, room: "relay" })).status).toBe(400);
    expect((await post({ ...ASK, route: "paste-it" })).status).toBe(400);
    expect((await post({ ...ASK, why: "  " })).status).toBe(400);
    expect((await post({ ...ASK, reversible: "yes" })).status).toBe(400);
    expect((await post({ ...ASK, title: "x".repeat(400) })).status).toBe(413);
    expect((await post(ASK, { key: FEED }, "/api/setup-asks?x=1")).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
  });

  it("refuses anything private, a copy of a room key, or words that ask for a secret", async () => {
    const { post, store } = await setup();
    const priv = await post({ ...ASK, why: "So nikita@example.com gets the mail." });
    expect(priv.status).toBe(422);
    expect(((await priv.json()) as { error: string }).error).toBe("private");
    expect((await post({ ...ASK, changes: `Uses ${LOG} for it.` })).status).toBe(422);
    const secret = await post({ ...ASK, changes: "Nikita pastes the app's private key into the thread." });
    expect(secret.status).toBe(422);
    expect(await secret.json()).toEqual({ error: "asks-for-secret" });
    expect(store.asks).toEqual([]);
  });

  it("caps new asks per hour and asks waiting at once", async () => {
    const { post, store, deps } = await setup();
    for (let i = 0; i < SETUP_PER_HOUR; i++) expect((await post(ASK)).status).toBe(201);
    expect((await post(ASK)).status).toBe(429);
    deps.now = NOW + 2 * 3_600_000;
    for (let i = SETUP_PER_HOUR; i < SETUP_OPEN_MAX; i++) expect((await post(ASK)).status).toBe(201);
    expect((await post(ASK)).status).toBe(429);
    expect(store.asks).toHaveLength(SETUP_OPEN_MAX);
  });

  it("says when there is no store", async () => {
    const { post } = await setup({ store: null });
    expect((await post(ASK)).status).toBe(503);
  });
});

describe("the secret rule", () => {
  it("catches typing, pasting or copying a key, and lets the keyless wording through", () => {
    for (const bad of ["Paste the token into the box", "Type your password at the prompt", "Copies the client secret into the thread", "Enter the PAT", "Send me the key"]) expect(asksForSecret(bad), bad).toBe(true);
    for (const ok of ["Its private key goes straight to the Key Vault", "Grants the Function App's identity read access to secrets", "Federated credential, no secret anywhere", "Creates a GitHub App from a manifest"]) expect(asksForSecret(ok), ok).toBe(false);
  });
});

describe("Nikita approving or declining (the passkey session)", () => {
  it("approves an open ask, and the thread then closes it done with a Trail line", async () => {
    const { post, cookie, asks } = await setup();
    await post(ASK);
    const res = await post({ id: "setup-0001", decision: "approve" }, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("__Host-ceo-desk=");
    expect(((await res.json()) as { ask: SetupAsk }).ask.state).toBe("approved");
    expect((await post({ id: "setup-0001", decision: "decline" }, { cookie })).status).toBe(409);
    const done = await post({ action: "close", id: "setup-0001", outcome: "done", trail: "App created; its key went straight to the Key Vault." });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true });
    const [a] = await asks();
    expect(a).toMatchObject({ state: "done", trail: "App created; its key went straight to the Key Vault.", closedAt: new Date(NOW).toISOString() });
    expect((await post({ action: "close", id: "setup-0001", outcome: "dropped", trail: "Again" })).status).toBe(409);
  });

  it("declines an open ask and closes it with its Trail line at once", async () => {
    const { post, cookie, asks } = await setup();
    await post(ASK);
    expect((await post({ id: "setup-0001", decision: "decline" }, { cookie })).status).toBe(200);
    const [a] = await asks();
    expect(a).toMatchObject({ state: "declined", trail: "Declined on the Desk; nothing was changed." });
  });

  it("never lets the thread finish an ask Nikita hasn't approved, or approve one itself", async () => {
    const { post } = await setup();
    await post(ASK);
    expect((await post({ action: "close", id: "setup-0001", outcome: "done", trail: "Did it anyway" })).status).toBe(409);
    expect((await post({ id: "setup-0001", decision: "approve" })).status).toBe(400);
    expect((await post({ action: "close", id: "setup-0001", outcome: "dropped", trail: "Not needed after all." })).status).toBe(200);
    expect((await post({ action: "close", id: "setup-9999", outcome: "dropped", trail: "Nope" })).status).toBe(404);
  });

  it("needs a passkey session: none, or another site, gets nothing", async () => {
    const { post, cookie, store } = await setup();
    await post(ASK);
    expect((await post({ id: "setup-0001", decision: "approve" }, {})).status).toBe(401);
    const cross = await handlePost(
      new Request(`${ORIGIN}/api/setup-asks`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://evil.test" }, body: JSON.stringify({ id: "setup-0001", decision: "approve" }) }),
      (await setup()).deps,
    );
    expect(cross.status).toBe(403);
    expect((await store.all(NOW))[0]!.state).toBe("open");
  });
});

describe("reading the asks", () => {
  it("answers the Desk session and the read key, open ones first, and filters by room", async () => {
    const { post, get, cookie, deps } = await setup();
    await post(ASK);
    deps.now = NOW + 60_000;
    await post({ ...ASK, room: "green", title: "Turn on the Sleeper webhook in the league settings" });
    await post({ action: "close", id: "setup-0002", outcome: "dropped", trail: "Sleeper has no webhooks." });
    const desk = await get("/api/setup-asks", { Cookie: cookie });
    expect(desk.status).toBe(200);
    expect(desk.headers.get("set-cookie")).toContain("__Host-ceo-desk=");
    expect(((await desk.json()) as { asks: SetupAsk[] }).asks.map((a) => a.id)).toEqual(["setup-0001", "setup-0002"]);
    const green = await get("/api/setup-asks?room=green", { "x-ceo-room-key": LOG });
    expect(((await green.json()) as { asks: SetupAsk[] }).asks.map((a) => a.id)).toEqual(["setup-0002"]);
  });

  it("has no public view: signed out, the feed key or a bad query get nothing", async () => {
    const { post, get } = await setup();
    await post(ASK);
    expect((await get()).status).toBe(401);
    expect((await get("/api/setup-asks", { "x-ceo-room-key": FEED })).status).toBe(401);
    expect((await get("/api/setup-asks?room=relay", { "x-ceo-room-key": LOG })).status).toBe(400);
    expect((await get("/api/setup-asks?view=public")).status).toBe(400);
  });
});

describe("what is kept", () => {
  it("drops bad rows and anything untouched for 30 days", () => {
    const good = { id: "setup-0001", at: new Date(NOW).toISOString(), state: "open", ...ASK };
    const old = { ...good, id: "setup-0002", at: new Date(NOW - 31 * 86_400_000).toISOString() };
    expect(keepAsks([good, old, { ...good, id: "x" }, { ...good, route: "nope" }, null], NOW).map((a) => a.id)).toEqual(["setup-0001"]);
  });
});
