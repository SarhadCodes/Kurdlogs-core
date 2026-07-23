# Rebuild and restart KurdLogs Core (localhost Docker)
# Run from repo root: .\deploy-local.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch {}

$e = [char]27
$R = "$e[0m"; $B = "$e[1m"; $DIM = "$e[2m"
$CYAN = "$e[38;2;125;211;252m"
$MINT = "$e[38;2;134;239;172m"
$PEARL = "$e[38;2;226;232;240m"
$MUTED = "$e[38;2;148;163;184m"
$AMBER = "$e[38;2;253;224;71m"
$LINE = "$e[38;2;51;65;85m"
$OK = "$e[38;2;74;222;128m"
$ERR = "$e[38;2;248;113;113m"
$PROMPT = "$e[38;2;167;139;250m"

function Write-Kl([string]$Text) { Write-Host $Text }
function Write-KlBlank { Write-Host '' }

function Show-KlBanner {
  Clear-Host
  Write-KlBlank
  Write-Kl ("$CYAN" + '          ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄' + $R)
  Write-Kl ("$CYAN" + '        ▐█▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▌' + $R)
  Write-Kl ("$PEARL$B" + '              K U R D L O G S   C O R E' + $R)
  Write-Kl ("$MUTED" + '           self-hosted broadcast control panel' + $R)
  Write-Kl ("$CYAN" + '        ▐█▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄█▌' + $R)
  Write-Kl ("$CYAN" + '          ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀' + $R)
  Write-KlBlank
  Write-Kl ("$LINE" + '  ┌─ session ─────────────────────────────────────────┐' + $R)
  Write-Kl ("$LINE" + '  │' + $R + "  $MINT●$R live deploy   $MUTED│$R  docker compose   $MUTED│$R  localhost  $LINE│" + $R)
  Write-Kl ("$LINE" + '  └───────────────────────────────────────────────────┘' + $R)
  Write-KlBlank
}

function Show-KlStep([string]$Num, [string]$Title) {
  Write-KlBlank
  Write-Kl ("$LINE" + '╭──────────────────────────────────────────────────────────────╮' + $R)
  Write-Kl ("$LINE" + '│' + $R + "  $AMBER$B$Num$R  $PEARL$B$Title$R")
  Write-Kl ("$LINE" + '╰──────────────────────────────────────────────────────────────╯' + $R)
  Write-KlBlank
}

function Show-KlOk([string]$Text) {
  Write-Kl ("  $OK$B✓$R  $PEARL$Text$R")
}

function Show-KlFail([string]$Text) {
  Write-Kl ("  $ERR$B✗$R  $PEARL$Text$R")
}

function Show-KlInfo([string]$Text) {
  Write-Kl ("  $MUTED→$R  $Text")
}

function Show-KlProgress([string]$Label) {
  Write-Kl ("$MUTED  $Label$R")
  for ($i = 1; $i -le 24; $i++) {
    $fill = '█' * $i
    $empty = '░' * (24 - $i)
    $pct = [int](100 * $i / 24)
    Write-Host -NoNewline ("`r  $CYAN$fill$DIM$empty$R  $MUTED$pct%$R ")
    Start-Sleep -Milliseconds 18
  }
  Write-Host ''
}

Show-KlBanner

# ── 01 Docker check ──────────────────────────────────────────
Show-KlStep '01' 'Confirm Docker'
Write-Kl ("$PROMPT$B❯$R $MUTED" + 'kurdlogs' + "$R $DIM›$R docker --version")
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Show-KlFail 'Docker not found. Install Docker Desktop, then re-run.'
  exit 1
}
$dockerV = (docker --version 2>&1 | Out-String).Trim()
Show-KlInfo $dockerV
Write-Kl ("$PROMPT$B❯$R $MUTED" + 'kurdlogs' + "$R $DIM›$R docker compose version")
$composeV = (docker compose version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  Show-KlFail 'Docker Compose v2 required.'
  exit 1
}
Show-KlInfo $composeV
Show-KlOk 'Docker runtime ready'

# ── 02 Build ─────────────────────────────────────────────────
Show-KlStep '02' 'Build images'
Show-KlInfo 'frontend · backend · nginx-rtmp'
Show-KlProgress 'compiling containers'
docker compose build frontend backend nginx-rtmp
if ($LASTEXITCODE -ne 0) {
  Show-KlFail 'Build failed.'
  exit $LASTEXITCODE
}
Show-KlOk 'Images built'

# ── 03 Start ─────────────────────────────────────────────────
Show-KlStep '03' 'Start the stack'
Show-KlProgress 'bringing containers online'
docker compose up -d --force-recreate nginx-rtmp frontend backend
if ($LASTEXITCODE -ne 0) {
  Show-KlFail 'Compose up failed.'
  exit $LASTEXITCODE
}
Show-KlOk 'Containers restarted'

# ── 04 Postgres sync ─────────────────────────────────────────
Show-KlStep '04' 'Sync Postgres'
$sync = Join-Path $PSScriptRoot 'scripts\sync-postgres-password.ps1'
if (Test-Path $sync) {
  Show-KlInfo 'aligning DB password with .env'
  & $sync
  if ($LASTEXITCODE -ne 0) {
    Show-KlFail 'Postgres sync failed.'
    exit $LASTEXITCODE
  }
  Show-KlOk 'Postgres password synced'
} else {
  Show-KlInfo 'sync script not found — skipped'
}

# ── 05 Status ────────────────────────────────────────────────
Show-KlStep '05' 'Verify services'
$port = '8081'
if (Test-Path (Join-Path $PSScriptRoot '.env')) {
  $portLine = Get-Content (Join-Path $PSScriptRoot '.env') | Where-Object { $_ -match '^HTTP_PORT=' } | Select-Object -First 1
  if ($portLine) { $port = ($portLine -replace '^HTTP_PORT=', '').Trim() }
}

docker compose ps frontend backend nginx-rtmp
Write-KlBlank
Show-KlOk "Panel URL  http://localhost:$port"

# ── Done ─────────────────────────────────────────────────────
Write-KlBlank
Write-Kl ("$MINT" + '  ██████████████████████████████████████████████████████' + $R)
Write-Kl ("$PEARL$B" + '   KURDLOGS CORE  ·  DEPLOY COMPLETE' + $R)
Write-Kl ("$MUTED" + "   open  →  http://localhost:$port" + $R)
Write-Kl ("$MUTED" + '   login →  admin / admin123' + $R)
Write-Kl ("$MUTED" + '   tip   →  hard refresh (Ctrl+Shift+R) after first build' + $R)
Write-Kl ("$MINT" + '  ██████████████████████████████████████████████████████' + $R)
Write-KlBlank
