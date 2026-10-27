/* global Buffer */
// The template on every deploy (#330, docs/AZURE.md, "The template on every deploy"): what deploy-azure.yml's infra
// job passes to infra/resources.bicep, and the checks it makes before applying it. Pure functions, unit-tested in
// azure-infra-lib.test.mjs; the job's shell only gathers the inputs with `az` and runs scripts/azure-infra.mjs.
//
// The rule: a template run from CI changes nothing that is live except what the template itself says. So every
// parameter that the Cloud Shell paste could have set differently is read back from what is running (the home
// address, PayPal's mode, the three budgets, the log cap), and the template's own defaults (infra/main.bicep) fill in
// only what isn't there. No secret passes through: the template takes none, and the only app setting values read are
// the five plain ones above.

/** App settings the job reads back (values), by the template parameter each one feeds. */
export const LIVE_SETTINGS = {
  CEO_SITE_URL: "siteOnCustomDomain",
  PAYPAL_ENV: "paypalEnv",
  WORLD_BUDGET_USD: "worldBudgetUsd",
  SKIPPY_BUDGET_USD: "skippyBudgetUsd",
  EMAIL_BUDGET_USD: "emailBudgetUsd",
  // The always-on Kernel responder (#501): its off switch and its own cap, kept as set (a setting turned off in the
  // portal stays off through a deploy).
  KERNEL_AGENT_ENABLED: "kernelAgentEnabled",
  KERNEL_AGENT_BUDGET_USD: "kernelAgentBudgetUsd",
};

/**
 * Settings the template doesn't list but may be dropped by a run: the throwaway refresh switch, set again after, and
 * Gemini's speech key and cap, retired when ElevenLabs became the only voice (#472; Visual QA keeps its own key as a
 * GitHub Actions secret).
 */
export const DROPPABLE = ["KEYVAULT_REFRESH", "GEMINI_API_KEY", "GEMINI_BUDGET_USD"];

/** The custom home address (docs/DOMAIN.md); any other CEO_SITE_URL means the azurestaticapps.net one. */
export const CUSTOM_HOME = "https://ceo.nikita.page";

/** The parameters infra/resources.bicep takes, in its order. */
export const RESOURCE_PARAMS = [
  "location",
  "staticSiteLocation",
  "deployerPrincipalId",
  "githubPrincipalId",
  "repositoryToken",
  "logDailyCapGb",
  "worldBudgetUsd",
  "skippyBudgetUsd",
  "emailBudgetUsd",
  "kernelAgentEnabled",
  "kernelAgentBudgetUsd",
  "paypalEnv",
  "siteOnCustomDomain",
  "tags",
];

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^\d{1,3}(\.\d{1,2})?$/;
const CAP = /^\d{1,2}(\.\d{1,3})?$/;

/** Every app setting name the template writes: the plain ones and the Key Vault references. */
export function templateSettings(bicep) {
  const plain = [...bicep.matchAll(/\{ name: '([A-Za-z0-9_]+)', value: /g)].map((m) => m[1]);
  const secret = [...bicep.matchAll(/\{ setting: '([A-Z0-9_]+)', secret: '[a-z0-9-]+' \}/g)].map((m) => m[1]);
  return [...new Set([...plain, ...secret])].sort();
}

/** Live settings a template run would remove (the template replaces the whole list), minus the throwaway ones. */
export function droppedSettings(liveNames, templateNames) {
  const keep = new Set([...templateNames, ...DROPPABLE]);
  return [...new Set(liveNames)].filter((n) => typeof n === "string" && !keep.has(n)).sort();
}

/** The template's own default for a parameter of infra/main.bicep (compiled to JSON), or undefined. */
const defaultOf = (main, name) => main?.parameters?.[name]?.defaultValue;

/**
 * The parameters file for infra/resources.bicep. `live` is the five settings above as { name: value }; `cap` the log
 * workspace's daily cap as read; `deployer` and `github` the two principal ids (empty skips their roles, as on the
 * paste, which never removes a role already there). Returns { file, notes }: the ARM parameters file and what was
 * read back or defaulted, in words, for the run's summary (names and plain values only).
 */
export function buildParams({ main, live = {}, cap = "", deployer = "", github = "" }) {
  const notes = [];
  const pick = (param, value, ok) => {
    const fallback = defaultOf(main, param);
    if (value !== undefined && value !== null && value !== "" && ok(String(value))) {
      notes.push(`${param}: ${value} (kept from what is live)`);
      return String(value);
    }
    notes.push(`${param}: ${fallback} (the template's default)`);
    return fallback;
  };
  const site = typeof live.CEO_SITE_URL === "string" ? live.CEO_SITE_URL.trim().replace(/\/$/, "") : "";
  const siteOnCustomDomain = site === CUSTOM_HOME;
  notes.push(`siteOnCustomDomain: ${siteOnCustomDomain} (CEO_SITE_URL is ${site || "not set"})`);
  const id = (v) => (typeof v === "string" && GUID.test(v.trim()) ? v.trim() : "");
  const values = {
    location: defaultOf(main, "location"),
    staticSiteLocation: defaultOf(main, "staticSiteLocation"),
    deployerPrincipalId: id(deployer),
    githubPrincipalId: id(github),
    repositoryToken: "",
    logDailyCapGb: pick("logDailyCapGb", cap === "" ? "" : String(Number(cap)), (v) => CAP.test(v) && Number(v) > 0),
    worldBudgetUsd: pick("worldBudgetUsd", live.WORLD_BUDGET_USD, (v) => MONEY.test(v)),
    skippyBudgetUsd: pick("skippyBudgetUsd", live.SKIPPY_BUDGET_USD, (v) => MONEY.test(v)),
    emailBudgetUsd: pick("emailBudgetUsd", live.EMAIL_BUDGET_USD, (v) => MONEY.test(v)),
    kernelAgentEnabled: pick("kernelAgentEnabled", live.KERNEL_AGENT_ENABLED, (v) => v === "true" || v === "false"),
    kernelAgentBudgetUsd: pick("kernelAgentBudgetUsd", live.KERNEL_AGENT_BUDGET_USD, (v) => MONEY.test(v) && Number(v) <= 10),
    paypalEnv: pick("paypalEnv", live.PAYPAL_ENV, (v) => v === "sandbox" || v === "live"),
    siteOnCustomDomain,
    tags: defaultOf(main, "tags"),
  };
  notes.push(`deployerPrincipalId: ${values.deployerPrincipalId ? "found" : "none (the deployer's roles are left as they are)"}`);
  notes.push(`githubPrincipalId: ${values.githubPrincipalId ? "found" : "none (GitHub's roles are left as they are)"}`);
  for (const p of RESOURCE_PARAMS) if (values[p] === undefined) throw new Error(`no value for ${p}: is infra/main.bicep's default missing?`);
  const parameters = Object.fromEntries(RESOURCE_PARAMS.map((p) => [p, { value: values[p] }]));
  return { file: { $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#", contentVersion: "1.0.0.0", parameters }, notes };
}

/**
 * The what-if's changes as plain lines: the change and the resource, and for a change in place the property paths
 * that change (never their values: a path says enough, and an app setting's value never reaches the log). `deletes`
 * counts anything the run would delete, which an incremental run never should.
 */
export function whatIfSummary(result) {
  const changes = Array.isArray(result?.changes) ? result.changes : [];
  const counts = {};
  const lines = [];
  let deletes = 0;
  const paths = (delta, prefix = "") =>
    (Array.isArray(delta) ? delta : []).flatMap((d) => {
      const path = prefix ? `${prefix}.${d.path}` : String(d.path);
      return Array.isArray(d.children) && d.children.length ? paths(d.children, path) : [`${path} (${String(d.propertyChangeType ?? "").toLowerCase()})`];
    });
  for (const c of changes) {
    const kind = String(c.changeType ?? "Unknown");
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (kind === "Delete") deletes++;
    const id = String(c.resourceId ?? "");
    const short = id.replace(/^.*\/providers\//, "");
    if (kind === "NoChange" || kind === "Ignore") continue;
    lines.push(`${kind}: ${short}`);
    if (kind === "Modify") for (const p of paths(c.delta).slice(0, 30)) lines.push(`    ${p}`);
  }
  const head = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  return { head: head || "no changes", lines, deletes };
}

/** The `oid` claim of an access token (the identity's object id), or "" when it can't be read. */
export function tokenObjectId(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.oid === "string" && GUID.test(payload.oid) ? payload.oid : "";
  } catch {
    return "";
  }
}

/** Roles that let the deploy identity write role assignments on the group: the designed one, or the fallbacks. */
export const ASSIGNING_ROLES = ["Role Based Access Control Administrator", "User Access Administrator", "Owner"];

/** Whether the deploy identity can write the template's role assignments (from its role names on the group). */
export const canAssign = (roleNames) => (Array.isArray(roleNames) ? roleNames : []).some((r) => ASSIGNING_ROLES.includes(r));
