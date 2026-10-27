// Everything in C.E.O.'s resource group (deployed by infra/main.bicep; docs/AZURE.md says what each piece is for).
//
//   Static Web App (Standard)  the site, apps/world/dist, with the Function App linked as its /api backend
//   Function App (Flex FC1)    the api/ functions once they are ported, Node 22, system-assigned identity
//   Storage account            `ceo-state` (what Vercel Blob holds today), `ceo-backups` (nightly copies, 90 days)
//                              and the Flex deployment package; soft delete on blobs and containers
//   Key Vault (RBAC)           every secret the functions read, as Key Vault references in the app settings
//   Log Analytics + App Insights  logs and traces, with a daily ingestion cap
//
// The functions reach storage, Key Vault and App Insights with their own identity: no keys, no connection strings.
// Storage has shared-key access off, so nothing can use an account key even by mistake.

@description('Region for everything but the Static Web App.')
param location string

@description('Region for the Static Web App\'s control plane.')
param staticSiteLocation string

@description('Object ID of the person deploying; empty skips their roles.')
param deployerPrincipalId string

@description('Object ID of the service principal GitHub Actions signs in as (OIDC); empty skips its roles.')
param githubPrincipalId string

@description('Optional GitHub token to link the Static Web App to the repo at creation.')
@secure()
param repositoryToken string

@description('Daily Log Analytics ingestion cap in GB (a decimal, as a string).')
param logDailyCapGb string

@description('The Azure copy\'s monthly Claude budget for the world, in USD (WORLD_BUDGET_USD), as a string.')
param worldBudgetUsd string

@description('The Azure copy\'s monthly Claude budget for Skippy\'s chat, in USD (SKIPPY_BUDGET_USD), as a string.')
param skippyBudgetUsd string

@description('The email agent\'s own monthly Claude cap, in USD (EMAIL_BUDGET_USD), as a string.')
param emailBudgetUsd string

@description('Whether the always-on Kernel responder answers hand-offs (KERNEL_AGENT_ENABLED, #501), "true" or "false".')
param kernelAgentEnabled string

@description('The Kernel responder\'s own monthly Claude cap, in USD (KERNEL_AGENT_BUDGET_USD, #501), as a string.')
param kernelAgentBudgetUsd string

@description('Which PayPal the Spire\'s invoices use (PAYPAL_ENV): sandbox or live.')
param paypalEnv string

@description('Make ceo.nikita.page the site\'s home (CEO_SITE_URL, #314) once Nikita confirms the switch. Both addresses answer either way.')
param siteOnCustomDomain bool

param tags object

// Globally unique names carry a hash of the resource group, so the same paste lands on the same names every time.
var suffix = uniqueString(resourceGroup().id)
var storageName = 'stceo${suffix}'
var functionAppName = 'func-ceo-${suffix}'
var keyVaultName = 'kv-ceo-${suffix}'
var stateContainer = 'ceo-state'
var packageContainer = 'app-package'
var backupContainer = 'ceo-backups'

// Every secret the functions read (process.env under api/), by app setting and its Key Vault secret. Key Vault
// names take letters, digits and dashes only, hence the two spellings. Values come from the first-time secrets paste,
// or (third-party keys only, api/_keys/allowlist.ts) the Desk's Keys form.
// Vercel's BLOB_* settings are left out: the functions get the storage account below through their identity.
var secrets = [
  { setting: 'FOUNDRY_DESK_KEY', secret: 'foundry-desk-key' } // the Desk's sign-in key; also signs picture links
  { setting: 'FOUNDRY_APP_ID', secret: 'foundry-app-id' } // the crew's GitHub App
  { setting: 'FOUNDRY_APP_INSTALLATION_ID', secret: 'foundry-app-installation-id' }
  { setting: 'FOUNDRY_APP_PRIVATE_KEY', secret: 'foundry-app-private-key' }
  { setting: 'FOUNDRY_GITHUB_TOKEN', secret: 'foundry-github-token' } // fallback when the App isn't set
  { setting: 'CLAUDE_API_KEY', secret: 'claude-api-key' } // world steps and stories (ANTHROPIC_API_KEY also works)
  { setting: 'DESK_VAPID_PUBLIC_KEY', secret: 'desk-vapid-public-key' } // phone pings
  { setting: 'DESK_VAPID_PRIVATE_KEY', secret: 'desk-vapid-private-key' }
  { setting: 'DESK_VAPID_SUBJECT', secret: 'desk-vapid-subject' } // the pings' contact (mailto: or https:)
  { setting: 'DESK_PINGS_SECRET', secret: 'desk-pings-secret' } // shared with the desk-pings workflow
  { setting: 'SITE_BYPASS_TOKEN', secret: 'site-bypass-token' } // the site lock's bypass, shared with the live-watch workflow (#313)
  { setting: 'FANTASYPROS', secret: 'fantasypros' } // the Green's FantasyPros API key (x-api-key); Azure only
  // The Studio's voice and picture keys (#311), each capped at $10 a month in code; Azure only. Nikita set these by
  // hand before they were here, and the template replaces the whole settings list, so they must be listed.
  { setting: 'ELEVENLABS_API_KEY', secret: 'elevenlabs' }
  { setting: 'OPENAI_STUDIO_KEY', secret: 'openai' }
  // Nikita's Polymarket US key (#253), for the Exchange's private positions board: read-only by code (the key itself
  // could trade; api/_exchange/positions.ts only ever signs GETs to the two portfolio paths). Optional: without it the
  // board waits.
  { setting: 'POLYMARKET_US_KEY_ID', secret: 'polymarket-us-key-id' }
  { setting: 'POLYMARKET_US_SECRET_KEY', secret: 'polymarket-us-secret-key' }
  // The email agent (#263, docs/GMAIL.md): Google's OAuth client for Connect Gmail (gmail.readonly), and 32 random
  // bytes that seal the Gmail refresh token and the private mail list in `ceo-state` (api/_email/seal.ts). The
  // functions only read these: the token is never written to the vault. The Desk's Keys form (#330) may replace the
  // client id and secret, never the sealing key (api/_keys/allowlist.ts).
  { setting: 'GMAIL_CLIENT_ID', secret: 'gmail-client-id' }
  { setting: 'GMAIL_CLIENT_SECRET', secret: 'gmail-client-secret' }
  { setting: 'GMAIL_TOKEN_KEY', secret: 'gmail-token-key' }
  // A private skip list for the email agent (#323): comma-separated terms; mail holding one is counted, never read by
  // a model or kept. Optional: missing or empty skips nothing.
  { setting: 'EMAIL_SKIP_TERMS', secret: 'email-skip-terms' }
  // The Spire's invoices (#279, docs/PAYPAL.md): PayPal's REST app (client credentials). Sandbox or live is the plain
  // PAYPAL_ENV setting below; switching to live means pasting the Live app's id and secret here.
  { setting: 'PAYPAL_CLIENT_ID', secret: 'paypal-client-id' }
  { setting: 'PAYPAL_CLIENT_SECRET', secret: 'paypal-client-secret' }
  // The subminds' two room keys (#281, #312, api/_site/roomkeys.ts): 32 random bytes each, minted by the secrets paste
  // (docs/AZURE.md). The read key opens only GETs of room data; the write key only POST /api/room-feed and POST
  // /api/skippy-answer (a hand-off's answer coming back). Neither can change a setting, trade, send, or reach another
  // secret. Without one, what it opens stays off.
  { setting: 'SUBMIND_LOG_TOKEN', secret: 'submind-log-token' }
  { setting: 'SUBMIND_FEED_TOKEN', secret: 'submind-feed-token' }
]

// Built-in role IDs (the same in every tenant).
var roles = {
  storageBlobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageQueueDataContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  keyVaultSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
  monitoringMetricsPublisher: '3913510d-42f4-4e42-8a64-420c390055eb'
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
}

// --- Monitoring -------------------------------------------------------------------------------------------------

resource logs 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: 'log-ceo'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    // Ingestion stops for the day at the cap (App Insights included, it writes here), so a log storm can't run up
    // the bill. The first 5 GB a month are free.
    workspaceCapping: { dailyQuotaGb: json(logDailyCapGb) }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-ceo'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    // Entra ID only: the functions send telemetry with their identity (Monitoring Metrics Publisher below).
    DisableLocalAuth: true
  }
}

// --- Storage ----------------------------------------------------------------------------------------------------

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// Soft delete on blobs and containers: a deleted or overwritten state file can be undeleted for 14 days.
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

// The app's state: the world, stories, Desk sign-ins and pictures (Vercel Blob today).
resource state 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobs
  name: stateContainer
  properties: { publicAccess: 'None' }
}

// Where Flex Consumption keeps the deployed code package.
resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobs
  name: packageContainer
  properties: { publicAccess: 'None' }
}

// Nightly copies of `ceo-state` (the copy job comes with the port). Written straight to Cool, and the lifecycle
// policy below moves anything still Hot there to Cool and deletes copies after 90 days.
resource backups 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobs
  name: backupContainer
  properties: { publicAccess: 'None' }
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2025-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'backups-cool-then-delete'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['${backupContainer}/']
            }
            actions: {
              baseBlob: {
                tierToCool: { daysAfterModificationGreaterThan: 0 }
                delete: { daysAfterModificationGreaterThan: 90 }
              }
            }
          }
        }
      ]
    }
  }
}

// --- Key Vault --------------------------------------------------------------------------------------------------

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

// --- Functions --------------------------------------------------------------------------------------------------

resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: 'plan-ceo'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

var keyVaultSettings = map(secrets, s => {
  name: s.setting
  value: '@Microsoft.KeyVault(VaultName=${vault.name};SecretName=${s.secret})'
})

var plainSettings = [
  // The host's own storage, through the identity (Flex takes no FUNCTIONS_WORKER_RUNTIME or version settings).
  { name: 'AzureWebJobsStorage__accountName', value: storage.name }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
  { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD' }
  // world-step runs up to 180 s and day-story up to 150 s; 10 minutes leaves room and still stops a runaway.
  { name: 'AzureFunctionsJobHost__functionTimeout', value: '00:10:00' }
  // Where the ported functions keep their state: the Azure blob store (api/_world/store.ts), reached with the
  // identity through DefaultAzureCredential.
  { name: 'WORLD_STORE', value: 'azureblob' }
  { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
  { name: 'AZURE_STORAGE_BLOB_ENDPOINT', value: storage.properties.primaryEndpoints.blob }
  { name: 'AZURE_STORAGE_CONTAINER', value: stateContainer }
  // Each copy keeps its own spend ledger in its own store, so these cap the Azure copy alone. The voice is
  // ElevenLabs alone (#472), capped in code by ELEVENLABS_BUDGET_USD; Gemini's speech key and cap are retired.
  { name: 'WORLD_BUDGET_USD', value: worldBudgetUsd }
  { name: 'SKIPPY_BUDGET_USD', value: skippyBudgetUsd }
  // The one voice for the story, the week and Talk to Skippy (#475): Nikita's custom Skippy voice on ElevenLabs. Not a
  // secret. A new voice goes here, not in the portal, or the next deploy puts this one back.
  { name: 'ELEVENLABS_VOICE_ID', value: 'UmB8prvfojxqchgnJYWe' }
  // The email agent's own cap (#263; Nikita: $10 a month), separate from the two above.
  { name: 'EMAIL_BUDGET_USD', value: emailBudgetUsd }
  // The always-on Kernel responder (#501, docs/AZURE.md): its off switch ("false" stops it; the thread's watcher takes
  // every hand-off again) and its own cap, separate from the others, with a hard stop in code at $10 a month. It runs on
  // Haiku; KERNEL_AGENT_MODEL=sonnet (set by hand, kept by the deploy) moves it to Sonnet 5.5.
  { name: 'KERNEL_AGENT_ENABLED', value: kernelAgentEnabled }
  { name: 'KERNEL_AGENT_BUDGET_USD', value: kernelAgentBudgetUsd }
  // The Spire's invoices (#279): sandbox until Nikita switches to live (docs/PAYPAL.md).
  { name: 'PAYPAL_ENV', value: paypalEnv }
  // The site's home address (api/_site/hosts.ts): the pings' contact and the Gmail callback's fallback. The
  // azurestaticapps.net address until Nikita confirms the switch to ceo.nikita.page (docs/DOMAIN.md). The domain
  // itself (the nikita.page zone, its records, the custom domain on swa-ceo) was set up by hand and stays out of here,
  // so a deployment never touches the zone's other names (www, tide, the apex, mail).
  { name: 'CEO_SITE_URL', value: siteOnCustomDomain ? 'https://ceo.nikita.page' : 'https://${site.properties.defaultHostname}' }
  // The vault's own address, for the Desk's Keys form (#330, api/_keys/route.ts) and the refresh that brings a key set
  // there into the running app (azure/src/keys.ts). Not a secret.
  { name: 'KEY_VAULT_URI', value: vault.properties.vaultUri }
]

resource functionApp 'Microsoft.Web/sites@2024-11-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: concat(plainSettings, keyVaultSettings)
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${packageContainer}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        // 40 is the lowest Flex allows; C.E.O. needs one or two.
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: { name: 'node', version: '22' }
    }
  }
}

// --- Static Web App ---------------------------------------------------------------------------------------------

// Linked to GitHub only when a token is given. Even then Azure doesn't commit its own workflow to main (nothing is
// pushed to main directly, CLAUDE.md): the deploy workflow comes in through a pull request with the port.
// The build matches vercel.json: npm ci and npm run build from the repo root, output apps/world/dist.
var repoLink = empty(repositoryToken)
  ? {}
  : {
      repositoryUrl: 'https://github.com/nikitapage10/C.E.O.'
      branch: 'main'
      repositoryToken: repositoryToken
      buildProperties: {
        appLocation: '/'
        apiLocation: ''
        outputLocation: 'apps/world/dist'
        appBuildCommand: 'npm run build'
        skipGithubActionWorkflowGeneration: true
      }
    }

resource site 'Microsoft.Web/staticSites@2024-11-01' = {
  name: 'swa-ceo'
  location: staticSiteLocation
  tags: tags
  sku: { name: 'Standard', tier: 'Standard' }
  properties: union(
    {
      stagingEnvironmentPolicy: 'Enabled'
      allowConfigFileUpdates: true
    },
    repoLink
  )
}

// The Function App behind the site's /api (Standard SKU only).
resource backend 'Microsoft.Web/staticSites/linkedBackends@2024-11-01' = {
  parent: site
  name: 'functions'
  properties: {
    backendResourceId: functionApp.id
    region: location
  }
}

// --- Roles ------------------------------------------------------------------------------------------------------

// The Functions host needs Blob Data Owner on its storage (leases, the package), plus queues and tables for its
// triggers' bookkeeping. Owner covers the app's own reads and writes on `ceo-state` too.
var functionStorageRoles = [roles.storageBlobDataOwner, roles.storageQueueDataContributor, roles.storageTableDataContributor]

resource functionStorage 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for role in functionStorageRoles: {
    name: guid(storage.id, functionApp.id, role)
    scope: storage
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role)
      principalId: functionApp.identity.principalId
      principalType: 'ServicePrincipal'
    }
  }
]

// Read access to the vault's secrets: the Key Vault references, and the Keys form's refresh (azure/src/keys.ts).
// Writing (the Desk's Keys form, #330) needs Key Vault Secrets Officer, which is granted by the one-time role paste in
// docs/AZURE.md and deliberately not here: the deploy identity that applies this template may only assign the roles
// listed in its condition, and giving any identity write on the vault is not one of them. The paste grants it on each
// allowlisted secret alone (`<vault>/secrets/<name>`), never on the vault.
resource functionSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, functionApp.id, roles.keyVaultSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionTelemetry 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, functionApp.id, roles.monitoringMetricsPublisher)
  scope: insights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.monitoringMetricsPublisher)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// The person deploying: adds the secrets in the portal (RBAC vaults give even the subscription Owner no data
// access), and can look at or copy in the state blobs (shared keys are off, so the portal needs a data role).
resource deployerSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(vault.id, deployerPrincipalId, roles.keyVaultSecretsOfficer)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsOfficer)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

resource deployerState 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(storage.id, deployerPrincipalId, roles.storageBlobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

// GitHub Actions (deploy-azure.yml, backup-azure.yml, world-step.yml, desk-pings.yml, live-watch.yml), signed in
// through OIDC from main only: Contributor on this group to ship the site and the functions, blob data access for the
// nightly backup and the one-off seed (shared keys are off), and read access to the vault's secrets so the hourly
// pings and the live watch can read `desk-pings-secret` and `site-bypass-token` at run time instead of keeping copies
// in GitHub.
resource githubDeploy 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(githubPrincipalId)) {
  name: guid(resourceGroup().id, githubPrincipalId, roles.contributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.contributor)
    principalId: githubPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource githubBackup 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(githubPrincipalId)) {
  name: guid(storage.id, githubPrincipalId, roles.storageBlobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
    principalId: githubPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource githubSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(githubPrincipalId)) {
  name: guid(vault.id, githubPrincipalId, roles.keyVaultSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: githubPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output siteHostname string = site.properties.defaultHostname
output siteUrl string = 'https://${site.properties.defaultHostname}'
output staticSiteName string = site.name
output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output keyVaultName string = vault.name
output storageAccountName string = storage.name
output stateContainer string = state.name
output backupContainer string = backups.name
output secretNames array = map(secrets, s => s.secret)
