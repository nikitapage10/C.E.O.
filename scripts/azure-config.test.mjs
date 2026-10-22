import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Static Web App's config (apps/world/public/staticwebapp.config.json, docs/AZURE.md) carries vercel.json's
 * headers while both copies run, so a CSP change in one and not the other fails here.
 */
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const vercel = read("vercel.json");
const swa = read("apps/world/public/staticwebapp.config.json");

const vercelHeaders = (source) => Object.fromEntries(vercel.headers.find((r) => r.source === source).headers.map((h) => [h.key, h.value]));
const swaRoute = (route) => swa.routes.find((r) => r.route === route)?.headers;

describe("staticwebapp.config.json matches vercel.json (#214)", () => {
  it("sends the same security headers on every response", () => {
    expect(swa.globalHeaders).toEqual(vercelHeaders("/(.*)"));
  });

  it("keeps the service worker fresh and the hashed assets cached for good", () => {
    expect(swaRoute("/sw.js")).toEqual(vercelHeaders("/sw.js"));
    expect(swaRoute("/assets/*")).toEqual(vercelHeaders("/assets/(.*)"));
  });

  it("serves the app for every page vercel.json rewrites, and never for /api or a missing file", () => {
    expect(swa.navigationFallback.rewrite).toBe("/index.html");
    const excluded = (path) => swa.navigationFallback.exclude.some((e) => e.endsWith("/*") && path.startsWith(e.slice(0, -1)));
    for (const r of vercel.rewrites.filter((r) => !r.source.startsWith("/api/"))) {
      expect(r.destination).toBe("/index.html");
      expect(excluded(r.source)).toBe(false);
    }
    // The site lock's routes (#236) are rewritten into the Desk's sign-in function on Vercel, and the Exchange's
    // Polymarket board (#240) and the Green's league board (#252) into the world feed's; Azure has them as functions of their own, under /api like every function.
    for (const r of vercel.rewrites.filter((r) => r.source.startsWith("/api/"))) {
      expect(r.destination).toMatch(/^\/api\/(desk-auth\?site=(login|password)|world\?(exchange=(markets|positions)|green=league))$/);
      expect(excluded(r.source)).toBe(true);
    }
    for (const path of ["/api/*", "/assets/*", "/models/*"]) expect(swa.navigationFallback.exclude).toContain(path);
  });
});
