// Azure infrastructure for the Tektalis Asset Management System (code deployment).
//
//   App Service (Linux, Python 3.12) ── FastAPI API + built React SPA (same origin)
//            │
//            ▼
//   Azure Database for PostgreSQL Flexible Server (v17)
//
// Code is zip-deployed afterwards by deploy.ps1; Oryx installs requirements.txt
// during deployment and App Service runs `sh startup.sh` (migrations, seed, gunicorn).

targetScope = 'resourceGroup'

@description('Short name used as a prefix for all resources.')
@minLength(3)
@maxLength(12)
param appName string = 'ams'

@description('Azure region. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('App Service plan SKU (B1 = Basic; use P0v3/P1v3 for production workloads).')
param appServiceSkuName string = 'B1'

@description('PostgreSQL administrator login name.')
param postgresAdminUser string = 'amsadmin'

@description('PostgreSQL administrator password. Use only letters and digits (it is embedded in a connection URL).')
@secure()
param postgresAdminPassword string

@description('Secret used to sign JWT access tokens.')
@secure()
param jwtSecretKey string

@description('JWT access token lifetime in minutes.')
param jwtExpireMinutes int = 60

@description('PostgreSQL major version.')
param postgresVersion string = '17'

@description('PostgreSQL compute SKU (Burstable B1ms is the cheapest tier).')
param postgresSkuName string = 'Standard_B1ms'

@description('PostgreSQL compute tier matching the SKU.')
@allowed([ 'Burstable', 'GeneralPurpose', 'MemoryOptimized' ])
param postgresSkuTier string = 'Burstable'

var suffix = uniqueString(resourceGroup().id)
var webAppName = toLower('${appName}-web-${suffix}')
var postgresServerName = toLower('${appName}-pg-${suffix}')
var databaseName = 'ams_db'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${appName}-logs-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${appName}-ai-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresServerName
  location: location
  sku: {
    name: postgresSkuName
    tier: postgresSkuTier
  }
  properties: {
    version: postgresVersion
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Special 0.0.0.0 rule = allow connections from Azure services (incl. App Service).
resource postgresAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan-${suffix}'
  location: location
  kind: 'linux'
  sku: { name: appServiceSkuName }
  properties: {
    reserved: true // required for Linux plans
  }
}

var databaseUrl = 'postgresql+psycopg://${postgresAdminUser}:${postgresAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  dependsOn: [ database, postgresAllowAzure ]
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'PYTHON|3.12'
      appCommandLine: 'sh startup.sh'
      alwaysOn: appServiceSkuName != 'F1' && appServiceSkuName != 'D1'
      healthCheckPath: '/health'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        // Oryx: pip install -r requirements.txt during zip deploy.
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        // Migrations + seed run before gunicorn binds; give the container time to start.
        { name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '600' }
        { name: 'WEBSITES_PORT', value: '8000' }
        { name: 'DATABASE_URL', value: databaseUrl }
        { name: 'JWT_SECRET_KEY', value: jwtSecretKey }
        { name: 'JWT_ALGORITHM', value: 'HS256' }
        { name: 'JWT_ACCESS_TOKEN_EXPIRE_MINUTES', value: string(jwtExpireMinutes) }
        { name: 'CORS_ORIGINS', value: 'https://${webAppName}.azurewebsites.net' }
        { name: 'STATIC_DIR', value: 'static' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
      ]
    }
  }
}

// Stream stdout/stderr (startup, migrations, gunicorn) to Log Analytics.
resource webAppDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: webApp
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServicePlatformLogs', enabled: true }
    ]
  }
}

output webAppName string = webApp.name
output appUrl string = 'https://${webApp.properties.defaultHostName}'
output postgresServerName string = postgres.name
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
