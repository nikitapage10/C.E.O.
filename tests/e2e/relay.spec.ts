import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Relay's Thread (#615, simplified in #642), the Codex, on the built site, with a signed-in session and /api/email and
 * /api/relay stubbed in the browser. The queue is one scrolling codex; only the entry in focus answers voice and keys
 * ("yes" only with its draft on screen); an email's draft comes only on "Draft it", a text's ready draft is the reply box's ghost text (#904); a
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

async function stub(page: Page, opts: { signedIn?: boolean; canSend?: boolean; order?: string | null; group?: boolean; failSends?: number[]; tapbacks?: "on" | "off"; newTextAfter?: number } = {}) {
  const signedIn = opts.signedIn ?? true;
  // Longest waiting first is the page's default (#904); most tests here walk the queue newest first (Sam, Jordan,
  // Priya), as a device that picked Newest would. null leaves the default.
  const order = opts.order === undefined ? "newest" : opts.order;
  if (order) await page.addInitScript((o) => window.localStorage.setItem("relay.order.v2", o), order);
  const posts: Record<string, unknown>[] = [];
  let samDraft: { text: string; at: number } | null = null;
  let requests: Record<string, unknown>[] = [];
  let rids = 0;
  let sendsMade = 0;
  // #980: after this many signed-in reads, a new text from Jordan comes in (the Mac reported it).
  let reads = 0;
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
      reads++;
      const fresh = opts.newTextAfter !== undefined && reads > opts.newTextAfter ? [{ text: "also are you free saturday", at: now - 60_000, ref: "0000000d" }] : [];
      const texts = [
        { id: SAM, name: "Sam Test", channel: "iMessage", group: false, state: "owed", sort: "sooner", since: now - 4 * 60_000, laterUntil: null, gist: "Everyone's there already; they ask if they should start without you", draft: samDraft, summary: null },
        { id: JORDAN, name: "Jordan Test", channel: "iMessage", group: false, state: "owed", sort: "normal", since: now - 12 * 60_000, laterUntil: null, gist: "Says the meme you sent at 2am was too accurate", draft: { text: "haha right?? saw it and thought of you", at: now - 60_000 }, summary: null, messages: [
          { text: "did you see what I sent", at: now - 40 * 60_000, ref: "0000000a" },
          { text: "the one with the cat in the box", at: now - 39 * 60_000, me: true },
          { text: "Photo", at: now - 20 * 60_000, media: true, ref: "0000000b" },
          { text: "ok that meme you sent at 2am was way too accurate", at: now - 12 * 60_000, ref: "0000000c" },
          ...fresh,
        ] },
        // An unnamed big group (#923): the hub names it by its people, the shelf counts what is new.
        ...(opts.group ? [{ id: "9999999999999999", name: "Alex, Sam +5", channel: "iMessage", group: true, state: "settled", sort: null, since: now - 30 * 60_000, laterUntil: null, gist: "", draft: null, summary: { text: "They plan a picnic on Sunday.", asked: false }, messages: Array.from({ length: 5 }, (_, i) => ({ text: `picnic line ${i}`, at: now - (30 - i) * 60_000, from: i % 2 ? "Alex Test" : "Sam Other" })) }] : []),
      ];
      return r.fulfill({ json: { ok: true, status: textsStatus(), ready: true, paired: true, pairedAt: now - 86_400_000, lastSeen: now, unlockedUntil: now + 3_600_000, texts, cards: [], textsAt: now, requests, ...(opts.tapbacks && { tapbacks: opts.tapbacks }), spend: { usd: 0.03, budget: 10 } } });
    }
    const body = r.request().postDataJSON() as Record<string, unknown>;
    posts.push({ line: "texts", ...body });
    if (body.action === "restyle" || body.action === "draft") samDraft = { text: SAM_DRAFT, at: Date.now() };
    // Each request its own id (#950: the outbox follows each send by it); a send listed as sent, or failed when asked.
    const rid = (++rids).toString(16).padStart(24, "0");
    if (body.action === "send" || body.action === "resend") {
      const fail = opts.failSends?.includes(++sendsMade);
      // A resend names only the old request (the site copies its thread and text).
      const old = body.action === "resend" ? requests.find((q) => q.rid === body.rid) : undefined;
      requests = [...requests.filter((q) => q.kind !== "done"), { rid, kind: "send", thread: old?.thread ?? body.thread, text: old?.text ?? body.text, created: Date.now(), until: Date.now() + 600_000, state: fail ? "failed" : "sent", ...(fail && { reason: "bb-down" }) }, ...requests.filter((q) => q.kind === "done")];
    }
    // The site holds a Done until the Mac takes it (#914).
    if (body.action === "done") requests = [...requests, { rid, kind: "done", thread: body.thread, text: "", created: Date.now(), until: Date.now() + 600_000, state: "waiting" }];
    return r.fulfill({ json: { ok: true, rid, until: Date.now() + 600_000 } });
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
 * from the bar (the switch holds page to page, and the bar shows it while it listens). On a phone the bar is the
 * phone frame's own (#1045, PhoneNav.tsx): the top bar shows Hands-free, the bottom bar leads into Relay.
 */
const relayHandsFree = async (page: Page) => {
  await page.goto(`${BASE}/boiler/controls`);
  await page.locator("#ct-settings .bx-fold").click();
  await page.locator("#ct-settings").getByRole("button", { name: "Hands-free" }).click();
  await expect(page.locator("header.wv-nav").getByRole("button", { name: /Listening|Hands-free/ })).toBeVisible();
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
    // A text's ready draft stays folded: only ghost text in the reply box (#904), never a draft on its own.
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

    // Y on the keyboard: the draft goes into the outbox under the box (#950), and the send goes only after the window,
    // bound to the draft on screen. The box stays open for the next text.
    await page.keyboard.press("y");
    await expect(undoLine(page)).toContainText("Sending to Sam Test");
    await expect(focused(page).locator(".cx-outmsg")).toContainText(SAM_DRAFT);
    await expect(focused(page).locator(".cx-outmsg")).toContainText("sending");
    await expect(focused(page).getByRole("textbox", { name: /Your reply to Sam Test/ })).toBeVisible();
    if (SHOTS) await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/615-seal-${width}.png` });
    await page.waitForTimeout(1_500);
    expect(sends(posts)).toEqual([]);
    await expect.poll(() => sends(posts), { timeout: 8_000 }).toEqual([{ line: "texts", action: "send", thread: SAM, draftAt: expect.any(Number), text: SAM_DRAFT }]);
    // Once, and only once; the thread stays in the queue after the send (#870) and leaves on Done (#904's row).
    await page.waitForTimeout(1_000);
    expect(sends(posts)).toHaveLength(1);
    await expect(focused(page).locator(".cx-outmsg")).toContainText("sent", { timeout: 8_000 });
    await expect(focused(page)).toContainText("Sam Test");
    await focused(page).getByRole("button", { name: /^Done/ }).click();
    await expect(page.locator(".cx-entry", { hasText: "Sam Test" })).toHaveCount(0);
    await expect(focused(page)).toHaveCount(1);
    expect(sends(posts)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test(`scrolling moves the focus, and keys act only on the entry in focus (${width} wide)`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: width > 600 ? 900 : 860 });
    await page.addInitScript(FAKE_SPEECH);
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
    // The card is the conversation (#904): their lines left, Nikita's own right, a photo-only line a "Photo" chip,
    // the newest last and largest.
    await expect(focused(page).locator(".cx-bub[data-me]")).toContainText("the one with the cat in the box");
    await expect(focused(page).locator(".cx-chip")).toHaveText("Photo");
    await expect(focused(page).locator(".cx-bub-hero")).toContainText("way too accurate");
    // One row (#904): no Reply, Skip, Cancel or mic button; the reply box is already open under the newest message.
    for (const gone of [/^Reply/, /^Skip/, /^Cancel/, /^Mic/]) await expect(focused(page).getByRole("button", { name: gone })).toHaveCount(0);
    await expect(focused(page).getByRole("button", { name: /^Done/ })).toBeVisible();
    await expect(focused(page).getByRole("button", { name: /^Later/ })).toBeVisible();
    const box = focused(page).getByRole("textbox", { name: /Your reply to Jordan Test/ });
    await expect(box).toBeVisible();
    // The box starts empty (#923): no ghost draft, no "Use draft"; "Write for me" sits beside Send.
    await expect(box).toHaveAttribute("placeholder", "Reply to Jordan");
    await expect(box).toHaveValue("");
    await expect(focused(page).getByRole("button", { name: /Use draft/ })).toHaveCount(0);
    await expect(focused(page).getByRole("button", { name: /Write for me/ })).toBeVisible();
    // The older lines sit faded behind the newest (#923) until hovered or tapped.
    const ctx = focused(page).locator(".cx-ctx");
    await expect(ctx).not.toHaveAttribute("data-clear", "true");
    if (SHOTS) await page.waitForTimeout(1_500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/923-card-${width}.png` });
    // A tap on the faded lines (on one of his own, so it picks nothing; #980: a pick no longer clears them all).
    await ctx.locator(".cx-bub[data-me]").dispatchEvent("click");
    await expect(ctx).toHaveAttribute("data-clear", "true");
    await ctx.locator(".cx-bub[data-me]").dispatchEvent("click");
    await expect(ctx).not.toHaveAttribute("data-clear", "true");
    await page.keyboard.press("r");
    await expect(box).toBeFocused();
    // The Mac already has a draft here: "Write for me" puts it in the box to edit, and nothing sends.
    await focused(page).getByRole("button", { name: /Write for me/ }).click();
    await expect(box).toHaveValue("haha right?? saw it and thought of you");
    // Typing replaces it; Shift+Enter is a new line, not a send; Esc leaves the box so the keys work again.
    await box.fill("");
    await box.pressSequentially("ha");
    await box.press("Shift+Enter");
    await box.pressSequentially("yes");
    await expect(box).toHaveValue("ha\nyes");
    await box.press("Escape");
    await expect(box).not.toBeFocused();
    await page.waitForTimeout(300);
    expect(sends(posts)).toEqual([]);
    // Hold Space (outside a text field) talks into the box; letting go ends it. Still nothing sends.
    await box.fill("");
    await box.press("Escape");
    await page.keyboard.down("Space");
    await expect(focused(page).locator(".cx-listen")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __say: (t: string) => boolean }).__say("on my way"))).toBe(true);
    await expect(box).toHaveValue("on my way");
    await page.keyboard.up("Space");
    await expect(focused(page).locator(".cx-listen")).toHaveCount(0);
    // Enter in the box sends it, after the undo window; Z inside the window takes it back.
    await box.press("Enter");
    await expect(undoLine(page)).toContainText("Sending to Jordan Test");
    await undoLine(page).getByRole("button", { name: /Undo/ }).click();
    await page.waitForTimeout(5_600);
    expect(sends(posts)).toEqual([]);
    // W and S move through the codex (here newest first: Sam, Jordan, Priya); J and K still do too.
    await page.keyboard.press("w");
    await expect(focused(page)).toContainText("Sam Test");
    await page.keyboard.press("s");
    await expect(focused(page)).toContainText("Jordan Test");
    await page.keyboard.press("k");
    await expect(focused(page)).toContainText("Sam Test");
    await page.keyboard.press("j");
    await expect(focused(page)).toContainText("Jordan Test");
    // A is Later: Jordan goes to the back and the Mac hears it after the undo-free notice.
    await page.keyboard.press("a");
    await expect.poll(() => posts.filter((p) => p.action === "later")).toEqual([{ line: "texts", action: "later", thread: JORDAN }]);
    expect(sends(posts)).toEqual([]);
  });
}

test("Write for me asks Blasto only on the tap, fills the box, and never sends (#923)", async ({ page }) => {
  const posts = await stub(page, { group: true });
  await page.goto(`${BASE}/relay`);
  await expect(focused(page)).toContainText("Sam Test");
  // Nothing asked for until the tap.
  await page.waitForTimeout(500);
  expect(posts.filter((p) => p.action === "draft")).toEqual([]);
  const box = focused(page).getByRole("textbox", { name: /Your reply to Sam Test/ });
  await expect(box).toHaveValue("");
  await focused(page).getByRole("button", { name: /Write for me/ }).click();
  await expect.poll(() => posts.filter((p) => p.action === "draft")).toEqual([{ line: "texts", action: "draft", thread: SAM }]);
  await expect(box).toHaveValue(SAM_DRAFT, { timeout: 15_000 });
  await page.waitForTimeout(800);
  expect(sends(posts)).toEqual([]);
  // The Groups shelf names the unnamed group by its people and says what its number counts.
  const chip = page.locator(".cx-shelf button").first();
  await expect(chip).toContainText("Alex, Sam +5");
  await expect(chip).toContainText("5 new");
});

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
  test(`the Codex: one line of numbers, Email and Texts newest first, the rest behind Settings (${width} wide)`, async ({ page }) => {
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
    await expect(texts.first()).toContainText("Sam Test");
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
  // The 5-second window, plus room for a busy software renderer's late timers.
  await expect.poll(() => posts.filter((p) => p.action === "done"), { timeout: 12_000 }).toEqual([{ line: "texts", action: "done", thread: SAM }]);
  expect(posts.filter((p) => p.action === "intent")).toEqual([]);
  // "not this one" on a mail is skip: gone like Done until Priya writes again.
  await page.locator(".cx-rows button", { hasText: "Priya Madeup" }).click();
  await expect(focused(page)).toContainText("Priya Madeup");
  await say(page, "not this one");
  await expect(page.locator(".cx-entry", { hasText: "Priya Madeup" })).toHaveCount(0);
  await expect.poll(() => posts.filter((p) => p.action === "skip"), { timeout: 8_000 }).toEqual([{ line: "email", action: "skip", id: PRIYA }]);
});

test("Done sticks (#914): a reload inside the Undo window still sends it, and it stays off the line while the Mac hasn't settled it", async ({ page }) => {
  test.setTimeout(60_000);
  const posts = await stub(page);
  await page.goto(`${BASE}/relay`);
  // Both lines in first, and Done on Sam's own card: Done shows only on the card in focus, so a bare "the focused
  // card's Done" could land on whichever card took the focus as a line came in (#1073).
  await expect(page.locator(".cx-count")).toContainText("3 waiting");
  await expect(focused(page)).toContainText("Sam Test");
  await page.locator(".cx-entry[data-focus]", { hasText: "Sam Test" }).getByRole("button", { name: /^Done/ }).click();
  await expect(page.locator(".cx-entry", { hasText: "Sam Test" })).toHaveCount(0);
  // Reloaded at once, before the five seconds are up: the Done goes as the page leaves, and Sam doesn't come back.
  await page.reload();
  await expect(focused(page)).toHaveCount(1);
  await expect.poll(() => posts.filter((p) => p.action === "done")).toEqual([{ line: "texts", action: "done", thread: SAM }]);
  await expect(page.locator(".cx-entry", { hasText: "Jordan Test" })).toHaveCount(1);
  await expect(page.locator(".cx-entry", { hasText: "Sam Test" })).toHaveCount(0);
  // And again later, while the site still holds the request for the Mac.
  await page.reload();
  await expect(page.locator(".cx-entry", { hasText: "Jordan Test" })).toHaveCount(1);
  await expect(page.locator(".cx-entry", { hasText: "Sam Test" })).toHaveCount(0);
  await expect(page.locator(".cx-rows li", { hasText: "Sam Test" })).toHaveCount(0);
});

test("a rule from a sentence, said with Space held (#950: no type box): \"invites can wait\" says what changed, with Undo", async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
  const posts = await stub(page);
  await page.goto(`${BASE}/relay`);
  await page.locator(".cx-rows button", { hasText: "Priya Madeup" }).click();
  await expect(focused(page)).toContainText("Priya Madeup");
  // The type box, its Go and its "?" are gone; one small hint stays.
  await expect(page.locator("#cx-words")).toHaveCount(0);
  await expect(page.getByText(/tell Blasto what to say/)).toHaveCount(0);
  await expect(page.locator(".cx-dock").getByRole("button", { name: "Keys" })).toHaveCount(0);
  // #950: the "hold Space to talk, or type" row is gone too; the dock only names the mic while it is live.
  await expect(page.locator(".cx-dock")).not.toContainText(/hold Space/i);
  // Holding Space (outside a field or a button) hands the open email's words to the Thread.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down("Space");
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __rec: unknown }).__rec), { timeout: 8_000 }).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __say: (t: string) => boolean }).__say("invites can wait"))).toBe(true);
  await page.keyboard.up("Space");
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

test("#1169: scrolling away and back, the words are there the moment the entry is in focus again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stub(page);
  await page.goto(`${BASE}/relay`);
  await expect(focused(page)).toContainText("Sam Test");
  const blank = () => focused(page).locator(".cx-msg[data-sg-ghost], .cx-adv[data-sg-ghost], .cx-init[data-sg-ghost]");
  await expect(blank()).toHaveCount(0);
  const pages = page.locator(".cx-pages");
  await pages.hover();
  // One wheel gesture a step (#1161): on to Jordan, and back to Sam.
  await page.mouse.wheel(0, 240);
  await expect(focused(page)).toContainText("Jordan Test");
  await expect(blank()).toHaveCount(0);
  await page.waitForTimeout(900);
  await page.mouse.wheel(0, -240);
  await expect(focused(page)).toContainText("Sam Test");
  if (SHOTS) await page.waitForTimeout(700);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1169-back-1440.png` });
  // No particle has to land first (#1162): the words show at once, not after a form.
  await expect(blank()).toHaveCount(0, { timeout: 400 });
  await expect(focused(page).locator(".cx-msg").first()).toBeVisible();
  // And the keys the same way, there and back.
  await page.keyboard.press("s");
  await expect(focused(page)).toContainText("Jordan Test");
  await page.keyboard.press("w");
  await expect(focused(page)).toContainText("Sam Test");
  await expect(blank()).toHaveCount(0, { timeout: 400 });
});

test("signed out: counts only, never a name", async ({ page }) => {
  await stub(page, { signedIn: false });
  await page.goto(`${BASE}/relay`);
  await expect(page.getByText("3 waiting on you.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByText("Sam Test")).toHaveCount(0);
  await expect(page.getByText("Priya Madeup")).toHaveCount(0);
  await expect(page.locator(".rq")).toHaveCount(0);
});

test("the queue on the wave (#803): a face, a first name and the wait; a tap jumps there; the order menu (#904)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The rows drift on the wave all the time, so Playwright never sees one "stable" enough to click: with reduced
  // motion they sit still (one frame per change), which is the same queue and the same taps.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stub(page, { order: null });
  await page.goto(`${BASE}/relay`);
  const wave = page.getByRole("navigation", { name: "Up next" });
  // Longest waiting first by default (#904): Priya's mail an hour ago, then Jordan, then Sam.
  await expect(page.locator(".cx-entry").first()).toContainText("Priya Madeup");
  await expect(page.locator(".cx-entry").last()).toContainText("Sam Test");
  await expect(page.locator(".cx-order summary")).toContainText("Longest waiting");
  await expect(page.locator(".cx-count")).toContainText("3 waiting");
  // Say things once (#904): the line shows the first name and the wait, no gist and no full name.
  await expect(wave.locator(".rq-item").first()).toContainText("Priya");
  await expect(wave).not.toContainText("Madeup");
  await expect(wave).not.toContainText("which trail");
  // The rows drift on the wave every frame, so Playwright's pointer click never finds the row "stable" and waits out
  // the test; the tap is sent to the row itself instead (#844).
  await wave.getByRole("button", { name: /: Priya Madeup/ }).dispatchEvent("click");
  await expect(focused(page)).toContainText("Priya Madeup");
  await expect(wave.locator(".rq-item[data-cur]")).toContainText("Priya");
  // Newest first, from the small menu, puts Sam at the top and Priya last; the one in focus stays in focus.
  await page.locator(".cx-order summary").click();
  await page.getByRole("radio", { name: "Newest" }).click();
  await expect(page.locator(".cx-order summary")).toContainText("Newest");
  await expect(focused(page)).toContainText("Priya Madeup");
  await expect(page.locator(".cx-entry").first()).toContainText("Sam Test");
  await expect(page.locator(".cx-entry").last()).toContainText("Priya Madeup");
  // Remembered on this device.
  await page.reload();
  await expect(page.locator(".cx-order summary")).toContainText("Newest");
  await page.locator(".cx-order summary").click();
  await expect(page.getByRole("radio", { name: "Newest" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /Oldest/ })).toHaveAttribute("aria-checked", "false");
});

test("#950: the box stays open while texts queue in order; Done moves on at once; a failed one comes back with Resend", async ({ page }) => {
  test.setTimeout(90_000);
  const posts = await stub(page, { failSends: [2] });
  await page.goto(`${BASE}/relay`);
  await expect(page.locator(".cx-rows button", { hasText: "Jordan Test" })).toBeVisible();
  await page.locator(".cx-rows button", { hasText: "Jordan Test" }).click();
  await expect(focused(page)).toContainText("Jordan Test");
  const box = focused(page).getByRole("textbox", { name: /Your reply to Jordan Test/ });
  // Three texts, one after another: the box clears at once each time and stays open and editable, and each waits
  // under the box as "sending…" (its few seconds of Undo, then on its way). Each is looked at as it goes in: on a slow
  // runner the first can be sent, and gone from the box, before the third is typed (nightly d4e53b9, #990).
  const out = focused(page).locator(".cx-outmsg");
  for (const words of ["ha that cat", "ok one more", "see you sunday"]) {
    await box.fill(words);
    await box.press("Enter");
    await expect(box).toHaveValue("");
    await expect(box).toBeEditable();
    await expect(out.filter({ hasText: words })).toContainText("sending");
  }
  // They go in the order sent; the second fails at the Mac and says so, with Resend.
  await expect.poll(() => sends(posts).map((p) => p.text), { timeout: 20_000 }).toEqual(["ha that cat", "ok one more", "see you sunday"]);
  const failed = out.filter({ hasText: "ok one more" });
  await expect(failed).toContainText("not sent", { timeout: 10_000 });
  // The other two went: "sent" for a few seconds, then out of the box, never "not sent".
  await expect(out.filter({ hasText: "ha that cat" }).filter({ hasText: "not sent" })).toHaveCount(0);
  await expect(out.filter({ hasText: "see you sunday" }).filter({ hasText: "not sent" })).toHaveCount(0);
  await expect(undoLine(page)).toContainText("Not sent to Jordan Test");
  await failed.getByRole("button", { name: "Resend" }).click();
  await expect.poll(() => posts.filter((p) => p.action === "resend" || p.action === "send").length, { timeout: 10_000 }).toBe(4);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/950-queue.png` });

  // Done while a text is still on its way: the card moves on at once; the text still goes; then the Done.
  await box.fill("last one, promise");
  await box.press("Enter");
  await focused(page).getByRole("button", { name: /^Done/ }).click();
  await expect(page.locator(".cx-entry", { hasText: "Jordan Test" })).toHaveCount(0);
  await expect.poll(() => sends(posts).at(-1)?.text, { timeout: 15_000 }).toBe("last one, promise");
  await expect.poll(() => posts.filter((p) => p.action === "done").map((p) => p.thread), { timeout: 20_000 }).toEqual([JORDAN]);
  const lastSend = posts.findIndex((p) => p.text === "last one, promise");
  const done = posts.findIndex((p) => p.action === "done");
  expect(done).toBeGreaterThan(lastSend);
});

test("#950: any of their earlier bubbles takes a tapback, and Reply answers it inline through the same send", async ({ page }) => {
  test.setTimeout(60_000);
  const posts = await stub(page, { tapbacks: "on" });
  await page.goto(`${BASE}/relay`);
  await expect(page.locator(".cx-rows button", { hasText: "Jordan Test" })).toBeVisible();
  await page.locator(".cx-rows button", { hasText: "Jordan Test" }).click();
  await expect(focused(page)).toContainText("Jordan Test");
  // Their latest by default; a tap on an earlier bubble of theirs picks it.
  await expect(focused(page).locator(".cx-tbwhich")).toHaveText("on their latest");
  const earlier = focused(page).locator(".cx-ctx .cx-bub[data-pick]", { hasText: "did you see what I sent" });
  // The codex may still be settling its scroll onto Jordan: pick once it has. On a CI runner the room's software-rendered
  // field can hold the main thread for seconds while it builds, so the pick gets the time to land (nightly d4e53b9, #990).
  await expect(async () => {
    if ((await earlier.getAttribute("data-picked")) !== "true") await earlier.click({ timeout: 5_000 });
    await expect(earlier).toHaveAttribute("data-picked", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(focused(page).locator(".cx-tbwhich")).toContainText("did you see what I sent");
  // #980: ‹ › step through their lines too, and stepping onto the latest lets the pick go.
  await focused(page).getByRole("button", { name: "Pick a later message of theirs" }).click();
  await expect(focused(page).locator(".cx-ctx .cx-bub[data-picked]")).toContainText("Photo");
  await focused(page).getByRole("button", { name: "Pick a later message of theirs" }).click();
  await expect(focused(page).locator(".cx-tbwhich")).toHaveText("on their latest");
  await focused(page).getByRole("button", { name: "Pick an earlier message of theirs" }).click();
  await focused(page).getByRole("button", { name: "Pick an earlier message of theirs" }).click();
  await expect(earlier).toHaveAttribute("data-picked", "true");
  await expect(focused(page).locator(".cx-tbwhich")).toContainText("did you see what I sent");
  // The other older lines keep their fade while one is picked.
  await expect.poll(() => focused(page).locator(".cx-ctx").getAttribute("data-clear")).toBeNull();
  // His own line can't be picked.
  await expect(focused(page).locator(".cx-ctx .cx-bub[data-me][data-pick]")).toHaveCount(0);
  await focused(page).getByRole("button", { name: "Heart" }).click();
  await expect.poll(() => posts.filter((p) => p.action === "react")).toEqual([{ line: "texts", action: "react", thread: JORDAN, ref: "0000000a", tapback: "love" }]);
  // Reply: the quoted line shows above the box, and the send names that line.
  await focused(page).getByRole("button", { name: "Inline reply to this message" }).click();
  await expect(focused(page).locator(".cx-quote")).toContainText("did you see what I sent");
  const box = focused(page).getByRole("textbox", { name: /Your reply to Jordan Test/ });
  await expect(box).toBeFocused();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/950-reply.png` });
  await box.fill("yes, the cat one");
  await box.press("Enter");
  await expect(focused(page).locator(".cx-quote")).toHaveCount(0);
  await expect.poll(() => sends(posts), { timeout: 15_000 }).toEqual([{ line: "texts", action: "send", thread: JORDAN, draftAt: expect.any(Number), text: "yes, the cat one", reply: "0000000a" }]);
});

test("#950: Relay refreshes by itself while it shows, keeping the card and the words being typed", async ({ page }) => {
  test.setTimeout(60_000);
  await stub(page);
  let reads = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && /\/api\/relay$/.test(r.url())) reads++;
  });
  await page.goto(`${BASE}/relay`);
  await expect(page.locator(".cx-rows button", { hasText: "Jordan Test" })).toBeVisible();
  await page.locator(".cx-rows button", { hasText: "Jordan Test" }).click();
  const box = focused(page).getByRole("textbox", { name: /Your reply to Jordan Test/ });
  await box.fill("half a thought");
  const before = reads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads, { timeout: 5_000 }).toBeGreaterThan(before);
  await expect.poll(() => reads, { timeout: 25_000 }).toBeGreaterThan(before + 1);
  await expect(focused(page)).toContainText("Jordan Test");
  await expect(box).toHaveValue("half a thought");
});

test("#980: a new text shows on the card by itself, no refresh, and the older lines stay dark and blurred", async ({ page }) => {
  test.setTimeout(60_000);
  await stub(page, { newTextAfter: 1 });
  await page.goto(`${BASE}/relay`);
  await expect(page.locator(".cx-rows button", { hasText: "Jordan Test" })).toBeVisible();
  await page.locator(".cx-rows button", { hasText: "Jordan Test" }).click();
  await expect(focused(page)).toContainText("Jordan Test");
  await page.mouse.move(0, 0);
  // Their older lines: each has its depth, and is faded and blurred (#980: at least #923's).
  const older = focused(page).locator(".cx-ctx > .cx-bub").first();
  await expect.poll(() => older.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--d"))).not.toBe("");
  await expect.poll(() => older.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5_000 }).toBeLessThanOrEqual(0.55);
  await expect.poll(() => older.evaluate((el) => getComputedStyle(el).filter)).toMatch(/blur\((?:[2-9]|1\.[5-9])/);
  // Within one poll (15 s) the new text is the newest line on the card, with no reload.
  await expect(focused(page).locator(".cx-bub-hero")).toContainText("also are you free saturday", { timeout: 25_000 });
  await expect(focused(page).locator(".cx-ctx")).toContainText("ok that meme you sent at 2am was way too accurate");
});
