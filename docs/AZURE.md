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
job is `backup-azure.yml` (see [Deploys and backups](#deploys-and-backups)).

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

1. **Fill the secrets.** Two parts: one paste mints the secrets that are ours to make, and three come from outside
   by hand. Vercel's values can't be read back (they are marked sensitive), so the Azure copy gets its own.

   **The paste**, in Cloud Shell (Bash), after the [one-time setup](#one-time-setup) below. It brings the template
   up to date (with `githubPrincipalId`, so GitHub's identity gets Key Vault Secrets User and the hourly pings can
   read `desk-pings-secret`; and the budget settings), then writes straight into the vault (`kv-ceo-besgu7fnckib2`
   today; it looks the names up in `rg-ceo-prod`) and restarts the Function App so it picks them up:

   - `desk-vapid-public-key` / `desk-vapid-private-key`: a fresh P-256 push key pair, made by Node in Cloud Shell, in
     the form `web-push` takes (base64url: the uncompressed public point, and the private scalar `d`);
   - `desk-vapid-subject`: `mailto:` and the address you're signed in to Azure with;
   - `desk-pings-secret`: 32 random bytes, base64url. Nobody needs a copy: `desk-pings.yml` reads it from the vault;
   - `foundry-desk-key`: 32 random bytes, base64url, **printed once** at the end. It is the Azure Desk's sign-in key:
     keep it in your password manager and use it to enrol a passkey on the Azure address (see "Passkeys are per
     domain" below). It isn't Vercel's Desk key.

   A secret that already has a value is kept, never replaced (the paste says `kept …`), so running it again is safe.
   To replace them all on purpose (it signs every Azure Desk session out and drops its phones' pings), run
   `export FORCE=1` first and `unset FORCE` after.

```bash
(git -C ceo-azure pull -q || git clone -q --depth 1 https://github.com/nikitapage10/C.E.O..git ceo-azure) && az deployment sub create -n ceo -l westus3 -f ceo-azure/infra/main.bicep -p deployerPrincipalId="$(az ad signed-in-user show --query id -o tsv)" githubPrincipalId="$(az ad sp list --display-name ceo-github-deploy --query "[0].id" -o tsv)" -o none && echo "infra updated" && \
(RG=rg-ceo-prod; KV=$(az keyvault list -g $RG --query "[0].name" -o tsv); FA=$(az functionapp list -g $RG --query "[0].name" -o tsv)
[ -n "$KV" ] && [ -n "$FA" ] || { echo "No Key Vault or Function App in $RG yet: run the paste above first."; exit 1; }
has() { [ "${FORCE:-0}" != 1 ] && [ -n "$(az keyvault secret show --vault-name "$KV" -n "$1" --query value -o tsv 2>/dev/null)" ]; }
put() { az keyvault secret set --vault-name "$KV" -n "$1" --value "$2" -o none && echo "set  $1"; }
rnd() { node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))'; }
if has desk-vapid-public-key || has desk-vapid-private-key; then echo "kept desk-vapid-public-key, desk-vapid-private-key"; else
  read -r PUB PRIV < <(node -e 'const j=require("crypto").generateKeyPairSync("ec",{namedCurve:"P-256"}).privateKey.export({format:"jwk"}),b=s=>Buffer.from(s,"base64url");console.log(Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString("base64url"),j.d)')
  put desk-vapid-private-key "$PRIV" && put desk-vapid-public-key "$PUB"; fi
if has desk-vapid-subject; then echo "kept desk-vapid-subject"; else U=$(az account show --query user.name -o tsv); put desk-vapid-subject "mailto:${U#*#}"; fi
if has desk-pings-secret; then echo "kept desk-pings-secret"; else put desk-pings-secret "$(rnd)"; fi
if has foundry-desk-key; then echo "kept foundry-desk-key"; else K=$(rnd); put foundry-desk-key "$K" && printf '\nYour Azure Desk key, shown only now (keep it in your password manager):\n%s\n\n' "$K"; fi
az functionapp restart -g $RG -n "$FA" -o none && echo "restarted $FA")
```

   **By hand, three secrets** (they come from other services). In the [Azure portal](https://portal.azure.com):
   search **Key vaults** → **kv-ceo-besgu7fnckib2** → in the left menu **Objects → Secrets** → **+ Generate/Import**.
   Leave **Upload options** on *Manual*, type the **Name** exactly as below, paste the value into **Secret value**,
   leave the content type, dates and **Enabled: Yes** as they are, and press **Create**. Then restart: search
   **Function App** → **func-ceo-besgu7fnckib2** → **Overview** → **Restart** (Key Vault values are read at start-up).

   | Name | Value |
   | --- | --- |
   | `claude-api-key` | A new key from [console.anthropic.com](https://console.anthropic.com) → **API keys** → **Create key**, in the same workspace as Vercel's (so the same monthly spend limit covers both copies) |
   | `gemini-api-key` | A key from [aistudio.google.com](https://aistudio.google.com) → **Get API key** → **Create API key** (Vercel's own Gemini project is fine) |
   | `foundry-github-token` | A fine-grained token: GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Resource owner `nikitapage10`, **Only select repositories** → `nikitapage10/C.E.O.`, and under **Repository permissions**: Actions *Read-only*, Code scanning alerts *Read-only*, Contents *Read-only*, Dependabot alerts *Read-only*, Issues *Read and write*, Pull requests *Read-only* (Metadata *Read-only* comes with it). Nothing else |

   `foundry-app-id`, `foundry-app-installation-id` and `foundry-app-private-key` stay empty until the crew's GitHub
   App exists (#138); the functions use `foundry-github-token` meanwhile. A secret that doesn't exist yet (or is
   empty) is harmless: its app setting holds the literal `@Microsoft.KeyVault(...)` text, which the functions treat
   as unset (see "Key Vault references" below), so that feature is simply off, as on Vercel without the setting.

   | Key Vault secret | App setting |
   | --- | --- |
   | `foundry-desk-key` | `FOUNDRY_DESK_KEY` |
   | `foundry-app-id`, `foundry-app-installation-id`, `foundry-app-private-key` | `FOUNDRY_APP_ID`, `FOUNDRY_APP_INSTALLATION_ID`, `FOUNDRY_APP_PRIVATE_KEY` |
   | `foundry-github-token` (only without the App) | `FOUNDRY_GITHUB_TOKEN` |
   | `claude-api-key` | `CLAUDE_API_KEY` |
   | `gemini-api-key` | `GEMINI_API_KEY` |
   | `desk-vapid-public-key`, `desk-vapid-private-key`, `desk-vapid-subject` | `DESK_VAPID_PUBLIC_KEY`, `DESK_VAPID_PRIVATE_KEY`, `DESK_VAPID_SUBJECT` |
   | `desk-pings-secret` | `DESK_PINGS_SECRET` |

   **Budgets** aren't secrets: the template sets them as plain app settings, lower than Vercel's because both copies
   use the same Claude and Gemini accounts, and each copy keeps its own ledger. `WORLD_BUDGET_USD=2` (Vercel: 6),
   `GEMINI_BUDGET_USD=2` (Vercel: 5) and `SKIPPY_BUDGET_USD=0.5` (Vercel: 1); change one with `-p worldBudgetUsd=3`
   (or `geminiBudgetUsd`, `skippyBudgetUsd`) on the paste. Anything set by hand in the portal is reset by the next
   template run, so change them there.
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
  that setting missing, instead of using the reference as a key. A secret that exists but is empty or only
  whitespace counts as unset too, and the rest are trimmed (a value pasted with a stray line break still works).
  Its list of secret settings must match the template's; a unit test keeps the two in step.
- **Long requests skip `/api`.** The Static Web App's proxy to a linked backend may cut a request at about 45
  seconds, so the hourly world step (up to 180 s) and the day story (up to 150 s) should be called on the Function
  App's own URL (`az deployment sub show -n ceo --query properties.outputs.functionAppUrl.value -o tsv`), not the
  site's `/api`. The Function App allows 10 minutes (`azure/host.json`, `functionTimeout`). Linking adds an identity
  provider to the Function App; check its own URL still answers before pointing anything at it.
- **Passkeys are per domain.** The Desk's passkeys are tied to the address they were made on, so signing in to the
  Desk on the Azure address needs its own passkey, enrolled there with the Desk key as on Vercel. Azure's store
  starts empty: Vercel's passkeys don't carry over, and neither do the world, the stories or the pictures until
  they are copied into `ceo-state` (see [Seeding the Azure state](#seeding-the-azure-state)).
- **`staticwebapp.config.json`** (in `apps/world/public`, copied into `dist` by the build) already carries
  `vercel.json`'s headers and page rewrites; a unit test (`scripts/azure-config.test.mjs`) keeps the two in step. One difference: Vercel caches
  `/models/*?v=…` for good, and Static Web Apps can't match on a query string, so models are revalidated instead.

### The site password on Azure

The site password (#236, [SECURITY.md](SECURITY.md), "The site password") is Vercel Routing Middleware on Vercel,
which Static Web Apps can't run. On Azure the simplest sound part of it runs:

- **Every function is behind the same gate.** `azure/src/index.ts` wraps each handler in `withGate`
  (`api/_site/gate.ts`): the same decision, the same cookie and the same exemptions as Vercel's middleware (the
  hourly world step's POST, the pings scan with the Azure copy's own `DESK_PINGS_SECRET`, `SITE_BYPASS_TOKEN` when
  set). The password is the Azure copy's own: set it on the Azure Desk (Foundry tab, **Site password**), after
  enrolling a passkey there. It lives in `ceo-state` at `desk/site/password.json`, and the site's cookies are signed
  with a key derived from the Azure copy's own Desk key (`foundry-desk-key`), so no new secret is needed.
- **The login page is `/api/site-login`.** The Desk and the Lattice still load from the Static Web App, but their
  first API call answers 401 with `x-ceo-site-gate: locked`, and the page goes to the login page
  (`apps/world/src/siteGate.ts`), which brings it back after the password.
- **Follow-up, not done:** the Static Web App's own files (the HTML, scripts, models and images) stay reachable
  without the password, though they hold nothing that isn't already public on GitHub, and no data comes without the
  API. Locking those needs Static Web Apps' own authentication with a custom role on `/*` in
  `staticwebapp.config.json` (Standard plan; a custom identity provider or invitations), which is its own change.

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
- **`.github/workflows/world-step.yml`** and **`.github/workflows/desk-pings.yml`**, hourly (and pings on Foundry
  issue events): each has a second job, `azure`, beside the Vercel one. The world step calls the Function App's own
  address (`az functionapp show … defaultHostName`), since a step can take minutes and the site's proxy may cut it;
  if that address refuses callers (a linked Static Web App can do that), it goes through the site's `/api` instead.
  The pings job reads `desk-pings-secret` from the vault at run time (masked in the log; GitHub keeps no copy, and
  it isn't Vercel's), which needs the Key Vault Secrets User role the template gives GitHub's identity. Until Azure
  is set up the job is skipped; if sign-in, the vault read or the call fails it leaves a warning and the run stays
  green, since Vercel is production. Each run shows as a deployment to the `azure` environment, like the backups.
- **`.github/workflows/backup-azure.yml`**, nightly at 10:41 UTC: the production world from Vercel's public API
  (`/api/world` and the last 7 days), everything in the Azure copy's `ceo-state`, and `apps/world/public/models`,
  into `ceo-backups/<YYYY-MM-DD>/` in Cool tier. The container keeps 90 days.

### Seeding the Azure state

A one-off: copy production's world (`world/state.json` and every day) and its stories with their audio into
`ceo-state`, under the store's own names, so the Azure copy carries on from where production is. The Desk's sign-ins
(`desk/`) stay behind: passkeys and phones belong to their address. The world's month of Claude spend and Gemini's
month of speech spend come with it, so the Azure budgets start where production's month is.

Actions → **Back up to Azure** → **Run workflow**, tick **seed**. If the Azure copy has already made a world of its
own (the hourly step starts one as soon as it runs), tick **force** too to replace it with production's. Without
force a world already there is left alone and the run says so; with it, only the copied files are replaced, and blob
soft delete keeps what was replaced for 14 days. Nothing seeds on its own: only a hand-run with **seed**.

**No token needed.** By default the run rebuilds the files from production's public API
(`scripts/seed-azure-public.mjs`): `/api/world`, each day's `/api/world?day=…`, and each day's and week's story
(`/api/day-story`) with its audio, the same pages the nightly backup saves. Everything the hourly step reads comes
across: the hour count and time, the relationships, the last 24 hours, the days, the builders' remarks, which day
was last told, and this month's spend. What the public pages don't carry stays behind:

- the idea pictures (`foundry/ideas/`): they are only served on a signed link, so ideas on the Azure copy show none;
- the spend of earlier months (only this month's is public; the budgets only use this month's);
- what each story cost (`cost`, `scriptUsd`: no page reads them; the month's speech total does come across), and its
  exact style version (a story in an older style is marked `1`, so the Desk may remake it once, as on production);
- story claims (`*.claim`), which the Azure copy makes again as it needs them.

**Optional, full copy:** with production's Blob token as a secret, the run copies the store itself instead,
idea pictures included (`scripts/seed-azure-pull.mjs`):

1. Vercel → the project → **Storage** → the Blob store → **.env.local** tab → **Show secret** → copy
   `BLOB_READ_WRITE_TOKEN`'s value (the store's own token, not a project setting, so it can be shown).
2. GitHub → the repo's **Settings → Secrets and variables → Actions → Secrets → New repository secret**, name
   `BLOB_READ_WRITE_TOKEN`, paste the value.
3. Run the seed as above.
4. Delete the `BLOB_READ_WRITE_TOKEN` secret again (it can read and write production's store).

**How GitHub signs in:** OIDC only. GitHub gives each job a short-lived token, and Azure trusts it only for this
repo's `azure` environment, which only `main` may use. No password or key is stored in GitHub; the Static Web App's
deployment token is read at run time and masked. The identity has Contributor on `rg-ceo-prod`, blob data access on
the storage account and Key Vault Secrets User on the vault (for `desk-pings-secret`), and nothing outside the
resource group.

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

The paste in step 1 passes `githubPrincipalId`, so the template gives GitHub's identity all three roles, Key Vault
Secrets User included. A setup made before that role was added gets it from the secrets paste in
[After the paste](#after-the-paste), which runs the template the same way. (Give roles through the template only:
one added by hand with `az role assignment create` gets a different name, and the next template run then fails
with `RoleAssignmentExists`.)

From then on every push to `main` updates both Vercel and Azure.
