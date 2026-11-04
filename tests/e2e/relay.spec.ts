import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Relay's Thread (#615, simplified in #642), the Codex, on the built site, with a signed-in session and /api/email and
 * /api/relay stubbed in the browser. The queue is one scrolling codex; only the entry in focus answers voice and keys
 * ("yes" only with its draft on screen); an email's draft comes only on "Draft it", a text's ready draft on Reply; a
 * yes waits five seconds and Undo sends nothing; an email sends only with Gmail's send grant, and otherwise offers
 * Open in Gmail; Done, skip and "already did it" leave at once with Undo; words go through the intent layer; the sender
 * rules have Undo; the Codex is one line of numbers and two lists; reduced motion draws no sigils. Every person, mail
 * and text here is made up.
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
const PRIYA_DRAFT = "The lake one, easily. The ridge has a scramble near the top. N";

/** A browser SpeechRecognition that hears whatever the test says (window.__say). */
const FAKE_SPEECH = () => {
  class Fake {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    /** Whether this recogniser already heard a line: hands-free starts a fresh one for the next. */
    used = false;
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
    r.used = true;
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
  let priyaDraft: string | null = null;
  const closed = new Set<string>();
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
          items: [{ id: PRIYA, at: now - 3_600_000, from: "Priya Madeup", subject: "Saturday hike, which trail?", kind: "needs-you", summary: "Priya asks which trail is kinder to a first-timer, the ridge loop or the lake.", action: "Reply with a pick", advice: "She wants a quick pick.", ...(priyaDraft && { draft: priyaDraft }), done: closed.has(PRIYA) }],
          applied: 0,
          urgentSkipped: 0,
          spend: { usd: 0.42, budget: 10 },
          rules,
          sentWeek: 2,
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
    if (body.action === "done" || body.action === "skip") closed.add(String(body.id));
    if (body.action === "reply") {
      priyaDraft = PRIYA_DRAFT;
      return r.fulfill({ json: { ok: true, draft: PRIYA_DRAFT } });
    }
    // The intent layer (#642), as the server's Haiku would read these made-up lines.
    if (body.action === "intent") {
      const said = String(body.said);
      if (/invites can wait/i.test(said)) {
        const rule = { id: "abcdefabcde1", kind: "tier", label: "invites", at: Date.now(), match: "invites", to: "can-wait" };
        rules = [rule];
        return r.fulfill({ json: { ok: true, intent: { kind: "rule", match: "invites", to: "can-wait" }, rule, moved: 0 } });
      }
      return r.fulfill({ json: { ok: true, intent: { kind: "reply", words: said } } });
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

/**
 * Says words to the Desk's room mic in hands-free (#638, the one listener): waits until it is listening again, then
 * hears them. On /relay they reach the Thread through the room's `voice` hook (rooms/relay/voice.ts).
 */
const say = async (page: Page, words: string) => {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __rec: { used: boolean } | null }).__rec?.used === false), { timeout: 15_000 }).toBe(true);
  return page.evaluate((w) => (window as unknown as { __say: (t: string) => boolean }).__say(w), words);
};
/**
 * Hands-free is switched in the Boiler Room's Settings since the Iris (#666): turn it on there, then walk into Relay
 * from the bar (the switch holds page to page, and the bar shows it while it listens).
 */
const relayHandsFree = async (page: Page) => {
  await page.goto(`${BASE}/boiler/controls`);
  await page.locator("#ct-settings").getByRole("button", { name: "Hands-free" }).click();
  await expect(page.locator(".wv-navr").getByRole("button", { name: /Listening|Hands-free/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Desk" }).getByRole("link", { name: "Relay" }).click();
  await expect(page.getByRole("region", { name: "Relay at a glance" })).toBeVisible();
};
/** Hands-free on from Settings, then back in Relay with `name` in focus (the walk round reorders who arrives first). */
const handsFreeOn = async (page: Page, name: string) => {
  await relayHandsFree(page);
  await expect(page.locator(".cx-entry", { hasText: name })).toHaveCount(1);
  await scrollTo(page, name);
  await expect(page.locator(".cx-entry[data-focus]")).toContainText(name);
};
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
    await expect(page.locator(".cx-count")).toContainText("3 waiting");
    // A text's ready draft stays folded until Reply.
    await expect(focused(page).locator(".cx-draft")).toHaveCount(0);
    if (SHOTS) await page.waitForTimeout(3_000);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-focus-${width}.png` });

    // Listening is opt-in, switched in the Boiler Room's Settings (#666). With no draft on screen, "yes" is not a
    // send, and Jordan's draft (not in focus) never goes.
    await handsFreeOn(page, "Sam Test");
    expect(await say(page, "yes")).toBe(true);
    await expect(undoLine(page)).toContainText("Nothing to send yet.");
    await page.keyboard.press("y");
    expect(sends(posts)).toEqual([]);

    // A few words go through the intent layer (a reply) and become a draft in their voice (the Mac's Blasto, restyle).
    await say(page, "tell them I'll be 10 late");
    await expect.poll(() => posts.filter((p) => p.action === "intent")).toEqual([{ line: "email", action: "intent", key: `t:${SAM}`, said: "tell them I'll be 10 late" }]);
    await expect.poll(() => posts.filter((p) => p.action === "restyle")).toEqual([{ line: "texts", action: "restyle", thread: SAM, text: "tell them I'll be 10 late" }]);
    await expect(focused(page).getByText(SAM_DRAFT)).toBeVisible({ timeout: 15_000 });
    await expect(focused(page).getByText("Send to Sam?")).toBeVisible();
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
    await expect(focused(page).getByText("Send to Jordan?")).toHaveCount(0);
    // R opens the ready draft.
    await page.keyboard.press("r");
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
  await page.locator(".cx-rows button", { hasText: "Priya Madeup" }).click();
  await expect(focused(page)).toContainText("which trail is kinder");
  // Blasto's advice, and no draft until asked for: Draft it is one Sonnet call from the advice.
  await expect(focused(page).locator(".cx-adv")).toContainText("She wants a quick pick.");
  await expect(focused(page).locator(".cx-draft")).toHaveCount(0);
  await focused(page).getByRole("button", { name: /^Draft it/ }).click();
  await expect.poll(() => posts.filter((p) => p.action === "reply")).toEqual([{ line: "email", action: "reply", id: PRIYA, said: "" }]);
  await expect(focused(page).getByText("Send to Priya?")).toBeVisible();
  await focused(page).getByRole("button", { name: /^Send/ }).click();
  await expect(undoLine(page)).toContainText("Sending to Priya Madeup");
  await page.waitForTimeout(3_000);
  expect(sends(posts)).toEqual([]);
  await expect.poll(() => sends(posts), { timeout: 6_000 }).toEqual([{ line: "email", action: "send", id: PRIYA, draft: PRIYA_DRAFT }]);
  await expect(undoLine(page)).toContainText("Sent to Priya Madeup");
  await page.waitForTimeout(1_000);
  expect(sends(posts)).toHaveLength(1);
});

test("email without the send grant: Open in Gmail, Copy and a quiet reconnect; filter and block come with Undo", async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
  const posts = await stub(page);
  await relayHandsFree(page);
  await page.locator(".cx-rows button", { hasText: "Priya Madeup" }).click();
  await expect(focused(page)).toContainText("which trail is kinder");
  await page.keyboard.press("r");
  await expect(focused(page).getByText("Send it from Gmail?")).toBeVisible();
  await expect(focused(page).getByRole("link", { name: "Open in Gmail" }).first()).toBeVisible();
  await expect(focused(page).getByRole("button", { name: "Reconnect Gmail to send from here" })).toBeVisible();
  await expect(focused(page).getByRole("button", { name: /^Send/ })).toHaveCount(0);
  // Copy sits in "…", with Skip, Filter, Block and Open in Gmail.
  const more = focused(page).locator(".cx-more");
  await expect(async () => {
    if (!(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator("summary").click();
    await expect(more.getByRole("menuitem", { name: "Copy the draft" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 6_000 });
  await expect(more.getByRole("menuitem", { name: "Block this sender" })).toBeVisible();
  await more.locator("summary").click();
  await page.keyboard.press("y");
  await say(page, "yes");
  expect(sends(posts)).toEqual([]);

  await say(page, "block this sender");
  await expect(undoLine(page)).toContainText("Blocked Priya Madeup.");
  expect(posts.filter((p) => p.action === "block")).toEqual([{ line: "email", action: "block", id: PRIYA }]);
  await undoLine(page).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => posts.filter((p) => p.action === "unblock")).toEqual([{ line: "email", action: "unblock", rule: "abcdefabcdef" }]);
});

for (const width of [1440, 400]) {
  test(`the Codex: one line of numbers, Email and Texts oldest first, the rest behind Settings (${width} wide)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 860 });
    await stub(page);
    await page.goto(`${BASE}/relay`);
    await page.getByRole("link", { name: /Codex/ }).click();
    const codex = page.getByRole("region", { name: "The codex" });
    await expect(codex.locator(".cx-line")).toContainText("3 waiting");
    await expect(codex.locator(".cx-line")).toContainText("oldest 1 h");
    await expect(codex.locator(".cx-line")).toContainText("2 sent this week");
    await expect(codex.locator(".cx-line")).toContainText("28 filtered");
    const email = codex.locator('.cx-sec[data-list="email"]').locator("li");
    await expect(email).toHaveCount(1);
    await expect(email.first()).toContainText("Priya Madeup");
    await expect(email.first()).toContainText("1 h");
    const texts = codex.locator('.cx-sec[data-list="texts"]').locator("li");
    await expect(texts).toHaveCount(2);
    await expect(texts.first()).toContainText("Jordan Test");
    // Settings is folded; its rules and style are there when opened.
    const style = codex.getByRole("heading", { name: "How you write" });
    await expect(style).toBeHidden();
    await codex.getByText("Settings", { exact: true }).click();
    await expect(style).toBeVisible();
    await expect(codex.getByRole("heading", { name: "Filter rules" })).toBeVisible();
    if (SHOTS) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/642-codex-${width}.png` });
    }
    // A row puts that exchange in focus, back up in the Thread.
    await email.first().getByRole("button").click();
    await expect(focused(page)).toContainText("Priya Madeup");
  });
}

test("Done, skip and \"already did it\" leave at once, Undo brings one back, and only then does the server hear", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(FAKE_SPEECH);
  const posts = await stub(page);
  await page.goto(`${BASE}/relay`);
  await expect(focused(page)).toContainText("Sam Test");
  // D: Sam leaves the Thread and the Codex at once; Z inside the window brings him back, and nothing is posted.
  await page.keyboard.press("d");
  await expect(page.locator(".cx-entry", { hasText: "Sam Test" })).toHaveCount(0);
  await expect(page.locator(".cx-rows li", { hasText: "Sam Test" })).toHaveCount(0);
  await expect(undoLine(page)).toContainText("Closed. Nothing owed to Sam.");
  await page.keyboard.press("z");
  await expect(page.locator(".cx-entry", { hasText: "Sam Test" })).toHaveCount(1);
  await page.waitForTimeout(5_500);
  expect(posts.filter((p) => p.action === "done")).toEqual([]);
  // "already did it" closes it with no draft and no question: one done after the window, and no model call.
  await handsFreeOn(page, "Sam Test");
  await scrollTo(page, "Sam Test");
  await expect(focused(page)).toContainText("Sam Test");
  await say(page, "already did it");
  await expect(page.locator(".cx-entry", { hasText: "Sam Test" })).toHaveCount(0);
  await expect.poll(() => posts.filter((p) => p.action === "done"), { timeout: 8_000 }).toEqual([{ line: "texts", action: "done", thread: SAM }]);
  expect(posts.filter((p) => p.action === "intent")).toEqual([]);
  // "not this one" on a mail is skip: gone like Done until Priya writes again.
  await page.locator(".cx-rows button", { hasText: "Priya Madeup" }).click();
  await expect(focused(page)).toContainText("Priya Madeup");
  await say(page, "not this one");
  await expect(page.locator(".cx-entry", { hasText: "Priya Madeup" })).toHaveCount(0);
  await expect.poll(() => posts.filter((p) => p.action === "skip"), { timeout: 8_000 }).toEqual([{ line: "email", action: "skip", id: PRIYA }]);
});

test("a rule from a sentence: \"invites can wait\" says what changed, with Undo", async ({ page }) => {
  const posts = await stub(page);
  await page.goto(`${BASE}/relay`);
  await page.locator(".cx-rows button", { hasText: "Priya Madeup" }).click();
  await expect(focused(page)).toContainText("Priya Madeup");
  await page.locator("#cx-words").fill("invites can wait");
  await page.locator("#cx-words").press("Enter");
  await expect(undoLine(page)).toContainText("From now on, invites can wait.");
  await undoLine(page).getByRole("button", { name: /Undo/ }).click();
  await expect.poll(() => posts.filter((p) => p.action === "unblock")).toEqual([{ line: "email", action: "unblock", rule: "abcdefabcde1" }]);
  expect(sends(posts)).toEqual([]);
});

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
