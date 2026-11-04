/**
 * The Desk's sign-in, browser side (#132; api/desk-auth.ts). Nikita unlocks the Desk with a passkey on an enrolled
 * device (the device's own fingerprint, face or PIN); a new device is enrolled once with the Desk key. The session
 * itself is an HttpOnly cookie the page never sees: this only knows whether it is signed in, until when, and on which
 * device, and renews it quietly while Nikita is using the Desk.
 */

import { create } from "zustand";
import { dropLocalPush, pushEndpoint } from "./pings.ts";

export interface Device {
  id: string;
  label: string;
  added: string;
  used: string | null;
  current: boolean;
}

export type AuthStatus = "checking" | "off" | "out" | "in";

export interface AuthView {
  status: AuthStatus;
  /** Signed in: the session ends at (ms) unless used again, and at the latest at hardUntil. */
  until?: number;
  hardUntil?: number;
  device?: string;
  devices?: Device[];
  /** Signed out: no try is taken before this (ms), after too many wrong ones. */
  lockedUntil?: number;
}

/** How a sign-in or enrolment went. */
export type AuthResult = "ok" | "cancelled" | "failed" | "locked" | "wrong-key" | "too-many" | "unsupported" | "off";

/* ── WebAuthn's binary fields as base64url, and back ── */

export function toB64url(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text: string): ArrayBuffer {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

type IdJson = { id: string; type?: string; transports?: string[] };
type CreateJson = Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
  challenge: string;
  user: { id: string; name: string; displayName: string };
  excludeCredentials?: IdJson[];
};
type RequestJson = Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & { challenge: string; allowCredentials?: IdJson[] };

const descriptor = (c: IdJson): PublicKeyCredentialDescriptor => ({ id: fromB64url(c.id), type: "public-key", ...(c.transports && { transports: c.transports as AuthenticatorTransport[] }) });

/** The server's registration options (JSON) as navigator.credentials.create() takes them. */
export function creationOptions(json: CreateJson): PublicKeyCredentialCreationOptions {
  return { ...json, challenge: fromB64url(json.challenge), user: { ...json.user, id: fromB64url(json.user.id) }, excludeCredentials: (json.excludeCredentials ?? []).map(descriptor) };
}

/** The server's sign-in options (JSON) as navigator.credentials.get() takes them. */
export function requestOptions(json: RequestJson): PublicKeyCredentialRequestOptions {
  return { ...json, challenge: fromB64url(json.challenge), allowCredentials: (json.allowCredentials ?? []).map(descriptor) };
}

/** A new passkey, as JSON for the server. */
export function registrationJson(cred: PublicKeyCredential) {
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    response: { clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject), transports: r.getTransports?.() ?? [] },
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    ...(cred.authenticatorAttachment && { authenticatorAttachment: cred.authenticatorAttachment }),
  };
}

/** A passkey's answer to a sign-in, as JSON for the server. */
export function assertionJson(cred: PublicKeyCredential) {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    response: { clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData), signature: toB64url(r.signature), ...(r.userHandle && { userHandle: toB64url(r.userHandle) }) },
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    ...(cred.authenticatorAttachment && { authenticatorAttachment: cred.authenticatorAttachment }),
  };
}

/** Whether this browser can use passkeys at all. */
export const canPasskey = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && Boolean(navigator.credentials);

/** A name for this device that Nikita can change before enrolling it: what it is, never who owns it. */
export function guessDevice(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux PC";
  return "This device";
}

/** "Try again in 14 min." / "in 40 s": how long a lockout has left. */
export function waitLine(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.ceil(s / 60)} min`;
}

/* ── The store ── */

const post = (body: unknown) => fetch("/api/desk-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });

/** A quiet renewal at most this often while Nikita is using the Desk. */
export const RENEW_MS = 5 * 60_000;

interface AuthStore {
  auth: AuthView;
  checked: number;
  /** Asks the server where the session stands (and so renews it). */
  check: () => Promise<void>;
  signIn: () => Promise<AuthResult>;
  enrol: (key: string, label: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  /** A function said the session is gone (401 signed-out). */
  lost: () => void;
}

type Status = { ready?: boolean; signedIn?: boolean; until?: number; hardUntil?: number; device?: string; devices?: Device[]; wait?: number };

function viewOf(s: Status, now: number): AuthView {
  if (!s.ready) return { status: "off" };
  if (s.signedIn) return { status: "in", until: s.until, hardUntil: s.hardUntil, device: s.device, devices: s.devices ?? [] };
  return { status: "out", ...(s.wait && { lockedUntil: now + s.wait * 1000 }) };
}

const lockedFrom = async (res: Response) => Date.now() + Number(((await res.json().catch(() => ({}))) as { wait?: number }).wait ?? 60) * 1000;

/**
 * Sign-in options fetched ahead, so a tap goes straight to the passkey prompt: some browsers (Safari) only show it
 * while the tap is fresh, and a round trip first can use that up. The challenge in them lasts five minutes.
 */
let ahead: { options: Promise<Response | null>; at: number } | null = null;
const AHEAD_MS = 4 * 60_000;

/** Fetches sign-in options ahead of a tap (once; again when the last ones are spent or getting old). */
export function prepareSignIn(): void {
  if (ahead && Date.now() - ahead.at < AHEAD_MS) return;
  ahead = { options: post({ action: "signin-options" }).catch(() => null), at: Date.now() };
}

function takeOptions(): Promise<Response | null> {
  const fresh = ahead && Date.now() - ahead.at < AHEAD_MS ? ahead.options : null;
  ahead = null;
  return fresh ?? post({ action: "signin-options" });
}

export const useDeskAuth = create<AuthStore>((set, get) => ({
  auth: { status: "checking" },
  checked: 0,
  check: async () => {
    set({ checked: Date.now() });
    try {
      const res = await fetch("/api/desk-auth", { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const auth = viewOf((await res.json()) as Status, Date.now());
      set({ auth });
      if (auth.status === "out" && canPasskey()) prepareSignIn();
    } catch {
      // No function here (a local dev server, or offline): the Desk reads as usual and its buttons stay off.
      if (get().auth.status === "checking") set({ auth: { status: "off" } });
    }
  },
  signIn: async () => {
    if (!canPasskey()) return "unsupported";
    try {
      const opts = await takeOptions();
      if (!opts) return "failed";
      if (opts.status === 503) return "off";
      if (!opts.ok) return "failed";
      let cred: PublicKeyCredential | null;
      try {
        cred = (await navigator.credentials.get({ publicKey: requestOptions((await opts.json()) as RequestJson) })) as PublicKeyCredential | null;
      } catch {
        // Closed, timed out, or no passkey for the Desk on this device. The next tap has options ready.
        prepareSignIn();
        return "cancelled";
      }
      if (!cred) return "cancelled";
      const res = await post({ action: "signin", response: assertionJson(cred) });
      if (res.status === 429) {
        set({ auth: { status: "out", lockedUntil: await lockedFrom(res) } });
        return "locked";
      }
      if (!res.ok) {
        prepareSignIn();
        return "failed";
      }
      await get().check();
      return "ok";
    } catch {
      return "failed";
    }
  },
  enrol: async (key, label) => {
    if (!canPasskey()) return "unsupported";
    try {
      const opts = await post({ action: "enrol-options", key, label });
      if (opts.status === 429) {
        set({ auth: { status: "out", lockedUntil: await lockedFrom(opts) } });
        return "locked";
      }
      if (opts.status === 401) return "wrong-key";
      if (opts.status === 409) return "too-many";
      if (opts.status === 503) return "off";
      if (!opts.ok) return "failed";
      let cred: PublicKeyCredential | null;
      try {
        cred = (await navigator.credentials.create({ publicKey: creationOptions((await opts.json()) as CreateJson) })) as PublicKeyCredential | null;
      } catch {
        return "cancelled";
      }
      if (!cred) return "cancelled";
      const res = await post({ action: "enrol", response: registrationJson(cred) });
      if (res.status === 429) {
        set({ auth: { status: "out", lockedUntil: await lockedFrom(res) } });
        return "locked";
      }
      if (res.status === 409) return "too-many";
      if (!res.ok) return "failed";
      await get().check();
      return "ok";
    } catch {
      return "failed";
    }
  },
  signOut: async () => {
    // Signing out stops this device's pings too (#135): the server drops its subscription, and so does the browser.
    const endpoint = await pushEndpoint();
    await post({ action: "signout", ...(endpoint && { endpoint }) }).catch(() => null);
    if (endpoint) await dropLocalPush();
    set({ auth: { status: "out" } });
    prepareSignIn();
  },
  remove: async (id) => {
    const mine = get().auth.devices?.find((d) => d.id === id)?.current === true;
    const res = await post({ action: "remove", id }).catch(() => null);
    // The server drops a removed device's pings; when it is this one, the browser lets go of its subscription too.
    if (res?.ok && mine) await dropLocalPush();
    await get().check();
    return Boolean(res?.ok);
  },
  lost: () => {
    if (get().auth.status !== "in") return;
    set({ auth: { status: "out" } });
    if (canPasskey()) prepareSignIn();
  },
}));

/** Signed in already, or signs in now with a passkey (one tap on an enrolled device). */
export async function ensureSignedIn(): Promise<AuthResult> {
  const { auth, signIn } = useDeskAuth.getState();
  if (auth.status === "in" && (auth.until ?? 0) > Date.now()) return "ok";
  return signIn();
}

let started = false;

/**
 * Checks the session when the Desk opens, and renews it quietly while Nikita is using it: on a click or a key, at most
 * every five minutes. A Desk left alone lets its session run out after 30 minutes, as it should.
 */
export function startDeskAuth(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    // Before #132 the Desk kept the typed key in this browser; it is only an enrolment secret now, so it goes.
    localStorage.removeItem("ceo.deskKey");
  } catch {
    /* no storage here: nothing to clear */
  }
  void useDeskAuth.getState().check();
  const touch = () => {
    const { auth, checked, check } = useDeskAuth.getState();
    if (auth.status === "in" && Date.now() - checked > RENEW_MS) void check();
    else if (auth.status === "in" && (auth.until ?? 0) <= Date.now()) useDeskAuth.setState({ auth: { status: "out" } });
  };
  window.addEventListener("pointerdown", touch, { passive: true });
  window.addEventListener("keydown", touch, { passive: true });
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && touch());
}
