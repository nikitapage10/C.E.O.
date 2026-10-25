import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Skippy on Today (#224): the built site, with a signed-in session, the Foundry feed and /api/skippy stubbed in the
 * browser. Tapping his portrait opens the chat; a message gets his reply and his buttons; an "open" button moves the
 * Desk without sending anything. Signed out, the box is off with a sign-in hint.
 */

const PORT = Number(process.env.E2E_SKIPPY_PORT ?? 5185);
const BASE = `http://localhost:${PORT}`;
/** Where to save the screenshots, when set. */
const SHOTS = process.env.E2E_SHOTS ?? "";
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const FEED = { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] };
const REPLY = {
  reply: "Two things are building and Rivet has one question for you, monkey. Bask in my summary.",
  actions: [
    { kind: "open", label: "Open the Foundry", page: "foundry" },
    { kind: "idea", label: "File: podium in the Spire", text: "A podium in the Spire for the Executive's keynotes" },
    { kind: "merge", label: "Merge everything" },
  ],
};

async function stub(page: Page, signedIn: boolean): Promise<Record<string, unknown>[]> {
  const asked: Record<string, unknown>[] = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: FEED }));
  await page.route(`${BASE}/api/foundry`, (r) => r.fulfill({ json: { buttons: true, direct: true, shape: true, images: false } }));
  await page.route(`${BASE}/api/desk-auth`, (r) =>
    r.fulfill({ json: signedIn ? { ready: true, signedIn: true, until: Date.now() + 30 * 60_000, hardUntil: Date.now() + 8 * 3_600_000, device: "Test device", devices: [] } : { ready: true, signedIn: false } }),
  );
  await page.route(`${BASE}/api/skippy`, async (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: { ready: true } });
    asked.push(r.request().postDataJSON() as Record<string, unknown>);
    return r.fulfill({ json: REPLY });
  });
  return asked;
}

for (const width of [1280, 400]) {
  test(`Skippy answers on Today and routes with a tap (${width} wide)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 600 ? 860 : 820 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const asked = await stub(page, true);

    await page.goto(BASE + "/");
    await expect(page.locator(".today .desk__title")).toBeVisible();
    // Today's avatar went with the Confluence (#413); the bar's Ask Skippy opens the same dialogue on every page.
    await page.locator(".desk__skippy").click();
    const chat = page.getByRole("dialog", { name: "Skippy, the Magnificent" });
    await expect(chat).toBeVisible();

    const box = chat.getByRole("textbox", { name: "Message to Skippy" });
    await box.fill("What's going on?");
    await box.press("Enter");
    await expect(chat.getByText("Bask in my summary.")).toBeVisible();
    // The message goes with the page's own data for his quick take (#341), never with anything typed before.
    expect(asked).toEqual([{ message: "What's going on?", history: [], page: expect.stringMatching(/^Nikita is on the Desk's Today page\./) }]);
    // The unknown "merge" button is dropped in the browser too.
    await expect(chat.getByRole("button", { name: "Merge everything" })).toHaveCount(0);
    await expect(chat.getByRole("button", { name: /File: podium/ })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/skippy-chat-${width}.png` });

    await chat.getByRole("button", { name: "Open the Foundry" }).click();
    await expect(page).toHaveURL(`${BASE}/foundry`);
    expect(asked).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

test("signed out, Skippy's box is off with a sign-in hint", async ({ page }) => {
  await stub(page, false);
  await page.goto(BASE + "/");
  await page.locator(".desk__skippy").click();
  const chat = page.getByRole("dialog", { name: "Skippy, the Magnificent" });
  const box = chat.getByRole("textbox", { name: "Message to Skippy" });
  await expect(box).toBeDisabled();
  await expect(box).toHaveAttribute("placeholder", /Sign in/);
  await expect(chat.getByRole("button", { name: "Sign in" })).toBeVisible();
});
