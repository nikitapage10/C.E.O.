import { describe, expect, it } from "vitest";
import { LINK_MAX_S, ownPictures, pictureLink, pictureRef, picturesLine, signPicture, verifyPicture } from "./_pictures.ts";

const KEY = "test-desk-key";
const PATH = "foundry/ideas/1760000000000-a1.jpg";
const NOW = Date.parse("2026-10-14T12:00:00Z");
const nowS = Math.floor(NOW / 1000);

describe("short-lived picture links (#127)", () => {
  it("verifies a link signed with the Desk key, before it runs out", async () => {
    const until = nowS + 600;
    const sig = await signPicture(KEY, PATH, until);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPicture(KEY, PATH, until, sig, NOW)).toBe(true);
  });

  it("refuses a wrong key, another picture, a moved expiry, a bad signature or no key at all", async () => {
    const until = nowS + 600;
    const sig = await signPicture(KEY, PATH, until);
    expect(await verifyPicture("another-key", PATH, until, sig, NOW)).toBe(false);
    expect(await verifyPicture(KEY, "foundry/ideas/other.jpg", until, sig, NOW)).toBe(false);
    expect(await verifyPicture(KEY, PATH, until + 1, sig, NOW)).toBe(false);
    expect(await verifyPicture(KEY, PATH, until, sig.replace(/^./, (c) => (c === "0" ? "1" : "0")), NOW)).toBe(false);
    expect(await verifyPicture(KEY, PATH, until, "", NOW)).toBe(false);
    expect(await verifyPicture("", PATH, until, await signPicture("", PATH, until).catch(() => "0".repeat(64)), NOW)).toBe(false);
  });

  it("refuses an expired link, and one signed too far ahead", async () => {
    const past = nowS - 1;
    expect(await verifyPicture(KEY, PATH, past, await signPicture(KEY, PATH, past), NOW)).toBe(false);
    const far = nowS + LINK_MAX_S + 60;
    expect(await verifyPicture(KEY, PATH, far, await signPicture(KEY, PATH, far), NOW)).toBe(false);
  });

  it("refuses anything outside the ideas folder, however it is signed", async () => {
    for (const path of ["world/state.json", "foundry/ideas/../world/state.json", "foundry/ideas/a b.png"]) {
      const until = nowS + 600;
      expect(await verifyPicture(KEY, path, until, await signPicture(KEY, path, until), NOW)).toBe(false);
    }
  });

  it("links only to the site's own picture function, never a host", () => {
    expect(pictureLink(PATH, nowS, "ab")).toBe(`/api/foundry-image?p=foundry%2Fideas%2F1760000000000-a1.jpg&u=${nowS}&s=ab`);
  });
});

describe("the Desk shows only Nikita's own pictures (#127)", () => {
  it("reads a picture's store name from its own link, whatever host the link names", () => {
    expect(pictureRef("https://ceo.example/api/foundry-image?p=foundry%2Fideas%2Fa1.png")).toBe("foundry/ideas/a1.png");
    expect(pictureRef("https://attacker.example/api/foundry-image?p=foundry%2Fideas%2Fa1.png")).toBe("foundry/ideas/a1.png");
    expect(pictureRef("foundry/ideas/a1.png")).toBe("foundry/ideas/a1.png");
  });

  it("drops anything that isn't one of the Desk's own pictures", () => {
    for (const link of ["https://attacker.example/i.png", "https://x.public.blob.vercel-storage.com/foundry/ideas/a.jpg", "/api/foundry-image?p=secrets%2Fkeys.txt", "javascript:alert(1)", "data:image/png;base64,AAAA", ""]) {
      expect(pictureRef(link)).toBeNull();
    }
  });

  it("finds the pictures an issue names, on its Pictures line or in the old picture links, and nothing else", () => {
    const body = [
      "**Pitch:** Look.",
      "![Picture 1](https://ceo.example/api/foundry-image?p=foundry%2Fideas%2Fold.jpg)",
      "![x](https://attacker.example/i.png)",
      '<img src="https://attacker.example/p.png">',
      "![y](https://x.public.blob.vercel-storage.com/a.jpg)",
      picturesLine(["foundry/ideas/a.jpg", "foundry/ideas/b.png"]),
    ].join("\n");
    expect(ownPictures(body)).toEqual(["foundry/ideas/old.jpg", "foundry/ideas/a.jpg", "foundry/ideas/b.png"]);
    expect(ownPictures("no pictures here")).toEqual([]);
  });

  it("carries pictures in the issue as names, never as a link or an image GitHub would fetch", () => {
    const line = picturesLine(["foundry/ideas/a.jpg"]);
    expect(line).toBe("**Pictures:** 1, kept private and shown only on the Desk (foundry/ideas/a.jpg)");
    expect(line).not.toMatch(/!\[|\]\(|https?:|\/api\//);
    expect(picturesLine([])).toBe("");
  });

  it("shows at most four", () => {
    expect(ownPictures(picturesLine(["a", "b", "c", "d", "e"].map((n) => `foundry/ideas/${n}.jpg`)))).toHaveLength(4);
  });
});
