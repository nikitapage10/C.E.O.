/**
 * The pure half of the change card (scripts/change-card.mjs, #158): reads `git diff --numstat` into areas of the
 * repo, scrubs the words that go on the card, and writes the card's HTML. No Node APIs and no browser here, so the
 * unit tests (change-card-lib.test.mjs) can run it as is.
 *
 * The card only ever shows paths grouped into areas, counts, check results and the words the Builder passes in. It
 * never reads file contents, and `scrub` takes out anything that looks like a key, an email address or a link.
 */

/** Where a path lives, first match wins. Labels are what Nikita sees on the card ("Desk · API · Docs"). */
export const AREA_RULES = [
  [/^\.github\//, "CI"],
  [/^\.claude\//, "Tooling"],
  [/^docs\//, "Docs"],
  [/^lore\//, "Lore"],
  [/^tests\//, "Tests"],
  [/^api\/_security\//, "Security"],
  [/^api\//, "API"],
  [/^apps\/world\/src\/desk\//, "Desk"],
  [/^apps\/world\/public\//, "Assets"],
  [/^apps\/world\/src\//, "Lattice"],
  [/^apps\/hub\//, "Hub"],
  [/^packages\/simulator\//, "Simulator"],
  [/^packages\/core\//, "Core"],
  [/^scripts\//, "Scripts"],
  [/^assets\//, "Assets"],
  [/^[^/]+\.md$/, "Docs"],
  [/^(apps\/[^/]+\/)?[^/]+\.(json|[cm]?[jt]s|ya?ml|toml)$/, "Config"],
];

/** The area a repo path belongs to, "Other" when no rule matches. */
export function areaOf(path) {
  const p = String(path).replace(/^\.\//, "");
  for (const [re, label] of AREA_RULES) if (re.test(p)) return label;
  return "Other";
}

/**
 * Reads `git diff --numstat` output: "added<TAB>removed<TAB>path" per line, "-" for binary files (counted as a file
 * with no lines). Run git with --no-renames so every path is a plain path.
 */
export function parseNumstat(text) {
  const files = [];
  for (const line of String(text).split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trimEnd());
    if (!m) continue;
    files.push({ path: m[3], added: m[1] === "-" ? 0 : Number(m[1]), removed: m[2] === "-" ? 0 : Number(m[2]) });
  }
  return files;
}

/** Groups files into areas, biggest change first (lines, then files, then name). */
export function groupAreas(files) {
  const byArea = new Map();
  for (const f of files) {
    const area = areaOf(f.path);
    const g = byArea.get(area) ?? { area, files: 0, added: 0, removed: 0 };
    g.files += 1;
    g.added += f.added;
    g.removed += f.removed;
    byArea.set(area, g);
  }
  return [...byArea.values()].sort(
    (a, b) => b.added + b.removed - (a.added + a.removed) || b.files - a.files || a.area.localeCompare(b.area),
  );
}

/** "Desk · API · Docs" */
export const areaLine = (groups) => groups.map((g) => g.area).join(" · ");

/** Totals across every area. */
export function totals(groups) {
  return groups.reduce((t, g) => ({ files: t.files + g.files, added: t.added + g.added, removed: t.removed + g.removed }), {
    files: 0,
    added: 0,
    removed: 0,
  });
}

const STATES = { pass: "pass", passed: "pass", green: "pass", ok: "pass", fail: "fail", failed: "fail", red: "fail", skip: "skip", skipped: "skip", "n/a": "skip" };

/**
 * Check results from "typecheck=pass,lint=pass,test=fail" (":" works too) or an object {typecheck: "pass"}.
 * Unknown states read as "skip", so a typo never shows as green.
 */
export function parseChecks(input) {
  if (!input) return [];
  const pairs = typeof input === "string"
    ? input.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(/[=:]/))
    : Object.entries(input);
  return pairs.map(([name, state]) => ({
    name: scrub(String(name ?? "").trim(), 24),
    state: STATES[String(state ?? "").trim().toLowerCase()] ?? "skip",
  })).filter((c) => c.name);
}

/** One word for the row of checks: "green", "red" or "partial" (some skipped), "none" when there are none. */
export function checksVerdict(checks) {
  if (!checks.length) return "none";
  if (checks.some((c) => c.state === "fail")) return "red";
  return checks.every((c) => c.state === "pass") ? "green" : "partial";
}

const SECRETISH = [
  /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, // email addresses
  /\bhttps?:\/\/\S+/gi, // links (they can carry tokens in a query)
  /\b(sk|pk|rk)-[\w-]{12,}/g, // API keys
  /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[\w]{10,}/g, // GitHub tokens
  /\bxox[abprs]-[\w-]{10,}/g, // Slack tokens
  /\bAKIA[0-9A-Z]{12,}/g, // AWS keys
  // Long opaque strings with digits and letters mixed in (tokens, hashes of secrets). Hyphens break a run, so
  // kebab-case branch names and paths stay readable.
  /(?<![\w/+])(?=[\w/+]*\d[\w/+]*\d)(?=[\w/+]*[A-Za-z])[\w/+]{32,}={0,2}/g,
];

/** Plain one-line text for the card: no control characters, nothing key- or email-shaped, at most `max` characters. */
export function scrub(text, max = 160) {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  let s = String(text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ");
  for (const re of SECRETISH) s = s.replace(re, "[redacted]");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** The summary as one to three short lines, from a string (split on newlines) or a list. */
export function summaryLines(summary) {
  const raw = Array.isArray(summary) ? summary : String(summary ?? "").split(/\n+/);
  return raw.map((l) => scrub(l, 150)).filter(Boolean).slice(0, 3);
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STATE_LABEL = { pass: "passed", fail: "failed", skip: "skipped" };

/**
 * The card as a full HTML page, 1200×630, in the Desk's look: the Lattice's void, navy hairline glass, the Desk's
 * serif title, Inter body and Plex Mono labels. `fonts` holds optional data: URLs for those three faces.
 */
export function cardHtml(card, fonts = {}) {
  const issue = Number(card.issue) || 0;
  const title = escapeHtml(scrub(card.title, 110));
  const lines = summaryLines(card.summary).map((l) => `<p>${escapeHtml(l)}</p>`).join("");
  const groups = card.groups ?? [];
  const shown = groups.slice(0, 5);
  const rest = groups.slice(5);
  const sum = totals(groups);
  const most = Math.max(1, ...shown.map((g) => g.added + g.removed));
  const areaRows = shown
    .map((g) => {
      const w = Math.max(3, Math.round(((g.added + g.removed) / most) * 100));
      return `<li><span class="area">${escapeHtml(g.area)}</span><span class="bar"><i style="width:${w}%"></i></span><span class="num">${g.files} ${g.files === 1 ? "file" : "files"}</span><span class="num add${g.added ? "" : " zero"}">+${g.added}</span><span class="num del${g.removed ? "" : " zero"}">−${g.removed}</span></li>`;
    })
    .join("");
  const restRow = rest.length
    ? `<li class="more">and ${escapeHtml(areaLine(rest))}: ${totals(rest).files} files</li>`
    : "";
  const checks = card.checks ?? [];
  const verdict = checksVerdict(checks);
  const checkRows = checks.length
    ? checks.map((c) => `<li class="${c.state}"><b></b><span>${escapeHtml(c.name)}</span><em>${STATE_LABEL[c.state]}</em></li>`).join("")
    : `<li class="skip"><b></b><span>not run yet</span></li>`;
  const builder = escapeHtml(scrub(card.builder || "Unassigned", 40));
  const model = escapeHtml(scrub(card.model || "", 40));
  const branch = escapeHtml(scrub(card.branch || "", 60));
  const range = escapeHtml(scrub(card.range || "", 40));
  const date = escapeHtml(scrub(card.date || "", 20));
  const face = (family, url, weight, style = "normal") =>
    url ? `@font-face{font-family:"${family}";src:url(${url}) format("woff2");font-weight:${weight};font-style:${style};}` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${face("Card Serif", fonts.serif, 400)}${face("Card Serif", fonts.serifLight, 300)}${face("Card Sans", fonts.sans, "100 900")}${face("Card Mono", fonts.mono, 400)}${face("Card Mono", fonts.monoMedium, 500)}
:root{--bg:#04060b;--panel:rgba(10,15,26,.72);--text:#e8f1ff;--muted:#aab5c9;--faint:#7c879e;--dim:#46506a;--hair:rgba(255,255,255,.13);--hair-soft:rgba(255,255,255,.07);--ice:#8fe8ff;--mint:#7dffc4;--amber:#ffd08f;--rose:#ff6b8b;--foundry:#ffb067;
--serif:"Card Serif","Cormorant Garamond",Georgia,serif;--sans:"Card Sans",Inter,system-ui,sans-serif;--mono:"Card Mono","IBM Plex Mono","DejaVu Sans Mono",monospace;}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
body{position:relative;padding:44px 56px 40px;display:flex;flex-direction:column;
background:radial-gradient(900px 520px at 88% -10%,rgba(143,232,255,.13),transparent 60%),radial-gradient(760px 480px at -5% 115%,rgba(255,176,103,.10),transparent 60%),linear-gradient(180deg,#070b14,#04060b 70%)}
body::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(ellipse at 70% 20%,#000 0,transparent 75%);pointer-events:none}
.top{display:flex;align-items:center;gap:14px;font-family:var(--mono);font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.top .mark{color:var(--foundry)}
.top .issue{margin-left:auto;padding:5px 12px;border:1px solid rgba(255,208,143,.4);border-radius:4px;color:var(--amber);letter-spacing:.08em;font-size:15px}
h1{margin:26px 0 12px;font-family:var(--serif);font-weight:400;font-size:50px;line-height:1.04;letter-spacing:-.005em;max-width:1060px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.summary{max-width:1000px;font-size:19px;line-height:1.45;color:var(--muted)}
.summary p{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.touched{margin-top:16px;font-family:var(--mono);font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--ice)}
.grid{margin-top:auto;display:grid;grid-template-columns:1.55fr 1fr 0.95fr;gap:16px}
.panel{position:relative;padding:16px 18px 16px;border:1px solid var(--hair);border-radius:6px;background:var(--panel);overflow:hidden}
.panel::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.035),transparent 45%);pointer-events:none}
.label{display:flex;align-items:baseline;gap:8px;margin-bottom:11px;padding-bottom:9px;border-bottom:1px solid var(--hair-soft);font-family:var(--mono);font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.label .aside{margin-left:auto;letter-spacing:.04em;text-transform:none;color:var(--muted)}
ul{list-style:none}
.areas li{display:grid;grid-template-columns:96px 1fr 62px 52px 46px;align-items:center;gap:10px;height:24px;font-size:14px}
.areas .area{color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.areas .bar{height:5px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
.areas .bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,rgba(143,232,255,.55),var(--ice))}
.num{font-family:var(--mono);font-size:12.5px;color:var(--faint);text-align:right;white-space:nowrap}
.num.add{color:var(--mint)}.num.del{color:var(--rose)}.num.zero{color:var(--dim)}
.areas .more{display:block;font-size:12.5px;color:var(--faint);height:auto;margin-top:4px}
.checks li{display:flex;align-items:center;gap:10px;height:24px;font-size:14px}
.checks b{width:8px;height:8px;border-radius:50%;background:var(--dim);flex:none}
.checks .pass b{background:var(--mint);box-shadow:0 0 8px rgba(125,255,196,.6)}
.checks .fail b{background:var(--rose);box-shadow:0 0 8px rgba(255,107,139,.6)}
.checks span{font-family:var(--mono);font-size:13px}
.checks em{margin-left:auto;font-style:normal;font-size:12.5px;color:var(--faint)}
.checks .fail em{color:var(--rose)}
.verdict-green{color:var(--mint)!important}.verdict-red{color:var(--rose)!important}.verdict-partial{color:var(--amber)!important}
.who .name{font-family:var(--serif);font-size:30px;line-height:1.1}
.who .model{margin-top:4px;font-size:15px;color:var(--ice)}
.who dl{margin-top:14px;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12.5px}
.who dt{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);padding-top:1px}
.who dd{font-family:var(--mono);color:var(--faint);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
</style></head><body>
<div class="top"><span class="mark">◆ The Foundry</span><span>Change card</span><span class="issue">#${issue}</span></div>
<h1>${title}</h1>
<div class="summary">${lines}</div>
${groups.length ? `<div class="touched">${escapeHtml(areaLine(groups))}</div>` : ""}
<div class="grid">
  <section class="panel areas"><div class="label">Areas touched<span class="aside">${sum.files} ${sum.files === 1 ? "file" : "files"} · <span class="num add">+${sum.added}</span> <span class="num del">−${sum.removed}</span></span></div><ul>${areaRows || '<li class="more">no files changed</li>'}${restRow}</ul></section>
  <section class="panel checks"><div class="label">Checks<span class="aside verdict-${verdict}">${verdict === "none" ? "" : verdict}</span></div><ul>${checkRows}</ul></section>
  <section class="panel who"><div class="label">Built by</div><div class="name">${builder}</div>${model ? `<div class="model">on ${model}</div>` : ""}<dl>${branch ? `<dt>Branch</dt><dd>${branch}</dd>` : ""}${range ? `<dt>Diff</dt><dd>${range}</dd>` : ""}${date ? `<dt>Date</dt><dd>${date}</dd>` : ""}</dl></section>
</div>
</body></html>`;
}
