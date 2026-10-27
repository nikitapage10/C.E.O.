/* global Buffer, URL */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildParams, canAssign, droppedSettings, RESOURCE_PARAMS, templateSettings, tokenObjectId, whatIfSummary } from "./azure-infra-lib.mjs";

const bicep = readFileSync(new URL("../infra/resources.bicep", import.meta.url), "utf8");
const mainBicep = readFileSync(new URL("../infra/main.bicep", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/deploy-azure.yml", import.meta.url), "utf8");

/** main.bicep's defaults as `az bicep build` would give them, read from the source for the test. */
function defaults() {
  const get = (name) => {
    const m = new RegExp(`param ${name} (?:string|bool|int) = '?([^'\\n]*)'?`).exec(mainBicep);
    return m ? m[1] : undefined;
  };
  const parameters = {};
  for (const p of ["location", "staticSiteLocation", "logDailyCapGb", "worldBudgetUsd", "skippyBudgetUsd", "emailBudgetUsd", "kernelAgentEnabled", "kernelAgentBudgetUsd", "paypalEnv"]) parameters[p] = { defaultValue: get(p) };
  parameters.tags = { defaultValue: { app: "ceo", env: "prod" } };
  return { parameters };
}

const ID = "11111111-2222-3333-4444-555555555555";

describe("the template on every deploy (#330)", () => {
  it("knows every app setting the template writes", () => {
    const names = templateSettings(bicep);
    for (const n of ["WORLD_STORE", "CEO_SITE_URL", "KEY_VAULT_URI", "PAYPAL_ENV", "AzureWebJobsStorage__accountName", "CLAUDE_API_KEY", "FOUNDRY_DESK_KEY", "SUBMIND_FEED_TOKEN"]) expect(names, n).toContain(n);
    expect(names).not.toContain("KEYVAULT_REFRESH");
  });

  it("refuses to drop a setting made outside the template, but not the refresh switch", () => {
    const names = templateSettings(bicep);
    expect(droppedSettings([...names, "KEYVAULT_REFRESH"], names)).toEqual([]);
    // Gemini's speech key and cap, retired by #472, go without holding the template back.
    expect(droppedSettings([...names, "GEMINI_API_KEY", "GEMINI_BUDGET_USD"], names)).toEqual([]);
    expect(names).not.toContain("GEMINI_API_KEY");
    expect(names).not.toContain("GEMINI_BUDGET_USD");
    expect(droppedSettings([...names, "OPENAI_API_KEY", "GREEN_BUDGET_USD"], names)).toEqual(["GREEN_BUDGET_USD", "OPENAI_API_KEY"]);
  });

  it("passes every parameter resources.bicep takes, and nothing else", () => {
    const declared = [...bicep.matchAll(/^param (\w+) /gm)].map((m) => m[1]);
    expect(RESOURCE_PARAMS).toEqual(declared);
    const { file } = buildParams({ main: defaults() });
    expect(Object.keys(file.parameters)).toEqual(declared);
    expect(file.parameters.repositoryToken.value).toBe("");
  });

  it("keeps what is live: the home address, PayPal's mode, the budgets and the log cap", () => {
    const { file } = buildParams({
      main: defaults(),
      live: { CEO_SITE_URL: "https://ceo.nikita.page", PAYPAL_ENV: "live", WORLD_BUDGET_USD: "3", SKIPPY_BUDGET_USD: "1", EMAIL_BUDGET_USD: "8", KERNEL_AGENT_ENABLED: "false", KERNEL_AGENT_BUDGET_USD: "4" },
      cap: "0.5",
      deployer: ID,
      github: ID,
    });
    const v = Object.fromEntries(Object.entries(file.parameters).map(([k, p]) => [k, p.value]));
    expect(v).toMatchObject({ siteOnCustomDomain: true, paypalEnv: "live", worldBudgetUsd: "3", skippyBudgetUsd: "1", emailBudgetUsd: "8", kernelAgentEnabled: "false", kernelAgentBudgetUsd: "4", logDailyCapGb: "0.5", deployerPrincipalId: ID, githubPrincipalId: ID, location: "westus3", staticSiteLocation: "westus2" });
  });

  it("falls back to the template's defaults, never to junk", () => {
    const { file } = buildParams({ main: defaults(), live: { CEO_SITE_URL: "https://thankful-forest-019308c1e.5.azurestaticapps.net", PAYPAL_ENV: "prod", WORLD_BUDGET_USD: "lots" }, cap: "", deployer: "me", github: "" });
    const v = Object.fromEntries(Object.entries(file.parameters).map(([k, p]) => [k, p.value]));
    expect(v).toMatchObject({ siteOnCustomDomain: false, paypalEnv: "sandbox", worldBudgetUsd: "6", skippyBudgetUsd: "2", emailBudgetUsd: "10", kernelAgentEnabled: "true", kernelAgentBudgetUsd: "10", logDailyCapGb: "0.2", deployerPrincipalId: "", githubPrincipalId: "" });
  });

  it("summarises the what-if by change and property path, never by value", () => {
    const result = {
      changes: [
        { changeType: "NoChange", resourceId: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv" },
        {
          changeType: "Modify",
          resourceId: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Web/sites/func",
          delta: [{ path: "properties.siteConfig", propertyChangeType: "Modify", children: [{ path: "appSettings[3].value", propertyChangeType: "Modify", before: "old-secret-ish", after: "new-secret-ish" }] }],
        },
        { changeType: "Create", resourceId: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Authorization/roleAssignments/x" },
      ],
    };
    const s = whatIfSummary(result);
    expect(s.head).toBe("1 Create, 1 Modify, 1 NoChange");
    expect(s.lines).toEqual(["Modify: Microsoft.Web/sites/func", "    properties.siteConfig.appSettings[3].value (modify)", "Create: Microsoft.Authorization/roleAssignments/x"]);
    expect(JSON.stringify(s)).not.toContain("secret-ish");
    expect(s.deletes).toBe(0);
    expect(whatIfSummary({ changes: [{ changeType: "Delete", resourceId: "x" }] }).deletes).toBe(1);
  });

  it("reads the deploy identity from its token, and knows which roles can assign", () => {
    const token = `h.${Buffer.from(JSON.stringify({ oid: ID })).toString("base64url")}.s`;
    expect(tokenObjectId(token)).toBe(ID);
    expect(tokenObjectId("junk")).toBe("");
    expect(canAssign(["Contributor"])).toBe(false);
    expect(canAssign(["Contributor", "Role Based Access Control Administrator"])).toBe(true);
  });

  it("the helper exits 3 and writes nothing when a setting would be dropped", () => {
    let code = 0;
    try {
      execFileSync("node", ["scripts/azure-infra.mjs", "params", "--main", "/dev/null", "--bicep", "infra/resources.bicep", "--names", "/dev/null"], { stdio: "pipe" });
    } catch (e) {
      code = e.status;
    }
    expect(code).not.toBe(0);
  });
});

describe("the deploy workflow's infra job (#330)", () => {
  const job = workflow.slice(workflow.indexOf("\n  infra:"), workflow.indexOf("\n  site:"));

  it("runs only for main, under the azure environment, at resource-group scope", () => {
    expect(job).toContain("github.ref == 'refs/heads/main'");
    expect(job).toContain("environment: azure");
    expect(job).toContain("az deployment group what-if -g");
    expect(job).toContain("az deployment group create -g");
    expect(job).not.toMatch(/az deployment sub|main\.bicep -p|--template-file infra\/main/);
    expect(workflow).not.toMatch(/^\s+pull_request/m);
  });

  it("pins every action by full SHA", () => {
    for (const m of workflow.matchAll(/uses: ([^\s]+)/g)) expect(m[1], m[1]).toMatch(/@[0-9a-f]{40}$/);
  });

  it("ships the code only after the template, and re-reads the vault after applying", () => {
    expect(workflow).toMatch(/\n {2}site:\n {4}needs: \[build, infra\]/);
    expect(workflow).toMatch(/\n {2}functions:\n {4}needs: \[build, infra\]/);
    expect(job).toContain("KEYVAULT_REFRESH=");
    expect(job).toMatch(/KEYVAULT_REFRESH=[^\n]+-o none/);
  });
});

describe("the role paste in docs/AZURE.md (#330)", () => {
  const doc = readFileSync(new URL("../docs/AZURE.md", import.meta.url), "utf8");
  const cond = doc.split("\n").find((l) => l.startsWith("COND=")) ?? "";

  it("lets the deploy identity assign exactly the template's roles, and delete none", () => {
    const templateRoles = new Set([...bicep.slice(bicep.indexOf("var roles = {"), bicep.indexOf("}", bicep.indexOf("var roles = {"))).matchAll(/'([0-9a-f-]{36})'/g)].map((m) => m[1]));
    expect(templateRoles.size).toBe(8);
    const inCondition = new Set([...cond.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]).filter((g) => g !== "00000000-0000-0000-0000-000000000000"));
    expect([...inCondition].sort()).toEqual([...templateRoles].sort());
    expect(cond).toContain("($N(ActionMatches{'$W/delete'})) OR (@Resource[$W:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {00000000-0000-0000-0000-000000000000})");
    // No "!" inside double quotes: Cloud Shell's bash would try to expand it as history.
    expect(cond).not.toContain("!");
  });

  it("never grants Owner, and never at the subscription", () => {
    const paste = doc.slice(doc.indexOf("**The one last paste**"), doc.indexOf("It prints one line per role"));
    expect(paste).not.toMatch(/--role "?Owner/);
    expect(paste).not.toMatch(/--scope "?\/subscriptions\/[^"\s]*"?\s/);
    expect(paste).toContain('--role "Role Based Access Control Administrator" --scope "$SCOPE" --condition "$COND" --condition-version 2.0');
  });
});
