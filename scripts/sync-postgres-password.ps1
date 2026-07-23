# Sync Postgres role password to match POSTGRES_PASSWORD in .env
# Needed when the postgres_data volume was initialized with a different password.
# Run from repo root: .\scripts\sync-postgres-password.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path '.env')) {
  Write-Error '.env not found — copy .env.example and set POSTGRES_PASSWORD'
}

$pwLine = Get-Content '.env' | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
if (-not $pwLine) {
  Write-Error 'POSTGRES_PASSWORD missing in .env'
}

$pw = $pwLine -replace '^POSTGRES_PASSWORD=', ''
$pwSql = $pw -replace "'", "''"

Write-Host 'Syncing Postgres password from .env...' -ForegroundColor Cyan
docker compose exec -T postgres psql -U postgres -c "ALTER USER postgres PASSWORD '$pwSql';"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Restarting backend...' -ForegroundColor Cyan
docker compose restart backend
Write-Host 'Done.' -ForegroundColor Green
