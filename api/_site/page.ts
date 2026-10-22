/**
 * The site's login page (#236, #238): "Sign in with passkey" (the Desk's passkey, api/desk-auth.ts) and "Add this
 * device" with the Desk key for a device that has none. No password: the passkey is the only way in. It shows the
 * same on Vercel (served by the middleware or /api/site-login) and on Azure (/api/site-login). Dark, in the
 * Desk's Weave look.
 *
 * The passkey needs a few lines of script. They are served from this site (/api/site-login?part=script, LOGIN_SCRIPT
 * below) with Subresource Integrity, under a CSP that allows only that: `default-src 'none'`, `script-src 'self'`,
 * `connect-src 'self'` (the script talks to /api/desk-auth and nothing else), inline styles, and forms posting here.
 * Nothing loads from anywhere else, and the page echoes nothing unescaped. Without script (or WebAuthn) the page
 * says a browser with passkeys is needed.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash } from "node:crypto";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A path on this site to go back to after signing in; anything else (another host, a scheme, a backslash) is "/". */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\r\n\t]/.test(value) || /^\/api\/site-login/.test(value)) return "/";
  return value;
}

export interface LoginPageOptions {
  next?: string;
  /** A line under the buttons: "off" (not set up), "unknown" (store down), "signed-out". */
  message?: "off" | "unknown" | "signed-out";
  /** Whether the Desk's passkeys can be used here (the Desk key is set on the server). Default: yes. */
  passkey?: boolean;
}

/** The login page's CSP: nothing but this site's own script (the passkey) and its calls to this site. */
export const LOGIN_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const LINES = {
  off: "Signing in isn’t set up on the server yet.",
  unknown: "The site can’t check right now. Try again in a minute.",
  "signed-out": "Signed out on this device.",
} as const;

export function loginPage(opts: LoginPageOptions = {}): string {
  const next = safeNext(opts.next);
  const passkey = opts.passkey !== false;
  const line = opts.message ? LINES[opts.message] : passkey ? "" : LINES.off;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="dark">
<title>C.E.O.</title>
<style>
  :root { --bg: #05070c; --panel: rgba(15, 19, 30, 0.66); --text: #eef1f7; --muted: #b2bbcb; --faint: #8790a5;
    --hair: rgba(255, 255, 255, 0.1); --hair-strong: rgba(255, 255, 255, 0.24); --ice: #9fd2ff; --rose: #f07a8f; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text);
    font: 15px/1.5 Manrope, "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; }
  body { display: grid; place-items: center; min-height: 100vh; padding: 16px;
    background: radial-gradient(60rem 40rem at 50% -10%, rgba(159, 210, 255, 0.08), transparent 60%), var(--bg); }
  main { width: min(100%, 360px); padding: 28px 24px; border: 1px solid var(--hair); border-radius: 16px; background: var(--panel); }
  h1 { margin: 0 0 4px; font-size: 13px; font-weight: 600; letter-spacing: 0.32em; color: var(--ice); }
  p { margin: 0 0 20px; color: var(--faint); font-size: 13px; }
  label { display: block; margin: 12px 0 8px; color: var(--muted); font-size: 13px; }
  input { width: 100%; padding: 11px 12px; border: 1px solid var(--hair-strong); border-radius: 10px; background: rgba(0, 0, 0, 0.35);
    color: var(--text); font: inherit; }
  input:focus, button:focus-visible, summary:focus-visible { outline: 2px solid var(--ice); outline-offset: 1px; }
  button { width: 100%; margin-top: 14px; padding: 11px 12px; border: 0; border-radius: 10px; background: var(--ice); color: #05070c;
    font: inherit; font-weight: 600; cursor: pointer; }
  button.quiet { background: transparent; color: var(--text); border: 1px solid var(--hair-strong); }
  button:disabled { opacity: 0.6; cursor: default; }
  details { margin-top: 16px; }
  summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  .help { margin: 16px 0 0; }
  .note { margin: 14px 0 0; color: var(--rose); font-size: 13px; }
  .note:empty { display: none; }
  [hidden] { display: none !important; }
</style></head>
<body><main data-next="${esc(next)}">
<h1>C.E.O.</h1>
<p>Private. Sign in once on this device.</p>
${
  passkey
    ? `<section id="pk" hidden>
<button id="pk-go" type="button">Sign in with passkey</button>
<details id="pk-add"><summary>New device with no passkey? Add it</summary>
<form id="pk-enrol">
<label for="pk-key">Desk key</label>
<input id="pk-key" type="password" autocomplete="off" required maxlength="256">
<label for="pk-name">This device’s name</label>
<input id="pk-name" type="text" autocomplete="off" maxlength="40" placeholder="Laptop">
<button type="submit" class="quiet">Add this device</button>
</form>
</details>
<p class="help">A passkey saved in Google Password Manager works on your other Chrome devices too. No passkey here? Add this device with the Desk key.</p>
</section>
<p class="help" id="pk-none">Signing in needs a browser with passkeys and JavaScript on.</p>
<script src="/api/site-login?part=script" integrity="${LOGIN_SCRIPT_SRI}" defer></script>`
    : ""
}
<p class="note" role="status" id="note">${line ? esc(line) : ""}</p>
</main></body></html>`;
}

/**
 * The passkey's script for the login page (#238): the Desk's own WebAuthn ceremony (api/desk-auth.ts), plain and
 * dependency-free. Sign-in options are fetched as the page opens, so a tap goes straight to the passkey prompt (some
 * browsers only show it while the tap is fresh). A successful sign-in or "Add this device" sets the site cookie and
 * the Desk's session (desk-auth.ts) and goes back to the page asked for.
 */
export const LOGIN_SCRIPT = `"use strict";
(function () {
  var main = document.querySelector("main");
  var box = document.getElementById("pk");
  var note = document.getElementById("note");
  if (!main || !box || !note || typeof window.PublicKeyCredential !== "function" || !navigator.credentials) return;
  var next = main.getAttribute("data-next") || "/";
  if (next.charAt(0) !== "/" || next.charAt(1) === "/" || next.indexOf("\\\\") >= 0) next = "/";
  box.hidden = false;
  var none = document.getElementById("pk-none");
  if (none) none.hidden = true;
  var go = document.getElementById("pk-go");
  var enrol = document.getElementById("pk-enrol");
  var busy = false;
  function say(t) { note.textContent = t; }
  function b64(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }
  function bin(t) {
    var s = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4));
    var o = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o.buffer;
  }
  function ids(list) {
    return (list || []).map(function (c) { var d = { id: bin(c.id), type: "public-key" }; if (c.transports) d.transports = c.transports; return d; });
  }
  function post(body) {
    return fetch("/api/desk-auth", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function wait(res) {
    return res.json().then(function (j) { return Math.max(1, Math.ceil(((j && j.wait) || 60) / 60)); }, function () { return 1; });
  }
  function extra(cred) {
    var out = { clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {} };
    if (cred.authenticatorAttachment) out.authenticatorAttachment = cred.authenticatorAttachment;
    return out;
  }
  var ahead = null;
  function prepare() { ahead = { at: Date.now(), res: post({ action: "signin-options" }).catch(function () { return null; }) }; }
  function options() {
    var a = ahead && Date.now() - ahead.at < 240000 ? ahead.res : post({ action: "signin-options" });
    ahead = null;
    return a;
  }
  async function signIn() {
    if (busy) return;
    busy = true; go.disabled = true; say("");
    try {
      var r = await options();
      if (!r || r.status === 503) return say(r ? "Passkeys aren’t set up on the server." : "The site can’t be reached. Try again.");
      if (!r.ok) return say("That didn’t go through. Try again.");
      var o = await r.json();
      o.challenge = bin(o.challenge);
      o.allowCredentials = ids(o.allowCredentials);
      var cred;
      try { cred = await navigator.credentials.get({ publicKey: o }); } catch (e) { cred = null; }
      if (!cred) { prepare(); return say("No passkey was used. If this device has none, add it below."); }
      var a = cred.response;
      var resp = { clientDataJSON: b64(a.clientDataJSON), authenticatorData: b64(a.authenticatorData), signature: b64(a.signature) };
      if (a.userHandle) resp.userHandle = b64(a.userHandle);
      var res = await post({ action: "signin", response: Object.assign({ id: cred.id, rawId: b64(cred.rawId), type: cred.type, response: resp }, extra(cred)) });
      if (res.status === 429) return say("Too many tries. Try again in " + (await wait(res)) + " min.");
      if (!res.ok) { prepare(); return say("That passkey didn’t open it. Try again."); }
      location.replace(next);
    } catch (e) {
      prepare();
      say("That didn’t go through. Try again.");
    } finally {
      busy = false; go.disabled = false;
    }
  }
  async function add(ev) {
    ev.preventDefault();
    if (busy) return;
    busy = true; say("");
    var button = enrol.querySelector("button");
    button.disabled = true;
    try {
      var key = document.getElementById("pk-key").value;
      var label = document.getElementById("pk-name").value || "A device";
      var r = await post({ action: "enrol-options", key: key, label: label });
      if (r.status === 401) return say("That isn’t the Desk key.");
      if (r.status === 409) return say("The Desk has as many devices as it can hold. Remove one from the Desk first.");
      if (r.status === 429) return say("Too many tries. Try again in " + (await wait(r)) + " min.");
      if (r.status === 503) return say("Passkeys aren’t set up on the server.");
      if (!r.ok) return say("That didn’t go through. Try again.");
      var o = await r.json();
      o.challenge = bin(o.challenge);
      o.user.id = bin(o.user.id);
      o.excludeCredentials = ids(o.excludeCredentials);
      var cred;
      try { cred = await navigator.credentials.create({ publicKey: o }); } catch (e) { cred = null; }
      if (!cred) return say("No passkey was made. Try again.");
      var a = cred.response;
      var resp = { clientDataJSON: b64(a.clientDataJSON), attestationObject: b64(a.attestationObject), transports: a.getTransports ? a.getTransports() : [] };
      var res = await post({ action: "enrol", response: Object.assign({ id: cred.id, rawId: b64(cred.rawId), type: cred.type, response: resp }, extra(cred)) });
      if (res.status === 429) return say("Too many tries. Try again in " + (await wait(res)) + " min.");
      if (res.status === 409) return say("The Desk has as many devices as it can hold. Remove one from the Desk first.");
      if (!res.ok) return say("That didn’t go through. Try again.");
      location.replace(next);
    } catch (e) {
      say("That didn’t go through. Try again.");
    } finally {
      busy = false; button.disabled = false;
    }
  }
  go.addEventListener("click", signIn);
  enrol.addEventListener("submit", add);
  prepare();
})();
`;

/** The script's Subresource Integrity, so the page runs exactly this script and nothing else at that address. */
export const LOGIN_SCRIPT_SRI = `sha256-${createHash("sha256").update(LOGIN_SCRIPT).digest("base64")}`;
