/**
 * Where C.E.O. lives (#314, docs/DOMAIN.md). The Static Web App answers on two addresses during the move to the
 * custom domain: its own azurestaticapps.net host, and ceo.nikita.page once Nikita adds the domain. Both keep working
 * until Nikita confirms the switch; CEO_SITE_URL (the Function App's plain setting, infra/resources.bicep) names the
 * one the site calls home, and stays the azurestaticapps.net address until then.
 *
 * What follows the address the browser used, so either host works on its own:
 *   passkeys     WebAuthn's origin and RP ID come from the request (api/desk-auth.ts). A passkey belongs to the host
 *                it was made on, so each host needs its own (Nikita re-adds devices on the new one with the Desk key).
 *   cookies      the Desk, site-gate and Gmail-state cookies are all `__Host-`: no Domain attribute, so each host keeps
 *                its own, and signing in on one does not sign in on the other.
 *   Gmail        the OAuth redirect goes back to the host that started the connect (redirectFor), when it is one of
 *                SITE_HOSTS; Google's OAuth client lists both callbacks (docs/GMAIL.md).
 *   CSP          'self' only (apps/world/public/staticwebapp.config.json), so no host is written into it.
 */

/** The Static Web App's own address (swa-ceo). It keeps answering after the switch. */
export const AZURE_HOST = "thankful-forest-019308c1e.5.azurestaticapps.net";
/** The custom domain on Azure DNS (zone nikita.page in rg-ceo-prod). */
export const CUSTOM_HOST = "ceo.nikita.page";
/** Every public address of the site. */
export const SITE_HOSTS: readonly string[] = [CUSTOM_HOST, AZURE_HOST];

type Env = Record<string, string | undefined>;

/** True when `host` (no port) is one of the site's public addresses. */
export function isSiteHost(host: string): boolean {
  return SITE_HOSTS.includes(host.toLowerCase());
}

/**
 * The site's home address, no trailing slash: CEO_SITE_URL when it is https on one of SITE_HOSTS, else the
 * azurestaticapps.net address (the default until Nikita confirms the switch).
 */
export function siteUrl(env: Env = process.env): string {
  const given = (env.CEO_SITE_URL ?? "").trim();
  try {
    const u = new URL(given);
    if (u.protocol === "https:" && !u.port && isSiteHost(u.hostname) && (u.pathname === "/" || u.pathname === "")) return `https://${u.hostname}`;
  } catch {
    // unset or not a URL: the default
  }
  return `https://${AZURE_HOST}`;
}
