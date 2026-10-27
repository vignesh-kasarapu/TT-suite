<#
.SYNOPSIS
  Build the production Docker image and create a self-contained bundle to copy to another machine.

.DESCRIPTION
  Output folder (default: deploy/bundle) contains:
    ams-app.tar          the image (API + built React UI)
    docker-compose.yml   app + PostgreSQL 17
    .env.example         settings template
  On the target machine (Docker Desktop):
    docker load -i ams-app.tar
    copy .env.example .env   (then edit passwords/secrets)
    docker compose up -d

.EXAMPLE
  ./deploy/package.ps1
  ./deploy/package.ps1 -Tag 1.0.1
#>
[CmdletBinding()]
param(
    [string]$Tag = 'latest',
    # Defaults to deploy/bundle
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$image = "ams-app:$Tag"
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot 'bundle' }

Write-Host "==> Building $image..." -ForegroundColor Cyan
docker build -t $image $repoRoot
if ($LASTEXITCODE -ne 0) { throw "docker build failed." }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "==> Exporting image..." -ForegroundColor Cyan
docker save $image -o (Join-Path $OutDir 'ams-app.tar')
if ($LASTEXITCODE -ne 0) { throw "docker save failed." }

Copy-Item (Join-Path $PSScriptRoot 'docker-compose.yml') $OutDir -Force
$envExample = (Get-Content (Join-Path $PSScriptRoot '.env.example') -Raw) -replace 'AMS_IMAGE=ams-app:latest', "AMS_IMAGE=$image"
[System.IO.File]::WriteAllText((Join-Path $OutDir '.env.example'), $envExample)

Write-Host ""
Write-Host "==> Bundle ready: $OutDir" -ForegroundColor Green
Get-ChildItem $OutDir -Force | ForEach-Object { Write-Host ("    {0,-20} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB)) }
Write-Host ""
Write-Host "On the target machine:"
Write-Host "    docker load -i ams-app.tar"
Write-Host "    copy .env.example .env     # set POSTGRES_PASSWORD and JWT_SECRET_KEY"
Write-Host "    docker compose up -d"
Write-Host "    -> http://localhost:8080"
