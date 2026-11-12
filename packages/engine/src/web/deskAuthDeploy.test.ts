// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Why a deploy asked for the passkey (#1078). A deploy restarts the Function App (the template's KEYVAULT_REFRESH, then
 * the zip deploy) minutes after the new site is uploaded, so a Desk that loads or reloads in that window (a stale
 * chunk reloads it on its own, RoomGuard.tsx) gets no answer from /api/desk-auth. The session cookie itself is fine:
 * its keys come from the Desk key alone, nothing per build or per instance. But the page took the failed check for
 * "sign-in is off", never looked again, and the next action that needed a session went straight to the passkey.
 */

type Answer = { status: number; body?: unknown };

const signedIn = { ready: true, signedIn: true, until: Date.now() + 14 * 86_400_000, hardUntil: Date.now() + 30 * 86_400_000, device: "Mac", devices: [] };

let answers: Answer[];
let calls: string[];
let prompts: number;

function stubBrowser() {
  answers = [];
  calls = [];
  prompts = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const next = answers.shift() ?? { status: 200, body: signedIn };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("window", { PublicKeyCredential: function PublicKeyCredential() {}, addEventListener: () => undefined });
  vi.stubGlobal("navigator", {
    credentials: {
      get: async () => {
        prompts++;
        return null;
      },
    },
  });
}

async function freshStore() {
  vi.resetModules();
  return import("./signin.ts");
}

describe("a deploy never signs the Desk out (#1078)", () => {
  beforeEach(stubBrowser);
  afterEach(() => vi.unstubAllGlobals());

  it("a check that fails while the functions restart doesn't count as signed out: the next action asks the server again, not the passkey", async () => {
    const { useDeskAuth, ensureSignedIn } = await freshStore();
    answers.push({ status: 502 });
    await useDeskAuth.getState().check();
    expect(useDeskAuth.getState().auth.status).not.toBe("in");

    // The functions are back; the cookie was good all along.
    const result = await ensureSignedIn();
    expect(prompts).toBe(0);
    expect(result).toBe("ok");
    expect(useDeskAuth.getState().auth.status).toBe("in");
  });

  it("a 503 while the server can't read its keys yet is the same: no passkey", async () => {
    const { useDeskAuth, ensureSignedIn } = await freshStore();
    answers.push({ status: 200, body: { ready: false, signedIn: false } });
    await useDeskAuth.getState().check();
    expect(await ensureSignedIn()).toBe("ok");
    expect(prompts).toBe(0);
  });

  it("really signed out: the passkey is asked for, as before", async () => {
    const { useDeskAuth, ensureSignedIn } = await freshStore();
    answers.push({ status: 200, body: { ready: true, signedIn: false } }, { status: 200, body: { challenge: "AAAA" } });
    await useDeskAuth.getState().check();
    expect(useDeskAuth.getState().auth.status).toBe("out");
    await ensureSignedIn();
    expect(prompts).toBe(1);
  });

  it("checks again on its own after a failed check, so the Desk comes back signed in without a tap", async () => {
    vi.useFakeTimers();
    try {
      const { useDeskAuth, RETRY_MS } = await freshStore();
      answers.push({ status: 502 });
      await useDeskAuth.getState().check();
      expect(useDeskAuth.getState().auth.status).toBe("off");
      await vi.advanceTimersByTimeAsync(RETRY_MS + 10);
      expect(useDeskAuth.getState().auth.status).toBe("in");
    } finally {
      vi.useRealTimers();
    }
  });
});
