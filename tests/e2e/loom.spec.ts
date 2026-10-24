import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * The loom shows every job in flight (#337): with the Foundry feed stubbed to six jobs working, the Desk's Foundry
 * loom gives four of them a strand and a knot each, with their builder's face, and a "+2 more" knot for the rest.
 * No two labels overlap, and each knot opens its own details.
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
  test(`the loom gives every job in flight a knot (${name})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(size);
    await stub(page);
    await page.goto(BASE + "/foundry");
    const stage = page.locator(".wv-fstage .wv-stage");
    await expect(stage).toBeVisible();
    const rows = stage.locator(".wv-knot.is-row");
    await expect(rows).toHaveCount(5);
    // The ideas and the latest shipped keep their knots beside them.
    await expect(stage.locator(".wv-knot:not(.is-row)")).toHaveCount(3);
    // Four strands, each with its builder's face, and the rest on one knot.
    await expect(stage.locator(".wv-knot.is-row .wv-kav")).toHaveCount(4);
    await expect(stage.locator('.wv-knot[data-item="flights-more"]')).toContainText("+2 more");
    await page.waitForTimeout(800);

    const labels = await stage.locator(".wv-knot:not(.is-gone) .wv-kl").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, text: e.textContent ?? "" };
      }),
    );
    if (SHOTS) await stage.screenshot({ path: `${SHOTS}/loom-${name}.png` });
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) expect(meets(labels[i]!, labels[j]!), `"${labels[i]!.text}" overlaps "${labels[j]!.text}"`).toBe(false);

    // Each knot opens its own details.
    for (const [item, title] of [
      ["c61", "The loom shows every job in flight"],
      ["c63", "A new skyline for the Spire"],
      ["flights-more", "Two more jobs on the loom"],
    ] as const) {
      await stage.locator(`.wv-knot[data-item="${item}"]`).click();
      await expect(stage.locator(".wv-detail.is-open .wv-ttl")).toHaveText(title);
      if (SHOTS && item === "c63") await page.waitForTimeout(1500);
      if (SHOTS && item === "c63") await stage.screenshot({ path: `${SHOTS}/loom-${name}-open.png` });
      await page.keyboard.press("Escape");
      await expect(stage.locator(".wv-detail.is-open")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
