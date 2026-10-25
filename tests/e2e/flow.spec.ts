import { expect, test, type Page } from "@playwright/test";

/**
 * The flow kit's loop (#428, apps/world/src/desk/flow): its one canvas draws while it is on screen and stops drawing
 * when the tab is hidden, when it is scrolled out of view and when the page unmounts it (a laptop stays smooth: no
 * hidden heavy work, #401). Run against the dev server's kit harness (flow/harness.html, never built).
 */

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __flow: { field?: { frames: number } } }).__flow.field?.frames ?? -1);
const idle = (page: Page, ms: number) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

test("the flow field's loop pauses when hidden, off screen or unmounted", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/src/desk/flow/harness.html");
  await expect.poll(() => frames(page), { timeout: 30_000 }).toBeGreaterThan(5);

  // Hidden: no frames at all.
  await setHidden(page, true);
  await idle(page, 200);
  const h0 = await frames(page);
  await idle(page, 800);
  expect(await frames(page)).toBe(h0);

  // Visible again: it picks up by itself.
  await setHidden(page, false);
  await expect.poll(() => frames(page)).toBeGreaterThan(h0 + 3);

  // Scrolled out of view: skipped.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await idle(page, 300);
  const s0 = await frames(page);
  await idle(page, 800);
  expect(await frames(page)).toBe(s0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => frames(page)).toBeGreaterThan(s0 + 3);

  // Unmounted: gone from the loop.
  await page.evaluate(() => (window as unknown as { __flow: { unmount: () => void } }).__flow.unmount());
  await idle(page, 200);
  const u0 = await frames(page);
  await idle(page, 800);
  expect(await frames(page)).toBe(u0);
  expect(errors).toEqual([]);
});

test("the flow field draws one still frame under reduced motion", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/src/desk/flow/harness.html");
  await expect.poll(() => frames(page), { timeout: 30_000 }).toBeGreaterThan(0);
  // A still frame is redrawn on each layout (mount, fonts arriving); then nothing until something changes.
  let f0 = -1;
  await expect
    .poll(async () => {
      const a = await frames(page);
      await idle(page, 700);
      const b = await frames(page);
      f0 = b;
      return a === b;
    }, { timeout: 15_000 })
    .toBe(true);
  expect(f0).toBeLessThanOrEqual(10);
  await ctx.close();
});
