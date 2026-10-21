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

@description('Object ID of the service principal GitHub Actions signs in as through OIDC (docs/AZURE.md, "Deploys and backups"). Gets Contributor on the resource group and blob data access for backups. Empty skips both.')
param githubPrincipalId string = ''

@description('Optional GitHub token (repo + workflow scope) to link the Static Web App to the repo at creation. Leave empty to create it unlinked and connect it later (docs/AZURE.md). Never commit one.')
@secure()
param repositoryToken string = ''

@description('Monthly budget for the subscription, in the billing currency.')
param monthlyBudget int = 25

@description('Email for the budget alert, on top of the subscription Owners. Required by Azure: a subscription budget needs at least one contact email.')
param budgetEmail string

@description('First day of the budget, yyyy-MM-01. Defaults to the current month.')
param budgetStartDate string = '${utcNow('yyyy-MM')}-01'

@description('Daily Log Analytics ingestion cap in GB, as a string because Bicep has no decimal literals.')
param logDailyCapGb string = '0.2'

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
    tags: tags
  }
}

// The whole subscription's spend, not just this group: a fresh subscription holds only C.E.O. One alert at 80% of
// actual spend, to the Owners and the given email.
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
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
