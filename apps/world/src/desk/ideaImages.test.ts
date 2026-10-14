import { describe, expect, it } from "vitest";
import { verifyPicture } from "../../../../api/_pictures.ts";
import { linkUntil, pictureLinks } from "./ideaImages.ts";

const NOW = Date.parse("2026-10-14T12:03:00Z");

describe("the Desk's picture links (#127)", () => {
  it("signs links the picture function accepts, on this site only, for 10 to 20 minutes", async () => {
    const links = await pictureLinks(["foundry/ideas/a.jpg", "foundry/ideas/b.png"], "test-desk-key", NOW);
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.startsWith("/api/foundry-image?p=foundry%2Fideas%2F")).toBe(true);
      const q = new URL(link, "https://ceo.example").searchParams;
      const until = Number(q.get("u"));
      expect(until - NOW / 1000).toBeGreaterThanOrEqual(600);
      expect(until - NOW / 1000).toBeLessThanOrEqual(1200);
      expect(await verifyPicture("test-desk-key", q.get("p")!, until, q.get("s")!, NOW)).toBe(true);
    }
  });

  it("keeps the same link for a whole ten-minute window", () => {
    expect(linkUntil(NOW)).toBe(linkUntil(NOW + 60_000));
  });

  it("shows nothing without the key, and nothing that isn't one of the Desk's own pictures", async () => {
    expect(await pictureLinks(["foundry/ideas/a.jpg"], "", NOW)).toEqual([]);
    expect(await pictureLinks(["https://attacker.example/i.png", "world/state.json"], "test-desk-key", NOW)).toEqual([]);
  });
});
