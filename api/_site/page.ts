/**
 * The site's login page (#236): one password field, nothing else. Plain HTML with inline styles and no script, so it
 * works under the site's CSP (no inline scripts), loads nothing from anywhere, and shows the same on Vercel (served by
 * the middleware or /api/site-login) and on Azure (/api/site-login). Dark, in the Desk's Weave look.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A path on this site to go back to after signing in; anything else (another host, a scheme, a backslash) is "/". */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\r\n\t]/.test(value) || /^\/api\/site-login/.test(value)) return "/";
  return value;
}

export interface LoginPageOptions {
  next?: string;
  /** A line under the field: "wrong" (generic), "locked" (with minutes), "off" (not set up), "unknown" (store down). */
  message?: "wrong" | "locked" | "off" | "unknown" | "signed-out";
  waitMinutes?: number;
}

const LINES = {
  wrong: "That didn’t open it. Try again.",
  off: "Signing in isn’t set up on the server yet.",
  unknown: "The site can’t check right now. Try again in a minute.",
  "signed-out": "Signed out on this device.",
} as const;

export function loginPage(opts: LoginPageOptions = {}): string {
  const next = safeNext(opts.next);
  const line =
    opts.message === "locked"
      ? `Too many tries. Try again in ${Math.max(1, Math.ceil(opts.waitMinutes ?? 1))} minute${Math.ceil(opts.waitMinutes ?? 1) === 1 ? "" : "s"}.`
      : opts.message
        ? LINES[opts.message]
        : "";
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
  label { display: block; margin-bottom: 8px; color: var(--muted); font-size: 13px; }
  input { width: 100%; padding: 11px 12px; border: 1px solid var(--hair-strong); border-radius: 10px; background: rgba(0, 0, 0, 0.35);
    color: var(--text); font: inherit; }
  input:focus { outline: 2px solid var(--ice); outline-offset: 1px; }
  button { width: 100%; margin-top: 14px; padding: 11px 12px; border: 0; border-radius: 10px; background: var(--ice); color: #05070c;
    font: inherit; font-weight: 600; cursor: pointer; }
  .note { margin: 14px 0 0; color: var(--rose); font-size: 13px; }
</style></head>
<body><main>
<h1>C.E.O.</h1>
<p>Private. Sign in once on this device.</p>
<form method="post" action="/api/site-login">
<input type="hidden" name="next" value="${esc(next)}">
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required maxlength="256" autofocus>
<button type="submit">Sign in</button>
</form>
${line ? `<p class="note" role="status">${esc(line)}</p>` : ""}
</main></body></html>`;
}
