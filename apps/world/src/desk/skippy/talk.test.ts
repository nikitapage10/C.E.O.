import { describe, expect, it } from "vitest";
import { useSkippy } from "./chat.ts";
import { TALK_NOTE, clock, creditsLine, isToolToken, landedNote, readCredits, readHandoffs, readUsage, requestToken, usageLine } from "./talk.ts";

const usage = { month: "2026-10", usedMin: 3, budgetMin: 41.6, leftMin: 38.6, sessionMin: 3, canTalk: true };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("Talk to Skippy in the browser", () => {
  it("reads the month's minutes and writes them small", () => {
    expect(readUsage(usage)).toEqual(usage);
    expect(readUsage({ usedMin: -1 })).toBeNull();
    expect(readUsage(null)).toBeNull();
    expect(usageLine(usage)).toBe("3.0 of 41.6 talk min this month");
    expect(clock(179.4)).toBe("2:59");
    expect(clock(-3)).toBe("0:00");
  });

  it("writes the month's dollars against the share and the cap, and the plan's credits (#477)", () => {
    const billed = { ...usage, usedUsd: 0.36, budgetUsd: 5, elevenUsd: 1.1, capUsd: 10, calls: 2 };
    expect(readUsage({ ...billed, storyUsd: 0.74 })).toEqual(billed);
    expect(usageLine(billed)).toBe("3.0 of 41.6 talk min this month · $0.36 of $5.00 share · $1.10 of $10.00 cap");
    expect(readCredits({ used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" })).toEqual({ used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" });
    expect(creditsLine({ used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" })).toBe("Creator plan: 100,370 of 122,113 credits · resets Nov 5");
    expect(creditsLine({ used: 5, limit: 10, resetAt: null, tier: null })).toBe("Plan: 5 of 10 credits");
    expect(readCredits({ used: 5 })).toBeNull();
    expect(readCredits({ used: 5, limit: 10, resetAt: "soon<script>", tier: "<b>" })).toEqual({ used: 5, limit: 10, resetAt: null, tier: null });
  });

  it("turns each refusal into a reason with a plain note that says typing still works", async () => {
    expect(await requestToken(reply(200, { ok: false, reason: "capped", usage: { ...usage, canTalk: false } }))).toMatchObject({ ok: false, reason: "capped" });
    expect(await requestToken(reply(401, { error: "signed-out" }))).toEqual({ ok: false, reason: "signed-out" });
    expect(await requestToken(reply(429, { error: "slow-down", wait: 30 }))).toEqual({ ok: false, reason: "slow" });
    expect(await requestToken(reply(503, { error: "no-key" }))).toEqual({ ok: false, reason: "no-key" });
    expect(await requestToken(reply(502, { error: "agent-denied" }))).toEqual({ ok: false, reason: "agent-denied" });
    expect(await requestToken(reply(502, { error: "eleven" }))).toEqual({ ok: false, reason: "eleven" });
    expect(await requestToken(reply(502, { error: "key-invalid" }))).toEqual({ ok: false, reason: "key-invalid" });
    expect(await requestToken(reply(502, { error: "plan" }))).toEqual({ ok: false, reason: "plan" });
    expect(await requestToken(reply(502, { error: "something-new" }))).toEqual({ ok: false, reason: "eleven" });
    expect(TALK_NOTE["key-invalid"]).toMatch(/Keys page/);
    expect(TALK_NOTE.plan).toMatch(/plan or limits/);
    expect(TALK_NOTE["agent-denied"]).toMatch(/needs access to Agents/);
    expect(await requestToken((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toEqual({ ok: false, reason: "eleven" });
    for (const r of ["capped", "eleven", "key-invalid", "plan", "agent-denied", "mic", "failed"] as const) expect(TALK_NOTE[r]).toMatch(/[Tt]yping/);
  });

  it("hands back the one-call token, the call's length and the Desk's state", async () => {
    const got = await requestToken(reply(200, { ok: true, token: "lk-abc", conversation: "conv_1", maxSecs: 180, desk: "Builds in flight: 1", usage }));
    expect(got).toEqual({ ok: true, token: "lk-abc", conversation: "conv_1", maxSecs: 180, desk: "Builds in flight: 1", usage });
  });

  it("carries the call's tool token for the lookups only when it is well-formed (#479)", async () => {
    const tool = "vt1.mh3x9k2a.AbCdEfGhIjKlMnOpQrStUvWx.Zz09_-Zz09_-Zz09_-Zz09_-Zz09_-Zz09_-Zz0";
    expect(isToolToken(tool)).toBe(true);
    expect(isToolToken("vt1.<script>.a.b")).toBe(false);
    expect(isToolToken(`vt1.a.b.${"c".repeat(300)}`)).toBe(false);
    const ok = await requestToken(reply(200, { ok: true, token: "lk-abc", conversation: "conv_1", maxSecs: 600, desk: "", usage, tool }));
    expect(ok).toMatchObject({ ok: true, tool });
    const bad = await requestToken(reply(200, { ok: true, token: "lk-abc", conversation: "conv_1", maxSecs: 600, desk: "", usage, tool: "sk_live_nope" }));
    expect(bad).not.toHaveProperty("tool");
  });

  it("reads what the call handed to the Kernel, and words the landed answer for Skippy (#479)", async () => {
    const seen: string[] = [];
    const doFetch = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ handoffs: ["0123456789abcdef", "nope", "fedcba9876543210"] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await readHandoffs("conv_live_123", doFetch)).toEqual(["0123456789abcdef", "fedcba9876543210"]);
    expect(seen).toEqual(["/api/skippy-voice?handoffs=conv_live_123"]);
    expect(await readHandoffs("../x", doFetch)).toEqual([]);
    expect(await readHandoffs("conv_live_123", reply(401, {}))).toEqual([]);
    expect(landedNote("Shipped in number 485.", true)).toMatch(/^The answer from your own thread .*"Shipped in number 485\.".*next natural pause/);
    expect(landedNote("On it.", false)).toMatch(/^An update/);
  });

  it("waits on a call's hand-off in the chat like a typed one, once (#479)", async () => {
    const quiet = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const id = await useSkippy.getState().wait("0123456789abcdef", "kernel", "skippy", quiet);
    expect(id).not.toBeNull();
    const bubble = useSkippy.getState().turns.find((t) => t.id === id);
    expect(bubble).toMatchObject({ who: "skippy", handed: "0123456789abcdef", pending: { turn: "0123456789abcdef", room: "kernel", needs: "skippy" } });
    expect(bubble!.text).toMatch(/Skippy's own thread/);
    expect(await useSkippy.getState().wait("0123456789abcdef", "kernel", "skippy", quiet)).toBeNull();
    expect(await useSkippy.getState().wait("not-a-turn", "kernel", "skippy", quiet)).toBeNull();
    useSkippy.getState().clear();
  });
});
