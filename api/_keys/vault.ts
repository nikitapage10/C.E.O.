/**
 * The Key Vault as the Keys form sees it (#330): it can set a secret and read the vault's list of names with their
 * dates. Nothing else: no way to read a value back, list values or delete, so a bug or a stolen session in the route
 * can't reach those either. The Azure SDK lives only in the azure/ package, which registers the real one at start-up
 * (azure/src/vault.ts), so it never ships with a Vercel function or the Desk; on Vercel nothing is registered and the
 * form says it lives on Azure.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export interface SecretDates {
  /** Whether the vault has it and it is enabled. */
  enabled: boolean;
  /** When its current version was written (ms). */
  updated: number | null;
}

export interface KeyWriter {
  /** Every secret's name with its dates; never a value. */
  dates(): Promise<Map<string, SecretDates>>;
  /** Writes a new version of one secret. Answers only when it was written (ms), never the value. */
  set(name: string, value: string): Promise<{ updated: number | null }>;
}

type Env = Record<string, string | undefined>;

let factory: ((env: Env) => KeyWriter | null) | null = null;

/** Called once by azure/src/index.ts; tests pass their own, and null to unregister. */
export function registerKeyWriter(make: ((env: Env) => KeyWriter | null) | null): void {
  factory = make;
}

/** The vault when it is registered and named (KEY_VAULT_URI, set by the template), else null. */
export function pickKeyWriter(env: Env = process.env): KeyWriter | null {
  return factory ? factory(env) : null;
}
