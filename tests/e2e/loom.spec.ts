import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * The forge shows every job in flight (#337, #432): with the Foundry feed stubbed to six jobs working, the Desk's
 * Foundry stage gives four of them a lane each (the crew's cap), named for whoever has hands on it, and counts the rest
 * on "+2 more in hand". A lane opened from the canvas's labels shows its stage and its pull request; no two lanes'
 * labels overlap.
 */

const PORT = Number(process.env.E2E_LOOM_PORT ?? 5184);
const BASE = `http://localhost:${PORT}`;
/** Where to save the screenshots, when set (the Foundry's Pictures step). */
const SHOTS = process.env.E2E_SHOTS ?? "";
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const issue = (number: number, title: string, labels: string[], at: string, builder: string) => ({
  number,
  title,
  state: "open",
  html_url: `https://github.com/nikitapage10/C.E.O./issues/${number}`,
  created_at: minsAgo(240),
  updated_at: at,
  closed_at: null,
  body: `**Pitch:** ${title}.\n**Size:** small\n**Builder:** ${builder}`,
  labels: labels.map((name) => ({ name })),
});

const CHAT = ["foundry", "foundry:chat", "foundry:working"];
const FEED = {
  issues: [
    issue(61, "The loom shows every job in flight", CHAT, minsAgo(2), "Rusty (Opus)"),
    issue(62, "Brighter idea cards on the bench", CHAT, minsAgo(9), "Rusty (Sonnet)"),
    issue(63, "A new skyline for the Spire", CHAT, minsAgo(15), "Rocky (Opus)"),
    issue(64, "Bump the test runner", ["foundry", "foundry:upkeep", "foundry:working"], minsAgo(20), "Rivet (Sonnet)"),
    issue(65, "Faster room tour", CHAT, minsAgo(30), "Rusty (Sonnet)"),
    issue(66, "Quieter pings at night", CHAT, minsAgo(40), "Rusty (Sonnet)"),
    issue(70, "Idea: A lantern walk through the Archive", ["foundry", "foundry:idea"], minsAgo(60), "Rocky (Opus)"),
    issue(71, "Idea: Rivet's lens on the Systems page", ["foundry", "foundry:idea"], minsAgo(70), "Rusty (Sonnet)"),
    { ...issue(55, "Room tour tag colours for the tenth room", ["foundry", "foundry:chat", "foundry:shipped"], minsAgo(50), "Rusty (Sonnet)"), state: "closed", closed_at: minsAgo(50) },
  ],
  runs: { workflow_runs: [] },
  e2e: { workflow_runs: [] },
  pulls: [],
  commits: [],
  open: [{ number: 90, html_url: "https://github.com/nikitapage10/C.E.O./pull/90", created_at: minsAgo(5), draft: false, issue: 61, checks: "running" }],
};

async function stub(page: Page) {
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: FEED }));
}

type Box = { x: number; y: number; width: number; height: number };
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [name, size] of [
  ["wide", { width: 1440, height: 1000 }],
  ["phone", { width: 390, height: 900 }],
] as const) {
  test(`the forge gives every job in flight a lane (${name})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(size);
    await stub(page);
    await page.goto(BASE + "/foundry");
    const stage = page.locator(".fo-stage");
    await expect(stage).toBeVisible();
    // Four lanes, the cap, and the rest on one row.
    const lanes = stage.locator(".fo-lane[data-stage]");
    await expect(lanes).toHaveCount(4);
    await expect(stage.locator(".fo-more")).toContainText("+2 more in hand");
    // The ideas wait on the bench, each with a thread.
    await expect(stage.locator("[data-fo-idea]")).toHaveCount(2);
    // The job with a pull request open and checks running says so.
    await expect(stage.locator(".fo-lane", { hasText: "The loom shows every job in flight" }).locator(".fo-pill")).toHaveText("checks running");
    await page.waitForTimeout(800);

    const labels = await lanes.locator(".fo-lane-h").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y + 4, width: r.width, height: r.height - 8, text: e.textContent ?? "" };
      }),
    );
    if (SHOTS) await stage.screenshot({ path: `${SHOTS}/forge-${name}.png` });
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) expect(meets(labels[i]!, labels[j]!), `"${labels[i]!.text}" overlaps "${labels[j]!.text}"`).toBe(false);

    // A lane opens to its stage and its pull request, and closes again.
    const loom = stage.locator(".fo-lane", { hasText: "The loom shows every job in flight" });
    await loom.locator(".fo-lane-h").click();
    await expect(loom.locator(".fo-steps .is-now")).toHaveText("Checks");
    await expect(loom.getByRole("link", { name: "Pull request #90" })).toBeVisible();
    if (SHOTS) await stage.screenshot({ path: `${SHOTS}/forge-${name}-open.png` });
    await loom.locator(".fo-lane-h").click();
    await expect(loom.locator(".fo-lane-x")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
