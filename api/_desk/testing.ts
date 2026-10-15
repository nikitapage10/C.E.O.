/**
 * Test support for the Desk's sign-in (#132), imported only by tests: a signed-in session cookie for an enrolled test
 * device. (The Blob store's stand-in is next door, fakeBlob.ts.) Never imported by a function.
 */

import { deskKeyFor } from "./keys.js";
import { SESSION_COOKIE, newSession, signToken } from "./session.js";
import { BlobAuthStore, type AuthStore, type Passkey } from "./store.js";

export const TEST_PASSKEY: Passkey = { id: "test-passkey", publicKey: "AQID", counter: 0, label: "Test device", added: "2026-10-14T00:00:00.000Z" };

/** Enrols the test device in the store (the Blob one, mocked, by default) and returns a Cookie header with a fresh session. */
export async function signedInCookie(deskKey: string, now = Date.now(), store: AuthStore = new BlobAuthStore()): Promise<string> {
  const list = await store.passkeys();
  if (!list.some((p) => p.id === TEST_PASSKEY.id)) await store.savePasskeys([...list, TEST_PASSKEY]);
  return `${SESSION_COOKIE}=${signToken(await deskKeyFor(deskKey, "session"), newSession(TEST_PASSKEY.id, now))}`;
}
