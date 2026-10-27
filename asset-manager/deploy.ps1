<#
.SYNOPSIS
  Provision Azure resources and deploy the Asset Management System to Azure App Service (code deployment).

.DESCRIPTION
  1. Creates/updates the resource group and infrastructure (infra/main.bicep):
     App Service plan + Python 3.12 web app, PostgreSQL Flexible Server, Log Analytics, App Insights.
  2. Builds the React frontend (npm ci && npm run build).
  3. Packages backend/ + frontend/dist (as backend/static) into a zip.
  4. Zip-deploys to App Service; Oryx installs requirements.txt, then `sh startup.sh`
     runs Alembic migrations, seeds defaults and starts gunicorn.

  Generated secrets (PostgreSQL password, JWT key) are stored in .azure/<resource-group>.secrets.json
  (git-ignored) and reused on later runs. Keep that file safe.

.EXAMPLE
  ./deploy.ps1 -ResourceGroup rg-ams-prod -Location centralindia

.EXAMPLE
  # Code-only redeploy (skip infrastructure)
  ./deploy.ps1 -ResourceGroup rg-ams-prod -SkipInfra

.EXAMPLE
  # Build the deployable zip without touching Azure (e.g. for CI or inspection)
  ./deploy.ps1 -ResourceGroup unused -PackageOnly
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroup,

    [string]$Location = 'centralindia',

    [string]$AppName = 'ams',

    [string]$AppServiceSku = 'B1',

    [int]$JwtExpireMinutes = 60,

    [switch]$SkipInfra,

    # Build and zip only (no Azure calls). Output: .azure/build/app.zip
    [switch]$PackageOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot

function Assert-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "'$name' is not installed or not on PATH."
    }
}

function Invoke-Checked([scriptblock]$block, [string]$what) {
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

function New-RandomSecret([int]$length) {
    # Letters + digits only: safe inside a connection URL, satisfies Azure PostgreSQL complexity rules.
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    do {
        $bytes = New-Object byte[] $length
        $rng.GetBytes($bytes)
        $secret = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
    } until ($secret -cmatch '[A-Z]' -and $secret -cmatch '[a-z]' -and $secret -match '[0-9]')
    return $secret
}

function New-ZipFromDirectory([string]$sourceDir, [string]$zipPath) {
    # Compress-Archive on Windows PowerShell 5.1 writes '\' separators, which break on Linux.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        $base = (Resolve-Path $sourceDir).Path.TrimEnd('\', '/')
        Get-ChildItem -Path $base -Recurse -File | ForEach-Object {
            $entryName = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName) | Out-Null
        }
    }
    finally {
        $zip.Dispose()
    }
}

Assert-Command npm
$secretsDir = Join-Path $repoRoot '.azure'

if (-not $PackageOnly) {
    Assert-Command az

    Write-Host "==> Checking Azure login..." -ForegroundColor Cyan
    az account show --query "{subscription:name, id:id}" -o table
    if ($LASTEXITCODE -ne 0) { throw "Not logged in. Run 'az login' (and 'az account set -s <subscription>') first." }

    # ---- Secrets -----------------------------------------------------------------
    $secretsFile = Join-Path $secretsDir "$ResourceGroup.secrets.json"
    if (Test-Path $secretsFile) {
        $secrets = Get-Content $secretsFile -Raw | ConvertFrom-Json
        Write-Host "==> Reusing secrets from $secretsFile" -ForegroundColor Cyan
    }
    else {
        New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
        $secrets = [pscustomobject]@{
            postgresAdminPassword = New-RandomSecret 32
            jwtSecretKey          = New-RandomSecret 64
        }
        $secrets | ConvertTo-Json | Out-File -FilePath $secretsFile -Encoding utf8
        Write-Host "==> Generated new secrets in $secretsFile (keep this file safe)" -ForegroundColor Yellow
    }

    # ---- Infrastructure ----------------------------------------------------------
    if (-not $SkipInfra) {
        Write-Host "==> Creating resource group '$ResourceGroup' in '$Location'..." -ForegroundColor Cyan
        Invoke-Checked { az group create --name $ResourceGroup --location $Location -o none } 'Resource group creation'

        Write-Host "==> Deploying infrastructure (first run takes ~10 minutes for PostgreSQL)..." -ForegroundColor Cyan
        Invoke-Checked {
            az deployment group create `
                --resource-group $ResourceGroup `
                --name "ams-infra" `
                --template-file (Join-Path $repoRoot 'infra/main.bicep') `
                --parameters appName=$AppName `
                             appServiceSkuName=$AppServiceSku `
                             jwtExpireMinutes=$JwtExpireMinutes `
                             postgresAdminPassword=$($secrets.postgresAdminPassword) `
                             jwtSecretKey=$($secrets.jwtSecretKey) `
                -o none
        } 'Infrastructure deployment'
    }

    $outputsJson = az deployment group show --resource-group $ResourceGroup --name "ams-infra" --query properties.outputs -o json
    if ($LASTEXITCODE -ne 0) { throw "Could not read deployment outputs. Run once without -SkipInfra." }
    $outputs = $outputsJson | ConvertFrom-Json
    $webAppName = $outputs.webAppName.value
    $appUrl = $outputs.appUrl.value
}

# ---- Build frontend ----------------------------------------------------------
Write-Host "==> Building frontend..." -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot 'frontend')
try {
    Invoke-Checked { npm ci } 'npm ci'
    Invoke-Checked { npm run build } 'npm run build'
}
finally {
    Pop-Location
}

# ---- Package -----------------------------------------------------------------
Write-Host "==> Packaging application..." -ForegroundColor Cyan
$buildDir = Join-Path $secretsDir 'build'
$stageDir = Join-Path $buildDir 'package'
$zipPath = Join-Path $buildDir 'app.zip'
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

$backendDir = Join-Path $repoRoot 'backend'
$exclude = @('tests', '.venv', 'venv', '__pycache__', '.pytest_cache', '.env', 'Dockerfile', '.dockerignore', 'entrypoint.sh')
Get-ChildItem -Path $backendDir -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $stageDir -Recurse -Force
}
Get-ChildItem -Path $stageDir -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $repoRoot 'frontend/dist') -Destination (Join-Path $stageDir 'static') -Recurse

# startup.sh must have LF line endings to run on Linux.
$startup = Join-Path $stageDir 'startup.sh'
[System.IO.File]::WriteAllText($startup, ([System.IO.File]::ReadAllText($startup) -replace "`r`n", "`n"))

New-ZipFromDirectory -sourceDir $stageDir -zipPath $zipPath
Write-Host ("    {0} ({1:N1} MB)" -f $zipPath, ((Get-Item $zipPath).Length / 1MB))
if ($PackageOnly) { return }

# ---- Deploy ------------------------------------------------------------------
Write-Host "==> Deploying code to App Service '$webAppName' (Oryx installs Python dependencies)..." -ForegroundColor Cyan
Invoke-Checked {
    az webapp deploy `
        --resource-group $ResourceGroup `
        --name $webAppName `
        --src-path $zipPath `
        --type zip `
        --timeout 1200000 `
        -o none
} 'Code deployment'

Write-Host ""
Write-Host "==> Deployed: $appUrl" -ForegroundColor Green
Write-Host "    Health:  $appUrl/health"
Write-Host "    API docs: $appUrl/docs"
Write-Host "    Logs:    az webapp log tail -g $ResourceGroup -n $webAppName"
Write-Host ""
Write-Host "IMPORTANT: default seeded accounts (admin@tektalis.com / Admin@123 etc.) exist." -ForegroundColor Yellow
Write-Host "           Sign in and change their passwords immediately." -ForegroundColor Yellow
