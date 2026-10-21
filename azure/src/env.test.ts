import { describe, expect, it, vi } from "vitest";
import { dropKeyVaultRefs, envValue, isKeyVaultRef } from "./env.ts";

const REF = "@Microsoft.KeyVault(VaultName=kv-ceo-x;SecretName=claude-api-key)";

describe("unresolved Key Vault references", () => {
  it("are recognised, and nothing else is", () => {
    expect(isKeyVaultRef(REF)).toBe(true);
    expect(isKeyVaultRef(`  ${REF}`)).toBe(true);
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
});
