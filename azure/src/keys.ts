/**
 * Keys set from the Desk take effect without a restart (#330). The Function App reads its keys through Key Vault
 * references, which the platform resolves at start-up and then only now and then; a key replaced on the Desk would
 * otherwise wait for that. So for the allowlisted keys only (api/_keys/allowlist.ts), this instance keeps its own
 * copy fresh: at most every two minutes, before a request or a timer runs, it lists the vault's dates (never values)
 * and reads the value of an allowlisted key that is new or newer than the one it holds, into its own app setting.
 * The instance that wrote a key takes it at once (keyWriter's onSet). Nothing else in the environment is touched: the
 * Desk key, the bypass and the rest stay exactly as the platform resolved them.
 *
 * This is the option that needs no new permission: reading needs only Key Vault Secrets User, which the template has
 * always given the Function App. (Bumping an app setting from the app would need it to hold Website Contributor on
 * itself.) Logs carry setting names only.
 */

import { SETTABLE_KEYS } from "../../api/_keys/allowlist.js";
import type { SecretDates } from "../../api/_keys/vault.js";

type Env = Record<string, string | undefined>;

/** How often an instance looks for newer keys (ms). */
export const KEYS_FRESH_MS = 2 * 60_000;
/** The longest a request waits on the look (ms); past it the request goes ahead with what the instance has. */
export const KEYS_WAIT_MS = 2_500;

export interface KeySource {
  dates(): Promise<Map<string, SecretDates>>;
  read(name: string): Promise<string | null>;
}

export class KeyRefresh {
  /** Each allowlisted secret's version date this instance has loaded (or seen set here). */
  private readonly loaded = new Map<string, number | null>();
  private last = -Infinity;
  private running: Promise<string[]> | null = null;

  constructor(
    private readonly source: KeySource,
    private readonly env: Env = process.env,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  /** A value just written from this instance: the setting takes it now, and the next look won't read it again. */
  noteSet(secret: string, value: string, updated: number | null): void {
    const key = SETTABLE_KEYS.find((k) => k.secret === secret);
    if (!key) return;
    this.apply(key.setting, value);
    this.loaded.set(secret, updated);
  }

  private apply(setting: string, value: string): void {
    const v = value.trim();
    if (v) this.env[setting] = v;
    else delete this.env[setting];
  }

  /** Looks at most every KEYS_FRESH_MS; answers the settings it changed (names only). Never throws. */
  refresh(now: number = Date.now()): Promise<string[]> {
    if (this.running) return this.running;
    if (now - this.last < KEYS_FRESH_MS) return Promise.resolve([]);
    this.last = now;
    this.running = this.look()
      .catch(() => {
        this.log("keys refresh: the vault didn't answer");
        return [] as string[];
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** Waits for a look for at most KEYS_WAIT_MS. */
  async fresh(now: number = Date.now()): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.refresh(now), new Promise((resolve) => (timer = setTimeout(resolve, KEYS_WAIT_MS)))]);
    clearTimeout(timer);
  }

  private async look(): Promise<string[]> {
    const dates = await this.source.dates();
    const changed: string[] = [];
    await Promise.all(
      SETTABLE_KEYS.map(async (k) => {
        const d = dates.get(k.secret);
        if (!d?.enabled) return;
        if (this.loaded.has(k.secret) && this.loaded.get(k.secret) === d.updated) return;
        const value = await this.source.read(k.secret);
        if (value === null) return;
        const before = this.env[k.setting];
        this.apply(k.setting, value);
        this.loaded.set(k.secret, d.updated);
        if (this.env[k.setting] !== before) changed.push(k.setting);
      }),
    );
    if (changed.length) this.log(`keys refresh: took newer ${changed.sort().join(", ")}`);
    return changed;
  }
}
