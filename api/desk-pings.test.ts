import { describe, expect, it } from "vitest";
import { isQuiet, needsOf, planPings, pingText, QUIET_HOURS, readSubscription, type GhIssueLite, type Need, type PingSub, type PingText } from "./_desk/pings.ts";
import { MemoryAuthStore } from "./_desk/store.ts";
import { signedInCookie, TEST_PASSKEY } from "./_desk/testing.ts";
import { handlePost as authPost } from "./desk-auth.ts";
import { handleGet, handlePost, vapidSubject, type PingDeps, type Sent } from "./desk-pings.ts";

/**
 * The Desk's pings (#135): a device turns them on only in a passkey session, signing out or removing the device
 * drops them, and the scan pings once per item, all new items together, never in the quiet hours, in words that say
 * nothing about an issue.
 */

const DESK = "a test desk key, not a real one";
const SECRET = "a test pings secret, not a real one";
const ORIGIN = "https://ceo.test";
/** Noon in Denver (MDT). */
const NOON = Date.parse("2026-10-14T18:00:00Z");
/** 11pm in Denver: quiet. */
const NIGHT = Date.parse("2026-10-15T05:00:00Z");
/** 7:05am in Denver: the morning's first scan. */
const MORNING = Date.parse("2026-10-15T13:05:00Z");

const SUB = { endpoint: "https://web.push.apple.com/QGuessable-endpoint-id", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };

/** Issue text that must never reach a lock screen. */
const SECRET_WORDS = "Rebuild the Spire for Darrow";
const BODY_WORDS = "Nikita said call the dentist at 555";

function issue(number: number, labels: string[], body = `**Pitch:** ${BODY_WORDS}`): GhIssueLite & { title: string } {
  return { number, state: "open", title: `Idea: ${SECRET_WORDS}`, body, labels: labels.map((name) => ({ name })) };
}

function setup(now = NOON, issues: GhIssueLite[] = []) {
  const store = new MemoryAuthStore();
  const sent: { sub: PingSub; text: PingText }[] = [];
  const results = new Map<string, Sent>();
  const deps: PingDeps = {
    deskKey: DESK,
    store,
    now,
    publicKey: "BPublicKeyForTests",
    secret: SECRET,
    send: async (sub, text) => {
      sent.push({ sub, text });
      return results.get(sub.endpoint) ?? "ok";
    },
    issues: async () => issues,
  };
  return { store, deps, sent, results, issues };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/desk-pings`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const scanReq = (secret = SECRET) => post({ action: "scan" }, { Authorization: `Bearer ${secret}` });

async function subscribed(deps: PingDeps, store: MemoryAuthStore, sub = SUB) {
  const cookie = await signedInCookie(DESK, deps.now, store);
  const res = await handlePost(post({ action: "on", subscription: sub }, { cookie }), deps);
  expect(res.status).toBe(200);
  return cookie;
}

describe("turning pings on (#135)", () => {
  it("needs a passkey session: without one nothing is stored", async () => {
    const { store, deps } = setup();
    const res = await handlePost(post({ action: "on", subscription: SUB }), deps);
    expect(res.status).toBe(401);
    expect((await store.pings()).subs).toEqual([]);
    const forged = await handlePost(post({ action: "on", subscription: SUB }, { cookie: "__Host-ceo-desk=forged.token" }), deps);
    expect(forged.status).toBe(401);
    expect((await store.pings()).subs).toEqual([]);
  });

  it("from another site is refused", async () => {
    const { store, deps } = setup();
    const cookie = await signedInCookie(DESK, NOON, store);
    const res = await handlePost(post({ action: "on", subscription: SUB }, { cookie, origin: "https://evil.example" }), deps);
    expect(res.status).toBe(403);
    expect((await store.pings()).subs).toEqual([]);
  });

  it("signed in: stores the subscription against the passkey, and sends one welcome ping", async () => {
    const { store, deps, sent } = setup();
    await subscribed(deps, store);
    const { subs } = await store.pings();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ endpoint: SUB.endpoint, passkey: TEST_PASSKEY.id });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text.body).toMatch(/Pings are on/);
  });

  it("refuses a subscription that isn't from a known push service", async () => {
    const { store, deps } = setup();
    const cookie = await signedInCookie(DESK, NOON, store);
    for (const endpoint of ["https://evil.example/push", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "https://user:pw@fcm.googleapis.com/x", "javascript:alert(1)"]) {
      const res = await handlePost(post({ action: "on", subscription: { ...SUB, endpoint } }, { cookie }), deps);
      expect(res.status, endpoint).toBe(400);
    }
    expect((await store.pings()).subs).toEqual([]);
    expect(readSubscription({ ...SUB, keys: { p256dh: "<script>", auth: "x" } })).toBeNull();
    expect(readSubscription({ ...SUB, endpoint: "https://fcm.googleapis.com/fcm/send/abc" })).not.toBeNull();
  });

  it("says when pings aren't set up, and hands out only the public key", async () => {
    const { deps } = setup();
    expect(await handleGet({ ...deps, publicKey: "" }).json()).toEqual({ ready: false });
    expect(await handleGet(deps).json()).toEqual({ ready: true, key: "BPublicKeyForTests" });
    expect((await handlePost(post({ action: "on", subscription: SUB }), { ...deps, publicKey: "" })).status).toBe(503);
  });

  it("the VAPID contact is the site unless a proper one is set", () => {
    expect(vapidSubject("")).toMatch(/^https:\/\//);
    expect(vapidSubject("not a url")).toMatch(/^https:\/\//);
    expect(vapidSubject("mailto:desk@example.com")).toBe("mailto:desk@example.com");
  });
});

describe("turning pings off", () => {
  it("the switch drops this device's subscription", async () => {
    const { store, deps } = setup();
    const cookie = await subscribed(deps, store);
    await handlePost(post({ action: "off", endpoint: SUB.endpoint }, { cookie }), deps);
    expect((await store.pings()).subs).toEqual([]);
  });

  it("signing out drops this device's subscription", async () => {
    const { store, deps } = setup();
    const cookie = await subscribed(deps, store);
    const other = { ...SUB, endpoint: "https://fcm.googleapis.com/fcm/send/other-device" };
    await subscribed(deps, store, other);
    const res = await authPost(new Request(`${ORIGIN}/api/desk-auth`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ action: "signout", endpoint: SUB.endpoint }) }), { deskKey: DESK, store, now: NOON });
    expect(res.status).toBe(200);
    expect((await store.pings()).subs.map((s) => s.endpoint)).toEqual([other.endpoint]);
  });

  it("removing a device drops its subscriptions", async () => {
    const { store, deps } = setup();
    const cookie = await subscribed(deps, store);
    const res = await authPost(new Request(`${ORIGIN}/api/desk-auth`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ action: "remove", id: TEST_PASSKEY.id }) }), { deskKey: DESK, store, now: NOON });
    expect(res.status).toBe(200);
    expect((await store.pings()).subs).toEqual([]);
  });
});

describe("the scan", () => {
  it("needs the workflow's secret", async () => {
    const { deps, sent, issues } = setup(NOON);
    issues.push(issue(1, ["foundry", "foundry:idea"]));
    expect((await handlePost(post({ action: "scan" }), deps)).status).toBe(401);
    expect((await handlePost(scanReq("wrong"), deps)).status).toBe(401);
    expect((await handlePost(scanReq(), { ...deps, secret: "" })).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("pings each new item once, all together, and never again", async () => {
    const { store, deps, sent, issues } = setup(NOON);
    await subscribed(deps, store);
    sent.length = 0;
    issues.push(issue(1, ["foundry", "foundry:idea"]), issue(2, ["foundry", "foundry:idea"]), issue(3, ["foundry", "foundry:idea"]), issue(4, ["foundry", "foundry:idea", "foundry:question"], "**Question:** Which room?"));
    const res = await handlePost(scanReq(), deps);
    expect(await res.json()).toEqual({ pinged: 4, held: 0, devices: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toEqual({ title: "C.E.O. Desk", body: "Rivet has a question · 3 ideas are waiting for your pick", url: "/foundry" });
    // The same items again: nothing.
    await handlePost(scanReq(), deps);
    expect(sent).toHaveLength(1);
    // One more arrives: just that one.
    issues.push(issue(5, ["foundry", "foundry:fix", "foundry:blocked"]));
    await handlePost(scanReq(), deps);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text.body).toBe("A job is blocked and needs you");
  });

  it("stays quiet at night, then sends one summary at 7am of what still needs Nikita", async () => {
    const { store, deps, sent, issues } = setup(NIGHT);
    await subscribed({ ...deps, now: NOON }, store);
    sent.length = 0;
    issues.push(issue(1, ["foundry", "foundry:idea", "foundry:question"], "**Question:** Which room?"), issue(2, ["foundry", "foundry:idea"]));
    expect(await (await handlePost(scanReq(), deps)).json()).toEqual({ pinged: 0, held: 2, devices: 1 });
    expect(sent).toEqual([]);
    // Overnight, Nikita answered the question on the Desk: it's handled, so the morning drops it.
    issues[0] = issue(1, ["foundry", "foundry:idea", "foundry:revise"]);
    const res = await handlePost(scanReq(), { ...deps, now: MORNING });
    expect(await res.json()).toMatchObject({ pinged: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toEqual({ title: "Good morning from the Desk", body: "An idea is waiting for your pick", url: "/foundry" });
    await handlePost(scanReq(), { ...deps, now: MORNING + 60 * 60_000 });
    expect(sent).toHaveLength(1);
  });

  it("only enrolled devices get pings, and a device that unsubscribed is forgotten", async () => {
    const { store, deps, sent, results, issues } = setup(NOON);
    await subscribed(deps, store);
    const gone = { ...SUB, endpoint: "https://fcm.googleapis.com/fcm/send/gone" };
    await subscribed(deps, store, gone);
    const state = await store.pings();
    await store.savePings({ ...state, subs: [...state.subs, { ...SUB, endpoint: "https://fcm.googleapis.com/fcm/send/removed", passkey: "a-removed-passkey", added: "" }] });
    sent.length = 0;
    results.set(gone.endpoint, "gone");
    issues.push(issue(1, ["foundry", "foundry:stuck"]));
    await handlePost(scanReq(), deps);
    expect(sent.map((s) => s.sub.endpoint).sort()).toEqual([SUB.endpoint, gone.endpoint].sort());
    expect((await store.pings()).subs.map((s) => s.endpoint)).not.toContain(gone.endpoint);
  });

  it("decides nothing when GitHub can't be read", async () => {
    const { store, deps, sent } = setup(NOON);
    await subscribed(deps, store);
    sent.length = 0;
    const res = await handlePost(scanReq(), { ...deps, issues: async () => Promise.reject(new Error("down")) });
    expect(res.status).toBe(502);
    expect(sent).toEqual([]);
  });
});

describe("what needs Nikita's call", () => {
  const kinds = (issues: GhIssueLite[]) => needsOf(issues).map((n) => `${n.kind}#${n.issue}`);

  it("pings for ideas waiting for the pick, Rivet's questions and blockers", () => {
    expect(
      kinds([
        issue(1, ["foundry", "foundry:idea"]),
        issue(2, ["foundry", "foundry:idea", "foundry:question"], "**Question:** Which room?"),
        issue(3, ["foundry", "foundry:fix", "foundry:blocked", "foundry:working"]),
        issue(4, ["foundry", "foundry:fix", "foundry:stuck", "rung:3"]),
      ]),
    ).toEqual(["idea#1", "question#2", "blocker#3", "blocker#4"]);
  });

  it("stays quiet for everything else", () => {
    expect(
      kinds([
        issue(1, ["foundry", "foundry:idea", "foundry:revise"]),
        issue(2, ["foundry", "foundry:idea"], "**From Nikita (on the Desk):**\n\nmy own idea"),
        issue(3, ["foundry", "foundry:build", "foundry:working"]),
        issue(4, ["foundry", "foundry:fix", "foundry:working", "rung:2"]),
        issue(5, ["foundry", "foundry:upkeep"]),
        issue(6, ["foundry", "foundry:chat", "foundry:ready"]),
        { ...issue(7, ["foundry", "foundry:idea"]), state: "closed" },
        { ...issue(8, ["foundry", "foundry:idea"]), pull_request: {} },
        issue(9, ["foundry:idea"]),
      ]),
    ).toEqual([]);
  });

  it("a second question on the same idea is new; the same one never repeats", () => {
    const first = needsOf([issue(2, ["foundry", "foundry:idea", "foundry:question"], "**Question:** Which room?")]);
    const again = needsOf([issue(2, ["foundry", "foundry:idea", "foundry:question"], "**Question:** Which room?")]);
    const second = needsOf([issue(2, ["foundry", "foundry:idea", "foundry:question"], "**Question:** And which colour?")]);
    expect(again[0]!.key).toBe(first[0]!.key);
    expect(second[0]!.key).not.toBe(first[0]!.key);
    // The key carries a hash, never the question's words.
    expect(first[0]!.key).not.toMatch(/room/i);
  });

  it("a blocker cleared and flagged again pings again", () => {
    const need: Need = { kind: "blocker", issue: 3, key: "blocker:#3" };
    const open = new Set([3]);
    const one = planPings([need], {}, NOON, open);
    expect(one.ping).toEqual([need]);
    const cleared = planPings([], one.sent, NOON + 60_000, open);
    expect(cleared.sent).toEqual({});
    expect(planPings([need], cleared.sent, NOON + 120_000, open).ping).toEqual([need]);
  });

  it("forgets an item once its issue closes", () => {
    const need: Need = { kind: "idea", issue: 1, key: "idea:#1" };
    const one = planPings([need], {}, NOON, new Set([1]));
    expect(planPings([], one.sent, NOON + 60_000, new Set()).sent).toEqual({});
  });
});

describe("quiet hours", () => {
  it("are 10pm to 7am Mountain, a constant", () => {
    expect(QUIET_HOURS).toEqual({ from: 22, until: 7, timeZone: "America/Denver" });
  });

  it("follow Denver's clock through daylight saving", () => {
    // Summer (MDT, UTC-6) and winter (MST, UTC-7).
    expect(isQuiet(Date.parse("2026-07-01T03:59:00Z"))).toBe(false); // 9:59pm MDT
    expect(isQuiet(Date.parse("2026-07-01T04:00:00Z"))).toBe(true); // 10:00pm MDT
    expect(isQuiet(Date.parse("2026-07-01T12:59:00Z"))).toBe(true); // 6:59am MDT
    expect(isQuiet(Date.parse("2026-07-01T13:00:00Z"))).toBe(false); // 7:00am MDT
    expect(isQuiet(Date.parse("2026-12-01T05:00:00Z"))).toBe(true); // 10:00pm MST
    expect(isQuiet(Date.parse("2026-12-01T13:30:00Z"))).toBe(true); // 6:30am MST
    expect(isQuiet(Date.parse("2026-12-01T14:00:00Z"))).toBe(false); // 7:00am MST
  });

  it("hold items without marking them, so the morning still has them", () => {
    const need: Need = { kind: "idea", issue: 1, key: "idea:#1" };
    const night = planPings([need], {}, NIGHT, new Set([1]));
    expect(night).toMatchObject({ ping: [], held: 1, sent: {} });
    const morning = planPings([need], night.sent, MORNING, new Set([1]));
    expect(morning).toMatchObject({ ping: [need], morning: true });
  });
});

describe("what a ping says", () => {
  it("is counts and who is asking, short enough for a lock screen", () => {
    const n = (kind: Need["kind"], i: number): Need => ({ kind, issue: i, key: `${kind}:#${i}` });
    expect(pingText([n("question", 1)]).body).toBe("Rivet has a question");
    expect(pingText([n("idea", 1), n("idea", 2), n("idea", 3)]).body).toBe("3 ideas are waiting for your pick");
    expect(pingText([n("question", 1), n("question", 2)]).body).toBe("Rivet has 2 questions");
    expect(pingText([n("blocker", 1), n("blocker", 2)]).body).toBe("2 jobs are blocked and need you");
    const all = pingText([n("idea", 1), n("question", 2), n("blocker", 3)]);
    expect(all.body).toBe("A job is blocked and needs you · Rivet has a question · An idea is waiting for your pick");
    expect(all.body.length).toBeLessThan(160);
    expect(all.url).toBe("/foundry");
  });

  it("never carries an issue's title, body, question or number", () => {
    const issues = [
      issue(41, ["foundry", "foundry:idea"]),
      issue(42, ["foundry", "foundry:idea", "foundry:question"], `**Question:** ${BODY_WORDS}?`),
      issue(43, ["foundry", "foundry:fix", "foundry:blocked"]),
    ];
    for (const morning of [false, true]) {
      const text = JSON.stringify(pingText(needsOf(issues), morning));
      expect(text).not.toContain(SECRET_WORDS);
      expect(text).not.toContain(BODY_WORDS);
      expect(text).not.toContain("dentist");
      expect(text).not.toMatch(/#?4[123]\b/);
      expect(text).not.toMatch(/https?:/);
    }
  });
});
