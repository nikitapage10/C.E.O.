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

test("Talk has no site budget: it shows the plan's credits left, and falls back to typing with ElevenLabs' own note when they are used up (#532)", async ({ page }) => {
  await stub(page, true);
  // A stand-in microphone, so the call gets past the browser's prompt in a headless run.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  });
  let starts = 0;
  await page.route(`${BASE}/api/skippy-voice`, (r) => {
    if (r.request().method() === "POST") {
      starts++;
      return r.fulfill({ status: 502, json: { error: "quota" } });
    }
    return r.fulfill({ json: { ready: true, credits: { used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" } } });
  });
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Ask Skippy", exact: true }).first().click();
  const chat = page.getByRole("dialog", { name: "Skippy, the Magnificent" });
  // No talk minutes or budget block; only the plan's own credits.
  await expect(chat.getByText("Creator plan: 21,743 credits left of 122,113 · resets Nov 5")).toBeVisible();
  await expect(chat.getByText(/talk min|share|cap/)).toHaveCount(0);
  const talk = chat.getByRole("button", { name: /live voice call/ });
  await expect(talk).toBeEnabled();
  await talk.click();
  await expect(chat.getByText(/ElevenLabs credits used up/).first()).toBeVisible();
  // Typing still works, and Talk can be tried again (the plan may have refilled).
  await expect(chat.getByRole("textbox", { name: "Message to Skippy" })).toBeEnabled();
  await expect(chat.getByRole("button", { name: /live voice call/ })).toBeEnabled();
  expect(starts).toBe(1);
});

/** A stand-in for the ElevenLabs call (talkSession.ts's chunk): the test drives it from window.__holoCall. */
const FAKE_CALL = `export async function openCall(h) {
  window.__holoCall = h;
  return { level: () => window.__holoLevel ?? 0, mute: (m) => { window.__holoMuted = m; }, end: async () => {} };
}`;

async function startCall(page: Page) {
  await stub(page, true);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  });
  await page.route(`${BASE}/api/skippy-voice`, (r) =>
    r.fulfill({ json: r.request().method() === "POST" ? { ok: true, token: "t", conversation: "", desk: "", crew: { agent_turf01: "turf", agent_soot01: "soot" } } : { ready: true } }),
  );
  await page.route(/\/assets\/talkSession-[\w-]+\.js$/, (r) => r.fulfill({ contentType: "text/javascript", body: FAKE_CALL }));
  const asked: string[] = [];
  page.on("request", (r) => asked.push(r.url()));
  return asked;
}

test("Talk projects Skippy as a hologram, and nothing of it loads before the tap (#481)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const asked = await startCall(page);
  await page.goto(BASE + "/");
  await expect(page.locator(".today .desk__title")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(asked.filter((u) => /holoScene|HologramStage|Skippy\.[\w]+\.glb/.test(u))).toEqual([]);

  await page.locator(".desk__skippy").click();
  const chat = page.getByRole("dialog", { name: "Skippy, the Magnificent" });
  await chat.getByRole("button", { name: /live voice call/ }).click();
  const call = page.getByRole("region", { name: "Call with Skippy, the Magnificent" });
  await expect(call).toBeVisible();
  // He boots up over the chat box and rises from its foot to take it over, his words and pill beside it on the left (#538).
  await expect(call).toHaveClass(/holo--dock/);
  const offDock = async () => {
    const fig = await call.locator(".holo__fig").boundingBox();
    const dockBox = await chat.boundingBox();
    return fig && dockBox ? Math.max(Math.abs(fig.y + fig.height - (dockBox.y + dockBox.height)), Math.abs(fig.x + fig.width / 2 - (dockBox.x + dockBox.width / 2))) : 999;
  };
  await expect.poll(offDock).toBeLessThan(8);
  const panel = await call.locator(".holo__panel").boundingBox();
  const dockBox = await chat.boundingBox();
  expect(panel && dockBox && Math.abs(panel.x - dockBox.x) < 2 && Math.abs(panel.width - dockBox.width) < 2).toBe(true);
  const pillBox = await call.locator(".holo__pill").boundingBox();
  expect(pillBox && dockBox && pillBox.x + pillBox.width <= dockBox.x).toBe(true);
  await page.waitForFunction(() => Boolean((window as { __holoCall?: unknown }).__holoCall));
  await page.evaluate(() => {
    const h = (window as unknown as { __holoCall: { onMode: (m: string) => void; onMessage: (w: string, t: string) => void } }).__holoCall;
    (window as { __holoLevel?: number }).__holoLevel = 0.6;
    h.onMode("speaking");
    h.onMessage("skippy", "[laughs] Monkey, it was always fast. [smug] You were slow.");
  });
  await expect(call.getByText("“Monkey, it was always fast. You were slow.”")).toBeVisible();
  // The audio tags stay out of the transcript too (#490).
  await expect(chat.getByText("Monkey, it was always fast. You were slow.", { exact: true })).toBeVisible();
  await expect(chat.getByText(/\[smug\]|\[laughs\]/)).toHaveCount(0);
  await expect(call).toHaveAttribute("data-expr", "laughing");
  await expect(call.getByText("Live", { exact: true })).toBeVisible();
  await call.getByRole("button", { name: "Mute your microphone" }).click();
  expect(await page.evaluate(() => (window as { __holoMuted?: boolean }).__holoMuted)).toBe(true);
  await expect(page.locator(".holo--ready")).toBeVisible({ timeout: 90_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hologram-today.png` });

  // A submind takes the mic (#479's transfer): the hologram becomes its can, and Skippy's own agent brings him back.
  // The glitch class lasts SWAP_MS (0.9 s), shorter than a few assertions take on a busy CI runner, so it is caught
  // as it happens by an observer armed before the swap, never polled for after it.
  const sawSwitch = page.evaluate(
    () =>
      new Promise<boolean>((done) => {
        const seen = () => Boolean(document.querySelector(".holo.holo--switch"));
        const watch = new MutationObserver(() => seen() && (watch.disconnect(), done(true)));
        watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
        setTimeout(() => (watch.disconnect(), done(seen())), 15_000);
      }),
  );
  await page.evaluate(() => (window as unknown as { __holoCall: { onAgent: (a: string) => void } }).__holoCall.onAgent("agent_turf01"));
  // The switch is unmistakable (#490): the whole projection in the Green's colour, the label renamed, a glitch.
  const sub = page.getByRole("region", { name: "Call with Skippy, the Commentator" });
  await expect(sub).toBeVisible();
  await expect(sub).toHaveAttribute("data-speaker", "green");
  expect(await sawSwitch).toBe(true);
  await expect(sub.locator(".holo__name")).toHaveText("Skippy, the Commentator");
  expect(await sub.evaluate((el) => getComputedStyle(el).getPropertyValue("--holo").trim().toLowerCase())).toBe("#a3e04f");
  // ...and its own persona: the Commentator grins all the time.
  await page.evaluate(() => (window as unknown as { __holoCall: { onMessage: (w: string, t: string) => void } }).__holoCall.onMessage("skippy", "[fast] THE COMMENTATOR, live from the floating booth, folks!"));
  await expect(sub).toHaveAttribute("data-face", "grin");
  await expect(sub).not.toHaveClass(/holo--switch/);
  await page.waitForTimeout(600);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hologram-commentator.png` });
  // The Pessimist: grey, unimpressed.
  await page.evaluate(() => (window as unknown as { __holoCall: { onAgent: (a: string) => void } }).__holoCall.onAgent("agent_soot01"));
  const soot = page.getByRole("region", { name: "Call with Skippy, the Pessimist" });
  await page.evaluate(() => (window as unknown as { __holoCall: { onMessage: (w: string, t: string) => void } }).__holoCall.onMessage("skippy", "[slow] The Pessimist. Something's leaking. Let's see what."));
  await expect(soot).toHaveAttribute("data-face", "unimpressed");
  await expect(soot.locator(".holo__name")).toHaveText("Skippy, the Pessimist");
  await expect(soot).not.toHaveClass(/holo--switch/);
  await page.waitForTimeout(600);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hologram-pessimist.png` });
  await page.evaluate(() => (window as unknown as { __holoCall: { onAgent: (a: string) => void } }).__holoCall.onAgent("agent_skippy1"));
  await expect(call).toBeVisible();
  await expect(call).toHaveAttribute("data-speaker", "skippy");
  await expect(call).toHaveAttribute("data-face", "smug");

  // On End he sinks back down into the box, and then the chat is back.
  // Caught by an observer armed before the tap, like the switch above: the sink is shorter than a busy runner's poll.
  const sawSink = page.evaluate(
    () =>
      new Promise<boolean>((done) => {
        const seen = () => Boolean(document.querySelector(".holo.holo--leaving"));
        const watch = new MutationObserver(() => seen() && (watch.disconnect(), done(true)));
        watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
        setTimeout(() => (watch.disconnect(), done(seen())), 15_000);
      }),
  );
  await call.getByRole("button", { name: "End the call" }).click();
  expect(await sawSink).toBe(true);
  await expect(call).toHaveCount(0);
  await expect(page.locator(".holo")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("on a phone the hologram takes the sheet over with the pill above it, in reach (#481, #538)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startCall(page);
  await page.goto(BASE + "/foundry");
  await page.locator(".desk__skippy").click();
  const chat = page.getByRole("dialog", { name: "Skippy, the Magnificent" });
  await chat.getByRole("button", { name: /live voice call/ }).click();
  const call = page.getByRole("region", { name: "Call with Skippy, the Magnificent" });
  await expect(call).toHaveClass(/holo--phone/);
  await page.waitForTimeout(1000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hologram-phone.png` });
  const end = call.getByRole("button", { name: "End the call" });
  const pill = await end.boundingBox();
  const dock = await chat.boundingBox();
  expect(pill && dock && pill.y + pill.height <= dock.y).toBe(true);
  expect(pill && pill.x >= 0 && pill.x + pill.width <= 390).toBe(true);
  await end.click();
  await expect(call).toHaveCount(0);
});
