# KurdLogs Core — Windows installer (downloads binaries only, never the source)
# Usage:
#   irm https://kurdlogs-core.sarhadyt.workers.dev/install.ps1 | iex
[CmdletBinding()]
param(
  [string]$InstallDir = $(Join-Path $env:LOCALAPPDATA 'KurdLogs-Core'),
  [string]$DistBase = 'https://kurdlogs-core.sarhadyt.workers.dev',
  [string]$ImageTag = 'latest',
  [int]$HttpPort = 8081
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Num, [string]$Title) {
  Write-Host ""
  Write-Host "  [$Num] $Title" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "  ✓ $Message" -ForegroundColor Green
}

Write-Host ""
Write-Host "  KURDLOGS CORE  ·  Windows binary install" -ForegroundColor White
Write-Host "  Source stays private — only release images are pulled." -ForegroundColor DarkGray
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required. Install Docker Desktop, then re-run this installer."
}

docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose is required. Update Docker Desktop and try again."
}

Write-Step '01' "Create install folder"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Set-Location $InstallDir
Write-Ok $InstallDir

Write-Step '02' "Download release package (no source)"
$composeUrl = "$DistBase/release/docker-compose.yml"
Invoke-WebRequest -Uri $composeUrl -OutFile (Join-Path $InstallDir 'docker-compose.yml') -UseBasicParsing
Write-Ok 'docker-compose.yml'

Write-Step '03' "Configure environment"
$envPath = Join-Path $InstallDir '.env'
$adminPasswordShown = $null
if (-not (Test-Path $envPath)) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $jwt = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  $bytes = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pg = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  $bytes = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $api = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  $bytes = New-Object byte[] 10
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $adminHex = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  $adminPasswordShown = "Kl-${adminHex}9A"

  @"
PUBLIC_BASE_URL=http://localhost:$HttpPort
JWT_SECRET=$jwt
ADMIN_INITIAL_PASSWORD=$adminPasswordShown
IPTV_API_KEY=$api
POSTGRES_PASSWORD=$pg
HTTP_PORT=$HttpPort
RTMP_PUBLISH_PORT=1936
MCR_RTMP_PORT=1936
TOKEN_OVERLAP_SECONDS=120
TOKEN_REFRESH_AHEAD_SECONDS=90
KURDLOGS_IMAGE_BACKEND=ghcr.io/sarhadcodes/kurdlogs-core-backend:$ImageTag
KURDLOGS_IMAGE_FRONTEND=ghcr.io/sarhadcodes/kurdlogs-core-frontend:$ImageTag
KURDLOGS_IMAGE_NGINX=ghcr.io/sarhadcodes/kurdlogs-core-nginx:$ImageTag
"@ | Set-Content -Path $envPath -Encoding UTF8
  Write-Ok 'Created .env with generated secrets'
} else {
  $adminLine = Get-Content $envPath | Where-Object { $_ -match '^ADMIN_INITIAL_PASSWORD=' } | Select-Object -First 1
  if ($adminLine) {
    $adminPasswordShown = ($adminLine -replace '^ADMIN_INITIAL_PASSWORD=', '').Trim()
  }
  Write-Ok '.env already exists — keeping your settings'
}

Write-Step '04' "Pull binary images"
docker compose pull
if ($LASTEXITCODE -ne 0) {
  $needed = @(
    'ghcr.io/sarhadcodes/kurdlogs-core-backend:latest',
    'ghcr.io/sarhadcodes/kurdlogs-core-frontend:latest',
    'ghcr.io/sarhadcodes/kurdlogs-core-nginx:latest'
  )
  $missing = @()
  foreach ($img in $needed) {
    docker image inspect $img 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $missing += $img }
  }
  if ($missing.Count -gt 0) {
    throw @"
docker compose pull failed (registry denied / images missing).

The public release images are not available yet on GHCR.
Owner must publish them once:

  1) gh auth login -s write:packages
  2) Open GitHub → Actions → Publish release images → Run workflow
  3) Package settings → make each kurdlogs-core-* package Public

Missing:
$($missing -join "`n")
"@
  }
  Write-Host "  ! Registry pull failed, but local images were found — continuing." -ForegroundColor Yellow
} else {
  Write-Ok 'Images downloaded'
}

Write-Step '05' "Start KurdLogs Core"
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }
Write-Ok 'Services started'

Write-Host ""
Write-Host "  INSTALL COMPLETE" -ForegroundColor Green
Write-Host "  open  →  http://localhost:$HttpPort"
if ($adminPasswordShown) {
  Write-Host "  login →  admin / $adminPasswordShown"
  Write-Host "  note  →  change password + enable MFA in Settings after first login"
} else {
  Write-Host "  login →  admin / (see ADMIN_INITIAL_PASSWORD in .env or backend logs)"
}
Write-Host "  path  →  $InstallDir"
Write-Host ""
