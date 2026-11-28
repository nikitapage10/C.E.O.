import { describe, expect, it } from "vitest";
import { forgetTokens } from "../_haven/google/oauth.js";
import { cleanTitle, shortDescription, uploadShort, videoResource, type YoutubeDeps } from "./youtube.js";

const grant = { refresh: "refresh-token-abcdefghijkl", connectedAt: 1 };

function vault(g: unknown = grant) {
  const writes: unknown[] = [];
  return { writes, v: { read: async () => g, write: async (_n: string, x: unknown) => void writes.push(x), forget: async () => undefined } as unknown as YoutubeDeps["vault"] };
}

describe("youtube shorts", () => {
  it("tags the description with #Shorts once and keeps titles legal", () => {
    expect(shortDescription("How to file taxes")).toBe("How to file taxes\n\n#Shorts");
    expect(shortDescription("Already #shorts")).toBe("Already #shorts");
    expect(cleanTitle("  <Zombies>   & taxes ")).toBe("Zombies & taxes");
    expect(cleanTitle("x".repeat(150))).toHaveLength(100);
  });

  it("asks for public, not for kids, and labels AI honestly", () => {
    const r = videoResource({ video: "https://a.example/v.mp4", title: "Ep 1", description: "cap" });
    expect(r.status).toMatchObject({ privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  });

  it("streams the video into a resumable upload and reports what YouTube set", async () => {
    forgetTokens();
    const calls: { url: string; method: string }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      if (url === "https://media.example/cut.mp4") return new Response("videobytes", { status: 200, headers: { "content-length": "10" } });
      if (url.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=x" } });
      if (url.includes("upload_id=x")) return new Response(JSON.stringify({ id: "abc123XYZ_-", snippet: { channelId: "UCsHQxHpT02BmHHuLaXcYN1g" }, status: { privacyStatus: "private" } }), { status: 200 });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const { v } = vault();
    const got = await uploadShort({ fetch: fetcher, client: { clientId: "c", clientSecret: "s" }, vault: v, now: () => 1_000 }, { video: "https://media.example/cut.mp4", title: "Ep", description: "cap" });
    expect(got).toEqual({ ok: true, id: "abc123XYZ_-", privacy: "private", channel: "UCsHQxHpT02BmHHuLaXcYN1g", thumbnail: false });
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "POST", "PUT"]);
  });

  it("says not connected without a grant, and marks a refused grant", async () => {
    forgetTokens();
    const none = vault(null);
    expect(await uploadShort({ fetch: fetch, client: { clientId: "c", clientSecret: "s" }, vault: none.v, now: () => 1 }, { video: "https://m.example/v.mp4", title: "t", description: "d" })).toEqual({ ok: false, error: "not-connected" });
    const refusing = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    const r = vault();
    expect(await uploadShort({ fetch: refusing, client: { clientId: "c", clientSecret: "s" }, vault: r.v, now: () => 1 }, { video: "https://m.example/v.mp4", title: "t", description: "d" })).toEqual({ ok: false, error: "refused" });
    expect(r.writes).toEqual([{ ...grant, refused: true }]);
  });
});
