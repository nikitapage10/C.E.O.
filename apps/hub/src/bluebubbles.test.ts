import { describe, expect, it } from "vitest";
import { blueBubbles, BlueBubblesError, checkBlueBubbles, describeFailure, failure, redact, removeOldWebhooks, sendReason } from "./bluebubbles.ts";
import { errorClass } from "./log.ts";

/**
 * BlueBubbles' local API from the hub's side (#749): every call has a timeout, every failure says which in plain words,
 * and the password (a query param) never shows. The password and every value here are made up.
 */

const PW = "made-up pass&word=1";
const BASE = "http://127.0.0.1:1234";

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers from `answer` and records each call. */
const fake = (answer: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const seen: Seen[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    return answer(url, init);
  }) as typeof fetch;
  return { f, seen };
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const caught = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a failure");
};

describe("BlueBubbles calls fail in plain words (#749)", () => {
  it("gives the HTTP status and BlueBubbles' own words, redacted", async () => {
    const { f } = fake(() => json(400, { status: 400, message: "Validation Error", error: { type: "Validation Error", message: `Bad thing for password=${encodeURIComponent(PW)} and ${PW}` } }));
    const e = await caught(checkBlueBubbles(PW, f, BASE));
    expect(e).toBeInstanceOf(BlueBubblesError);
    expect((e as BlueBubblesError).status).toBe(400);
    const words = failure(e);
    expect(words).toContain("HTTP 400");
    expect(words).toContain("Bad thing");
    expect(words).not.toContain("made-up");
    expect(words).not.toContain(encodeURIComponent(PW));
  });

  it("says when the password doesn't match (401)", async () => {
    const { f } = fake(() => json(401, { status: 401, message: "Unauthorized", error: { type: "Authentication Error", message: "You are not authorized to access this resource" } }));
    expect(describeFailure(await caught(checkBlueBubbles(PW, f, BASE)))).toContain("doesn't match BlueBubbles' server password");
  });

  it("says when the answer isn't JSON", async () => {
    const { f } = fake(() => new Response("<html>BlueBubbles</html>", { status: 200 }));
    const e = (await caught(removeOldWebhooks(PW, f, BASE))) as BlueBubblesError;
    expect(e.kind).toBe("not-json");
    expect(describeFailure(e)).toContain("isn't the JSON");
  });

  it("says when a list isn't a list", async () => {
    const { f } = fake(() => json(200, { status: 200, data: { not: "a list" } }));
    expect(((await caught(removeOldWebhooks(PW, f, BASE))) as BlueBubblesError).kind).toBe("not-json");
  });

  it("turns a timeout and a refused connection into words, never the URL", async () => {
    const t = fake(() => Promise.reject(Object.assign(new Error(`timed out at ${BASE}/api/v1/ping?password=${PW}`), { name: "TimeoutError" })));
    const e = await caught(checkBlueBubbles(PW, t.f, BASE));
    expect((e as BlueBubblesError).kind).toBe("timeout");
    expect(failure(e)).toContain("didn't answer within 15 seconds");
    expect(errorClass(e)).toBe("TimeoutError");
    const u = fake(() => Promise.reject(new TypeError(`fetch failed ${BASE}?password=${PW}`)));
    const e2 = await caught(checkBlueBubbles(PW, u.f, BASE));
    expect((e2 as BlueBubblesError).kind).toBe("unreachable");
    expect(failure(e2)).toContain("couldn't reach BlueBubbles");
    expect(failure(e2)).not.toContain("made-up");
  });

  it("puts a timeout on every call", async () => {
    const { f, seen } = fake((url) => (url.includes("/message/text") ? json(200, { status: 200 }) : json(200, { status: 200, data: [] })));
    const bb = blueBubbles(PW, f, BASE);
    await bb.ping();
    await bb.contacts();
    await bb.messages("iMessage;-;+15555550123", 10);
    await bb.chats();
    await bb.contactPhotos();
    await bb.since(1, 50);
    await bb.send("iMessage;-;+15555550123", "hi", "temp-1");
    await checkBlueBubbles(PW, f, BASE);
    await removeOldWebhooks(PW, f, BASE);
    expect(seen.length).toBe(9);
    for (const s of seen) expect(s.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("a generic error says its class only", () => {
    expect(failure(new SyntaxError(`oops ${PW}`))).toBe("Relay: something went wrong (SyntaxError).");
  });

  it("redact takes out the password in any form, and any password, guid, token or k param", () => {
    const out = redact(`a ${PW} b ${encodeURIComponent(PW)} c ?guid=x&password=y&k=z&token=t&keep=1`, [PW]);
    expect(out).not.toContain("made-up");
    expect(out).not.toMatch(/guid=x|password=y|k=z|token=t/);
    expect(out).toContain("keep=1");
  });
});

describe("the message query and the old webhook (#749)", () => {
  it("asks BlueBubbles 1.9.12's message query for messages after the cursor, oldest first, with their chats", async () => {
    const row = { guid: "g1", dateCreated: 1_700_000_000_000, text: "hi", isFromMe: false, handle: { address: "+15555550123" }, chats: [{ guid: "iMessage;-;+15555550123" }] };
    const { f, seen } = fake(() => json(200, { status: 200, message: "Successfully fetched messages!", data: [row] }));
    const got = await blueBubbles(PW, f, BASE).since(1_699_999_999_000.7, 5_000);
    expect(got).toHaveLength(1);
    expect(got[0]!.inbound?.chat).toBe("iMessage;-;+15555550123");
    const s = seen[0]!;
    expect(s.init?.method).toBe("POST");
    const u = new URL(s.url);
    expect(u.pathname).toBe("/api/v1/message/query");
    expect(u.searchParams.get("password")).toBe(PW);
    expect(JSON.parse(String(s.init?.body))).toEqual({ with: ["chat", "chat.participants"], sort: "ASC", after: 1_699_999_999_000, limit: 1000 });
  });

  it("a poll that BlueBubbles refuses throws its status, for the log's class", async () => {
    const { f } = fake(() => json(500, { status: 500, message: "Server Error", error: { message: "database is locked" } }));
    const e = await caught(blueBubbles(PW, f, BASE).since(0, 10));
    expect(describeFailure(e)).toBe("BlueBubbles answered HTTP 500: database is locked.");
    expect(errorClass(e)).toBe("HttpError");
  });

  it("removes only Relay's old webhooks (to 127.0.0.1:7420)", async () => {
    const { f, seen } = fake((url, init) =>
      init?.method === "DELETE" ? json(200, { status: 200, message: "Successfully deleted webhook!" }) : json(200, { status: 200, data: [{ id: 3, url: "http://127.0.0.1:7420/bluebubbles?k=old", events: ["new-message"] }, { id: 4, url: "https://example.com/hook", events: ["*"] }] }),
    );
    expect(await removeOldWebhooks(PW, f, BASE)).toBe(1);
    const deletes = seen.filter((s) => s.init?.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(new URL(deletes[0]!.url).pathname).toBe("/api/v1/webhook/3");
  });

  it("send answers true, or throws so the hub can say why (#767)", async () => {
    const ok = fake(() => json(200, { status: 200 }));
    expect(await blueBubbles(PW, ok.f, BASE).send("c", "t", "g")).toBe(true);
    const body = JSON.parse(String(ok.seen[0]!.init?.body));
    expect(body).toEqual({ chatGuid: "c", tempGuid: "g", message: "t", method: "apple-script" });
    const bad = fake(() => json(500, { status: 500 }));
    expect(sendReason(await caught(blueBubbles(PW, bad.f, BASE).send("c", "t", "g")))).toBe("bb-refused");
  });
});

describe("why a send failed, as a reason code (#767)", () => {
  const reasonOf = async (answer: () => Response | Promise<Response>) => sendReason(await caught(blueBubbles(PW, fake(answer).f, BASE).send("c", "t", "g")));

  it("names macOS blocking BlueBubbles from controlling Messages (Automation, -1743)", async () => {
    expect(await reasonOf(() => json(500, { status: 500, message: "Message Send Error", error: { message: "execution error: Not authorized to send Apple events to Messages. (-1743)" } }))).toBe("mac-permission");
  });

  it("tells a timeout (it may have sent) from BlueBubbles not running and a wrong password", async () => {
    expect(await reasonOf(() => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })))).toBe("bb-timeout");
    expect(await reasonOf(() => Promise.reject(new TypeError("fetch failed")))).toBe("bb-down");
    expect(await reasonOf(() => json(401, { status: 401, error: { message: "You are not authorized to access this resource" } }))).toBe("bb-auth");
    expect(await reasonOf(() => json(400, { status: 400, error: { message: "A 'tempGuid' is required" } }))).toBe("bb-refused");
    expect(sendReason(new Error("anything"))).toBe("bb-refused");
  });
});
