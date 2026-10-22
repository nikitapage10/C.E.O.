# C.E.O. on Azure

C.E.O.'s Azure footprint, as Bicep in [`infra/`](../infra): a second working copy of the site alongside Vercel,
which stays production and is untouched. One paste in Azure Cloud Shell creates all of it, and the app's code runs
on both (see [The port](#the-port)); the deploy workflow and nightly backup are in [Deploys and backups](#deploys-and-backups).
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

Optionally, on the subscription: a **$25 monthly budget** that emails the Owners and you at 80% of actual spend
(`createBudget=true`; off by default, since C.E.O.'s Visual Studio subscription has its own spending limit). Expect **about $10–15 a month** in all. No database.

**Backups:** blob and container soft delete keep anything deleted or overwritten for 14 days, and `ceo-backups`
holds nightly copies of `ceo-state` in the Cool tier, deleted after 90 days by a lifecycle rule. The nightly copy
job itself comes with the second pull request.

The functions reach storage, Key Vault and App Insights through their identity, so there are no keys or connection
strings anywhere. You get Key Vault Secrets Officer on the vault (to add the secrets) and Storage Blob Data
Contributor on the storage account (to look at or copy in the state).

## The paste

Open [Cloud Shell](https://shell.azure.com) (Bash) in the subscription and paste this. It registers the services a new
subscription doesn't have switched on yet and deploys (5–10 minutes). (The repo's name ends in a dot, so its clone URL
is `C.E.O..git`, with two dots.)
Running it again updates what is there.

```bash
for p in Microsoft.Web Microsoft.Storage Microsoft.KeyVault Microsoft.Insights Microsoft.OperationalInsights Microsoft.Consumption; do az provider register -n $p --wait; done && (git -C ceo-azure pull -q || git clone -q --depth 1 https://github.com/nikitapage10/C.E.O..git ceo-azure) && az deployment sub create -n ceo -l westus3 -f ceo-azure/infra/main.bicep -p deployerPrincipalId=$(az ad signed-in-user show --query id -o tsv) -o table
```

The defaults are in [`infra/main.bicep`](../infra/main.bicep); add `-p name=value` to change one, for example
`logDailyCapGb=0.5`. The budget alert is off by default because Visual Studio subscriptions refuse the Budgets API
and cap spend themselves; on a pay-as-you-go subscription add `createBudget=true budgetEmail=you@example.com`. `az deployment sub show -n ceo --query properties.outputs` prints the
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
   to `main` (nothing is pushed to `main` directly). `deploy-azure.yml` ships it instead, once the one-time setup in
   [Deploys and backups](#deploys-and-backups) is done; no deployment token is stored anywhere.
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
  passkeys, limits and pings (`api/_desk/store.ts`), Skippy's chat ledger (`api/_skippy/budget.ts`) and idea pictures (`api/foundry-image.ts`).
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

## Deploys and backups

Nikita OK'd GitHub signing in to Azure on 2026-10-21. Two workflows keep the Azure copy going; both skip themselves
until the one-time setup below is done, so main stays green either way.

- **`.github/workflows/deploy-azure.yml`**, on every push to `main` (and by hand from the Actions tab): one build, then
  the site (prebuilt `apps/world/dist`, uploaded with no rebuild) and the functions (`azure/dist/functions.zip`,
  zip-deployed to Flex Consumption) go out in parallel. Expect about 3 to 4 minutes from push to live.
- **`.github/workflows/backup-azure.yml`**, nightly at 10:41 UTC: the production world from Vercel's public API
  (`/api/world` and the last 7 days), everything in the Azure copy's `ceo-state`, and `apps/world/public/models`,
  into `ceo-backups/<YYYY-MM-DD>/` in Cool tier. The container keeps 90 days.

**How GitHub signs in:** OIDC only. GitHub gives each job a short-lived token, and Azure trusts it only for this
repo's `azure` environment, which only `main` may use. No password or key is stored in GitHub; the Static Web App's
deployment token is read at run time and masked. The identity has Contributor on `rg-ceo-prod` and blob data access on
the storage account, and nothing outside the resource group.

**Pull requests** don't deploy to Azure: that would give Azure credentials to pull request code in a public repo.
Vercel's previews cover them.

**Rolling back:** open Actions, "Deploy to Azure", pick the last good run and choose "Re-run all jobs". It rebuilds
that commit and ships it. (Vercel rolls back on its own dashboard, as before.)

### One-time setup

1. In Azure Cloud Shell (Bash), after the first deployment has run. It makes the identity GitHub signs in as, trusts
   GitHub's `azure` environment, re-runs the template to give it its roles, and prints the values for step 3:

```bash
APPID=$(az ad app create --display-name ceo-github-deploy --query appId -o tsv) && SPID=$(az ad sp create --id $APPID --query id -o tsv 2>/dev/null || az ad sp show --id $APPID --query id -o tsv) && az ad app federated-credential create --id $APPID --parameters '{"name":"github-azure-env","issuer":"https://token.actions.githubusercontent.com","subject":"repo:nikitapage10/C.E.O.:environment:azure","audiences":["api://AzureADTokenExchange"]}' -o none; az ad app federated-credential create --id $APPID --parameters '{"name":"github-azure-env-ids","issuer":"https://token.actions.githubusercontent.com","subject":"repo:nikitapage10@11844478/C.E.O.@1412391639:environment:azure","audiences":["api://AzureADTokenExchange"]}' -o none; (git -C ceo-azure pull -q || git clone -q --depth 1 https://github.com/nikitapage10/C.E.O..git ceo-azure) && az deployment sub create -n ceo -l westus3 -f ceo-azure/infra/main.bicep -p deployerPrincipalId=$(az ad signed-in-user show --query id -o tsv) githubPrincipalId=$SPID -o none && O=$(az deployment sub show -n ceo --query properties.outputs) && printf "AZURE_CLIENT_ID=%s\nAZURE_TENANT_ID=%s\nAZURE_SUBSCRIPTION_ID=%s\nAZURE_RG=rg-ceo-prod\nAZURE_SWA_NAME=%s\nAZURE_FUNCTIONAPP_NAME=%s\nAZURE_STORAGE_ACCOUNT=%s\n" "$APPID" "$(az account show --query tenantId -o tsv)" "$(az account show --query id -o tsv)" "$(echo $O | jq -r .staticSiteName.value)" "$(echo $O | jq -r .functionAppName.value)" "$(echo $O | jq -r .storageAccountName.value)"
```

   GitHub names this repo in its sign-in tokens by its IDs (`repo:nikitapage10@11844478/C.E.O.@1412391639:…`, owner
   ID then repo ID), not only by its name, so the paste trusts both forms. If sign-in fails with `AADSTS700213` (no
   matching federated credential), the token's subject isn't one of them: the error prints it, and adding a credential
   with that subject fixes it. For a setup made before the ID form was added, this one line adds it:

```bash
az ad app federated-credential create --id $(az ad app list --display-name ceo-github-deploy --query [0].appId -o tsv) --parameters '{"name":"github-azure-env-ids","issuer":"https://token.actions.githubusercontent.com","subject":"repo:nikitapage10@11844478/C.E.O.@1412391639:environment:azure","audiences":["api://AzureADTokenExchange"]}' -o none
```

2. On GitHub: the repo's **Settings → Environments → New environment**, name it `azure`. Under **Deployment branches
   and tags** pick **Selected branches and tags** and add `main`.
3. On GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**, once for each of
   the seven lines step 1 printed (name on the left of `=`, value on the right). None of them is a secret. The
   workflows drop stray spaces and line breaks from them, so a messy paste still works.
4. Run "Deploy to Azure" once from the Actions tab (or push anything to `main`).

From then on every push to `main` updates both Vercel and Azure.
