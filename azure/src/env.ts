/**
 * Key Vault references that haven't resolved count as unset (docs/AZURE.md, "After the paste").
 *
 * On Azure every secret is an app setting of the form `@Microsoft.KeyVault(VaultName=…;SecretName=…)`, which the
 * platform swaps for the secret's value at start-up. Until the secret exists (or while the Function App can't read
 * the vault) the setting holds that literal text, and the code would take it for a real key: a "Claude key" that is
 * a vault address, a "Desk key" anyone can read in the template. So such values are removed from the environment
 * before any handler runs, and the code behaves as it does on Vercel with the setting missing. The same goes for a
 * secret that exists but is empty (or only whitespace).
 *
 * Imported first by azure/src/index.ts, so it runs before the api/ modules load.
 */

export const KEY_VAULT_PREFIX = "@Microsoft.KeyVault(";

/**
 * The app settings that are Key Vault references (infra/resources.bicep, `secrets`; a unit test keeps the two in
 * step). Their resolved values are trimmed, and an empty one counts as unset: a secret pasted in the portal with a
 * stray line break, or made empty to switch something off, must not become a key that is "set" but useless.
 */
export const SECRET_SETTINGS = [
  "FOUNDRY_DESK_KEY",
  "FOUNDRY_APP_ID",
  "FOUNDRY_APP_INSTALLATION_ID",
  "FOUNDRY_APP_PRIVATE_KEY",
  "FOUNDRY_GITHUB_TOKEN",
  "CLAUDE_API_KEY",
  "GEMINI_API_KEY",
  "DESK_VAPID_PUBLIC_KEY",
  "DESK_VAPID_PRIVATE_KEY",
  "DESK_VAPID_SUBJECT",
  "DESK_PINGS_SECRET",
  // The site lock's bypass for the live watch (#313): the workflow reads `site-bypass-token` from the vault too.
  "SITE_BYPASS_TOKEN",
  "FANTASYPROS",
  // Optional (#253): the Exchange's positions wait for them.
  "POLYMARKET_US_KEY_ID",
  "POLYMARKET_US_SECRET_KEY",
  // The email agent (#263): Google's OAuth client and the key that seals the Gmail token at rest.
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_TOKEN_KEY",
  // The Spire's invoices (#279): PayPal's REST app. PAYPAL_ENV (sandbox or live) is a plain setting.
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
] as const;

/** Whether a setting's value is an unresolved Key Vault reference (the platform's own spelling, in any case). */
export const isKeyVaultRef = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().toLowerCase().startsWith(KEY_VAULT_PREFIX.toLowerCase());

/** A setting's value, or undefined when it is missing or still an unresolved Key Vault reference. */
export const envValue = (env: Record<string, string | undefined>, name: string): string | undefined => {
  const v = env[name];
  return isKeyVaultRef(v) ? undefined : v;
};

/**
 * Remove every unresolved Key Vault reference from `env`, and every secret setting that resolved to nothing but
 * whitespace; trim the secret settings that remain. Returns the names removed (never their values).
 */
export function dropKeyVaultRefs(env: Record<string, string | undefined> = process.env): string[] {
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (isKeyVaultRef(value)) {
      delete env[name];
      dropped.push(name);
    }
  }
  for (const name of SECRET_SETTINGS) {
    const value = env[name];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "") {
      delete env[name];
      dropped.push(name);
    } else if (trimmed !== value) env[name] = trimmed;
  }
  return dropped.sort();
}

const dropped = dropKeyVaultRefs();
if (dropped.length) console.warn(`Unresolved or empty Key Vault settings treated as unset: ${dropped.join(", ")}`);
