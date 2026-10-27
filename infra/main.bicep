// C.E.O. on Azure: the whole footprint in one deployment (docs/AZURE.md has the Cloud Shell paste).
//
// Subscription scope, so one `az deployment sub create` makes the resource group, everything in it
// (infra/resources.bicep) and the monthly budget. Safe to run again: it updates what is there and changes nothing
// else. No secret values pass through here: the functions read theirs from Key Vault, filled in by hand.

targetScope = 'subscription'

@description('The resource group everything lives in.')
param resourceGroupName string = 'rg-ceo-prod'

@description('Region for the resource group, the Function App, storage, Key Vault and monitoring. It must offer Flex Consumption (`az functionapp list-flexconsumption-locations`).')
param location string = 'westus3'

@description('Region for the Static Web App. The site itself is served from a global edge; only these regions host its control plane, so westus3 is not one of them.')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param staticSiteLocation string = 'westus2'

@description('Object ID of the person deploying (`az ad signed-in-user show --query id -o tsv`). Gets Key Vault Secrets Officer, so they can add the secrets in the portal, and read/write on the state blobs. Empty skips both.')
param deployerPrincipalId string = ''

@description('Object ID of the service principal GitHub Actions signs in as through OIDC (docs/AZURE.md, "Deploys and backups"). Gets Contributor on the resource group, blob data access for backups and the seed, and Key Vault Secrets User (for desk-pings-secret and site-bypass-token). Empty skips all three.')
param githubPrincipalId string = ''

@description('Optional GitHub token (repo + workflow scope) to link the Static Web App to the repo at creation. Leave empty to create it unlinked and connect it later (docs/AZURE.md). Never commit one.')
@secure()
param repositoryToken string = ''

@description('Create the monthly budget alert. Off by default: Visual Studio (MSDN) subscriptions, which C.E.O. runs on, reject the Budgets API ("doesn\'t have valid WebDirect/AIRS offer type") and have their own spending limit. Turn it on for a pay-as-you-go subscription.')
param createBudget bool = false

@description('Monthly budget for the subscription, in the billing currency.')
param monthlyBudget int = 25

@description('Email for the budget alert, on top of the subscription Owners. Needed with createBudget: a subscription budget needs at least one contact email.')
param budgetEmail string = ''

@description('First day of the budget, yyyy-MM-01. Defaults to the current month.')
param budgetStartDate string = '${utcNow('yyyy-MM')}-01'

@description('Daily Log Analytics ingestion cap in GB, as a string because Bicep has no decimal literals.')
param logDailyCapGb string = '0.2'

@description('Monthly Claude budget for the world, in USD (the Function App\'s WORLD_BUDGET_USD). The code\'s own default; Azure took less while Vercel shared the key, and is the only home since #313.')
param worldBudgetUsd string = '6'

@description('Monthly Claude budget for Skippy\'s chat on the Azure copy, in USD (SKIPPY_BUDGET_USD).')
param skippyBudgetUsd string = '2'

@description('The email agent\'s own monthly Claude cap on the Azure copy, in USD (EMAIL_BUDGET_USD, #263).')
param emailBudgetUsd string = '10'

@description('Whether the always-on Kernel responder answers Skippy\'s hand-offs (KERNEL_AGENT_ENABLED, #501): "true" or "false". The off switch.')
@allowed(['true', 'false'])
param kernelAgentEnabled string = 'true'

@description('The Kernel responder\'s own monthly Claude cap, in USD (KERNEL_AGENT_BUDGET_USD, #501; Nikita: $10). The code never goes above $10.')
param kernelAgentBudgetUsd string = '10'

@description('Which PayPal the Spire\'s invoices use (PAYPAL_ENV, #279): sandbox until Nikita switches to live. Set it to live on the paste once the Live keys are in.')
@allowed(['sandbox', 'live'])
param paypalEnv string = 'sandbox'

@description('Make ceo.nikita.page the site\'s home (CEO_SITE_URL, #314, docs/DOMAIN.md) once Nikita confirms the switch. Both addresses answer either way.')
param siteOnCustomDomain bool = false

@description('Tags on every resource.')
param tags object = {
  app: 'ceo'
  env: 'prod'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'ceo-resources'
  scope: rg
  params: {
    location: location
    staticSiteLocation: staticSiteLocation
    deployerPrincipalId: deployerPrincipalId
    githubPrincipalId: githubPrincipalId
    repositoryToken: repositoryToken
    logDailyCapGb: logDailyCapGb
    worldBudgetUsd: worldBudgetUsd
    skippyBudgetUsd: skippyBudgetUsd
    emailBudgetUsd: emailBudgetUsd
    kernelAgentEnabled: kernelAgentEnabled
    kernelAgentBudgetUsd: kernelAgentBudgetUsd
    paypalEnv: paypalEnv
    siteOnCustomDomain: siteOnCustomDomain
    tags: tags
  }
}

// The whole subscription's spend, not just this group: a fresh subscription holds only C.E.O. One alert at 80% of
// actual spend, to the Owners and the given email.
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = if (createBudget) {
  name: 'ceo-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactRoles: ['Owner']
        contactEmails: [budgetEmail]
      }
    }
  }
}

output resourceGroup string = rg.name
output siteHostname string = resources.outputs.siteHostname
output siteUrl string = resources.outputs.siteUrl
output staticSiteName string = resources.outputs.staticSiteName
output functionAppName string = resources.outputs.functionAppName
output functionAppUrl string = resources.outputs.functionAppUrl
output keyVaultName string = resources.outputs.keyVaultName
output storageAccountName string = resources.outputs.storageAccountName
output stateContainer string = resources.outputs.stateContainer
output backupContainer string = resources.outputs.backupContainer
output secretNames array = resources.outputs.secretNames
