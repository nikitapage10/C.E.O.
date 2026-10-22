/**
 * The injection eval suite for Skippy's chat on the Desk (#224, docs/THREAT-MODEL.md): hostile messages stay inside
 * their block, a hostile answer loses everything outside the closed set, and the chat's gates (the session, the
 * privacy check, the pace and the month's budget) hold before Claude hears anything. No network: the Anthropic SDK,
 * the blob store and GitHub are stubbed, and the payloads go through the real code around them.
 *
 * Underscore folder: Vercel never serves anything under `api/_security` as a function.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, chat, type Ask, type ChatDeps } from "../skippy.ts";
import { MemoryChatLedger, chatMonth } from "../_skippy/budget.ts";
import { deskContext } from "../_skippy/context.ts";
import { CHAT_TAGS, SKIPPY_PROMPT, SKIPPY_SCHEMA, chatInput, readReply } from "../_skippy/prompt.ts";
import { SESSION_COOKIE } from "../_desk/session.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { privateParts } from "../_privacy.ts";
import { CHAT_ANSWERS, CHAT_PAYLOADS, SECRET_FORMS } from "./fixtures/payloads.ts";

/** A stand-in for the Anthropic SDK: records every request and answers with whatever the test sets. No network. */
interface SdkCall {
  model: string;
  max_tokens: number;
  system: unknown;
  messages: { role: string; content: unknown }[];
  output_config?: { format?: { type: string; schema: unknown } };
}
const sdk = vi.hoisted(() => ({ calls: [] as SdkCall[], text: "{}", stop: "end_turn" }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (args: SdkCall) => {
        sdk.calls.push(args);
        return { content: [{ type: "text", text: sdk.text }], stop_reason: sdk.stop, usage: { input_tokens: 900, output_tokens: 40 } };
      },
    };
  },
}));
vi.mock("@vercel/blob", async () => (await import("../_desk/fakeBlob.ts")).fakeBlob);

const ORIGIN = "https://ceo.example";
const NOW = Date.parse("2026-10-22T16:00:00Z");
const QUESTION = { number: 11, title: "Idea: Brighter cards", state: "open", body: "**Question:** Which page?", user: { login: "ceo-foundry[bot]" }, labels: [{ name: "foundry" }, { name: "foundry:idea" }, { name: "foundry:question" }] };
const desk = deskContext([QUESTION], [], null, null);

const chatTag = new RegExp(`<\\s*/?\\s*(?:${CHAT_TAGS.join("|")})\\b[^>]*>`, "gi");
const tagsIn = (text: string) => [...text.matchAll(chatTag)].map((m) => m[0]);
/** What must never come out of an answer onto the Desk or into an issue. */
const FORBIDDEN = [/attacker\.example/i, /<\s*script/i, /onerror/i, /<\s*img/i, /javascript:/i, /!\[/, /\]\(/, /\*\*/, /\n/];

beforeEach(() => {
  sdk.calls.length = 0;
  sdk.text = "{}";
  sdk.stop = "end_turn";
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Skippy's chat: untrusted text stays in its data blocks", () => {
  it.each(CHAT_PAYLOADS)("a hostile message ($kind) stays inside <message>, and the history inside <conversation>", ({ text }) => {
    const input = chatInput("Ideas waiting: 0", [{ who: "nikita", text }, { who: "skippy", text }], text);
    // Exactly one opening and one closing tag per block, in order: nothing in the text closed one early.
    expect(tagsIn(input)).toEqual(["<desk>", "</desk>", "<conversation>", "</conversation>", "<message>", "</message>"]);
    expect(input).not.toMatch(/[\u{E0000}-\u{E007F}\u200b]/u);
  });

  it("keeps the rules a constant: the same system prompt whatever is said", async () => {
    const asks: string[] = [];
    const ask: Ask = async (system) => {
      asks.push(system);
      return { answer: { reply: "ok", actions: [] }, usage: null };
    };
    const { post } = await harness({ ask });
    for (const { text } of CHAT_PAYLOADS.slice(0, 4)) await post({ message: text });
    expect(new Set(asks)).toEqual(new Set([SKIPPY_PROMPT]));
  });

  it("the real call sends the rules as the system prompt, the message only as user data, with a closed schema and a token cap", async () => {
    vi.stubEnv("CLAUDE_API_KEY", "test-not-a-real-key");
    const { claudeChat } = await import("../skippy.ts");
    sdk.text = JSON.stringify({ reply: "ok", actions: [] });
    await claudeChat("test-not-a-real-key")(SKIPPY_PROMPT, chatInput("", [], CHAT_PAYLOADS[2]!.text));
    const call = sdk.calls[0]!;
    expect(call.system).toBe(SKIPPY_PROMPT);
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]!.role).toBe("user");
    expect(call.output_config?.format).toEqual({ type: "json_schema", schema: SKIPPY_SCHEMA });
    expect(SKIPPY_SCHEMA.additionalProperties).toBe(false);
    expect(SKIPPY_SCHEMA.properties.actions.items.additionalProperties).toBe(false);
    expect(call.max_tokens).toBeLessThanOrEqual(2_000);
    expect(call.model).toBe("claude-opus-5-5");
  });
});

describe("Skippy's chat: nothing outside the closed set survives a bad answer", () => {
  it.each(CHAT_ANSWERS)("$kind", ({ answer }) => {
    const r = readReply(answer, desk)!;
    expect(r).not.toBeNull();
    const all = JSON.stringify(r);
    for (const bad of FORBIDDEN) expect(r.reply, String(bad)).not.toMatch(bad);
    for (const bad of [/attacker\.example/i, /javascript:/i, /foundry:build/, /approve/, /"url"/]) expect(all, String(bad)).not.toMatch(bad);
    expect(r.reply.length).toBeLessThanOrEqual(700);
    expect(r.actions.length).toBeLessThanOrEqual(3);
    for (const a of r.actions) {
      expect(["idea", "open", "lattice", "answer"]).toContain(a.kind);
      expect(a.label.length).toBeLessThanOrEqual(40);
      if (a.kind === "answer") expect(a.issue).toBe(11);
      if (a.kind === "idea" || a.kind === "answer") expect(privateParts(a.text)).toEqual([]);
    }
  });

  it("rejects answers with no reply", () => {
    for (const bad of [null, undefined, "text", 42, [], { actions: [] }, { reply: 7 }, { reply: "\u200b" }]) expect(readReply(bad, desk)).toBeNull();
  });
});

describe("Skippy's chat: the gates hold before Claude hears anything", () => {
  it("refuses without a sign-in session (none, forged, another Desk's, a bare key)", async () => {
    const { post, asked } = await harness();
    const good = (await signedInCookie("test-desk-key", NOW)).slice(SESSION_COOKIE.length + 1);
    const other = (await signedInCookie("another-desk-key", NOW)).slice(SESSION_COOKIE.length + 1);
    for (const cookie of ["", `${SESSION_COOKIE}=`, `${SESSION_COOKIE}=forged.token`, `${SESSION_COOKIE}=${other}`, `${SESSION_COOKIE}=${good.split(".")[0]}`, `ceo-desk=${good}`]) {
      expect((await post({ message: "hi", key: "test-desk-key" }, cookie)).status, cookie).toBe(401);
    }
    expect(asked()).toBe(0);
  });

  it("refuses a request from another site", async () => {
    const { deps, cookie, asked } = await harness();
    const res = await chat(new Request(`${ORIGIN}/api/skippy`, { method: "POST", headers: { Cookie: cookie, Origin: "https://attacker.example" }, body: JSON.stringify({ message: "hi" }) }), deps);
    expect(res.status).toBe(403);
    expect(asked()).toBe(0);
  });

  it.each(SECRET_FORMS.filter((s) => privateParts(s.text).length > 0))("holds back private text ($kind) before Claude, in the message or the history", async ({ text }) => {
    const { post, asked } = await harness();
    expect((await post({ message: text })).status).toBe(422);
    expect((await post({ message: "hi", history: [{ who: "nikita", text }] })).status).toBe(422);
    expect(asked()).toBe(0);
  });

  it("names what it held back, never the words", async () => {
    const { post } = await harness();
    const body = JSON.stringify(await (await post({ message: "mail nikita.page@example.com" })).json());
    expect(body).toContain("an email address");
    expect(body).not.toContain("nikita.page");
  });

  it("respects the month's budget: a spent share means a scripted line and no call", async () => {
    const ledger = new MemoryChatLedger();
    ledger.spend = { "2026-10": { usd: 1.9999, calls: 1, tokensIn: 0, tokensOut: 0 } };
    const { post, asked } = await harness({ ledger });
    const body = (await (await post({ message: "hi" })).json()) as { capped?: boolean };
    expect(body.capped).toBe(true);
    expect(asked()).toBe(0);
  });

  it("respects the whole cap: a world that has spent its way up to it leaves the chat nothing", async () => {
    const world = { spend: { "2026-10": { usd: 7.9999, tokensIn: 0, tokensOut: 0, calls: 0, scripted: 0 } } };
    const { post, asked } = await harness({ world: async () => world as never, env: { SKIPPY_BUDGET_USD: "10" } });
    expect(((await (await post({ message: "hi" })).json()) as { capped?: boolean }).capped).toBe(true);
    expect(asked()).toBe(0);
  });

  it("fails closed when the ledger can't be read", async () => {
    const { post, asked } = await harness({ ledger: { load: async () => Promise.reject(new Error("blob")), add: async () => undefined } });
    expect((await post({ message: "hi" })).status).toBe(503);
    expect(asked()).toBe(0);
  });

  it("counts every answered call, and the pace stops a flood before Claude", async () => {
    const { post, asked, ledger } = await harness();
    let last = 200;
    for (let i = 0; i < 12 && last === 200; i++) last = (await post({ message: `ping ${i}` })).status;
    expect(last).toBe(429);
    expect(asked()).toBe(8);
    expect(chatMonth(ledger.spend, NOW).calls).toBe(8);
  });

  it("end to end through POST: GitHub reads only the repo's API, the answer is checked, and no build label is ever sent", async () => {
    vi.stubEnv("FOUNDRY_DESK_KEY", "test-desk-key");
    vi.stubEnv("FOUNDRY_GITHUB_TOKEN", "test-token");
    vi.stubEnv("CLAUDE_API_KEY", "test-not-a-real-key");
    vi.stubEnv("BLOB_STORE_ID", "store_test");
    vi.stubEnv("WORLD_STORE", "memory");
    const sent: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      sent.push({ url, method: init.method ?? "GET" });
      return Response.json(url.includes("/issues?") ? [QUESTION] : {});
    });
    sdk.text = JSON.stringify(CHAT_ANSWERS[0]!.answer);
    const cookie = await signedInCookie("test-desk-key");
    const res = await POST(new Request(`${ORIGIN}/api/skippy`, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ message: CHAT_PAYLOADS[0]!.text }) }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { actions: unknown[] }).actions).toEqual([]);
    expect(sent.filter((s) => s.method !== "GET" || !s.url.startsWith("https://api.github.com/repos/nikitapage10/C.E.O.")), JSON.stringify(sent)).toEqual([]);
    const user = String(sdk.calls[0]!.messages[0]!.content);
    expect(user).toContain("#11 Brighter cards");
    expect(tagsIn(user)).toEqual(["<desk>", "</desk>", "<conversation>", "</conversation>", "<message>", "</message>"]);
  });
});

/** The chat with its pieces in memory and Claude stubbed; `asked` counts the calls that reached the model. */
async function harness(over: Partial<ChatDeps> = {}) {
  const store = new MemoryAuthStore();
  const cookie = await signedInCookie("test-desk-key", NOW, store);
  let n = 0;
  const ask: Ask = async () => {
    n += 1;
    return { answer: { reply: "Bask in it.", actions: [] }, usage: { input_tokens: 900, output_tokens: 40 } };
  };
  const ledger = new MemoryChatLedger();
  const deps: ChatDeps = { deskKey: "test-desk-key", store, ledger, ask, world: async () => null, desk: async () => desk, now: NOW, env: {}, ...over };
  const counting = deps.ask;
  if (counting && over.ask) deps.ask = async (s, i) => ((n += 1), counting(s, i));
  const post = (body: unknown, c = cookie) => chat(new Request(`${ORIGIN}/api/skippy`, { method: "POST", headers: { Cookie: c }, body: JSON.stringify(body) }), deps);
  return { post, deps, cookie, asked: () => n, ledger: deps.ledger as MemoryChatLedger };
}
