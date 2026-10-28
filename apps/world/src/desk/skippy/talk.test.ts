import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { speak, useSkippy } from "./chat.ts";
import { setCallLive } from "./liveCall.ts";
import { CREDITS_OUT, TALK_NOTE, clock, elapsedSecs, creditsLine, clipSentence, isToolToken, landedNote, readCredits, readHandoffs, requestToken } from "./talk.ts";

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("Talk to Skippy in the browser", () => {
  it("writes the clock, and the plan's credits left with no site budget (#532)", () => {
    expect(clock(179.4)).toBe("2:59");
    expect(clock(-3)).toBe("0:00");
    expect(readCredits({ used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" })).toEqual({ used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" });
    expect(creditsLine({ used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" })).toBe("Creator plan: 21,743 credits left of 122,113 · resets Nov 5");
    expect(creditsLine({ used: 5, limit: 10, resetAt: null, tier: null })).toBe("Plan: 5 credits left of 10");
    expect(creditsLine({ used: 10, limit: 10, resetAt: "2026-11-05", tier: "creator" })).toBe(`${CREDITS_OUT} · resets Nov 5`);
    expect(readCredits({ used: 5 })).toBeNull();
    expect(readCredits({ used: 5, limit: 10, resetAt: "soon<script>", tier: "<b>" })).toEqual({ used: 5, limit: 10, resetAt: null, tier: null });
  });

  it("turns each refusal into a reason with a plain note that says typing still works", async () => {
    expect(await requestToken(reply(502, { error: "quota" }))).toEqual({ ok: false, reason: "quota" });
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
    expect(TALK_NOTE.quota).toMatch(/ElevenLabs credits used up/);
    expect(TALK_NOTE.quota.split(". ").length).toBeLessThanOrEqual(2);
    expect(TALK_NOTE["agent-denied"]).toMatch(/needs access to Agents/);
    expect(await requestToken((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toEqual({ ok: false, reason: "eleven" });
    for (const r of ["quota", "eleven", "key-invalid", "plan", "agent-denied", "mic", "failed"] as const) expect(TALK_NOTE[r]).toMatch(/[Tt]yping/);
  });

  it("hands back the one-call token and the Desk's state, with no call length (#532)", async () => {
    const got = await requestToken(reply(200, { ok: true, token: "lk-abc", conversation: "conv_1", desk: "Builds in flight: 1" }));
    expect(got).toEqual({ ok: true, token: "lk-abc", conversation: "conv_1", desk: "Builds in flight: 1" });
  });

  it("carries the call's tool token for the lookups only when it is well-formed (#479)", async () => {
    const tool = "vt1.mh3x9k2a.AbCdEfGhIjKlMnOpQrStUvWx.Zz09_-Zz09_-Zz09_-Zz09_-Zz09_-Zz09_-Zz0";
    expect(isToolToken(tool)).toBe(true);
    expect(isToolToken("vt1.<script>.a.b")).toBe(false);
    expect(isToolToken(`vt1.a.b.${"c".repeat(300)}`)).toBe(false);
    const ok = await requestToken(reply(200, { ok: true, token: "lk-abc", conversation: "conv_1", desk: "", tool }));
    expect(ok).toMatchObject({ ok: true, tool });
    const bad = await requestToken(reply(200, { ok: true, token: "lk-abc", conversation: "conv_1", desk: "", tool: "sk_live_nope" }));
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
    expect(landedNote("Shipped in number 485.", true)).toMatch(/^The answer from the deeper you .*"Shipped in number 485\.".*Say it to him now, answer first/);
    // Nothing for him to echo (#498): the note never names the plumbing.
    expect(landedNote("Shipped.", true).replace(/"[^"]*"/, "")).not.toMatch(/thread|hand-?off|hand (it )?off|kernel/i);
    expect(landedNote("On it.", false)).toMatch(/^An update/);
  });

  it("waits on a call's hand-off in the chat like a typed one, once (#479)", async () => {
    const quiet = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const id = await useSkippy.getState().wait("0123456789abcdef", "kernel", "skippy", quiet);
    expect(id).not.toBeNull();
    const bubble = useSkippy.getState().turns.find((t) => t.id === id);
    expect(bubble).toMatchObject({ who: "skippy", handed: "0123456789abcdef", pending: { turn: "0123456789abcdef", room: "kernel", needs: "skippy" } });
    expect(bubble!.text).not.toMatch(/thread|kernel/i);
    expect(await useSkippy.getState().wait("0123456789abcdef", "kernel", "skippy", quiet)).toBeNull();
    expect(await useSkippy.getState().wait("not-a-turn", "kernel", "skippy", quiet)).toBeNull();
    useSkippy.getState().clear();
  });
});

describe("a live call keeps local read-aloud quiet and answers whole (#521)", () => {
  it("never speaks through the browser's voice while a call is live", () => {
    const speakFn = vi.fn();
    vi.stubGlobal("window", { speechSynthesis: { speak: speakFn, cancel: vi.fn() } });
    vi.stubGlobal("SpeechSynthesisUtterance", function (this: { text: string }, t: string) { this.text = t; });
    try {
      setCallLive(true);
      speak("The answer is five percent.");
      expect(speakFn).not.toHaveBeenCalled();
      setCallLive(false);
      speak("The answer is five percent.");
      expect(speakFn).toHaveBeenCalledTimes(1);
    } finally {
      setCallLive(false);
      vi.unstubAllGlobals();
    }
  });

  it("puts a long answer in whole, and cuts at a sentence end when it must", () => {
    const long = "A twenty-five basis point hike is five percent, which the market priced in. ".repeat(12).trim();
    expect(landedNote(long.slice(0, 900), true)).toContain(long.slice(0, 900));
    const cut = clipSentence(long.repeat(3), 1500);
    expect(cut.length).toBeLessThanOrEqual(1500);
    expect(cut.endsWith("in.")).toBe(true);
  });
});

describe("the call timer counts up (#537)", () => {
  it("is whole seconds since the call went live, never negative, 0 before it starts", () => {
    expect(elapsedSecs(0, 5_000)).toBe(0);
    expect(elapsedSecs(1_000, 1_000)).toBe(0);
    expect(elapsedSecs(1_000, 66_400)).toBe(65);
    expect(clock(elapsedSecs(1_000, 66_400))).toBe("1:05");
    expect(elapsedSecs(9_000, 1_000)).toBe(0);
  });
  it("tells him to drop any other line when an answer lands", () => {
    expect(landedNote("Out.", true)).toMatch(/Drop whatever else you were about to say, and no waiting line/);
  });
});
