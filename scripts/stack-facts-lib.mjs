// What C.E.O. runs on, read from the repo itself (#312), for Desk Skippy's <stack> block (api/_skippy/stack.ts).
// Pure reads of the checkout: the languages in it, the Node versions it names, the hosts its config and Bicep set up,
// the top-level dependencies of every workspace at their locked versions, and the outside services its server code
// calls. Only public facts: names and versions, never a key, an account id, a URL with a secret or anything from .env.
//
// `renderStackFacts(root)` is the committed file's text (a test fails when it falls behind the repo) and
// `renderStackDeps(root)` the lockfile's part, written at install and build time; scripts/stack-facts.mjs writes both.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Folders that are never the repo's own code. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "playwright-report", "test-results", ".claude", ".vercel"]);

/** The repo's files, relative and with forward slashes: git's list when there is one, else a walk. */
export function repoFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    const files = out.split("\0").filter(Boolean).filter((f) => !f.split("/").some((p) => SKIP_DIRS.has(p)));
    if (files.length) return files.sort();
  } catch {
    // No git (a build machine without the history): walk the tree instead.
  }
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else found.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return found.sort();
}

/** Source extensions and manifests, by language. */
const LANGUAGES = [
  { name: "TypeScript", ext: ["ts", "tsx", "mts", "cts"] },
  { name: "JavaScript", ext: ["js", "mjs", "cjs", "jsx"] },
  { name: "Shell", ext: ["sh", "bash"] },
  { name: "Bicep", ext: ["bicep"] },
  { name: "PHP", ext: ["php", "phtml"], manifests: ["composer.json", "composer.lock"] },
  { name: "Python", ext: ["py"], manifests: ["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"] },
  { name: "Java", ext: ["java", "jsp"], manifests: ["pom.xml", "build.gradle", "build.gradle.kts"] },
  { name: "Ruby", ext: ["rb"], manifests: ["Gemfile"] },
  { name: "Go", ext: ["go"], manifests: ["go.mod"] },
  { name: "Rust", ext: ["rs"], manifests: ["Cargo.toml"] },
  { name: "C#/.NET", ext: ["cs", "csproj", "fs"] },
];

/** Which languages the repo has code in, and which of the common server languages it has none of. */
export function languagesOf(files) {
  const exts = new Set(files.map((f) => (f.includes(".") ? f.slice(f.lastIndexOf(".") + 1).toLowerCase() : "")));
  const bases = new Set(files.map((f) => f.slice(f.lastIndexOf("/") + 1)));
  const present = [];
  const absent = [];
  for (const l of LANGUAGES) {
    const has = l.ext.some((e) => exts.has(e)) || (l.manifests ?? []).some((m) => bases.has(m));
    (has ? present : absent).push(l.name);
  }
  return { present, absent };
}

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const readText = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "");

/** The Node versions the repo names: package.json's engines, CI's setup-node, .nvmrc, and the Azure Function App's runtime. */
export function nodeOf(root, files) {
  const engines = readJson(root, "package.json").engines?.node ?? "";
  const ci = new Set();
  for (const f of files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))) {
    for (const m of readText(root, f).matchAll(/node-version:\s*["']?([\w.]+)/g)) ci.add(m[1]);
  }
  const nvmrc = readText(root, ".nvmrc").trim();
  if (nvmrc) ci.add(nvmrc.replace(/^v/, ""));
  const bicep = readText(root, "infra/resources.bicep");
  const azure = /runtime:\s*\{\s*name:\s*'node',\s*version:\s*'([\d.]+)'/.exec(bicep)?.[1] ?? null;
  return { engines, ci: [...ci].sort(), azure };
}

/** Where it runs, from the repo's own config: the Bicep (Azure, production since #313), vercel.json, the workflows. */
export function hostsOf(root, files, node) {
  const hosts = [];
  const bicep = readText(root, "infra/resources.bicep");
  if (bicep) {
    const parts = [];
    if (bicep.includes("'Microsoft.Web/staticSites@")) parts.push("Static Web Apps (the site)");
    if (/kind:\s*'functionapp/.test(bicep)) parts.push(`Azure Functions on Linux, Flex Consumption${node.azure ? `, Node.js ${node.azure}` : ""} (the api/ code, bundled by azure/build.mjs)`);
    if (bicep.includes("'Microsoft.Storage/storageAccounts@")) parts.push("Blob Storage for state and backups");
    if (bicep.includes("'Microsoft.KeyVault/vaults@")) parts.push("Key Vault for secrets");
    if (bicep.includes("'Microsoft.Insights/components@")) parts.push("Application Insights");
    if (parts.length) hosts.push(`Azure, production and the only home (infra/*.bicep): ${parts.join(", ")}`);
  }
  if (files.includes("vercel.json")) hosts.push("Vercel: being retired, nothing deploys there; vercel.json and its adapter code stay until it is switched off");
  if (files.some((f) => f.startsWith(".github/workflows/"))) hosts.push("GitHub Actions for CI, deploys and the scheduled jobs");
  return hosts;
}

/** The security gates CI runs on every change, from the workflows. */
export function checksOf(root, files) {
  const out = [];
  const checks = readText(root, ".github/workflows/checks.yml");
  const level = /npm audit --audit-level=(\w+)/.exec(checks)?.[1];
  if (level) out.push(`npm audit (fails at ${level} and above)`);
  if (checks.includes("npm audit signatures")) out.push("npm audit signatures");
  if (files.includes(".github/workflows/codeql.yml")) out.push("CodeQL");
  if (files.includes(".github/workflows/dependency-review.yml")) out.push("dependency review");
  if (files.includes(".github/dependabot.yml")) out.push("Dependabot");
  if (files.includes(".github/workflows/scorecard.yml")) out.push("OpenSSF Scorecard");
  return out;
}

/** The lockfile's entry for a workspace's dependency: nested under the workspace first, then hoisted. */
function lockedVersion(lock, workspace, name) {
  const nested = lock.packages[`${workspace ? `${workspace}/` : ""}node_modules/${name}`];
  const hoisted = lock.packages[`node_modules/${name}`];
  return (nested ?? hoisted)?.version ?? null;
}

/**
 * Every workspace's own dependencies at the versions the lockfile resolved, as "name version": workspace links, type
 * packages and web fonts left out (no code of theirs runs). Runtime and dev apart, each once, sorted.
 */
export function topLevelOf(lock) {
  const runtime = new Map();
  const dev = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path.includes("node_modules/") || entry.link) continue;
    for (const [field, into] of [["dependencies", runtime], ["devDependencies", dev]]) {
      for (const name of Object.keys(entry[field] ?? {})) {
        if (name.startsWith("@ceo/") || name.startsWith("@types/") || name.startsWith("@fontsource")) continue;
        const version = lockedVersion(lock, path, name);
        if (version) into.set(`${name} ${version}`, true);
      }
    }
  }
  for (const k of runtime.keys()) dev.delete(k);
  const sorted = (m) => [...m.keys()].sort();
  return { runtime: sorted(runtime), dev: sorted(dev) };
}

/** Every installed package in the lockfile, once per name and version, with whether it is only ever a dev dependency. */
export function lockedPackagesOf(lock) {
  const seen = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    const at = path.lastIndexOf("node_modules/");
    if (at < 0 || entry.link || !entry.version) continue;
    const name = entry.name ?? path.slice(at + "node_modules/".length);
    const key = `${name}@${entry.version}`;
    const devOnly = entry.dev === true;
    const prior = seen.get(key);
    seen.set(key, { name, version: entry.version, dev: prior ? prior.dev && devOnly : devOnly });
  }
  return [...seen.values()].sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1));
}

/** Database clients that would mean a database server somewhere. */
const DATABASES = ["pg", "mysql", "mysql2", "mongodb", "mongoose", "prisma", "@prisma/client", "redis", "ioredis", "sqlite3", "better-sqlite3", "@supabase/supabase-js", "firebase-admin", "@azure/cosmos", "@planetscale/database", "@neondatabase/serverless"];

/** Which of those the lockfile has (none means no database server). */
export const databasesOf = (packages) => [...new Set(packages.filter((p) => DATABASES.includes(p.name)).map((p) => p.name))].sort();

/** Outside services, by what the server code calls: a host or an SDK. Names only. */
const SERVICES = [
  ["GitHub API", /api\.github\.com/],
  ["Anthropic Claude API", /@anthropic-ai\/sdk|api\.anthropic\.com/],
  ["OpenAI API", /api\.openai\.com/],
  ["Google Gemini API", /generativelanguage\.googleapis\.com/],
  ["Gmail API", /gmail\.googleapis\.com/],
  ["Polymarket", /polymarket\.(?:com|us)/],
  ["Sleeper", /api\.sleeper\.(?:app|com)/],
  ["FantasyPros", /api\.fantasypros\.com/],
  ["PayPal", /api-m(?:\.sandbox)?\.paypal\.com/],
  ["Vercel Blob", /["']@vercel\/blob["']/],
  ["Azure Blob Storage", /["']@azure\/storage-blob["']/],
  ["Azure managed identity", /["']@azure\/identity["']/],
  ["Web Push (the browsers' push services)", /["']web-push["']/],
  ["OpenSSF Scorecard", /api\.securityscorecards\.dev/],
  ["OSV.dev", /api\.osv\.dev/],
];

/** Where the server code lives: the functions, their Azure wrapper, the middleware and the hub. Tests left out. */
const isServerSource = (f) => /^(?:api|azure\/src|apps\/hub\/src)\/.+\.(?:ts|mjs|js)$/.test(f) || f === "middleware.ts";
const isTest = (f) => /\.test\.(?:ts|mjs|js)$/.test(f) || f.includes("/_security/") || f.endsWith("/testing.ts");

export function servicesOf(root, files) {
  const text = files.filter((f) => isServerSource(f) && !isTest(f) && f !== "api/_skippy/stack.ts").map((f) => readText(root, f)).join("\n");
  return SERVICES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** The repo's own facts, from the checkout at `root`: they change only when the code does. */
export function stackFacts(root) {
  const files = repoFiles(root);
  const node = nodeOf(root, files);
  return {
    languages: languagesOf(files),
    node,
    hosts: hostsOf(root, files, node),
    checks: checksOf(root, files),
    services: servicesOf(root, files),
    databases: databasesOf(lockedPackagesOf(readJson(root, "package-lock.json"))),
  };
}

/** The lockfile's facts: they change with every dependency bump. */
export function stackDeps(root) {
  const lock = readJson(root, "package-lock.json");
  const packages = lockedPackagesOf(lock);
  return { deps: { dependencies: topLevelOf(lock), lockfile: { packages: packages.length, runtime: packages.filter((p) => !p.dev).length } }, packages };
}

/** api/_skippy/stack.ts, committed: a test fails when it falls behind the repo. */
export function renderStackFacts(root) {
  return `/**
 * What C.E.O. runs on, for Desk Skippy (#312). GENERATED by \`npm run stack:facts\` (scripts/stack-facts-lib.mjs) from
 * the repo: don't edit by hand. The build runs it, and a test fails when this file falls behind the repo. The
 * dependency versions are in stackDeps.ts, written at every install and build from the lockfile.
 * Public facts only: languages, versions, hosts and service names. Never a key or an account id.
 */

import type { StackFacts } from "./stackTypes.js";

export const STACK_FACTS: StackFacts = ${JSON.stringify(stackFacts(root), null, 2)};
`;
}

/**
 * api/_skippy/stackDeps.ts: not committed (it would fall behind with every Dependabot bump), written from the
 * lockfile by \`npm ci\` (postinstall) and by the build, so it always matches the packages installed.
 */
export function renderStackDeps(root) {
  const { deps, packages } = stackDeps(root);
  const rows = packages.map((p) => `  [${JSON.stringify(p.name)}, ${JSON.stringify(p.version)}, ${p.dev ? 1 : 0}],`).join("\n");
  return `/**
 * C.E.O.'s dependencies at their locked versions, for Desk Skippy (#312). GENERATED from package-lock.json by
 * scripts/stack-facts.mjs at every install and build; not committed. Names and versions only.
 */

import type { StackDeps } from "./stackTypes.js";

export const STACK_DEPS: StackDeps = ${JSON.stringify(deps, null, 2)};

/** Every locked package once: name, version, and 1 when it is only ever a dev dependency. For the OSV lookup. */
export const LOCKED_PACKAGES: readonly (readonly [string, string, 0 | 1])[] = [
${rows}
];
`;
}
