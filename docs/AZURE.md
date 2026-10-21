# C.E.O. on Azure

C.E.O.'s Azure footprint, as Bicep in [`infra/`](../infra): a second working copy of the site alongside Vercel,
which stays production and is untouched. One paste in Azure Cloud Shell creates all of it. This is the footprint
only; the code port and its deploy workflow follow in a second pull request (see [Next: the port](#next-the-port)).
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
   to `main` (nothing is pushed to `main` directly). With the port, a pull request adds the deploy workflow: copy the
   site's deployment token (Portal → the Static Web App → Manage deployment token, or
   `az staticwebapp secrets list -n swa-ceo -g rg-ceo-prod --query properties.apiKey -o tsv`) into a GitHub Actions
   secret, and the workflow builds from the repo root (`npm ci`, `npm run build`, output `apps/world/dist`).
   (`repositoryToken` on the paste links the repo at creation instead; it still doesn't add a workflow.)

## Next: the port

Not done yet, and nothing here changes the live site. The code port and the deploy workflow follow in a second
pull request:

- **Vercel functions → Azure Functions:** the handlers in `api/` become HTTP functions (Node 22, `@azure/functions`)
  in the Function App, deployed by a workflow. `waitUntil` from `@vercel/functions` needs a replacement.
- **Blob Storage:** on Azure the stores in `api/_world`, `api/_desk` and the pictures use the `ceo-state` container
  (`WORLD_STORE=azureblob`) with `DefaultAzureCredential`; Vercel keeps Vercel Blob. The nightly backup copy to
  `ceo-backups` comes with it.
- **Long requests skip `/api`.** The Static Web App's proxy to a linked backend times out at 45 seconds, so the
  hourly world step (up to 180 s) and the day story (up to 150 s) should be called on the Function App's own URL.
  Linking adds an identity provider to the Function App; check its own URL still answers before pointing the
  workflows at it.
- **`staticwebapp.config.json`** (in `apps/world/public`, copied into `dist` by the build) already carries
  `vercel.json`'s headers and page rewrites; a unit test (`scripts/azure-config.test.mjs`) keeps the two in step. One difference: Vercel caches
  `/models/*?v=…` for good, and Static Web Apps can't match on a query string, so models are revalidated instead.
- **Deploys:** the workflow publishes the site with the Static Web App's deployment token and the functions
  through OIDC, from `main` like Vercel.
