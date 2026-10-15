#!/usr/bin/env node
/**
 * Renders a change card (#158): a 1200×630 PNG in the Desk's look that shows what a change did, for the issue's
 * `**Trail · Pictures:**` step when there is nothing to screenshot (docs, CI, API, security, scripts). It shows the
 * issue and title, a 1–3 line summary, the areas the diff touched with file and line counts, the check results, and
 * who built it on which model. Post it like any picture: scripts/issue-shots.sh <issue> "<what>" <card.png>.
 *
 * Usage:
 *   node scripts/change-card.mjs --issue=158 --title="…" --summary="line one" --summary="line two" \
 *     --builder=Dusty --model=Opus --checks=typecheck=pass,lint=pass,test=pass,build=pass \
 *     [--base=origin/main] [--head=HEAD] [--branch=…] [--out=card.png]
 *   node scripts/change-card.mjs --json=card.json [--out=card.png]   (same keys; summary may be a list, checks an object)
 *
 * The diff comes from `git diff --numstat --no-renames <base>...<head>` (paths and counts only; file contents are
 * never read). Every word on the card goes through `scrub`, which drops anything shaped like a key, an email address
 * or a link. Needs Chromium (PLAYWRIGHT_CHROMIUM_PATH, else /opt/pw-browsers/chromium, else Playwright's own).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { cardHtml, groupAreas, parseChecks, parseNumstat } from "./change-card-lib.mjs";

const args = process.argv.slice(2);
const all = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const flag = (name) => all(name).at(-1);

if (args.includes("--help") || args.includes("-h")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*\n?/, "").replace(/^ \* ?/gm, ""));
  process.exit(0);
}

const file = flag("json") ? JSON.parse(readFileSync(flag("json"), "utf8")) : {};
const pick = (name) => flag(name) ?? file[name];
const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (...a) => {
  try {
    return git(...a);
  } catch {
    return "";
  }
};

const issue = Number(pick("issue"));
const title = pick("title");
if (!issue || !title) {
  console.error("change-card: --issue and --title are needed (see --help).");
  process.exit(2);
}

const base = pick("base") ?? (tryGit("rev-parse", "-q", "--verify", "origin/main") ? "origin/main" : "main");
const head = pick("head") ?? "HEAD";
const groups = groupAreas(parseNumstat(git("diff", "--numstat", "--no-renames", `${base}...${head}`)));
const short = (ref) => tryGit("rev-parse", "--short", ref) || ref;
const summary = all("summary").length ? all("summary") : file.summary;

const card = {
  issue,
  title,
  summary,
  groups,
  checks: parseChecks(pick("checks")),
  builder: pick("builder"),
  model: pick("model"),
  branch: pick("branch") ?? tryGit("rev-parse", "--abbrev-ref", head).replace(/^HEAD$/, ""),
  range: `${short(tryGit("merge-base", base, head) || base)}…${short(head)}`,
  date: pick("date") ?? new Date().toISOString().slice(0, 10),
};

// The Desk's own faces, from the fontsource packages the world app already ships; system fonts stand in without them.
const require = createRequire(import.meta.url);
const font = (pkg, name) => {
  try {
    const path = resolve(dirname(require.resolve(`${pkg}/package.json`)), "files", name);
    return `data:font/woff2;base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return undefined;
  }
};
const fonts = {
  serif: font("@fontsource/cormorant-garamond", "cormorant-garamond-latin-400-normal.woff2"),
  serifLight: font("@fontsource/cormorant-garamond", "cormorant-garamond-latin-300-normal.woff2"),
  sans: font("@fontsource-variable/inter", "inter-latin-wght-normal.woff2"),
  mono: font("@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2"),
  monoMedium: font("@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2"),
};

const out = resolve(pick("out") ?? `change-card-${issue}.png`);
mkdirSync(dirname(out), { recursive: true });

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // Nothing on the card reaches the network: every font and style is inline.
  await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
  await page.setContent(cardHtml(card, fonts), { waitUntil: "load" });
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.screenshot({ path: out, type: "png" });
} finally {
  await browser.close();
}
console.log(out);
