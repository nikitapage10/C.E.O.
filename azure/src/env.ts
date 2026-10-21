/**
 * Key Vault references that haven't resolved count as unset (docs/AZURE.md, "After the paste").
 *
 * On Azure every secret is an app setting of the form `@Microsoft.KeyVault(VaultName=…;SecretName=…)`, which the
 * platform swaps for the secret's value at start-up. Until the secret exists (or while the Function App can't read
 * the vault) the setting holds that literal text, and the code would take it for a real key: a "Claude key" that is
 * a vault address, a "Desk key" anyone can read in the template. So such values are removed from the environment
 * before any handler runs, and the code behaves as it does on Vercel with the setting missing.
 *
 * Imported first by azure/src/index.ts, so it runs before the api/ modules load.
 */

export const KEY_VAULT_PREFIX = "@Microsoft.KeyVault(";

/** Whether a setting's value is an unresolved Key Vault reference. */
export const isKeyVaultRef = (value: string | undefined): boolean => typeof value === "string" && value.trim().startsWith(KEY_VAULT_PREFIX);

/** A setting's value, or undefined when it is missing or still an unresolved Key Vault reference. */
export const envValue = (env: Record<string, string | undefined>, name: string): string | undefined => {
  const v = env[name];
  return isKeyVaultRef(v) ? undefined : v;
};

/** Remove every unresolved Key Vault reference from `env`; returns the names removed (never their values). */
export function dropKeyVaultRefs(env: Record<string, string | undefined> = process.env): string[] {
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (isKeyVaultRef(value)) {
      delete env[name];
      dropped.push(name);
    }
  }
  return dropped.sort();
}

const dropped = dropKeyVaultRefs();
if (dropped.length) console.warn(`Unresolved Key Vault references treated as unset: ${dropped.join(", ")}`);
