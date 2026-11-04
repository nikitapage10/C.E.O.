import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Relay's Thread (#615), the Codex, on the built site, with a signed-in session and /api/email and /api/relay stubbed
 * in the browser. The queue is one scrolling codex; only the entry in focus answers voice and keys ("yes" only with
 * its draft on screen); a yes waits five seconds and Undo sends nothing; an email sends only with Gmail's send grant,
 * and otherwise offers Copy and Open in Gmail; the sender rules have Undo; Open the codex counts what waits; reduced
 * motion draws no sigils. Every person, mail and text here is made up.
 */

const PORT = Number(process.env.E2E_RELAY_PORT ?? 5187);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? "";
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const SAM = "0123456789abcdef";
const JORDAN = "1123456789abcdef";
const PRIYA = "18a1b2c3d4e5f601";
const SAM_DRAFT = "start without me! running 10 late, save me a seat";

/** A browser SpeechRecognition that hears whatever the test says (window.__say). */
const FAKE_SPEECH = () => {
  class Fake {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    start() {
      (window as unknown as { __rec: Fake | null }).__rec = this;
    }
    stop() {
      (window as unknown as { __rec: Fake | null }).__rec = null;
      this.onend?.();
    }
    abort() {
      this.stop();
    }
  }
  (window as unknown as Record<string, unknown>).SpeechRecognition = Fake;
  (window as unknown as { __say: (t: string) => boolean }).__say = (t: string) => {
    const r = (window as unknown as { __rec: Fake | null }).__rec;
    if (!r?.onresult) return false;
    const result = Object.assign([{ transcript: t }], { isFinal: true });
    r.onresult({ resultIndex: 0, results: [result] });
    return true;
  };
};

async function stub(page: Page, opts: { signedIn?: boolean; canSend?: boolean } = {}) {
  const signedIn = opts.signedIn ?? true;
  const posts: Record<string, unknown>[] = [];
  let samDraft: { text: string; at: number } | null = null;
  let requests: Record<string, unknown>[] = [];
  const now = Date.now();
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: signedIn ? { ready: true, signedIn: true, until: now + 30 * 60_000, hardUntil: now + 8 * 3_600_000, device: "Test device", devices: [] } : { ready: true, signedIn: false } }));
  const emailStatus = { v: 1, at: now, gmail: "connected", agent: "listening", needsYou: 1, fyi: 0, noise: 21, newToday: 30, unsorted: 0, skipped: 3, budgetPct: 4, lastCheck: now - 30_000 };
  let rules: Record<string, unknown>[] = [];
  await page.route(/\/api\/email(\?.*)?$/, async (r) => {
    const url = new URL(r.request().url());
    if (r.request().method() === "GET") {
      if (url.searchParams.get("view") === "status" || !signedIn) return r.fulfill({ json: { ok: true, status: emailStatus } });
      return r.fulfill({
        json: {
          ok: true,
          status: emailStatus,
          canConnect: true,
          canSend: opts.canSend === true,
          items: [{ id: PRIYA, at: now - 3_600_000, from: "Priya Madeup", subject: "Saturday hike, which trail?", kind: "needs-you", summary: "Priya asks which trail is kinder to a first-timer, the ridge loop or the lake.", action: "Reply with a pick", advice: "She wants a quick pick.", draft: "The lake one, easily. The ridge has a scramble near the top. N", done: false }],
          applied: 0,
          urgentSkipped: 0,
          spend: { usd: 0.42, budget: 10 },
          rules,
          ruled: 0,
          style: { traits: ["lowercase in texts", "one short paragraph", "signs emails as N"], from: 18, at: now - 86_400_000 },
        },
      });
    }
    const body = r.request().postDataJSON() as Record<string, unknown>;
    posts.push({ line: "email", ...body });
    if (body.action === "block" || body.action === "filter") {
      const rule = { id: "abcdefabcdef", kind: body.action, label: "Priya Madeup", at: Date.now() };
      rules = [rule];
      return r.fulfill({ json: { ok: true, rule } });
    }
    if (body.action === "unblock") {
      rules = [];
      return r.fulfill({ json: { ok: true } });
    }
    if (body.action === "send") return r.fulfill({ json: { ok: true, sentAt: Date.now() } });
    return r.fulfill({ json: { ok: true } });
  });
  const textsStatus = () => ({ v: 1, at: Date.now(), hub: "listening", messages: "up", models: "up", owed: 2, sooner: 1, overdue: 0, later: 0, settled: 4, draftsReady: 1, sentToday: 7, streakDays: 2, week: [], nextNudgeAt: null });
  await page.route(/\/api\/relay(\?.*)?$/, async (r) => {
    const url = new URL(r.request().url());
    if (r.request().method() === "GET") {
      if (url.searchParams.get("view") === "status" || !signedIn) return r.fulfill({ json: { ok: true, status: textsStatus() } });
      const texts = [
        { id: SAM, name: "Sam Test", channel: "iMessage", group: false, state: "owed", sort: "sooner", since: now - 4 * 60_000, laterUntil: null, gist: "Everyone's there already; they ask if they should start without you", draft: samDraft, summary: null },
        { id: JORDAN, name: "Jordan Test", channel: "iMessage", group: false, state: "owed", sort: "normal", since: now - 12 * 60_000, laterUntil: null, gist: "Says the meme you sent at 2am was too accurate", draft: { text: "haha right?? saw it and thought of you", at: now - 60_000 }, summary: null },
      ];
      return r.fulfill({ json: { ok: true, status: textsStatus(), ready: true, paired: true, pairedAt: now - 86_400_000, lastSeen: now, unlockedUntil: now + 3_600_000, texts, cards: [], textsAt: now, requests, spend: { usd: 0.03, budget: 10 } } });
    }
    const body = r.request().postDataJSON() as Record<string, unknown>;
    posts.push({ line: "texts", ...body });
    if (body.action === "restyle") samDraft = { text: SAM_DRAFT, at: Date.now() };
    if (body.action === "send") requests = [{ rid: "b".repeat(24), kind: "send", thread: body.thread, text: body.text, created: Date.now(), until: Date.now() + 600_000, state: "sent" }];
    return r.fulfill({ json: { ok: true, rid: "c".repeat(24), until: Date.now() + 600_000 } });
  });
  return posts;
}

const say = (page: Page, words: string) => page.evaluate((w) => (window as unknown as { __say: (t: string) => boolean }).__say(w), words);
const sends = (posts: Record<string, unknown>[]) => posts.filter((p) => p.action === "send");
const focused = (page: Page) => page.locator(".cx-entry[data-focus]");
const undoLine = (page: Page) => page.locator(".cx-undo");
/** Scrolls the codex's pages to the entry for `name`. */
const scrollTo = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = [...document.querySelectorAll<HTMLElement>(".cx-entry")].find((e) => e.textContent?.includes(n));
    const root = document.querySelector<HTMLElement>(".cx-pages");
    if (el && root) root.scrollTo({ top: el.offsetTop });
  }, name);

for (const width of [1440, 400]) {
  test(`the codex: words make a draft, yes waits out the undo, and only then sends (${width} wide)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width > 600 ? 900 : 860 });
    await page.addInitScript(FAKE_SPEECH);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const posts = await stub(page);
    await page.goto(`${BASE}/relay`);
    await expect(page.getByRole("region", { name: "Relay at a glance" })).toBeVisible();
    // Sooner first: Sam is in focus, written in from the spine.
    await expect(focused(page)).toContainText("Sam Test");
    await expect(focused(page).getByText(/should start without you/)).toBeVisible();
    await expect(page.locator(".cx-metrics")).toContainText("3waiting");
    await expect(page.locator(".cx-index")).toContainText("Priya");
    if (SHOTS) await page.waitForTimeout(3_000);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-focus-${width}.png` });

    // Listening is opt-in. With no draft on screen, "yes" is not a send, and Jordan's draft (not in focus) never goes.
    await page.getByRole("button", { name: "Listen hands-free" }).click();
    expect(await say(page, "yes")).toBe(true);
    await expect(undoLine(page)).toContainText("Nothing to send yet.");
    await page.keyboard.press("y");
    expect(sends(posts)).toEqual([]);

    // A few words become a draft in their voice (the Mac's Blasto, via restyle), and the passes tick.
    await say(page, "tell them I'll be 10 late");
    await expect.poll(() => posts.filter((p) => p.action === "restyle")).toEqual([{ line: "texts", action: "restyle", thread: SAM, text: "tell them I'll be 10 late" }]);
    await expect(focused(page).getByText(SAM_DRAFT)).toBeVisible({ timeout: 15_000 });
    await expect(focused(page).getByText("Send to Sam?")).toBeVisible();
    await expect(focused(page).locator(".cx-pass span[data-on]")).not.toHaveCount(0);
    if (SHOTS) await page.waitForTimeout(3_200);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-ask-${width}.png` });

    // Yes, then undo inside the five seconds: nothing is sent.
    await say(page, "send it");
    await expect(undoLine(page)).toContainText("Sending to Sam Test");
    await say(page, "undo");
    await expect(undoLine(page)).toContainText("Not sent.");
    await page.waitForTimeout(5_600);
    expect(sends(posts)).toEqual([]);

    // Y on the keyboard: sealed, and the send goes only after the window, bound to the draft on screen.
    await page.keyboard.press("y");
    await expect(undoLine(page)).toContainText("Sending to Sam Test");
    await expect(focused(page)).toContainText("Sealed");
    if (SHOTS) await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-seal-${width}.png` });
    await page.waitForTimeout(1_500);
    expect(sends(posts)).toEqual([]);
    await expect.poll(() => sends(posts), { timeout: 8_000 }).toEqual([{ line: "texts", action: "send", thread: SAM, draftAt: expect.any(Number), text: SAM_DRAFT }]);
    // Sam leaves the codex; the next entry takes focus.
    await expect(page.locator(".cx-entry", { hasText: "Sam Test" })).toHaveCount(0);
    await expect(focused(page)).toHaveCount(1);
    await expect(page.locator(".cx-index")).toContainText("Sent today");
    expect(errors).toEqual([]);
  });

  test(`scrolling moves the focus, and keys act only on the entry in focus (${width} wide)`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: width > 600 ? 900 : 860 });
    const posts = await stub(page);
    await page.goto(`${BASE}/relay`);
    await expect(focused(page)).toContainText("Sam Test");
    // Half way between two entries: nothing changes focus yet.
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".cx-pages")!;
      root.scrollTo({ top: root.clientHeight * 0.45 });
    });
    if (SHOTS) await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-scroll-${width}.png` });
    await scrollTo(page, "Jordan Test");
    await expect(focused(page)).toContainText("Jordan Test");
    await expect(focused(page).getByText("Send to Jordan?")).toBeVisible();
    // J and K move through the codex.
    await page.keyboard.press("k");
    await expect(focused(page)).toContainText("Priya Madeup");
    await page.keyboard.press("j");
    await expect(focused(page)).toContainText("Jordan Test");
    await page.keyboard.press("y");
    await expect(undoLine(page)).toContainText("Sending to Jordan Test");
    await page.keyboard.press("z");
    await expect(undoLine(page)).toContainText("Not sent.");
    await page.waitForTimeout(5_400);
    expect(sends(posts)).toEqual([]);
  });
}

test("email sends from the codex once Gmail grants send: after the undo, the draft on screen, once", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(FAKE_SPEECH);
  const posts = await stub(page, { canSend: true });
  await page.goto(`${BASE}/relay`);
  await page.locator(".cx-index").getByRole("button", { name: /Priya/ }).click();
  await expect(focused(page)).toContainText("Saturday hike, which trail?");
  await expect(focused(page).getByText("Send to Priya?")).toBeVisible();
  await focused(page).getByRole("button", { name: /^Yes/ }).click();
  await expect(undoLine(page)).toContainText("Sending to Priya Madeup");
  await page.waitForTimeout(3_000);
  expect(sends(posts)).toEqual([]);
  await expect.poll(() => sends(posts), { timeout: 6_000 }).toEqual([{ line: "email", action: "send", id: PRIYA, draft: "The lake one, easily. The ridge has a scramble near the top. N" }]);
  await expect(undoLine(page)).toContainText("Sent to Priya Madeup");
  await page.waitForTimeout(1_000);
  expect(sends(posts)).toHaveLength(1);
});

test("email without the send grant: Copy, Open in Gmail and a quiet reconnect; filter and block come with Undo", async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
  const posts = await stub(page);
  await page.goto(`${BASE}/relay`);
  await page.locator(".cx-index").getByRole("button", { name: /Priya/ }).click();
  await expect(focused(page)).toContainText("Saturday hike, which trail?");
  await expect(focused(page).getByText("Send it from Gmail?")).toBeVisible();
  await expect(focused(page).getByRole("button", { name: "Copy" })).toBeVisible();
  await expect(focused(page).getByRole("link", { name: "Open in Gmail" }).first()).toBeVisible();
  await expect(focused(page).getByRole("button", { name: "Reconnect Gmail to send from here" })).toBeVisible();
  await expect(focused(page).getByRole("button", { name: /^Yes/ })).toHaveCount(0);
  await page.keyboard.press("y");
  await page.getByRole("button", { name: "Listen hands-free" }).click();
  await say(page, "yes");
  expect(sends(posts)).toEqual([]);

  await say(page, "block this sender");
  await expect(undoLine(page)).toContainText("Blocked Priya Madeup.");
  expect(posts.filter((p) => p.action === "block")).toEqual([{ line: "email", action: "block", id: PRIYA }]);
  await undoLine(page).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => posts.filter((p) => p.action === "unblock")).toEqual([{ line: "email", action: "unblock", rule: "abcdefabcdef" }]);
});

for (const width of [1440, 400]) {
  test(`Open the codex: pending by line, waiting longest, high priority (${width} wide)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 860 });
    await stub(page);
    await page.goto(`${BASE}/relay`);
    await page.getByRole("link", { name: /Open the codex/ }).click();
    const codex = page.getByRole("region", { name: "The codex" });
    await expect(codex.locator(".cx-counts")).toContainText("3waiting on you");
    await expect(codex.locator(".cx-counts")).toContainText("2texts");
    await expect(codex.locator(".cx-counts")).toContainText("1email");
    const longest = codex.locator(".cx-sec", { hasText: "Waiting longest" }).locator("li");
    await expect(longest.first()).toContainText("Priya Madeup");
    await expect(longest.first()).toContainText("1 h");
    const high = codex.locator(".cx-sec", { hasText: "High priority" });
    await expect(high.locator("li", { hasText: "Sam Test" })).toContainText("sooner");
    await expect(high.locator("li", { hasText: "Priya Madeup" })).toContainText("needs you");
    await expect(high.locator("li", { hasText: "Jordan Test" })).toHaveCount(0);
    await expect(codex).toContainText("How you write");
    await expect(codex).toContainText("Filter rules");
    if (SHOTS) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/615-codex-${width}.png` });
      await page.screenshot({ path: `${SHOTS}/615-codex-full-${width}.png`, fullPage: true });
    }
    // A row puts that exchange in focus, back up in the codex.
    await high.locator("li", { hasText: "Priya Madeup" }).getByRole("button").click();
    await expect(focused(page)).toContainText("Priya Madeup");
  });
}

test("reduced motion draws no sigils and shows the words at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stub(page);
  await page.goto(`${BASE}/relay`);
  await expect(focused(page).getByText(/should start without you/)).toBeVisible();
  await expect(page.locator(".sg-cv")).toHaveCount(0);
  await expect(page.locator("[data-sg-ghost]")).toHaveCount(0);
});

test("with motion, the words are written in on a capped canvas", async ({ page }) => {
  await stub(page);
  await page.goto(`${BASE}/relay`);
  await expect(page.locator(".sg-cv")).toHaveCount(1);
  const live = await page.evaluate(() => (window as unknown as { __relaySigils: { live: number } }).__relaySigils.live);
  expect(live).toBeLessThanOrEqual(1600);
  await expect(focused(page).locator(".cx-msg[data-sg-ghost]")).toHaveCount(0, { timeout: 8_000 });
});

test("signed out: counts only, never a name", async ({ page }) => {
  await stub(page, { signedIn: false });
  await page.goto(`${BASE}/relay`);
  await expect(page.getByText("3 waiting on you.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByText("Sam Test")).toHaveCount(0);
  await expect(page.getByText("Priya Madeup")).toHaveCount(0);
});
