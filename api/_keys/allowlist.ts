/**
 * The keys the Desk's Keys form may set (#330, docs/SECURITY.md, "Setting keys from the Desk"). Azure is the first
 * guard: the role paste (docs/AZURE.md) gives the Function App's identity Key Vault Secrets Officer on each of these
 * secrets alone, never on the vault, so it can't write any other secret whatever the code does. This list is defence
 * in depth on top of that: a name that isn't here is refused before the vault is called, whatever the request says.
 *
 * On it: third-party API keys and settings, which Nikita gets from another service and pastes in. Off it, by design:
 * everything that guards the lock, the crew or sealed data (the Desk key, the site bypass, the pings secret, the
 * crew's GitHub token and App, the push keys, the key that seals the Gmail token, the room threads' write key).
 * Replacing one of those from a browser would let a stolen session hand itself a way back in, so they stay with the
 * Cloud Shell paste. A unit test pins both lists and checks every secret in infra/resources.bicep is on exactly one.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export interface SettableKey {
  /** The Key Vault secret's name (infra/resources.bicep, `secrets`). */
  secret: string;
  /** The app setting it backs (azure/src/env.ts, SECRET_SETTINGS). */
  setting: string;
  /** What the Desk calls it. */
  label: string;
  /** Where it comes from, in a few words. */
  from: string;
}

export const SETTABLE_KEYS: readonly SettableKey[] = [
  { secret: "claude-api-key", setting: "CLAUDE_API_KEY", label: "Claude", from: "console.anthropic.com, API keys" },
  { secret: "gemini-api-key", setting: "GEMINI_API_KEY", label: "Gemini", from: "aistudio.google.com, Get API key" },
  { secret: "fantasypros", setting: "FANTASYPROS", label: "FantasyPros", from: "FantasyPros' API page" },
  { secret: "polymarket-us-key-id", setting: "POLYMARKET_US_KEY_ID", label: "Polymarket US key ID", from: "polymarket.us/developer" },
  { secret: "polymarket-us-secret-key", setting: "POLYMARKET_US_SECRET_KEY", label: "Polymarket US secret key", from: "polymarket.us/developer, shown once" },
  { secret: "gmail-client-id", setting: "GMAIL_CLIENT_ID", label: "Gmail client ID", from: "Google Cloud, OAuth client" },
  { secret: "gmail-client-secret", setting: "GMAIL_CLIENT_SECRET", label: "Gmail client secret", from: "Google Cloud, OAuth client" },
  { secret: "paypal-client-id", setting: "PAYPAL_CLIENT_ID", label: "PayPal client ID", from: "developer.paypal.com, REST app" },
  { secret: "paypal-client-secret", setting: "PAYPAL_CLIENT_SECRET", label: "PayPal client secret", from: "developer.paypal.com, REST app" },
  { secret: "elevenlabs", setting: "ELEVENLABS_API_KEY", label: "ElevenLabs", from: "elevenlabs.io, API keys" },
  { secret: "openai", setting: "OPENAI_STUDIO_KEY", label: "OpenAI (the Studio)", from: "platform.openai.com, API keys" },
  { secret: "email-skip-terms", setting: "EMAIL_SKIP_TERMS", label: "Email skip terms", from: "your own list, comma-separated" },
];

/**
 * Never settable from the Desk, even if someone adds them above by mistake: the test fails, and so does isSettable.
 * The patterns catch future names of the same kind (a new `foundry-app-…`, `desk-vapid-…` or `submind-…` secret).
 */
export const NEVER_SETTABLE: readonly (string | RegExp)[] = [
  "foundry-desk-key",
  "site-bypass-token",
  "desk-pings-secret",
  "foundry-github-token",
  /^foundry-app-/,
  /^desk-vapid-/,
  "gmail-token-key",
  /^submind-/,
  /^site-/,
  /^desk-/,
  /^foundry-/,
  /token/,
];

const blocked = (name: string) => NEVER_SETTABLE.some((n) => (typeof n === "string" ? n === name : n.test(name)));

/** The allowlisted key for this name, or null: unknown names, and anything on the never list, are refused. */
export function settable(name: unknown): SettableKey | null {
  if (typeof name !== "string" || name.length > 64 || blocked(name)) return null;
  return SETTABLE_KEYS.find((k) => k.secret === name) ?? null;
}

/**
 * The value the role paste gives a secret it has to create (#330, docs/AZURE.md), so that it exists for its own
 * per-secret role, with the tag below. Never a key: the Desk shows such a secret as not set, the key refresh and the
 * start-up (azure/src/env.ts) treat it as unset, and the form won't take it as a value.
 */
export const KEY_PLACEHOLDER = "ceo-placeholder-not-a-key";
/** The tag the paste puts on a placeholder's version; setting a real value writes a new, untagged version. */
export const PLACEHOLDER_TAG = "ceo-placeholder";

/** Whether a value is the role paste's placeholder rather than a key. */
export const isPlaceholder = (value: string | null | undefined): boolean => typeof value === "string" && value.trim() === KEY_PLACEHOLDER;

/** The most a value may be: far above any key on the list (Key Vault's own limit is 25 KB). */
export const MAX_VALUE = 4096;

/** A value as it will be stored (trimmed), or null when it is empty, too long, or not plain text on one line. */
export function cleanValue(given: unknown): string | null {
  if (typeof given !== "string") return null;
  const value = given.trim();
  if (!value || value.length > MAX_VALUE || isPlaceholder(value)) return null;
  // One line of printable text: a stray paste of something else (a file, a whole page) doesn't land as a key.
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return value;
}
