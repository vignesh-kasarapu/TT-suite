#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy Kanban to Azure (test or prod): Web App for Containers + PostgreSQL Flexible Server,
  (D-080; the VS Code code-deploy route is Solution/docs/azure-code-deploy.md). Idempotent - every step checks what exists
  first, so re-running with a new -ImageTag is how a release is shipped.

.DESCRIPTION
  Prompts for every value it needs; a default in [brackets] is taken with Enter. Secrets are read
  masked and never written to the repo or echoed. For an unattended run (release.yml) set each
  value as an environment variable KANBAN_<NAME> (names are shown beside each prompt) and
  KANBAN_CONFIRM=yes; nothing is then asked.

  Needs: Azure CLI >= 2.60 signed in (`az login`), psql on PATH (PostgreSQL client tools), and
  the image already pushed to the registry (runbook section 1).

.EXAMPLE
  pwsh Solution/infra/deploy.ps1 -Env test -ImageTag d0a4045
#>
param(
  [ValidateSet('test', 'prod')] [string]$Env,
  [string]$ImageTag
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$temp = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ("kanban-deploy-" + [Guid]::NewGuid()))

# ---------------------------------------------------------------- helpers

function Ask([string]$Name, [string]$Prompt, [string]$Default = '', [switch]$Optional) {
  $fromEnv = [Environment]::GetEnvironmentVariable("KANBAN_$Name")
  if ($fromEnv) { return $fromEnv }
  $hint = ''
  if ($Default) { $hint = " [$Default]" }
  $v = Read-Host "$Prompt (KANBAN_$Name)$hint"
  if (-not $v) { $v = $Default }
  if (-not $v -and -not $Optional) { throw "$Name is required." }
  return $v
}

function AskSecret([string]$Name, [string]$Prompt) {
  $fromEnv = [Environment]::GetEnvironmentVariable("KANBAN_$Name")
  if ($fromEnv) { return $fromEnv }
  $s = Read-Host "$Prompt (KANBAN_$Name, input hidden)" -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  if (-not $plain) { throw "$Name is required." }
  return $plain
}

# Run az; throw on a non-zero exit. The arguments are not echoed (some carry file paths to secrets).
function Invoke-AzCli {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'   # az writes warnings to stderr
  try { $out = & az @args --only-show-errors }
  finally { $ErrorActionPreference = $old }
  if ($LASTEXITCODE -ne 0) { throw "az $($args[0]) $($args[1]) $($args[2]) failed (exit $LASTEXITCODE)." }
  return $out
}

# Does this az 'show' succeed? (Existence checks for idempotency.)
function Test-AzCli {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & az @args --only-show-errors -o none 2>$null | Out-Null }
  finally { $ErrorActionPreference = $old }
  return ($LASTEXITCODE -eq 0)
}

function JsonFile([string]$Name, $Object) {
  $path = Join-Path $temp $Name
  $Object | ConvertTo-Json -Depth 10 | Set-Content -Path $path -Encoding UTF8
  return "@$path"
}

function SqlLiteral([string]$s) { return "'" + $s.Replace("'", "''") + "'" }

function Psql([string]$Conn, [string]$Password, [string]$Sql, [switch]$Scalar) {
  $file = Join-Path $temp ("q-" + [Guid]::NewGuid() + ".sql")
  Set-Content -Path $file -Value $Sql -Encoding UTF8
  $env:PGPASSWORD = $Password
  try {
    if ($Scalar) { $out = & psql $Conn -v ON_ERROR_STOP=1 -tA -f $file }
    else { $out = & psql $Conn -v ON_ERROR_STOP=1 -q -f $file }
    if ($LASTEXITCODE -ne 0) { throw "psql failed (exit $LASTEXITCODE)." }
    return $out
  }
  finally {
    Remove-Item $file -Force
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
}

function Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }

try {
  foreach ($tool in 'az', 'psql') {
    if (-not (Get-Command $tool -CommandType Application -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH (see the runbook, section 0)." }
  }

  # ---------------------------------------------------------------- inputs
  Step 'Inputs (Enter takes the [default])'
  if (-not $Env) { $Env = Ask 'ENV' 'Environment: test or prod' 'test' }
  if ($Env -notin 'test', 'prod') { throw 'Environment must be test or prod.' }
  if (-not $ImageTag) { $ImageTag = Ask 'IMAGE_TAG' 'Image tag (the short git SHA pushed in runbook section 1)' }

  $account = (Invoke-AzCli account show -o json | Out-String | ConvertFrom-Json)
  $subscription = Ask 'SUBSCRIPTION' 'Azure subscription (name or id)' $account.name
  Invoke-AzCli account set --subscription $subscription | Out-Null
  $location = Ask 'LOCATION' 'Azure region' 'centralindia'
  $rg = Ask 'RESOURCE_GROUP' 'Resource group' "rg-kanban-$Env"
  $acr = Ask 'ACR_NAME' 'Container registry name (created if missing)' 'acrtektalis'
  $acrRg = Ask 'ACR_RESOURCE_GROUP' 'Resource group of that registry' $rg
  $repo = Ask 'IMAGE_REPO' 'Image repository in the registry' 'kanban/app'
  $plan = Ask 'PLAN' 'App Service plan' "asp-kanban-$Env"
  $app = Ask 'APP_NAME' 'Web App name (becomes <name>.azurewebsites.net)' "app-kanban-$Env"
  $workspace = Ask 'LOG_WORKSPACE' 'Log Analytics workspace' "log-kanban-$Env"
  $publicUrl = Ask 'PUBLIC_BASE_URL' 'Public base URL' "https://$app.azurewebsites.net"
  $publicUrl = $publicUrl.TrimEnd('/')

  $pgServer = Ask 'PG_SERVER' 'PostgreSQL Flexible Server (existing one to join, or new)' "pg-kanban-$Env"
  $pgRg = Ask 'PG_RESOURCE_GROUP' 'Resource group of that server' $rg
  $pgAdmin = Ask 'PG_ADMIN_USER' 'Server admin login' 'pgadmin'
  $pgAdminPw = AskSecret 'PG_ADMIN_PASSWORD' 'Server admin password (new server: choose one)'
  $dbName = Ask 'DB_NAME' 'Database name' 'kanban'
  # D-106: role names are this app's own, so a server shared with LMS2.1 keeps them apart.
  $ownerRole = Ask 'DB_OWNER_ROLE' 'Database owner role (runs migrations; unique to Kanban on a shared server)' 'kanban_owner'
  $appRole = Ask 'DB_APP_ROLE' 'Database runtime role (the app connects as it; unique to Kanban on a shared server)' 'kanban_app'
  foreach ($r in $ownerRole, $appRole) {
    if ($r -cnotmatch '^[a-z_][a-z0-9_]{0,62}$') { throw "Role '$r' must be lower-case letters, digits and _ (max 63)." }
  }
  if ($ownerRole -eq $appRole) { throw 'The owner and runtime roles must differ.' }
  $ownerPw = AskSecret 'DB_OWNER_PASSWORD' "Password for role $ownerRole"
  $rwPw = AskSecret 'DB_APP_PASSWORD' "Password for role $appRole"

  $tenant = Ask 'ENTRA_TENANT_ID' 'Entra tenant (directory) id'
  $client = Ask 'ENTRA_CLIENT_ID' 'Entra application (client) id'
  $clientSecret = AskSecret 'ENTRA_CLIENT_SECRET' 'Entra client secret VALUE (not its id)'
  $redirect = Ask 'ENTRA_REDIRECT_URI' 'Entra redirect URI (must be on the app registration)' "$publicUrl/api/v1/auth/oidc/callback"

  $mailProvider = Ask 'MAIL_PROVIDER' 'Mail provider: graph or stub (stub is refused in prod)' 'graph'
  $mailSender = Ask 'MAIL_SENDER' 'Sender mailbox for Graph mail' 'kanban@tektalis.com'
  $seedAdmin = Ask 'SEED_ADMIN_EMAIL' 'First admin email (created at boot when there is no admin)'
  $appSecret = [Environment]::GetEnvironmentVariable('KANBAN_APP_SECRET')
  if (-not $appSecret) {
    $gen = Read-Host 'APP_SECRET (KANBAN_APP_SECRET): generate a new one? Keep the old one on a re-deploy, or saved Teams webhooks stop decrypting. (y = generate / n = type it) [y]'
    if ($gen -eq 'n') { $appSecret = AskSecret 'APP_SECRET' 'APP_SECRET (base64 of 32 random bytes)' }
    else {
      $bytes = New-Object byte[] 32
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      $appSecret = [Convert]::ToBase64String($bytes)
      Write-Host 'Generated a new APP_SECRET (stored with the other secrets; not shown).'
    }
  }
  $orgTz = Ask 'ORG_TZ' 'Organisation time zone (IANA)' 'Asia/Kolkata'
  $logLevel = Ask 'LOG_LEVEL' 'Log level' 'info'
  $sessionHours = Ask 'SESSION_HOURS' 'Session length in hours' '24'
  $opsEmail = Ask 'OPS_EMAIL' 'Ops email for alerts' 'ops@tektalis.com'
  $kv = ''
  if ($Env -eq 'prod') { $kv = Ask 'KEY_VAULT' 'Key Vault for prod secrets' 'kv-kanban-prod' }

  Write-Host ''
  Write-Host "About to deploy $repo`:$ImageTag to '$Env'" -ForegroundColor Yellow
  Write-Host "  subscription $subscription, region $location, resource group $rg"
  Write-Host "  web app $app ($publicUrl) on plan $plan (B1)"
  Write-Host "  registry $acr, database $dbName on $pgServer ($pgRg), roles $ownerRole / $appRole"
  if ($kv) { Write-Host "  secrets in Key Vault $kv" } else { Write-Host '  secrets as app settings' }
  $confirm = [Environment]::GetEnvironmentVariable('KANBAN_CONFIRM')
  if (-not $confirm) { $confirm = Read-Host 'Proceed? (yes/no)' }
  if ($confirm -ne 'yes') { throw 'Stopped - nothing was changed.' }

  # ---------------------------------------------------------------- 1. resource group
  Step "Resource group $rg"
  if ((Invoke-AzCli group exists -n $rg) -ne 'true') { Invoke-AzCli group create -n $rg -l $location -o none }

  # ---------------------------------------------------------------- 2. registry + image
  Step "Container registry $acr"
  if (-not (Test-AzCli acr show -n $acr -g $acrRg)) {
    if ((Invoke-AzCli group exists -n $acrRg) -ne 'true') { Invoke-AzCli group create -n $acrRg -l $location -o none }
    Invoke-AzCli acr create -n $acr -g $acrRg --sku Basic --admin-enabled false -l $location -o none
  }
  $acrId = Invoke-AzCli acr show -n $acr -g $acrRg --query id -o tsv
  $tags = Invoke-AzCli acr repository show-tags -n $acr --repository $repo -o tsv
  if ($tags -notcontains $ImageTag) {
    throw "Image $acr.azurecr.io/$repo`:$ImageTag is not in the registry. Build and push it first (runbook section 1)."
  }
  $image = "$acr.azurecr.io/$repo`:$ImageTag"

  # ---------------------------------------------------------------- 3. logs
  Step "Log Analytics workspace $workspace"
  if (-not (Test-AzCli monitor log-analytics workspace show -g $rg -n $workspace)) {
    Invoke-AzCli monitor log-analytics workspace create -g $rg -n $workspace -l $location --retention-time 30 -o none
  }
  $workspaceId = Invoke-AzCli monitor log-analytics workspace show -g $rg -n $workspace --query id -o tsv

  # ---------------------------------------------------------------- 4-5. plan + web app
  Step "App Service plan $plan and Web App $app"
  if (-not (Test-AzCli appservice plan show -g $rg -n $plan)) {
    Invoke-AzCli appservice plan create -g $rg -n $plan -l $location --is-linux --sku B1 -o none
  }
  if (-not (Test-AzCli webapp show -g $rg -n $app)) {
    Invoke-AzCli webapp create -g $rg -p $plan -n $app --container-image-name $image -o none
  }
  $principal = Invoke-AzCli webapp identity assign -g $rg -n $app --query principalId -o tsv
  $pull = Invoke-AzCli role assignment list --assignee $principal --role AcrPull --scope $acrId --query '[].id' -o tsv
  if (-not $pull) {
    Invoke-AzCli role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal --role AcrPull --scope $acrId -o none
  }
  $siteConfig = @{
    acrUseManagedIdentityCreds = $true
    alwaysOn                   = $true
    http20Enabled              = $true
    minTlsVersion              = '1.2'
    ftpsState                  = 'Disabled'
    healthCheckPath            = '/api/v1/health'
    autoHealEnabled            = $true
    autoHealRules              = @{
      triggers = @{ statusCodes = @(@{ status = 500; subStatus = 0; win32Status = 0; count = 10; timeInterval = '00:05:00' }) }
      actions  = @{ actionType = 'Recycle'; minProcessExecutionTime = '00:05:00' }
    }
  }
  Invoke-AzCli webapp config set -g $rg -n $app --generic-configurations (JsonFile 'site.json' $siteConfig) -o none
  Invoke-AzCli webapp update -g $rg -n $app --https-only true -o none
  Invoke-AzCli webapp log config -g $rg -n $app --docker-container-logging filesystem -o none
  $appId = Invoke-AzCli webapp show -g $rg -n $app --query id -o tsv
  if (-not (Test-AzCli monitor diagnostic-settings show --name to-log-analytics --resource $appId)) {
    $logs = @(@{ category = 'AppServiceConsoleLogs'; enabled = $true }, @{ category = 'AppServiceHTTPLogs'; enabled = $true })
    Invoke-AzCli monitor diagnostic-settings create --name to-log-analytics --resource $appId --workspace $workspaceId --logs (JsonFile 'logs.json' $logs) -o none
  }

  # ---------------------------------------------------------------- 6. PostgreSQL
  Step "PostgreSQL $pgServer"
  if (-not (Test-AzCli postgres flexible-server show -g $pgRg -n $pgServer)) {
    if ((Invoke-AzCli group exists -n $pgRg) -ne 'true') { Invoke-AzCli group create -n $pgRg -l $location -o none }
    Invoke-AzCli postgres flexible-server create -g $pgRg -n $pgServer -l $location --tier Burstable --sku-name Standard_B1ms `
      --storage-size 32 --version 17 --backup-retention 35 --admin-user $pgAdmin --admin-password $pgAdminPw `
      --public-access None --yes -o none
  }
  Invoke-AzCli postgres flexible-server parameter set -g $pgRg -s $pgServer --name require_secure_transport --value on -o none
  $pgHost = Invoke-AzCli postgres flexible-server show -g $pgRg -n $pgServer --query fullyQualifiedDomainName -o tsv

  # Firewall: the Web App's possible outbound IPs, plus this machine for the role setup below.
  $outbound = (Invoke-AzCli webapp show -g $rg -n $app --query possibleOutboundIpAddresses -o tsv) -split ','
  $i = 0
  foreach ($ip in ($outbound | Sort-Object -Unique)) {
    $i++
    Invoke-AzCli postgres flexible-server firewall-rule create -g $pgRg -n $pgServer --rule-name "$app-out-$i" --start-ip-address $ip --end-ip-address $ip -o none
  }
  $myIp = (Invoke-WebRequest -UseBasicParsing -Uri 'https://api.ipify.org').Content.Trim()
  Invoke-AzCli postgres flexible-server firewall-rule create -g $pgRg -n $pgServer --rule-name 'deploy-operator' --start-ip-address $myIp --end-ip-address $myIp -o none
  try {
    $adminConn = "host=$pgHost port=5432 dbname=postgres user=$pgAdmin sslmode=require"
    $existing = Psql $adminConn $pgAdminPw "SELECT string_agg(rolname, ',') FROM pg_roles WHERE rolname IN ('$ownerRole','$appRole');" -Scalar
    $existingList = @()
    if ($existing) { $existingList = $existing.Trim() -split ',' }
    if ($existingList.Count -gt 0) {
      Write-Host "Roles already on this server: $existing." -ForegroundColor Yellow
      Write-Host 'Roles are server-wide: fine on a re-deploy of Kanban; if another app uses them, stop and pick other names.' -ForegroundColor Yellow
      $reuse = [Environment]::GetEnvironmentVariable('KANBAN_REUSE_ROLES')
      if (-not $reuse) { $reuse = Read-Host 'Reuse them and set the passwords given above? (yes/no)' }
      if ($reuse -ne 'yes') { throw 'Stopped at the database roles - see the runbook, section 7.' }
    }
    $sql = @()
    if ($existingList -notcontains $ownerRole) { $sql += "CREATE ROLE $ownerRole LOGIN;" }
    if ($existingList -notcontains $appRole) { $sql += "CREATE ROLE $appRole LOGIN;" }
    $sql += "ALTER ROLE $ownerRole WITH LOGIN PASSWORD $(SqlLiteral $ownerPw);"
    $sql += "ALTER ROLE $appRole WITH LOGIN PASSWORD $(SqlLiteral $rwPw);"
    $sql += "GRANT $ownerRole TO CURRENT_USER;"   # the admin must be a member to hand the database over
    Psql $adminConn $pgAdminPw ($sql -join "`n") | Out-Null
    $hasDb = Psql $adminConn $pgAdminPw "SELECT 1 FROM pg_database WHERE datname = $(SqlLiteral $dbName);" -Scalar
    if (-not $hasDb) { Psql $adminConn $pgAdminPw "CREATE DATABASE `"$dbName`" OWNER $ownerRole;" | Out-Null }
    Psql $adminConn $pgAdminPw "GRANT CONNECT ON DATABASE `"$dbName`" TO $appRole;" | Out-Null
    $dbConn = "host=$pgHost port=5432 dbname=$dbName user=$pgAdmin sslmode=require"
    Psql $dbConn $pgAdminPw "GRANT USAGE ON SCHEMA public TO $appRole;" | Out-Null   # table grants: the migrations, to the DATABASE_URL user
  }
  finally {
    Invoke-AzCli postgres flexible-server firewall-rule delete -g $pgRg -n $pgServer --rule-name 'deploy-operator' --yes -o none
  }
  $enc = { param($s) [Uri]::EscapeDataString($s) }
  $dbUrl = "postgres://$appRole`:$(& $enc $rwPw)@$pgHost`:5432/$dbName`?sslmode=require"
  $dbOwnerUrl = "postgres://$ownerRole`:$(& $enc $ownerPw)@$pgHost`:5432/$dbName`?sslmode=require"

  # ---------------------------------------------------------------- 7. settings + secrets
  Step 'App settings and secrets'
  $secrets = [ordered]@{
    DATABASE_URL        = $dbUrl
    DATABASE_OWNER_URL  = $dbOwnerUrl
    ENTRA_CLIENT_SECRET = $clientSecret
    APP_SECRET          = $appSecret
  }
  $settings = [ordered]@{
    WEBSITES_PORT      = '8080'
    APP_PROFILE        = $Env
    APP_VERSION        = $ImageTag
    PUBLIC_BASE_URL    = $publicUrl
    AUTH_PROVIDER      = 'entra'
    AUTH_DEV_MODE      = 'false'
    ENTRA_TENANT_ID    = $tenant
    ENTRA_CLIENT_ID    = $client
    ENTRA_REDIRECT_URI = $redirect
    MAIL_PROVIDER      = $mailProvider
    MAIL_SENDER        = $mailSender
    SEED_ADMIN_EMAIL   = $seedAdmin
    ORG_TZ             = $orgTz
    LOG_LEVEL          = $logLevel
    SESSION_HOURS      = $sessionHours
  }
  if ($Env -eq 'prod') {
    if (-not (Test-AzCli keyvault show -n $kv -g $rg)) {
      Invoke-AzCli keyvault create -n $kv -g $rg -l $location --enable-rbac-authorization true -o none
    }
    $kvId = Invoke-AzCli keyvault show -n $kv -g $rg --query id -o tsv
    $me = Invoke-AzCli ad signed-in-user show --query id -o tsv
    foreach ($grant in @(@{ who = $me; type = 'User'; role = 'Key Vault Secrets Officer' }, @{ who = $principal; type = 'ServicePrincipal'; role = 'Key Vault Secrets User' })) {
      $has = Invoke-AzCli role assignment list --assignee $grant.who --role $grant.role --scope $kvId --query '[].id' -o tsv
      if (-not $has) {
        Invoke-AzCli role assignment create --assignee-object-id $grant.who --assignee-principal-type $grant.type --role $grant.role --scope $kvId -o none
      }
    }
    foreach ($key in $secrets.Keys) {
      $name = $key.ToLower().Replace('_', '-')
      $file = Join-Path $temp "$name.txt"
      [IO.File]::WriteAllText($file, $secrets[$key])
      $done = $false
      for ($try = 1; -not $done; $try++) {   # a new role assignment takes a minute or two to apply
        $old = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & az keyvault secret set --vault-name $kv -n $name --file $file --encoding utf-8 --only-show-errors -o none 2>$null
        $ErrorActionPreference = $old
        if ($LASTEXITCODE -eq 0) { $done = $true }
        elseif ($try -ge 12) { throw "Could not write secret $name to $kv." }
        else { Start-Sleep -Seconds 15 }
      }
      Remove-Item $file -Force
      $settings[$key] = "@Microsoft.KeyVault(SecretUri=https://$kv.vault.azure.net/secrets/$name/)"
    }
  }
  else {
    foreach ($key in $secrets.Keys) { $settings[$key] = $secrets[$key] }
  }
  $settingsFile = JsonFile 'settings.json' $settings
  Invoke-AzCli webapp config appsettings set -g $rg -n $app --settings $settingsFile -o none
  Remove-Item $settingsFile.Substring(1) -Force

  # ---------------------------------------------------------------- 8. image + alerts
  Step "Image $image"
  Invoke-AzCli webapp config container set -g $rg -n $app --container-image-name $image --container-registry-url "https://$acr.azurecr.io" -o none

  Step 'Alerts'
  $ag = "ag-kanban-$Env"
  if (-not (Test-AzCli monitor action-group show -g $rg -n $ag)) {
    Invoke-AzCli monitor action-group create -g $rg -n $ag --short-name "kanban$Env" --action email ops $opsEmail -o none
  }
  $agId = Invoke-AzCli monitor action-group show -g $rg -n $ag --query id -o tsv
  $pgId = Invoke-AzCli postgres flexible-server show -g $pgRg -n $pgServer --query id -o tsv
  $alerts = @(
    @{ n = "kanban-$Env-health"; scope = $appId; cond = 'avg HealthCheckStatus < 100' },
    @{ n = "kanban-$Env-db-cpu-credits"; scope = $pgId; cond = 'min cpu_credits_remaining < 10' },
    @{ n = "kanban-$Env-db-storage"; scope = $pgId; cond = 'max storage_percent > 80' }
  )
  foreach ($a in $alerts) {
    if (-not (Test-AzCli monitor metrics alert show -g $rg -n $a.n)) {
      Invoke-AzCli monitor metrics alert create -g $rg -n $a.n --scopes $a.scope --condition $a.cond --window-size 5m --evaluation-frequency 1m --action $agId -o none
    }
  }

  # ---------------------------------------------------------------- 9. restart + health
  Step 'Restart and wait for health'
  Invoke-AzCli webapp restart -g $rg -n $app -o none
  $healthy = $false
  for ($t = 0; $t -lt 40 -and -not $healthy; $t++) {
    Start-Sleep -Seconds 15
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "$publicUrl/api/v1/health" -TimeoutSec 10
      if ($r.StatusCode -eq 200 -and $r.Content -match '"ok"') { $healthy = $true }
    }
    catch { Write-Host '.' -NoNewline }
  }
  if (-not $healthy) {
    throw "No healthy response from $publicUrl/api/v1/health after 10 minutes. Check the container log: az webapp log tail -g $rg -n $app"
  }
  Write-Host "`nDeployed $ImageTag to $Env - $publicUrl is healthy." -ForegroundColor Green
  Write-Host 'Next: the 5-minute smoke checklist (runbook section 3).'
}
finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
