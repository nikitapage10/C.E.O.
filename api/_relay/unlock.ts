import { deskKeyFor } from "../_desk/keys.js";
import { readCookie, readToken, signToken } from "../_desk/session.js";
import { UNLOCK_MS } from "./tokens.js";

/**
 * Relay's send unlock (docs/RELAY-PRIVACY.md, "The send path", step 1): an HttpOnly cookie, signed with a key derived
 * from the Desk key, naming the passkey whose fresh answer made it, good for 72 hours on that device. Two fresh
 * passkey answers make one: Relay's own "Unlock sending" step-up, and (#870, Nikita 2026-11-05, "Sign-in unlocks") the
 * Desk's passkey sign-in itself, which already asks the device's own unlock (user verification required). Each send
 * is still its own single-use, 10-minute request made by a tap; the unlock only spares a second passkey prompt.
 * Its own module so the Desk's sign-in can set it without loading Relay's route.
 */

export const UNLOCK_COOKIE = "__Host-ceo-relay-unlock";

/** Until when this device's send unlock holds for this session's passkey (ms), or null. */
export async function unlockedUntil(request: Request, deskKey: string, passkey: string, now: number): Promise<number | null> {
  const p = readToken(await deskKeyFor(deskKey, "relay"), readCookie(request, UNLOCK_COOKIE));
  if (!p || p.t !== "relay-unlock" || p.c !== passkey || typeof p.e !== "number") return null;
  const until = p.e * 1000;
  // Never longer than the unlock's own life, whatever a cookie says.
  return until > now && until <= now + UNLOCK_MS ? until : null;
}

/** The unlock cookie for this passkey, from now: 72 hours. Set only after a fresh, user-verified passkey answer. */
export async function unlockCookie(deskKey: string, passkey: string, now: number): Promise<{ cookie: string; until: number }> {
  const e = Math.floor((now + UNLOCK_MS) / 1000);
  const token = signToken(await deskKeyFor(deskKey, "relay"), { t: "relay-unlock", c: passkey, e });
  return { cookie: `${UNLOCK_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(UNLOCK_MS / 1000)}`, until: e * 1000 };
}

export const clearUnlock = () => `${UNLOCK_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
