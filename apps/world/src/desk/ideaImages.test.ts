import { afterEach, describe, expect, it, vi } from "vitest";
import { linkUntil } from "../../../../api/_pictures.ts";
import { ownNames, pictureLinks } from "./ideaImages.ts";
import { useDeskAuth } from "./signin.ts";

const NOW = Date.parse("2026-10-14T12:03:00Z");

afterEach(() => vi.unstubAllGlobals());

describe("the Desk's picture links (#127, signed by the server since #132)", () => {
  it("asks the picture function to sign only the Desk's own pictures, and keeps only links to that function", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return Response.json({ links: ["/api/foundry-image?p=foundry%2Fideas%2Fa.jpg&u=1&s=ab", "https://attacker.example/x.png"] });
    });
    const links = await pictureLinks(["foundry/ideas/a.jpg", "https://attacker.example/i.png", "world/state.json"]);
    expect(asked).toEqual(["/api/foundry-image?sign=foundry%2Fideas%2Fa.jpg"]);
    expect(links).toEqual(["/api/foundry-image?p=foundry%2Fideas%2Fa.jpg&u=1&s=ab"]);
  });

  it("asks nothing when there is nothing of its own to show", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await pictureLinks(["https://attacker.example/i.png"])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(ownNames(["foundry/ideas/a.jpg", "foundry/ideas/b.jpg", "foundry/ideas/c.jpg", "foundry/ideas/d.jpg", "foundry/ideas/e.jpg"])).toHaveLength(4);
  });

  it("shows nothing once the session is gone, and the Desk knows it is signed out", async () => {
    useDeskAuth.setState({ auth: { status: "in", until: NOW + 60_000, device: "Test" } });
    vi.stubGlobal("fetch", async () => Response.json({ error: "signed-out" }, { status: 401 }));
    expect(await pictureLinks(["foundry/ideas/a.jpg"])).toEqual([]);
    expect(useDeskAuth.getState().auth.status).toBe("out");
  });

  it("keeps the same link for a whole ten-minute window, 10 to 20 minutes ahead", () => {
    expect(linkUntil(NOW)).toBe(linkUntil(NOW + 60_000));
    expect(linkUntil(NOW) - NOW / 1000).toBeGreaterThanOrEqual(600);
    expect(linkUntil(NOW) - NOW / 1000).toBeLessThanOrEqual(1200);
  });
});
