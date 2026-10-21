# C.E.O. on Azure

C.E.O.'s Azure footprint, as Bicep in [`infra/`](../infra): a second working copy of the site alongside Vercel,
which stays production and is untouched. One paste in Azure Cloud Shell creates all of it, and the app's code runs
on both (see [The port](#the-port)); the deploy workflow and nightly backup come next (see [Next](#next-deploys-and-backups)).
No Azure OpenAI or Speech: the functions keep calling Claude and Gemini as they do on Vercel.

## What gets created

In the resource group `rg-ceo-prod` (West US 3, the Static Web App in West US 2: it doesn't offer West US 3):

| Resource | For | Rough cost a month |
| --- | --- | --- |
| Static Web App `swa-ceo`, Standard | The site (`apps/world/dist`), with the Function App linked as its `/api` | about $9 |
| Function App `func-ceo-…`, Flex Consumption, Node 22 | The `api/` functions, system-assigned identity, 10-minute timeout | $0–5 (the hourly world step is most of it) |
| Storage account `stceo…`, Standard LRS | `ceo-state` (what Vercel Blob holds on Vercel), `ceo-backups` and the functions' code package. No public blobs, no account keys, TLS 1.2 | under $1 |
| Key Vault `kv-ceo-…`, RBAC | Every secret the functions read, as Key Vault references in their app settings | under $1 |
| Log Analytics `log-ceo` + Application Insights `appi-ceo` | Logs and traces, capped at 0.2 GB a day (the first 5 GB a month are free) | $0–3 |

And on the subscription: a **$25 monthly budget** that emails the subscription's Owners and you at 80% of actual
spend. Expect **about $10–15 a month** in all. No database.

**Backups:** blob and container soft delete keep anything deleted or overwritten for 14 days, and `ceo-backups`
holds nightly copies of `ceo-state` in the Cool tier, deleted after 90 days by a lifecycle rule. The nightly copy
job itself comes with the second pull request.

The functions reach storage, Key Vault and App Insights through their identity, so there are no keys or connection
strings anywhere. You get Key Vault Secrets Officer on the vault (to add the secrets) and Storage Blob Data
Contributor on the storage account (to look at or copy in the state).

## The paste

Open [Cloud Shell](https://shell.azure.com) (Bash) in the subscription and paste this. It asks for the email for the
budget alert, registers the services a new subscription doesn't have switched on yet, and deploys (5–10 minutes).
Running it again updates what is there.

```bash
read -rp "Email for budget alerts: " EMAIL && for p in Microsoft.Web Microsoft.Storage Microsoft.KeyVault Microsoft.Insights Microsoft.OperationalInsights Microsoft.Consumption; do az provider register -n $p --wait; done && (git -C ceo-azure pull -q || git clone -q --depth 1 https://github.com/nikitapage10/C.E.O.git ceo-azure) && az deployment sub create -n ceo -l westus3 -f ceo-azure/infra/main.bicep -p deployerPrincipalId=$(az ad signed-in-user show --query id -o tsv) budgetEmail="$EMAIL" -o table
```

The defaults are in [`infra/main.bicep`](../infra/main.bicep); add `-p name=value` to change one, for example
`monthlyBudget=40` or `logDailyCapGb=0.5`. `az deployment sub show -n ceo --query properties.outputs` prints the
names and URLs it made.

## After the paste

1. **Fill the secrets.** Portal → the Key Vault → Secrets → Generate/Import, one per name below, with the same values
   as in Vercel. Then restart the Function App so it picks them up. Until a secret exists, its app setting holds the
   literal `@Microsoft.KeyVault(...)` text, so fill every one the functions use (or delete its app setting) before the
   ported code goes live.

   | Key Vault secret | App setting |
   | --- | --- |
   | `foundry-desk-key` | `FOUNDRY_DESK_KEY` |
   | `foundry-app-id`, `foundry-app-installation-id`, `foundry-app-private-key` | `FOUNDRY_APP_ID`, `FOUNDRY_APP_INSTALLATION_ID`, `FOUNDRY_APP_PRIVATE_KEY` |
   | `foundry-github-token` (only without the App) | `FOUNDRY_GITHUB_TOKEN` |
   | `claude-api-key` | `CLAUDE_API_KEY` |
   | `gemini-api-key` | `GEMINI_API_KEY` |
   | `desk-vapid-public-key`, `desk-vapid-private-key`, `desk-vapid-subject` | `DESK_VAPID_PUBLIC_KEY`, `DESK_VAPID_PRIVATE_KEY`, `DESK_VAPID_SUBJECT` |
   | `desk-pings-secret` | `DESK_PINGS_SECRET` |

   `WORLD_BUDGET_USD` and `GEMINI_BUDGET_USD` aren't secrets; add them as plain app settings if Vercel has them set.
   Vercel's `BLOB_*` settings have no counterpart: the Function App already has `WORLD_STORE=azureblob`,
   `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_BLOB_ENDPOINT` and `AZURE_STORAGE_CONTAINER=ceo-state`.

2. **Connect GitHub to the site.** The Static Web App is created unlinked, so Azure doesn't commit its own workflow
   to `main` (nothing is pushed to `main` directly). A later pull request adds the deploy workflow: copy the
   site's deployment token (Portal → the Static Web App → Manage deployment token, or
   `az staticwebapp secrets list -n swa-ceo -g rg-ceo-prod --query properties.apiKey -o tsv`) into a GitHub Actions
   secret, and the workflow builds from the repo root (`npm ci`, `npm run build`, output `apps/world/dist`).
   (`repositoryToken` on the paste links the repo at creation instead; it still doesn't add a workflow.)

## The port

The same code runs on Vercel and on Azure; nothing here changes how Vercel runs it.

- **The functions.** Each `api/<name>.ts` keeps its Vercel handlers (`GET`/`POST`, web `Request` → `Response`).
  The [`azure/`](../azure) package registers every one of them as an Azure Functions HTTP function (Node 22,
  `@azure/functions` v4 programming model) at the same route, `/api/<name>`, in
  [`azure/src/index.ts`](../azure/src/index.ts). A small adapter ([`azure/src/adapter.ts`](../azure/src/adapter.ts))
  turns Azure's request into a web `Request` and the handler's `Response` back:
  - the URL is the one the browser used (`x-ms-original-url` or `x-forwarded-host` behind the Static Web App), so
    the Desk's same-origin check and its passkeys see the site's own address;
  - `x-real-ip`, which the Desk's sign-in limits count by, is always replaced with the address Azure saw (Vercel
    sets it itself; on Azure a caller could otherwise send their own);
  - each `Set-Cookie` becomes one of the response's cookies (Azure keeps one value per header name);
  - a handler that throws answers a bare 500, as on Vercel.
- **`waitUntil`.** `foundry.ts` and `world-step.ts` take it from [`api/_waitUntil.ts`](../api/_waitUntil.ts): on
  Vercel that is `@vercel/functions`' own, as before. On Azure the adapter gathers the work and waits for it before
  answering, up to 35 seconds (under the Static Web App proxy's cut); anything still running after that carries on
  on the warm instance, best effort. The world step waits for all of it (its day and week stories), since it is
  called on the Function App's own URL.
- **Storage.** [`api/_blob.ts`](../api/_blob.ts) is the one blob store every function uses: the world and its
  history (`api/_world/store.ts`), the day and week stories and Gemini's ledger (`api/_world/story.ts`), the Desk's
  passkeys, limits and pings (`api/_desk/store.ts`) and idea pictures (`api/foundry-image.ts`).
  `WORLD_STORE=azureblob` (set by the Bicep) uses Azure Blob Storage ([`azure/src/blob.ts`](../azure/src/blob.ts)):
  the container `AZURE_STORAGE_CONTAINER` (`ceo-state`) in `AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_BLOB_ENDPOINT`,
  signed in with the Function App's identity through `DefaultAzureCredential`. Anything else is Vercel Blob,
  making exactly the calls it made before. The write rules carry over: ETag checks (`If-Match`) so two world steps
  can't both land, and no overwrite unless allowed (`If-None-Match: *`) so a day's story is claimed once. **Idea
  pictures stay private:** the container has no public access, and a picture comes back only through
  `/api/foundry-image` on a short-lived signed link, as on Vercel. The Azure SDKs live only in `azure/`, which
  registers its store at start-up, so they never ship in a Vercel function or the Desk.
- **Key Vault references.** Until a secret exists in the vault, its app setting holds the literal
  `@Microsoft.KeyVault(...)` text. [`azure/src/env.ts`](../azure/src/env.ts) runs before any handler and removes
  every such value from the environment (logging only the setting's name), so the code behaves as on Vercel with
  that setting missing, instead of using the reference as a key.
- **Long requests skip `/api`.** The Static Web App's proxy to a linked backend may cut a request at about 45
  seconds, so the hourly world step (up to 180 s) and the day story (up to 150 s) should be called on the Function
  App's own URL (`az deployment sub show -n ceo --query properties.outputs.functionAppUrl.value -o tsv`), not the
  site's `/api`. The Function App allows 10 minutes (`azure/host.json`, `functionTimeout`). Linking adds an identity
  provider to the Function App; check its own URL still answers before pointing anything at it.
- **Passkeys are per domain.** The Desk's passkeys are tied to the address they were made on, so signing in to the
  Desk on the Azure address needs its own passkey, enrolled there with the Desk key as on Vercel. Azure's store
  starts empty: Vercel's passkeys don't carry over, and neither do the world, the stories or the pictures unless
  they are copied into `ceo-state`.
- **`staticwebapp.config.json`** (in `apps/world/public`, copied into `dist` by the build) already carries
  `vercel.json`'s headers and page rewrites; a unit test (`scripts/azure-config.test.mjs`) keeps the two in step. One difference: Vercel caches
  `/models/*?v=…` for good, and Static Web Apps can't match on a query string, so models are revalidated instead.

### Building the functions package

```bash
npm ci
npm run build:azure
```

This bundles `azure/src/index.ts`, the `api/` code and every dependency into one file with Vite, from the repo's own
locked `node_modules` (so Azure runs the same versions as Vercel), and writes the zip-deployable folder
`azure/dist/app` (`index.mjs`, `host.json`, `package.json`, no `node_modules` needed) plus `azure/dist/functions.zip`
when `zip` is installed. To deploy it by hand:

```bash
az functionapp deployment source config-zip -g rg-ceo-prod -n <functionAppName> --src azure/dist/functions.zip
```

The unit tests for the adapter, the Key Vault guard and the store choice run with the rest (`npm test`, files in
`azure/src/*.test.ts` and `api/_blob.test.ts`), with the Azure SDKs mocked.

## Next: deploys and backups

The deploy workflow (the site with the Static Web App's deployment token, the functions through OIDC, from `main`
like Vercel) and the nightly backup of `ceo-state` into `ceo-backups` come next, once Nikita OKs letting GitHub sign
in to Azure. Until then nothing deploys to Azure on its own, and the package above can be deployed by hand.
