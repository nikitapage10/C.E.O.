import { describe, expect, it } from "vitest";
import { fetchLine } from "./voice.ts";

/** The Rotunda's voices in the browser (#755): one line asked for, and every way it can fail quietly. */

const MP3 = Buffer.from(new Uint8Array(400).fill(5)).toString("base64");

describe("a Rotunda line from the function (#755)", () => {
  it("asks for the caption in its member's voice and hands back playable audio", async () => {
    let sent: Record<string, unknown> = {};
    const got = await fetchLine("boiler", "Again?", (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ say: "Again?", kind: "spoken", audio: MP3, cached: true });
    }) as typeof fetch);
    expect(sent).toEqual({ room: "today", speak: "Again?", as: "boiler" });
    expect(got.gone).toBe(false);
    expect(got.url).toMatch(/^blob:/);
  });

  it("falls back to the caption with no audio (capped or down), and stops asking when signed out", async () => {
    const noAudio = await fetchLine("boiler", "Again?", (async () => Response.json({ say: "Again?", kind: "spoken" })) as typeof fetch);
    expect(noAudio).toEqual({ url: null, gone: false });
    const signedOut = await fetchLine("boiler", "Again?", (async () => new Response("", { status: 401 })) as typeof fetch);
    expect(signedOut).toEqual({ url: null, gone: true });
    const broken = await fetchLine("boiler", "Again?", (async () => {
      throw new Error("offline");
    }) as typeof fetch);
    expect(broken).toEqual({ url: null, gone: false });
  });
});
