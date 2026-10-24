import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ROOM_IDS } from "@ceo/core";

/**
 * Smoke test for the whole Lattice: it boots, agents move, every room is reachable, an approval can be
 * granted, and every glitch fires and cleans up after itself. Screenshots land in test-results/shots.
 * Runs in headless Chromium on SwiftShader, which is slow, so waits are generous (boot, with the whole world streamed
 * in, gets 6 min) and the camera cuts.
 *
 * How slow (#161): a frame of the full Lattice takes 2-5 s of wall time there, and the simulation advances at most
 * 0.1 s x speed per frame (Scene.tsx), so 400 ms of simulated time at speed=4. A screenshot has to wait for a fresh
 * frame or two, so each one costs 10-20 s. The tests that take many screenshots budget time per screenshot, and
 * movement is measured over a fixed simulated window that starts when the first snapshot is taken.
 */

/**
 * Wall-clock budget for booting the Lattice (the boot wait below) and for one room or glitch screenshot step.
 *
 * Booting means the whole world is in, not just the first rooms (#405). Since room-first loading (#360) the curtain
 * lifts on the rooms nearest the camera and the other rooms' models stream in and compile behind it. With no
 * KHR_parallel_shader_compile (SwiftShader) that goes a part at a time between frames, and here it takes minutes
 * after the agents appear. A test that starts then has every evaluate, hover and screenshot queued behind it (an
 * evaluate took 20 s, a hover over two minutes), so the boot waits for window.__ceo.streamedIn() as well.
 */
const BOOT_MS = 360_000;
const STEP_MS = 60_000;
/** Simulated time agents get to move between the two position snapshots: ten frames at the slowest. */
const MOVE_WINDOW_MS = 4000;

type Api = {
  state: () => { agents: Record<string, unknown>; approvals: Record<string, { status: string; request: { room: string } }> };
  positions: () => Record<string, [number, number, number]>;
  time: () => number;
  focus: (room: string | null) => void;
  fireGlitch: (id: string) => void;
  activeGlitch: () => { id: string } | null;
  glitchIds: string[];
};

/**
 * The tests below share one booted Lattice (nightly it took ~54 of 60 minutes with every test booting its own: the
 * whole world streams in for minutes on SwiftShader). They run in order in a serial group on one page; the first
 * boots it, the rest reuse it and start from the overview. Each test leaves no state the next depends on.
 */
let page: Page;
let context: BrowserContext;

const api = <T,>(page: Page, fn: (a: Api) => T) =>
  page.evaluate(`(${fn.toString()})(window.__ceo)`) as Promise<Awaited<T>>;

async function boot(page: Page, speed = 4) {
  const start = Date.now();
  await page.goto(`/lattice?instant&glitches=off&speed=${speed}&quality=low&seed=7`);
  await page.waitForFunction(() => {
    const w = window as unknown as { __ceo?: { positions?: () => Record<string, unknown> } };
    return w.__ceo?.positions && Object.keys(w.__ceo.positions()).length >= 14;
  }, undefined, { timeout: BOOT_MS, polling: 1000 });
  await page.waitForFunction(
    () => (window as unknown as { __ceo: { streamedIn: () => boolean } }).__ceo.streamedIn(),
    undefined,
    { timeout: Math.max(1000, BOOT_MS - (Date.now() - start)), polling: 2000 },
  );
}

async function returnToOverview() {
  await api(page, (a) => a.focus(null));
  await expect(page.locator('[data-room="overview"]')).toHaveClass(/on/);
}

test.describe.serial("the Lattice", () => {
  test.beforeAll(async ({ browser }, info) => {
    const { baseURL, viewport } = info.project.use;
    context = await browser.newContext({ baseURL, viewport });
    page = await context.newPage();
  });
  test.afterAll(async () => {
    await context.close();
  });

  test("boots, agents move, rooms are reachable", async () => {
    // Boot, the movement window, the overview and one screenshot step per room.
    test.setTimeout(BOOT_MS + (ROOM_IDS.length + 2) * STEP_MS);
    await boot(page);
    await expect(page.locator(".mark__name")).toHaveText("C.E.O.");
    await expect(page.locator(".display .sr-only")).toHaveText("THE LATTICE");
    await page.screenshot({ path: "test-results/shots/overview.png" });

    // Both snapshots carry their simulated time, read in the same evaluate, so the window is exact. It used to end at
    // a fixed time (6 s) that a slow boot had often already passed, leaving no frames between the two snapshots.
    const snapshot = () => api(page, (a) => ({ t: a.time(), at: a.positions() }));
    const { t: t0, at: before } = await snapshot();
    await page.waitForFunction(
      (until) => (window as unknown as { __ceo: { time: () => number } }).__ceo.time() >= until,
      t0 + MOVE_WINDOW_MS,
      { timeout: STEP_MS, polling: 500 },
    );
    const { t: t1, at: after } = await snapshot();
    expect(t1 - t0).toBeGreaterThanOrEqual(MOVE_WINDOW_MS);
    const moved = Object.keys(before).filter((id) => {
      const [x0, , z0] = before[id]!;
      const [x1, , z1] = after[id]!;
      return Math.hypot(x1 - x0, z1 - z0) > 0.05;
    });
    expect(moved.length).toBeGreaterThan(2);

    for (const [i, room] of ROOM_IDS.entries()) {
      // 1 to 9, then 0 for the tenth room.
      await page.keyboard.press(String((i + 1) % 10));
      await expect(page.locator(`[data-room="${room}"]`)).toHaveClass(/on/);
      await expect(page.locator(".title-block .eyebrow")).toContainText(String(i + 1).padStart(2, "0"));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `test-results/shots/room-${i + 1}-${room}.png` });
    }
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-room="overview"]')).toHaveClass(/on/);
  });

  test("the C.E.O. can approve a request", async () => {
    test.setTimeout(STEP_MS * 4);
    // The demo's first approval comes 15-25 s into Lattice time (seed 7's moved from 12.4 s to 22.4 s when the Studio's
    // cast joined, #326). Approvals stay pending until answered, and the shared world has been running since the first
    // test's boot, so one is normally waiting already; the wait below covers the case where it isn't.
    await returnToOverview();
    // The demo's approvals only show inside their room (the Lattice-wide view is for real agents).
    await expect(page.locator("[data-approval]")).toHaveCount(0);
    const room = await page.waitForFunction(
      () => {
        const w = window as unknown as { __ceo: Api };
        return Object.values(w.__ceo.state().approvals).find((a) => a.status === "pending")?.request.room;
      },
      undefined,
      { timeout: 100_000, polling: 1000 },
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

  test("Brogu's eyes open in a room and Esc leaves them", async () => {
    test.setTimeout(STEP_MS * 5);
    await returnToOverview();
    const room = ROOM_IDS[0]!;
    await page.keyboard.press("1");
    await expect(page.locator(`[data-room="${room}"]`)).toHaveClass(/on/);
    await page.waitForTimeout(1500);

    await page.keyboard.press("b");
    const eyes = page.locator('[data-eyes="on"]');
    await expect(eyes).toBeVisible({ timeout: 30_000 });
    await expect(eyes.locator(".eyebrow").first()).toHaveText("Brogu's eyes");
    await expect(eyes.locator(".eyes__room")).not.toBeEmpty();
    await expect(eyes.locator('[data-eyes="leave"]')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/shots/brogu-eyes.png" });

    await page.keyboard.press("Escape");
    await expect(eyes).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(`[data-room="${room}"]`)).toHaveClass(/on/);
  });

  test("every glitch fires and the Lattice returns to normal", async () => {
    test.setTimeout(STEP_MS * 2);
    await returnToOverview();
    await api(page, (a) => a.focus("foundry"));
    const ids = await api(page, (a) => a.glitchIds);
    expect(ids.length).toBeGreaterThanOrEqual(14);
    // One step per glitch: fire, hold, screenshot, and wait for it to clear.
    test.setTimeout((ids.length + 4) * STEP_MS);
    for (const id of ids) {
      await page.evaluate((g) => (window as unknown as { __ceo: Api }).__ceo.fireGlitch(g), id);
      await expect.poll(() => api(page, (a) => a.activeGlitch()?.id ?? null)).toBe(id);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `test-results/shots/glitch-${id}.png` });
      await expect.poll(() => api(page, (a) => a.activeGlitch()), { timeout: 20_000 }).toBeNull();
    }
  });

  test("agents can be renamed, re-dressed and given relationships", async () => {
    test.setTimeout(STEP_MS * 5);
    await returnToOverview();
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

});

test("the Desk opens first without loading the Lattice", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (r) => r.resourceType() === "script" && scripts.push(r.url()));
  await page.goto("/");
  await expect(page.locator(".today .desk__title")).toBeVisible();
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/\/relay$/);
  await expect(page.locator(".desk__title")).toHaveText(/^Relay\b/);
  expect(scripts.some((u) => /three|App\.tsx|\/App-/.test(u))).toBe(false);
});
