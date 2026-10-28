import { execFile, spawn } from "node:child_process";
import { KEYCHAIN_ITEMS, KEYCHAIN_SERVICE, type KeychainItem } from "./config.ts";

/**
 * Relay's secrets in the Mac's login Keychain (docs/RELAY-PRIVACY.md, "Access"): generic passwords under the service
 * "CEO Relay", one account per item (KEYCHAIN_ITEMS). Read with `security find-generic-password -w`; written by
 * piping the command into `security -i`, so a value is never on a command line where `ps` could see it. Nothing
 * here logs or returns an error's text.
 */

export interface Keychain {
  get(item: KeychainItem): Promise<string | null>;
  set(item: KeychainItem, value: string): Promise<void>;
  remove(item: KeychainItem): Promise<void>;
}

const SAFE = /^[A-Za-z0-9._~+/=-]{1,512}$/;

export const macKeychain: Keychain = {
  get: (item) =>
    new Promise((resolve) => {
      execFile("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", item, "-w"], { timeout: 10_000 }, (err, stdout) => resolve(err ? null : stdout.replace(/\n$/, "") || null));
    }),
  set: (item, value) =>
    new Promise((resolve, reject) => {
      // Only values Relay made itself go through here (tokens and keys, base64url); Nikita's password is typed
      // straight into `security` by the installer.
      if (!SAFE.test(value) || !(KEYCHAIN_ITEMS as readonly string[]).includes(item)) return reject(Object.assign(new Error("bad keychain value"), { name: "KeychainError" }));
      const child = spawn("/usr/bin/security", ["-i"], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => reject(Object.assign(new Error("keychain"), { name: "KeychainError" })));
      child.on("exit", (code) => (code === 0 ? resolve() : reject(Object.assign(new Error("keychain"), { name: "KeychainError" }))));
      child.stdin.end(`add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a ${item} -w "${value}"\n`);
    }),
  remove: (item) =>
    new Promise((resolve) => {
      execFile("/usr/bin/security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", item], { timeout: 10_000 }, () => resolve());
    }),
};

/** For tests. */
export function memoryKeychain(initial: Partial<Record<KeychainItem, string>> = {}): Keychain & { items: Partial<Record<KeychainItem, string>> } {
  const items = { ...initial };
  return {
    items,
    get: async (k) => items[k] ?? null,
    set: async (k, v) => {
      items[k] = v;
    },
    remove: async (k) => {
      delete items[k];
    },
  };
}
