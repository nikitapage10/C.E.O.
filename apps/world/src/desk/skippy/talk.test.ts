import { describe, expect, it } from "vitest";
import { TALK_NOTE, clock, readUsage, requestToken, usageLine } from "./talk.ts";

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

  it("turns each refusal into a reason with a plain note that says typing still works", async () => {
    expect(await requestToken(reply(200, { ok: false, reason: "capped", usage: { ...usage, canTalk: false } }))).toMatchObject({ ok: false, reason: "capped" });
    expect(await requestToken(reply(401, { error: "signed-out" }))).toEqual({ ok: false, reason: "signed-out" });
    expect(await requestToken(reply(429, { error: "slow-down", wait: 30 }))).toEqual({ ok: false, reason: "slow" });
    expect(await requestToken(reply(503, { error: "no-key" }))).toEqual({ ok: false, reason: "no-key" });
    expect(await requestToken(reply(502, { error: "agent-denied" }))).toEqual({ ok: false, reason: "agent-denied" });
    expect(await requestToken(reply(502, { error: "eleven" }))).toEqual({ ok: false, reason: "eleven" });
    expect(await requestToken((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toEqual({ ok: false, reason: "eleven" });
    for (const r of ["capped", "eleven", "mic", "failed"] as const) expect(TALK_NOTE[r]).toMatch(/[Tt]yping/);
  });

  it("hands back the one-call token, the call's length and the Desk's state", async () => {
    const got = await requestToken(reply(200, { ok: true, token: "lk-abc", conversation: "conv_1", maxSecs: 180, desk: "Builds in flight: 1", usage }));
    expect(got).toEqual({ ok: true, token: "lk-abc", conversation: "conv_1", maxSecs: 180, desk: "Builds in flight: 1", usage });
  });
});
