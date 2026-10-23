# C.E.O. at ceo.nikita.page

C.E.O. lives on the Azure Static Web App `swa-ceo` (docs/AZURE.md). From #314 it answers on two addresses:

- **<https://ceo.nikita.page>**, the custom domain: a CNAME in the Azure DNS zone `nikita.page` (resource group
  `rg-ceo-prod`), added on swa-ceo under **Custom domains** → **Custom domain on Azure DNS**, with Azure's free
  DigiCert certificate (the zone's CAA record allows `digicert.com`).
- **<https://thankful-forest-019308c1e.5.azurestaticapps.net>**, the Static Web App's own address. It keeps working
  until Nikita confirms the switch, and answers after that too.

The zone, its records and the custom domain were set up by hand on 2026-10-23 and stay out of the Bicep template, so a
deployment never touches the zone's other names (www, tide and the apex point at Vercel for other sites; the mail
records stay as they are).

## What the app does on each host

Nothing in the app is tied to one host; `api/_site/hosts.ts` names both.

| Piece | How it works on both hosts |
|---|---|
| Passkeys (the Desk and the site lock) | WebAuthn's origin and RP ID are the address the browser used (`api/desk-auth.ts`; `azure/src/adapter.ts` puts it back behind the Static Web App). A passkey belongs to the host it was made on, so ceo.nikita.page needs its own: Nikita adds each device once, with the Desk key (step 2 below). |
| Allowed origins | A Desk write must come from the page's own origin (`sameOrigin`, `api/_desk/session.ts`), whichever host that is. |
| Cookies | The Desk session, the site lock and the Gmail state cookies are all `__Host-` cookies: no Domain, so each host keeps its own. Signing in on one doesn't sign in on the other. |
| CSP | `'self'` only (`apps/world/public/staticwebapp.config.json`, and the login page's own), so no host is written into it. |
| Gmail callback | A Connect Gmail started on ceo.nikita.page comes back to `https://ceo.nikita.page/api/gmail-callback`, one started on the old address comes back there (`redirectFor`, `api/_email/route.ts`). Google's OAuth client lists both (step 1). |
| PWA manifest | `start_url`, `scope` and `id` are `/`, so it installs from either host. An installed Desk belongs to the host it was installed from. |
| Home address | `CEO_SITE_URL`, a plain Function App setting (`api/_site/hosts.ts`): the pings' contact and the Gmail callback's fallback. The azurestaticapps.net address until step 3. |
| Live watch, world step, pings | The `AZURE_SITE_HOST` repository variable (`.github/workflows/live-watch.yml`, `world-step.yml`, `desk-pings.yml`); unset means the azurestaticapps.net address. The Builder's `scripts/foundry-watch.sh` reads `CEO_SITE` the same way. |
| Backups | Read the storage account directly, never the site, so nothing changes. |

## Nikita's steps after the pull request merges

Steps 1 and 2 make ceo.nikita.page fully usable. Step 3 is for when you're happy with it, and makes it the address
C.E.O. calls home; the old address keeps working either way. Everything here is from a browser on the Windows PC.

### 1. Google: add the new Gmail callback

> **What this does.** In Google Cloud Console (your `C.E.O. Relay` project), it adds a second allowed return address
> to the Gmail sign-in, so **Connect Gmail** works from ceo.nikita.page. The old address stays on the list, so both
> work. Free, and undone by deleting the line again. Nothing else about the Gmail connection changes.

1. Open <https://console.cloud.google.com/auth/clients> and pick the `C.E.O. Relay` project at the top if asked.
2. Click the client **C.E.O. Azure**.
3. Under **Authorized redirect URIs** → **+ Add URI** → `https://ceo.nikita.page/api/gmail-callback` (exactly, no
   trailing slash). Keep the azurestaticapps.net line that's already there.
4. **Save**. Google says it can take a few minutes to apply.

You don't need to reconnect Gmail: the connection you have keeps working. Only a future **Connect Gmail** or
**Reconnect Gmail** pressed on ceo.nikita.page uses the new line.

### 2. Add your devices on ceo.nikita.page

> **What this does.** On C.E.O. itself, it makes a new passkey for each device on ceo.nikita.page, using the Desk key
> (the `foundry-desk-key` value in the Azure Key Vault). Passkeys belong to one address, so the ones you have only work
> on the old address. Free; each new passkey can be removed from the Foundry tab, and the old ones keep working on the
> old address.

On each device (PC, phone):

1. Open <https://ceo.nikita.page>. The site lock's login page shows.
2. **New device with no passkey? Add it** → type the Desk key and a name with the new address in it, like
   `PC (ceo)` or `Phone (ceo)` → confirm with the fingerprint, face or PIN. You're signed in.
3. On the phone, if you added the Desk to the home screen: open ceo.nikita.page in the browser → **Share** (or the
   menu) → **Add to Home Screen**, then remove the old icon. Turn **Pings on this device** on again in the Foundry tab if
   you use them: they belong to the address too.

The Desk keeps at most ten devices, counting both addresses. Once you're on ceo.nikita.page for good, remove the old
ones from the **Foundry** tab's device list (the names without "(ceo)").

### 3. When you're happy: make ceo.nikita.page the home address

> **What this does.** In Azure Cloud Shell and GitHub, it tells C.E.O. that ceo.nikita.page is now its address: the
> Function App's `CEO_SITE_URL` setting (the pings' contact, the Gmail fallback), and the `AZURE_SITE_HOST` variable the
> hourly live watch, world step and pings use. The old address keeps answering. Free, and undone by setting the old
> address back the same way.

1. Open <https://shell.azure.com> (Bash), paste this one line and press Enter:

   ```bash
   az functionapp config appsettings set -g rg-ceo-prod -n func-ceo-besgu7fnckib2 --settings "CEO_SITE_URL=https://ceo.nikita.page" -o none && az functionapp restart -g rg-ceo-prod -n func-ceo-besgu7fnckib2 -o none && echo "CEO_SITE_URL is ceo.nikita.page; function app restarted"
   ```

2. Open <https://github.com/nikitapage10/C.E.O./settings/variables/actions> → **New repository variable** (or the
   pencil on `AZURE_SITE_HOST` if it's there) → Name `AZURE_SITE_HOST`, Value `ceo.nikita.page` (no https://) →
   **Add variable**.
3. Tell Skippy it's done. The next live watch (hourly at :23, or **Actions** → **Live watch** → **Run workflow**)
   checks ceo.nikita.page.

If the Bicep template is ever run again, add `siteOnCustomDomain=true` to its parameters, or it sets `CEO_SITE_URL`
back to the old address.
