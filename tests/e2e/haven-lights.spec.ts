import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";
import { keptRoomsWarm } from "./kept.ts";
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

const LOOK = { color: true, brightness: true, kelvin: [2200, 6500], moods: ["Aurora", "Sunset"] };
const VIEW = {
  vendors: { switchbot: "live", govee: "live" },
  lights: [
    { id: "a0000000000a", vendor: "switchbot", name: "Kitchen", type: "Bot", on: true, online: true },
    { id: "a0000000000b", vendor: "switchbot", name: "Porch", type: "Plug Mini (US)", on: false, online: true },
    { id: "a0000000000e", vendor: "govee", name: "Test Floor Lamp", type: "devices.types.light", on: true, online: true, rgb: "#39ff7a", brightness: 90, look: LOOK },
    { id: "a0000000000f", vendor: "govee", name: "Test Uplight", type: "devices.types.light", on: false, online: true, rgb: null, brightness: null, look: LOOK },
    { id: "a00000000011", vendor: "govee", name: "Christmas Tree", type: "devices.types.socket", on: false, online: true, rgb: null, brightness: null },
  ],
  scenes: [{ id: "a0000000000c", name: "All off" }],
  groups: [{ id: "a00000000010", vendor: "govee", name: "Same-Model", on: null }],
  remotes: [{ id: "a0000000000d", name: "Beamer", type: "Projector" }],
};
/** The made-up flat's study as a Studio, with a made-up spot for the made-up floor lamp. */
const PLAN = { ...FAKE_PLAN, rooms: FAKE_PLAN.rooms.map((r) => (r.id === "study" ? { ...r, name: "Studio" } : r)), lights: [{ name: "Test Floor Lamp", x: 930, y: 770 }] };

async function stub(page: Page, posts: unknown[], view: (url: string) => unknown = () => VIEW) {
  const now = Date.now();
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: true, until: now + 30 * 60_000, hardUntil: now + 8 * 3_600_000, device: "Test device", devices: [] } }));
  await page.route(/\/api\/haven(\?.*)?$/, (r) => r.fulfill({ json: new URL(r.request().url()).searchParams.get("view") === "status" ? { kitchen: { open: 0, done: 0 }, todos: 0, ready: true } : { items: [] } }));
  await page.route(/\/api\/haven\/devices(\?.*)?$/, (r) => r.fulfill({ json: { vendors: { roborock: "waiting", petlibro: "waiting", whisker: "waiting" }, devices: [] } }));
  await page.route(`${BASE}/api/haven-plan`, (r) => {
    if (r.request().method() === "POST") {
      const b = r.request().postDataJSON() as { name: string; x: number; y: number };
      posts.push(b);
      return r.fulfill({ json: { ok: true, plan: { ...PLAN, lights: [...PLAN.lights, { name: b.name, x: b.x, y: b.y }] } } });
    }
    return r.fulfill({ json: { plan: PLAN } });
  });
  await page.route(/\/api\/haven\/lights(\?.*)?$/, (r) => {
    if (r.request().method() === "POST") {
      posts.push(r.request().postDataJSON());
      return r.fulfill({ json: { ok: true, say: "Done." } });
    }
    return r.fulfill({ json: view(r.request().url()) });
  });
}

test("signed in: rooms and lamps, the scenes apart, Edit for a Govee colour, the groups and placing a light with a tap (#931, #974, #1002)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const posts: unknown[] = [];
  await stub(page, posts);
  await page.goto(`${BASE}/haven`);
  const panel = page.getByRole("region", { name: "Lights" });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  const govee = panel.getByRole("group", { name: "Lamps" }), sb = panel.getByRole("group", { name: "Rooms" }), scenes = panel.getByRole("group", { name: "Scenes" });
  await expect(govee).toContainText("Test Floor Lamp");
  await expect(sb).toContainText("Kitchen");
  await expect(sb).not.toContainText("Test Floor Lamp");
  // The lights Nikita doesn't use aren't listed (#1002); plain by default: no Colour, no Place, no groups until Edit.
  await expect(panel).not.toContainText("Christmas Tree");
  await expect(panel.getByRole("button", { name: "Test Floor Lamp: colour and mood" })).toHaveCount(0);
  await expect(scenes).toContainText("All off");
  await expect(scenes).not.toContainText("Same-Model");
  await expect(panel).not.toContainText("Not on the map");
  const kitchen = panel.getByRole("button", { name: /^Kitchen, on/ });
  await expect(kitchen).toHaveAttribute("aria-pressed", "true");
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
  // Edit: a Govee light's colour, and the groups listed with the scenes, never as lights.
  await panel.getByRole("button", { name: /^Edit the lights/ }).click();
  await expect(scenes).toContainText("Same-Model");
  await panel.getByRole("button", { name: "Test Floor Lamp: colour and mood" }).click();
  await panel.getByRole("button", { name: "Test Floor Lamp: Violet" }).click();
  await expect.poll(() => posts.length).toBe(4);
  expect(posts[3]).toEqual({ op: "look", id: "a0000000000e", rgb: "#8a5bff" });
  await panel.getByRole("combobox", { name: "Test Floor Lamp: mood" }).selectOption("Aurora");
  await expect.poll(() => posts.length).toBe(5);
  expect(posts[4]).toEqual({ op: "look", id: "a0000000000e", mood: "Aurora" });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/haven-974-panel.png` });
  const house = page.locator(".hv-house");
  if ((await house.getAttribute("data-gl")) !== "on") return;
  // Kitchen by its name, the floor lamp by its spot, and the uplight (a floor lamp with no spot and no room in its
  // name) in a corner by the bedroom dresser (#1060): three drawn, with no marker over any (#1020). Porch, and the
  // uplight's own spot, wait to be placed.
  await expect(house).toHaveAttribute("data-lights", "3");
  await expect(page.locator(".hv-bulb")).toHaveCount(0);
  await panel.getByRole("button", { name: "Place Test Uplight on the house" }).click();
  await expect(panel).toContainText("Tap where Test Uplight stands on the house.");
  const box = (await house.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);
  await expect.poll(() => posts.length).toBe(6);
  expect(posts[5]).toMatchObject({ action: "light", name: "Test Uplight", x: expect.any(Number), y: expect.any(Number) });
  // Still three: the uplight moves from the dresser's corner to where it was tapped.
  await expect(house).toHaveAttribute("data-lights", "3");
  await expect(panel.getByRole("button", { name: "Move Test Uplight on the house" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/haven-974-house.png` });
});

test("the off scene shows every room switch off at once, then reads them again fresh (#1020)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const posts: unknown[] = [], reads: string[] = [];
  let ran = false;
  const on = { ...VIEW, lights: VIEW.lights.map((l) => (l.vendor === "switchbot" ? { ...l, on: true } : l)) };
  const off = { ...VIEW, lights: VIEW.lights.map((l) => (l.vendor === "switchbot" ? { ...l, on: false } : l)) };
  // The vendor's state turns off only once read fresh after the scene, as SwitchBot's does.
  await stub(page, posts, (url) => {
    reads.push(url);
    return ran && url.endsWith("?fresh=1") ? off : on;
  });
  await page.goto(`${BASE}/haven`);
  const panel = page.getByRole("region", { name: "Lights" });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole("button", { name: /^Kitchen, on/ })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("button", { name: /^Porch, on/ })).toHaveAttribute("aria-pressed", "true");
  const house = page.locator(".hv-house");
  const gl = (await house.getAttribute("data-gl")) === "on";
  if (gl) await expect(house).toHaveAttribute("data-lights-on", "2");
  // The fresh read comes a few seconds after the scene: first let the rooms kept behind the Haven finish warming.
  await keptRoomsWarm(page);
  await panel.getByRole("button", { name: "All off" }).click();
  ran = true;
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ op: "scene", id: "a0000000000c" });
  // At once, before any read: both rooms off in the panel and on the house.
  await expect(panel.getByRole("button", { name: /^Kitchen, off/ })).toHaveAttribute("aria-pressed", "false", { timeout: 1_500 });
  await expect(panel.getByRole("button", { name: /^Porch, off/ })).toHaveAttribute("aria-pressed", "false", { timeout: 1_500 });
  if (gl) await expect(house).toHaveAttribute("data-lights-on", "1"); // the Govee floor lamp waits for its read
  // Then the real state, read fresh, agrees.
  await expect.poll(() => reads.some((u) => u.endsWith("?fresh=1")), { timeout: 6_000 }).toBe(true);
  await expect(panel.getByRole("button", { name: /^Kitchen, off/ })).toHaveAttribute("aria-pressed", "false");
});
