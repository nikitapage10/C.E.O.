import { expect, test, type Page } from "@playwright/test";
import { ROOM_IDS } from "@ceo/core";

/**
 * Smoke test for the whole Lattice: it boots, agents move, every room is reachable, an approval can be
 * granted, and every glitch fires and cleans up after itself. Screenshots land in test-results/shots.
 * Runs in headless Chromium on SwiftShader, which is slow, so waits are generous and the camera cuts.
 */

type Api = {
  state: () => { agents: Record<string, unknown>; approvals: Record<string, { status: string; request: { room: string } }> };
  positions: () => Record<string, [number, number, number]>;
  time: () => number;
  focus: (room: string | null) => void;
  fireGlitch: (id: string) => void;
  activeGlitch: () => { id: string } | null;
  glitchIds: string[];
};

const api = <T,>(page: Page, fn: (a: Api) => T) =>
  page.evaluate(`(${fn.toString()})(window.__ceo)`) as Promise<Awaited<T>>;

async function boot(page: Page) {
  await page.goto("/?instant&glitches=off&speed=4&quality=low&seed=7");
  await page.waitForFunction(() => {
    const w = window as unknown as { __ceo?: { positions?: () => Record<string, unknown> } };
    return w.__ceo?.positions && Object.keys(w.__ceo.positions()).length >= 14;
  }, undefined, { timeout: 60_000 });
}

test("boots, agents move, rooms are reachable", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".mark__name")).toHaveText("C.E.O.");
  await expect(page.locator(".display .sr-only")).toHaveText("THE LATTICE");
  await page.screenshot({ path: "test-results/shots/overview.png" });

  const before = await api(page, (a) => a.positions());
  await page.waitForFunction(() => (window as unknown as { __ceo: { time: () => number } }).__ceo.time() > 6000, undefined, { timeout: 90_000 });
  const after = await api(page, (a) => a.positions());
  const moved = Object.keys(before).filter((id) => {
    const [x0, , z0] = before[id]!;
    const [x1, , z1] = after[id]!;
    return Math.hypot(x1 - x0, z1 - z0) > 0.05;
  });
  expect(moved.length).toBeGreaterThan(2);

  for (const [i, room] of ROOM_IDS.entries()) {
    await page.keyboard.press(String(i + 1));
    await expect(page.locator(`[data-room="${room}"]`)).toHaveClass(/on/);
    await expect(page.locator(".title-block .eyebrow")).toContainText(String(i + 1).padStart(2, "0"));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/shots/room-${i + 1}-${room}.png` });
  }
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-room="overview"]')).toHaveClass(/on/);
});

test("the C.E.O. can approve a request", async ({ page }) => {
  await boot(page);
  // The demo's approvals only show inside their room (the Lattice-wide view is for real agents).
  await expect(page.locator("[data-approval]")).toHaveCount(0);
  const room = await page.waitForFunction(
    () => {
      const w = window as unknown as { __ceo: Api };
      return Object.values(w.__ceo.state().approvals).find((a) => a.status === "pending")?.request.room;
    },
    undefined,
    { timeout: 100_000 },
  );
  await page.evaluate((r) => (window as unknown as { __ceo: Api }).__ceo.focus(r), (await room.jsonValue()) as string);
  const card = page.locator("[data-approval]").first();
  await expect(card).toBeVisible({ timeout: 100_000 });
  const id = await card.getAttribute("data-approval");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(`[data-approval="${id}"]`)).toHaveCount(0);
  const status = await page.evaluate((approvalId) => {
    const w = window as unknown as { __ceo: Api };
    return w.__ceo.state().approvals[approvalId!]?.status;
  }, id);
  expect(status).toBe("approved");
});

test("every glitch fires and the Lattice returns to normal", async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page);
  await api(page, (a) => a.focus("foundry"));
  const ids = await api(page, (a) => a.glitchIds);
  expect(ids.length).toBeGreaterThanOrEqual(14);
  for (const id of ids) {
    await page.evaluate((g) => (window as unknown as { __ceo: Api }).__ceo.fireGlitch(g), id);
    await expect.poll(() => api(page, (a) => a.activeGlitch()?.id ?? null)).toBe(id);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `test-results/shots/glitch-${id}.png` });
    await expect.poll(() => api(page, (a) => a.activeGlitch()), { timeout: 20_000 }).toBeNull();
  }
});

test("agents can be renamed, re-dressed and given relationships", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => localStorage.removeItem("ceo.cast.v2"));
  await page.locator(".roster li").filter({ hasText: "Kevin" }).hover();
  await page.getByRole("button", { name: "Open Kevin in the agent studio" }).click();
  const studio = page.locator(".studio");
  await expect(studio).toBeVisible();

  await studio.getByLabel("Name").fill("Kevin the Magnificent");
  await expect(page.locator(".roster")).toContainText("Kevin the Magnificent");

  await studio.getByRole("button", { name: "look" }).click();
  await studio.getByRole("button", { name: "Engineer from a Rocky Planet" }).click();
  await expect(studio.locator(".sticky-note")).toContainText("Fist my bump");

  await studio.getByRole("button", { name: "relationships" }).click();
  const add = studio.locator("form.inline");
  await add.locator("select").first().selectOption({ label: "Noco" });
  await add.locator("select").nth(1).selectOption("nemesis");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(studio.locator(".rels")).toContainText("Noco");
  await page.screenshot({ path: "test-results/shots/studio.png" });

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ceo.cast.v2") ?? "null"));
  expect(saved.profiles.kevin.name).toBe("Kevin the Magnificent");
  expect(saved.profiles.kevin.look).toMatchObject({ preset: "rock-engineer", body: "rocky" });
  expect(saved.relationships).toContainEqual(expect.objectContaining({ a: "kevin", b: "odds", kind: "nemesis" }));

  await page.keyboard.press("Escape");
  await expect(studio).toHaveCount(0);

  // Selecting an agent opens their dossier, House and all.
  await page.evaluate(() => (window as unknown as { __ceo: { store: { getState: () => { selectAgent: (id: string) => void } } } }).__ceo.store.getState().selectAgent("loremaster"));
  const dossier = page.locator(".dossier");
  await expect(dossier).toContainText("House Transformere");
  await dossier.locator(".house").click();
  await expect(dossier).toContainText("Generatio the Pretrained");
});
