import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the hub lives on the Mac and what it talks to (#535, docs/RELAY-PRIVACY.md). Nothing here is a secret: the
 * keys are in the login Keychain (./keychain.ts), never in a file, the launchd plist or the environment.
 */

/** The hub listens here, for BlueBubbles' webhook only, and nowhere else. */
export const HOST = "127.0.0.1";
export const PORT = 7420;

/** The site the hub reports to and polls (outbound HTTPS only; the hub opens no port to anything but BlueBubbles). */
export const SITE = "https://ceo.nikita.page";

/** BlueBubbles Server's own local API. */
export const BLUEBUBBLES = "http://127.0.0.1:1234";

/** The Keychain service every Relay item is filed under; each item's account is one of KEYCHAIN_ITEMS. */
export const KEYCHAIN_SERVICE = "CEO Relay";
/**
 * bluebubbles-password  typed by Nikita at install; the hub's way into BlueBubbles' local API
 * hub-token             from pairing: the hub's key to its own calls on the site
 * send-key              from pairing: checks the signature on every Desk request before the hub acts on it
 * local-key             made at install: the BlueBubbles webhook's and the relay command's key to the hub itself
 */
export const KEYCHAIN_ITEMS = ["bluebubbles-password", "hub-token", "send-key", "local-key"] as const;
export type KeychainItem = (typeof KEYCHAIN_ITEMS)[number];

/** The launchd job. */
export const LAUNCHD_LABEL = "page.nikita.ceo.relay";

export interface Paths {
  /** Relay's folder: the runtime, the hub bundle, the state file. Out of Time Machine and Spotlight. */
  home: string;
  state: string;
  config: string;
  logs: string;
  plist: string;
}

export function pathsFor(home = homedir()): Paths {
  const base = join(home, "Library", "Application Support", "CEO Relay");
  return {
    home: base,
    state: join(base, "relay.json"),
    config: join(base, "config.json"),
    logs: join(home, "Library", "Logs", "CEO Relay"),
    plist: join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`),
  };
}

/** What may be tuned without a new bundle, from config.json. */
export interface HubConfig {
  /** Dialtone's daily nudges, local time, [hour, minute]. */
  nudges: [number, number][];
}

export const DEFAULT_CONFIG: HubConfig = { nudges: [[12, 30], [18, 30]] };

/** The config from config.json's text, every field checked; anything odd falls back to the default. */
export function readConfig(raw: string | null): HubConfig {
  let o: Record<string, unknown>;
  try {
    o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    o = {};
  }
  const nudges = Array.isArray(o.nudges) && o.nudges.length <= 4 && o.nudges.every((n) => Array.isArray(n) && n.length === 2 && Number.isInteger(n[0]) && Number.isInteger(n[1]) && n[0] >= 7 && n[0] < 22 && n[1] >= 0 && n[1] < 60) ? (o.nudges as [number, number][]) : DEFAULT_CONFIG.nudges;
  return { nudges };
}
