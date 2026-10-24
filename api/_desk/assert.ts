/**
 * One passkey answer checked against one challenge (#132): the WebAuthn check the Desk's sign-in uses, shared with
 * the Keys form's step-up (#330, api/_keys/route.ts) so both go through the same code. SimpleWebAuthn checks the
 * origin, the site, the challenge, the signature, user verification (the device's own unlock) and the counter.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Passkey } from "./store.js";

const toBytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64url"));

export type Assertion = { ok: true; counter: number } | { ok: false };

/** Whether `response` is `passkey`'s answer to `challenge` on this origin and site, with the device's own unlock. */
export async function checkAssertion(o: { response: AuthenticationResponseJSON | undefined; challenge: string; origin: string; rpID: string; passkey: Passkey }): Promise<Assertion> {
  if (!o.response || o.response.id !== o.passkey.id) return { ok: false };
  try {
    const result = await verifyAuthenticationResponse({
      response: o.response,
      expectedChallenge: o.challenge,
      expectedOrigin: o.origin,
      expectedRPID: o.rpID,
      credential: { id: o.passkey.id, publicKey: toBytes(o.passkey.publicKey), counter: o.passkey.counter, transports: o.passkey.transports },
      requireUserVerification: true,
    });
    return result.verified ? { ok: true, counter: result.authenticationInfo.newCounter } : { ok: false };
  } catch {
    return { ok: false };
  }
}
