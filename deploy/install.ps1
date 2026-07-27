# KurdLogs Core — Windows installer (downloads binaries only, never the source)
# Usage:
#   irm https://kurdlogs-core.sarhadyt.workers.dev/install.ps1 | iex
[CmdletBinding()]
param(
  [string]$InstallDir = $(Join-Path $env:LOCALAPPDATA 'KurdLogs-Core'),
  [string]$DistBase = 'https://kurdlogs-core.sarhadyt.workers.dev',
  [string]$ImageTag = '1.2.1',
  [int]$HttpPort = 8081,
  [string]$InstallerVersion = '2026-07-27-v3'
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

$KlDefaultAdminPassword = 'Kurdlogs!'

function New-KlAdminPassword {
  return $KlDefaultAdminPassword
}

function Get-KlEnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) { return $null }
  $line = Get-Content $Path -Encoding UTF8 | Where-Object { $_ -match ("^" + [regex]::Escape($Key) + "=") } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace ("^" + [regex]::Escape($Key) + "="), '').Trim().Trim('"').Trim("'")
}

function Set-KlEnvValue([string]$Path, [string]$Key, [string]$Value) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  if (-not (Test-Path $Path)) {
    [System.IO.File]::WriteAllText($Path, "$Key=$Value`n", $utf8NoBom)
    return
  }
  $raw = [System.IO.File]::ReadAllText($Path)
  $pattern = '(?m)^' + [regex]::Escape($Key) + '=.*$'
  if ([regex]::IsMatch($raw, $pattern)) {
    $raw = [regex]::Replace($raw, $pattern, "$Key=$Value", 1)
  } else {
    if ($raw.Length -gt 0 -and -not $raw.EndsWith("`n")) { $raw += "`n" }
    $raw += "$Key=$Value`n"
  }
  [System.IO.File]::WriteAllText($Path, $raw, $utf8NoBom)
}

function Test-KlTcpPortInUse([int]$Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient('127.0.0.1', $Port)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Wait-KlBackendReady {
  for ($i = 0; $i -lt 60; $i++) {
    docker compose exec -T backend node -e "process.exit(0)" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Invoke-KlAdminPasswordSync {
  $script = @'
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const password = (process.env.ADMIN_INITIAL_PASSWORD || "").trim();
if (!password) {
  console.error("ADMIN_INITIAL_PASSWORD missing");
  process.exit(2);
}
bcrypt.hash(password, 12)
  .then((hash) => prisma.user.upsert({
    where: { username: "admin" },
    update: {
      passwordHash: hash,
      mustChangePassword: false,
      role: "ADMIN",
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: null,
    },
    create: {
      username: "admin",
      passwordHash: hash,
      role: "ADMIN",
      mustChangePassword: false,
    },
  }))
  .then(() => prisma.$disconnect())
  .then(() => {
    console.log("admin-sync-ok");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    prisma.$disconnect().finally(() => process.exit(1));
  });
'@
  $out = $script | docker compose exec -T -w /app backend node 2>&1 | Out-String
  return ($LASTEXITCODE -eq 0) -and ($out -match 'admin-sync-ok')
}

function Test-KlAdminLogin {
  param([string]$Password)
  try {
    $body = '{"username":"admin","password":"' + ($Password -replace '\\', '\\\\' -replace '"', '\"') + '"}'
    $resp = Invoke-RestMethod -Uri "http://localhost:$HttpPort/api/auth/login" -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 15
    return [bool]$resp.success
  } catch {
    return $false
  }
}

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
  $adminPasswordShown = New-KlAdminPassword
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  $envBody = @"
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
KURDLOGS_RELEASE=$ImageTag
KURDLOGS_IMAGE_BACKEND=ghcr.io/sarhadcodes/kurdlogs-core-backend:$ImageTag
KURDLOGS_IMAGE_FRONTEND=ghcr.io/sarhadcodes/kurdlogs-core-frontend:$ImageTag
KURDLOGS_IMAGE_NGINX=ghcr.io/sarhadcodes/kurdlogs-core-nginx:$ImageTag
"@
  [System.IO.File]::WriteAllText($envPath, $envBody.TrimStart() + "`n", $utf8NoBom)
  Write-Ok 'Created .env with generated secrets'
} else {
  $adminPasswordShown = Get-KlEnvValue $envPath 'ADMIN_INITIAL_PASSWORD'
  if (-not $adminPasswordShown -or $adminPasswordShown -match '^Kl-[a-f0-9]+9A$') {
    $adminPasswordShown = $KlDefaultAdminPassword
    Set-KlEnvValue $envPath 'ADMIN_INITIAL_PASSWORD' $adminPasswordShown
    Write-Ok 'Set default admin password to Kurdlogs!'
  } else {
    Write-Ok '.env already exists — keeping your settings'
  }
}

# Always pin compose to the requested release images (fresh pull on reinstall).
Set-KlEnvValue $envPath 'KURDLOGS_RELEASE' $ImageTag
Set-KlEnvValue $envPath 'KURDLOGS_IMAGE_BACKEND' "ghcr.io/sarhadcodes/kurdlogs-core-backend:$ImageTag"
Set-KlEnvValue $envPath 'KURDLOGS_IMAGE_FRONTEND' "ghcr.io/sarhadcodes/kurdlogs-core-frontend:$ImageTag"
Set-KlEnvValue $envPath 'KURDLOGS_IMAGE_NGINX' "ghcr.io/sarhadcodes/kurdlogs-core-nginx:$ImageTag"
Write-Ok "Release images set to $ImageTag"

# KurdLogs RTMP must stay off 1935 (Flussonic). Reinstalls with an old .env may still have 1935.
Set-KlEnvValue $envPath 'RTMP_PUBLISH_PORT' '1936'
Set-KlEnvValue $envPath 'MCR_RTMP_PORT' '1936'
Set-KlEnvValue $envPath 'HTTP_PORT' "$HttpPort"
Set-KlEnvValue $envPath 'PUBLIC_BASE_URL' "http://localhost:$HttpPort"
Write-Ok 'RTMP ingest pinned to port 1936 (avoids Flussonic on 1935)'

$rtmpPort = [int](Get-KlEnvValue $envPath 'RTMP_PUBLISH_PORT')
if (Test-KlTcpPortInUse $rtmpPort) {
  Write-Host "  ! Port $rtmpPort is already in use on this machine — nginx-rtmp may fail to start." -ForegroundColor Yellow
}
if (Test-KlTcpPortInUse $HttpPort) {
  $owner = Get-NetTCPConnection -LocalPort $HttpPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($owner -and $owner.OwningProcess -ne 0) {
    $proc = Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -notmatch 'com\.docker|wsl|vmmem') {
      Write-Host "  ! Port $HttpPort is already in use — the panel may not load." -ForegroundColor Yellow
    }
  }
}

Set-KlEnvValue $envPath 'SYNC_ADMIN_PASSWORD' '1'

Write-Step '04' "Pull binary images"
docker compose pull
if ($LASTEXITCODE -ne 0) {
  $needed = @(
    "ghcr.io/sarhadcodes/kurdlogs-core-backend:$ImageTag",
    "ghcr.io/sarhadcodes/kurdlogs-core-frontend:$ImageTag",
    "ghcr.io/sarhadcodes/kurdlogs-core-nginx:$ImageTag"
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
docker compose up -d --pull always --force-recreate
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }

$pgPass = Get-KlEnvValue $envPath 'POSTGRES_PASSWORD'
if ($pgPass) {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker compose exec -T postgres pg_isready -U postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if ($ready) {
    docker compose exec -T postgres psql -U postgres -c "ALTER USER postgres PASSWORD '$pgPass';" 2>$null | Out-Null
    docker compose up -d --force-recreate backend | Out-Null
  }
}

if ($adminPasswordShown) {
  if (-not (Wait-KlBackendReady)) {
    throw 'Backend did not become ready — check: docker compose logs backend'
  }

  $adminSynced = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Invoke-KlAdminPasswordSync) {
      $adminSynced = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $adminSynced) {
    throw @"
Failed to sync admin password into the database.

Try manually:
  cd $InstallDir
  docker compose exec -T backend node dist/scripts/reset-admin.js `"$adminPasswordShown`"
"@
  }

  $loginOk = $false
  for ($i = 0; $i -lt 15; $i++) {
    if (Test-KlAdminLogin $adminPasswordShown) {
      $loginOk = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $loginOk) {
    throw 'Admin password was synced but login verification failed — check: docker compose logs backend'
  }

  Set-KlEnvValue $envPath 'SYNC_ADMIN_PASSWORD' '0'
  Write-Ok 'Admin login synced and verified'
}

Start-Sleep -Seconds 3
$backendState = (docker compose ps backend --format '{{.State}}' 2>$null | Select-Object -First 1).Trim()
$rtmpState = (docker compose ps nginx-rtmp --format '{{.State}}' 2>$null | Select-Object -First 1).Trim()
if ($backendState -ne 'running') {
  Write-Host '  ! Backend is not running — login will show 502. Check: docker compose logs backend' -ForegroundColor Yellow
}
if ($rtmpState -ne 'running') {
  Write-Host '  ! nginx-rtmp is not running — RTMP ingest is down. Check: docker compose logs nginx-rtmp' -ForegroundColor Yellow
  Write-Host '    If you see port 1935 in the error, re-run this installer (RTMP is now pinned to 1936).' -ForegroundColor DarkGray
}

Write-Ok 'Services started'

Write-Host ""
Write-Host "  INSTALL COMPLETE" -ForegroundColor Green
Write-Host "  installer →  $InstallerVersion"
Write-Host "  release  →  $ImageTag"
Write-Host "  open      →  http://localhost:$HttpPort"
Write-Host "  username →  admin"
Write-Host "  password →  $adminPasswordShown" -ForegroundColor Yellow
Write-Host "  path     →  $InstallDir"
Write-Host ""
