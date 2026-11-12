/**
 * The site lock, browser side (#236, #238): when an API call answers 401 with `x-ceo-site-gate: locked`, this browser
 * has no site session (it ran out, was signed out everywhere, or the site's files were reachable without one, as on
 * Azure, docs/AZURE.md). The page then goes to the login page, which brings it back here after the password.
 *
 * On Vercel the middleware already sends the login page instead of the Desk or the Lattice, so this only matters on
 * Azure, or when a session ends while a page is open.
 */

export const GATE_HEADER = "x-ceo-site-gate";

/** The login page's address for coming back to this page. */
export function loginUrl(loc: Pick<Location, "pathname" | "search">): string {
  return `/api/site-login?next=${encodeURIComponent(loc.pathname + loc.search)}`;
}

/**
 * Whether an answer says the site is locked for this browser: a 401 from the gate. Its 503 (site-unavailable: the
 * server couldn't read its own lock or keys, as a fresh instance can during a deploy, #1078) says nothing about this
 * browser's session, so the page stays put and the call is tried again later, with no trip to the login page.
 */
export function isLocked(res: Pick<Response, "status" | "headers">): boolean {
  return res.status === 401 && res.headers.get(GATE_HEADER) === "locked";
}

/** Wraps the page's fetch once: a locked answer sends the page to the login page (once). */
export function installSiteGate(win: Window & typeof globalThis = window): void {
  const own = win.fetch.bind(win);
  let leaving = false;
  win.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await own(...args);
    if (!leaving && isLocked(res)) {
      leaving = true;
      win.location.assign(loginUrl(win.location));
    }
    return res;
  };
}
