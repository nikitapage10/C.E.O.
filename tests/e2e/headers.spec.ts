import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { headersFor, startDistServer, vercelConfig } from "./dist-server.ts";

/**
 * Security headers (#62): the built site, served with exactly the headers vercel.json declares, loads the Desk (every
 * tab) and the Lattice without the browser blocking anything the app itself needs. The server reads vercel.json, so
 * this can't pass against a policy different from the one that ships.
 */

/** E2E_DIST_PORT picks another port, so two checkouts can run this side by side. */
const PORT = Number(process.env.E2E_DIST_PORT ?? 5181);
const BASE = `http://localhost:${PORT}`;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

/** Collects `securitypolicyviolation` events and the console's CSP complaints, from before the page's first script. */
async function watch(page: Page) {
  const seen: string[] = [];
  await page.exposeFunction("__reportCsp", (m: string) => seen.push(m));
  await page.addInitScript(() => {
    const w = window as unknown as { __reportCsp: (m: string) => void };
    document.addEventListener("securitypolicyviolation", (e) => w.__reportCsp(`${e.violatedDirective} blocked ${e.blockedURI}`));
  });
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) seen.push(m.text());
  });
  return seen;
}

test("every response carries the security headers", async ({ request }) => {
  for (const path of ["/", "/lattice", "/relay", "/assets/missing.js"]) {
    const res = await request.get(BASE + path);
    const h = res.headers();
    const expected = headersFor(path, new URLSearchParams());
    expect(h["content-security-policy"], path).toBe(expected["Content-Security-Policy"]);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("microphone=(self)");
    expect(h["permissions-policy"]).toContain("camera=()");
  }
  const csp = vercelConfig.headers.flatMap((r) => r.headers).find((x) => x.key === "Content-Security-Policy")!.value;
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"]) expect(csp).toContain(d);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
});

test("the Desk and each of its tabs raise no CSP violation", async ({ page }) => {
  const seen = await watch(page);
  await page.goto(BASE + "/");
  await expect(page.locator(".desk__title")).toHaveText("Today");
  for (const tab of await page.locator(".desk__tabs a").all()) {
    await tab.click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1000);
  expect(seen).toEqual([]);
});

test("the Desk installs as an app under the policy: manifest, icons and its service worker (#135)", async ({ page, request }) => {
  const seen = await watch(page);
  const manifest = await request.get(BASE + "/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as { start_url: string; icons: { src: string }[] };
  expect(body.start_url).toBe("/");
  for (const icon of body.icons) expect((await request.get(BASE + icon.src)).ok(), icon.src).toBe(true);
  expect((await request.get(BASE + "/sw.js")).headers()["cache-control"]).toBe("no-cache");
  await page.goto(BASE + "/");
  await expect(page.locator(".desk__title")).toHaveText("Today");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(BASE + "/");
  // The worker keeps nothing: no cache is ever opened.
  expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);
  await page.waitForTimeout(500);
  expect(seen).toEqual([]);
});

test("the Lattice boots under the policy without a violation", async ({ page }) => {
  test.setTimeout(240_000);
  const seen = await watch(page);
  await page.goto(BASE + "/lattice?instant&glitches=off&speed=4&quality=low&seed=7");
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __ceo?: { positions?: () => Record<string, unknown> } };
      return w.__ceo?.positions && Object.keys(w.__ceo.positions()).length >= 14;
    },
    undefined,
    { timeout: 150_000, polling: 1000 },
  );
  await page.waitForTimeout(2000);
  expect(seen).toEqual([]);
});
