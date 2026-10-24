import { describe, expect, it } from "vitest";
import { writeHash as serverHash } from "../../../../../api/_keys/route.ts";
import { keyLine, loadKeys, setKey, writeHash, type KeyRow } from "./keys.ts";

const NOW = Date.parse("2026-10-23T23:30:00Z");
const row = (over: Partial<KeyRow>): KeyRow => ({ name: "claude-api-key", label: "Claude", from: "x", set: true, updated: null, lastSet: null, ...over });

describe("the Keys form, browser side (#330)", () => {
  it("says where a key stands, never anything of its value", () => {
    expect(keyLine(row({ set: null }), NOW)).toBe("Can't tell yet");
    expect(keyLine(row({ set: false }), NOW)).toBe("Not set");
    expect(keyLine(row({ updated: NOW - 3 * 86_400_000, lastSet: NOW - 3_600_000 }), NOW)).toBe("Set, written 3 d ago, from the Desk 1 h ago");
  });

  it("reads the list, and knows a copy with no keys route", async () => {
    const answer = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    expect(await loadKeys(answer(404))).toEqual({ state: "off" });
    expect(await loadKeys(answer(401))).toEqual({ state: "out" });
    expect(await loadKeys(answer(500))).toEqual({ state: "failed" });
    expect(await loadKeys(answer(200, { vault: "ok", keys: [] }))).toEqual({ state: "ready", view: { vault: "ok", keys: [] } });
  });

  it("sends nothing where passkeys can't be used", async () => {
    let called = false;
    const f = (async () => ((called = true), new Response("{}"))) as unknown as typeof fetch;
    expect(await setKey("claude-api-key", "v", f, null)).toBe("unsupported");
    expect(called).toBe(false);
  });

  it("hashes the write exactly as the server does, over the trimmed value", async () => {
    expect(await writeHash("claude-api-key", "  v-123\n")).toBe(serverHash("claude-api-key", "v-123"));
    expect(await writeHash("claude-api-key", "v")).not.toBe(await writeHash("gemini-api-key", "v"));
  });
});
