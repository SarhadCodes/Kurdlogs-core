# Rebuild and restart KurdLogs Core (localhost Docker)
# Run from repo root: .\deploy-local.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host 'Building frontend + backend + nginx-rtmp images...' -ForegroundColor Cyan
docker compose build frontend backend nginx-rtmp
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Restarting containers...' -ForegroundColor Cyan
docker compose up -d --force-recreate nginx-rtmp frontend backend
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Syncing Postgres password (fixes backend crash after volume/password mismatch)...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'scripts\sync-postgres-password.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$port = '8081'
if (Test-Path (Join-Path $PSScriptRoot '.env')) {
  $portLine = Get-Content (Join-Path $PSScriptRoot '.env') | Where-Object { $_ -match '^HTTP_PORT=' } | Select-Object -First 1
  if ($portLine) { $port = ($portLine -replace '^HTTP_PORT=','').Trim() }
}
Write-Host "Done. Open http://localhost:$port and hard refresh (Ctrl+Shift+R)" -ForegroundColor Green
Write-Host 'Check sidebar build version — expect v18.5.6-localhost-login-fix' -ForegroundColor Green
docker compose ps frontend backend nginx-rtmp
