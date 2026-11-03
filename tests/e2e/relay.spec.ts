import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Relay's Thread (#615) on the built site, with a signed-in session and /api/email and /api/relay stubbed in the
 * browser. One exchange at a time; voice commands only work in their state ("yes" only with a draft on screen); a
 * yes waits five seconds and Undo sends nothing; the sender rules have Undo; reduced motion draws no sigils.
 * Every person, mail and text here is made up.
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

async function stub(page: Page, opts: { signedIn?: boolean } = {}) {
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

for (const width of [1440, 400]) {
  test(`one exchange at a time: words make a draft, yes waits out the undo, and only then sends (${width} wide)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width > 600 ? 900 : 860 });
    await page.addInitScript(FAKE_SPEECH);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const posts = await stub(page);
    await page.goto(`${BASE}/relay`);
    const stage = page.getByRole("region", { name: "Relay at a glance" });
    const conv = stage.locator(".rt-conv");
    await expect(conv.getByText("Sam Test")).toBeVisible();
    await expect(conv.getByText(/should start without you/)).toBeVisible();
    await expect(page.locator(".rt-metrics")).toContainText("3waiting");
    if (SHOTS) await page.waitForTimeout(1_600);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-incoming-${width}.png` });

    // Listening is opt-in. With no draft on screen, "yes" is not a send.
    await page.getByRole("button", { name: "Listen hands-free" }).click();
    expect(await say(page, "yes")).toBe(true);
    await expect(page.getByText("Nothing to send yet.")).toBeVisible();
    expect(sends(posts)).toEqual([]);

    // A few words become a draft in his voice (the Mac's Blasto, via restyle).
    await say(page, "tell them I'll be 10 late");
    await expect.poll(() => posts.filter((p) => p.action === "restyle")).toEqual([{ line: "texts", action: "restyle", thread: SAM, text: "tell them I'll be 10 late" }]);
    await expect(conv.getByText(SAM_DRAFT)).toBeVisible({ timeout: 15_000 });
    await expect(conv.getByText("Send to Sam?")).toBeVisible();
    if (SHOTS) await page.waitForTimeout(1_600);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-ask-${width}.png` });

    // Yes, then undo inside the five seconds: nothing is sent.
    await say(page, "send it");
    await expect(page.locator(".rt-toast")).toContainText("Sending to Sam Test");
    await say(page, "undo");
    await expect(page.locator(".rt-toast")).toContainText("Not sent.");
    await page.waitForTimeout(5_600);
    expect(sends(posts)).toEqual([]);

    // Y on the keyboard: the send goes only after the window, bound to the draft on screen.
    await page.keyboard.press("y");
    await expect(page.locator(".rt-toast")).toContainText("Sending to Sam Test");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-undo-${width}.png` });
    await page.waitForTimeout(2_000);
    expect(sends(posts)).toEqual([]);
    await expect.poll(() => sends(posts), { timeout: 8_000 }).toEqual([{ line: "texts", action: "send", thread: SAM, draftAt: expect.any(Number), text: SAM_DRAFT }]);
    // The next one is already up.
    await expect(conv.getByText("Priya Madeup").first()).toBeVisible();
    await expect(conv.getByText("Saturday hike, which trail?")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("email is read-only: no send, but filter and block each come with Undo", async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
  const posts = await stub(page);
  await page.goto(`${BASE}/relay`);
  await page.getByRole("listitem").filter({ hasText: "Priya Madeup" }).first().getByRole("button").click();
  const conv = page.locator(".rt-conv");
  await expect(conv.getByText("Saturday hike, which trail?")).toBeVisible();
  await expect(conv.getByText("Email sends from Gmail for now.")).toBeVisible();
  await expect(conv.getByRole("button", { name: /^Yes/ })).toHaveCount(0);
  await page.keyboard.press("y");
  await page.getByRole("button", { name: "Listen hands-free" }).click();
  await say(page, "yes");
  expect(sends(posts)).toEqual([]);

  await say(page, "block this sender");
  await expect(page.locator(".rt-toast")).toContainText("Blocked Priya Madeup.");
  expect(posts.filter((p) => p.action === "block")).toEqual([{ line: "email", action: "block", id: PRIYA }]);
  await page.locator(".rt-toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => posts.filter((p) => p.action === "unblock")).toEqual([{ line: "email", action: "unblock", rule: "abcdefabcdef" }]);
  if (SHOTS) {
    await page.locator("#rt-all").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/615-everything-1440.png`, fullPage: true });
  }
});

test("reduced motion draws no sigils and shows the words at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stub(page);
  await page.goto(`${BASE}/relay`);
  await expect(page.locator(".rt-conv").getByText(/should start without you/)).toBeVisible();
  await expect(page.locator(".sg-cv")).toHaveCount(0);
  await expect(page.locator(".sg-ghost")).toHaveCount(0);
});

test("with motion, the words form out of sigils on a capped canvas", async ({ page }) => {
  await stub(page);
  await page.goto(`${BASE}/relay`);
  await expect(page.locator(".sg-cv")).toHaveCount(1);
  const live = await page.evaluate(() => (window as unknown as { __relaySigils: { live: number } }).__relaySigils.live);
  expect(live).toBeLessThanOrEqual(1600);
  await expect(page.locator(".rt-body .sg-ghost, .rt-body.sg-ghost")).toHaveCount(0, { timeout: 5_000 });
});

test("signed out: counts only, never a name", async ({ page }) => {
  await stub(page, { signedIn: false });
  await page.goto(`${BASE}/relay`);
  await expect(page.getByText("3 waiting on you.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByText("Sam Test")).toHaveCount(0);
  await expect(page.getByText("Priya Madeup")).toHaveCount(0);
});
