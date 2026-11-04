/**
 * Amazon Cognito's SRP sign-in (USER_SRP_AUTH, then PASSWORD_VERIFIER), for the Whisker account (#632). Whisker's app
 * signs in through a Cognito user pool, as pylitterbot does with pycognito; this is the same exchange in TypeScript,
 * with node:crypto and BigInt only.
 *
 * The password never reaches Azure. SRP's private value is x = H(salt | H(poolName | userId | ":" | password)); the
 * inner digest depends only on the account, so the setup paste (docs/HOME-DEVICES.md) makes it once in Cloud Shell
 * (asking Cognito for the account's USER_ID_FOR_SRP first) and the Key Vault keeps that digest (WHISKER_SRP_DIGEST).
 * This file only ever combines it with the salt Cognito sends for each sign-in.
 *
 * The maths (RFC 5054's 3072-bit group, g = 2, and Cognito's own HKDF and claim) follows AWS's published
 * amazon-cognito-identity-js AuthenticationHelper. A refresh needs no password: REFRESH_TOKEN_AUTH with the stored
 * refresh token.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { callJson, VendorError, type Fetch } from "./http.js";
import { obj, str } from "./types.js";

export const N_HEX =
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF";
export const N = BigInt(`0x${N_HEX}`);
export const G = 2n;

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** AWS's padHex: even length, and a leading 00 when the top bit is set (so it reads as positive). */
export function padHex(n: bigint): string {
  let h = n.toString(16);
  if (h.length % 2) h = `0${h}`;
  else if ("89abcdef".includes(h[0]!)) h = `00${h}`;
  return h;
}

const hashHex = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
/** The SRP digest's shape: SHA-256 as 64 lowercase hex characters. */
export const SRP_DIGEST = /^[0-9a-f]{64}$/;
export const K = BigInt(`0x${hashHex(`${padHex(N)}${padHex(G)}`)}`);

/** Cognito's 16-byte key: HKDF-SHA256 over S with u as the salt and "Caldera Derived Key" as the info. */
export function hkdf(ikmHex: string, saltHex: string): Buffer {
  const prk = createHmac("sha256", Buffer.from(saltHex, "hex")).update(Buffer.from(ikmHex, "hex")).digest();
  return createHmac("sha256", prk).update(Buffer.concat([Buffer.from("Caldera Derived Key", "utf8"), Buffer.from([1])])).digest().subarray(0, 16);
}

/** The shared secret S for the client, from the server's salt and B and the account's SRP digest. */
export function clientSecret(a: bigint, A: bigint, B: bigint, saltHex: string, srpDigest: string): { S: bigint; u: bigint } {
  const u = BigInt(`0x${hashHex(padHex(A) + padHex(B))}`);
  if (u === 0n || B % N === 0n) throw new VendorError(502);
  if (!SRP_DIGEST.test(srpDigest)) throw new VendorError(401);
  const x = BigInt(`0x${hashHex(padHex(BigInt(`0x${saltHex}`)) + srpDigest)}`);
  const base = (B - K * modPow(G, x, N)) % N;
  return { S: modPow(base, a + u * x, N), u };
}

/** Cognito's timestamp: "Tue Nov 4 18:00:00 UTC 2026" (the day without a leading zero). */
export function cognitoTimestamp(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
}

export function claimSignature(key: Buffer, poolName: string, userId: string, secretBlock: string, timestamp: string): string {
  return createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(poolName + userId, "utf8"), Buffer.from(secretBlock, "base64"), Buffer.from(timestamp, "utf8")]))
    .digest("base64");
}

export interface CognitoTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Date.now() the id token stops working. */
  expires: number;
}

export interface CognitoPool {
  poolId: string;
  clientId: string;
}

const regionOf = (poolId: string) => poolId.split("_")[0]!;

async function idp(fetchFn: Fetch, pool: CognitoPool, target: string, body: unknown): Promise<Record<string, unknown>> {
  return obj(
    await callJson(fetchFn, `https://cognito-idp.${regionOf(pool.poolId)}.amazonaws.com/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}` },
      body: JSON.stringify(body),
    }),
  );
}

/** A JWT's expiry (ms), read without checking the signature (Cognito checked it; we only want the time). */
export function jwtExpiry(token: string): number {
  try {
    const exp = Number(obj(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"))).exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function tokensOf(auth: unknown, refreshFallback = ""): CognitoTokens {
  const r = obj(auth);
  const idToken = str(r.IdToken);
  const accessToken = str(r.AccessToken);
  const refreshToken = str(r.RefreshToken) || refreshFallback;
  if (!idToken || !accessToken || !refreshToken) throw new VendorError(502);
  return { idToken, accessToken, refreshToken, expires: jwtExpiry(idToken) };
}

/** Signs in with the email and the account's SRP digest. VendorError(401) when Cognito says no. */
export async function srpSignIn(fetchFn: Fetch, pool: CognitoPool, username: string, srpDigest: string, now: number, rand: () => Buffer = () => randomBytes(128)): Promise<CognitoTokens> {
  const a = BigInt(`0x${rand().toString("hex")}`) % N;
  const A = modPow(G, a, N);
  let init: Record<string, unknown>;
  try {
    init = await idp(fetchFn, pool, "InitiateAuth", { AuthFlow: "USER_SRP_AUTH", ClientId: pool.clientId, AuthParameters: { USERNAME: username, SRP_A: A.toString(16) } });
  } catch (e) {
    throw e instanceof VendorError && e.status === 400 ? new VendorError(401) : e;
  }
  if (init.ChallengeName !== "PASSWORD_VERIFIER") throw new VendorError(502);
  const c = obj(init.ChallengeParameters);
  const userId = str(c.USER_ID_FOR_SRP);
  const salt = str(c.SALT);
  const B = BigInt(`0x${str(c.SRP_B) || "0"}`);
  const secretBlock = str(c.SECRET_BLOCK);
  const poolName = pool.poolId.split("_")[1] ?? "";
  const { S, u } = clientSecret(a, A, B, salt, srpDigest);
  const key = hkdf(padHex(S), padHex(u));
  const timestamp = cognitoTimestamp(new Date(now));
  let answer: Record<string, unknown>;
  try {
    answer = await idp(fetchFn, pool, "RespondToAuthChallenge", {
      ChallengeName: "PASSWORD_VERIFIER",
      ClientId: pool.clientId,
      ChallengeResponses: { USERNAME: userId, PASSWORD_CLAIM_SECRET_BLOCK: secretBlock, TIMESTAMP: timestamp, PASSWORD_CLAIM_SIGNATURE: claimSignature(key, poolName, userId, secretBlock, timestamp) },
    });
  } catch (e) {
    throw e instanceof VendorError && e.status === 400 ? new VendorError(401) : e;
  }
  return tokensOf(answer.AuthenticationResult);
}

/** New id and access tokens from the refresh token. */
export async function refreshTokens(fetchFn: Fetch, pool: CognitoPool, refreshToken: string): Promise<CognitoTokens> {
  const r = await idp(fetchFn, pool, "InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: pool.clientId, AuthParameters: { REFRESH_TOKEN: refreshToken } });
  return tokensOf(r.AuthenticationResult, refreshToken);
}
