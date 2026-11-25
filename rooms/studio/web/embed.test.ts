import { describe, expect, it } from "vitest";
import { postKind } from "../../../api/_studio/stats.ts";
import { embedOf } from "./screens.tsx";

describe("the feed's players and kinds (#1233)", () => {
  it("embeds a TikTok by its video id and an Instagram post or reel by its code", () => {
    expect(embedOf("https://www.tiktok.com/@show/video/7312345678901234567")).toBe("https://www.tiktok.com/embed/v2/7312345678901234567");
    expect(embedOf("https://www.instagram.com/reel/C1abc_DEF-9/")).toBe("https://www.instagram.com/reel/C1abc_DEF-9/embed");
    expect(embedOf("https://www.instagram.com/show/p/C1abcDEF9/")).toBe("https://www.instagram.com/p/C1abcDEF9/embed");
    expect(embedOf("https://example.com/video/123456789")).toBeNull();
    expect(embedOf(undefined)).toBeNull();
  });
  it("tells a story from a post by what Zernio says it is", () => {
    expect(postKind({ platformSpecificData: { contentType: "story" } })).toBe("story");
    expect(postKind({ contentType: "STORIES" })).toBe("story");
    expect(postKind({ mediaType: "video" })).toBe("post");
    expect(postKind({})).toBe("post");
  });
});
