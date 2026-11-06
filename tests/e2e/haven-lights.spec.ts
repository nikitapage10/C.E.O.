import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";
import { FAKE_PLAN } from "../../api/_haven/plan.fixture.ts";

/**
 * The Haven's lights (#931) on the built site, with the endpoints stubbed in the browser. The plan is the made-up
 * fixture and the lights, scene and remote are made up for the run: nothing here is anyone's real home.
 * E2E_SHOTS=<dir> also saves a picture.
 */

const PORT = Number(process.env.E2E_HAVEN_LIGHTS_PORT ?? 5199);
const SHOTS = process.env.E2E_SHOTS ?? "";
const BASE = `http://localhost:${PORT}`;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const VIEW = {
  vendors: { switchbot: "live", govee: "waiting" },
  lights: [
    { id: "a0000000000a", vendor: "switchbot", name: "Kitchen", type: "Bot", on: true, online: true },
    { id: "a0000000000b", vendor: "switchbot", name: "Porch", type: "Plug Mini (US)", on: false, online: true },
  ],
  scenes: [{ id: "a0000000000c", name: "All off" }],
  remotes: [{ id: "a0000000000d", name: "Beamer", type: "Projector" }],
};

async function stub(page: Page, posts: unknown[]) {
  const now = Date.now();
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: true, until: now + 30 * 60_000, hardUntil: now + 8 * 3_600_000, device: "Test device", devices: [] } }));
  await page.route(/\/api\/haven(\?.*)?$/, (r) => r.fulfill({ json: new URL(r.request().url()).searchParams.get("view") === "status" ? { kitchen: { open: 0, done: 0 }, todos: 0, ready: true } : { items: [] } }));
  await page.route(/\/api\/haven\/devices(\?.*)?$/, (r) => r.fulfill({ json: { vendors: { roborock: "waiting", petlibro: "waiting", whisker: "waiting" }, devices: [] } }));
  await page.route(`${BASE}/api/haven-plan`, (r) => r.fulfill({ json: { plan: FAKE_PLAN } }));
  await page.route(`${BASE}/api/haven/lights`, (r) => {
    if (r.request().method() === "POST") {
      posts.push(r.request().postDataJSON());
      return r.fulfill({ json: { ok: true, say: "Done." } });
    }
    return r.fulfill({ json: VIEW });
  });
}

test("signed in: the lights, a scene, the projector's power and the light the house couldn't place (#931)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const posts: unknown[] = [];
  await stub(page, posts);
  await page.goto(`${BASE}/haven`);
  const panel = page.getByRole("region", { name: "Lights" });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  const kitchen = panel.getByRole("button", { name: /^Kitchen, on/ });
  await expect(kitchen).toHaveAttribute("aria-pressed", "true");
  // The fixture has a Kitchen, so that light hangs there; "Porch" names no room, so it's listed apart.
  await expect(panel).toContainText("Not on the map yet: Porch (Plug Mini (US))");
  await kitchen.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ op: "set", id: "a0000000000a", on: false });
  await expect(panel.getByRole("button", { name: /^Kitchen, off/ })).toHaveAttribute("aria-pressed", "false");
  await panel.getByRole("button", { name: "All off" }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toEqual({ op: "scene", id: "a0000000000c" });
  await panel.getByRole("group", { name: "Beamer power" }).getByRole("button", { name: "On" }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2]).toEqual({ op: "set", id: "a0000000000d", on: true });
  const house = page.locator(".hv-house");
  if ((await house.getAttribute("data-gl")) === "on") await expect(page.locator(".hv-bulb")).toHaveCount(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/haven-931-lights.png` });
});
