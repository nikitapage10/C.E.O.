import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { dropKeyVaultRefs, envValue, isKeyVaultRef, SECRET_SETTINGS } from "./env.ts";

const REF = "@Microsoft.KeyVault(VaultName=kv-ceo-x;SecretName=claude-api-key)";

describe("unresolved Key Vault references", () => {
  it("are recognised, and nothing else is", () => {
    expect(isKeyVaultRef(REF)).toBe(true);
    expect(isKeyVaultRef(`  ${REF}`)).toBe(true);
    expect(isKeyVaultRef("@microsoft.keyvault(SecretUri=https://kv-ceo-x.vault.azure.net/secrets/gemini-api-key/)")).toBe(true);
    expect(isKeyVaultRef("sk-ant-real-looking")).toBe(false);
    expect(isKeyVaultRef("")).toBe(false);
    expect(isKeyVaultRef(undefined)).toBe(false);
    expect(isKeyVaultRef("see @Microsoft.KeyVault(")).toBe(false);
  });

  it("read as unset", () => {
    expect(envValue({ CLAUDE_API_KEY: REF }, "CLAUDE_API_KEY")).toBeUndefined();
    expect(envValue({ CLAUDE_API_KEY: "k" }, "CLAUDE_API_KEY")).toBe("k");
  });

  it("are dropped from the environment by name, leaving real values alone", () => {
    const env: Record<string, string | undefined> = { CLAUDE_API_KEY: REF, FOUNDRY_DESK_KEY: REF, WORLD_STORE: "azureblob", GEMINI_API_KEY: "g" };
    expect(dropKeyVaultRefs(env)).toEqual(["CLAUDE_API_KEY", "FOUNDRY_DESK_KEY"]);
    expect(env).toEqual({ WORLD_STORE: "azureblob", GEMINI_API_KEY: "g" });
  });

  it("are dropped from process.env when the module loads", async () => {
    process.env.CEO_TEST_KV = REF;
    vi.resetModules();
    await import("./env.ts");
    expect(process.env.CEO_TEST_KV).toBeUndefined();
  });

  it("count an empty or blank secret as unset, and trim the rest", () => {
    const env: Record<string, string | undefined> = { DESK_PINGS_SECRET: "", FANTASYPROS: "  \n", CLAUDE_API_KEY: " k\n", WORLD_BUDGET_USD: "", PATH_LIKE: " x " };
    expect(dropKeyVaultRefs(env)).toEqual(["DESK_PINGS_SECRET", "FANTASYPROS"]);
    // Only secret settings are touched: other settings keep their exact value, even an empty one.
    expect(env).toEqual({ CLAUDE_API_KEY: "k", WORLD_BUDGET_USD: "", PATH_LIKE: " x " });
  });

  it("count the role paste's placeholder as unset (#330)", () => {
    const env: Record<string, string | undefined> = { OPENAI_STUDIO_KEY: "ceo-placeholder-not-a-key", CLAUDE_API_KEY: "k" };
    expect(dropKeyVaultRefs(env)).toEqual(["OPENAI_STUDIO_KEY"]);
    expect(env).toEqual({ CLAUDE_API_KEY: "k" });
  });

  it("know every secret setting the infra template makes a Key Vault reference", () => {
    const bicep = readFileSync(new URL("../../infra/resources.bicep", import.meta.url), "utf8");
    const inTemplate = [...bicep.matchAll(/\{ setting: '([A-Z0-9_]+)', secret: '[a-z0-9-]+' \}/g)].map((m) => m[1]).sort();
    expect(inTemplate.length).toBeGreaterThan(0);
    expect([...SECRET_SETTINGS].sort()).toEqual(inTemplate);
  });
});
