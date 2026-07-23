# Sync Postgres role password to match POSTGRES_PASSWORD in .env
# Needed when the postgres_data volume was initialized with a different password.
# Run from repo root: .\scripts\sync-postgres-password.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$envPath = Join-Path (Get-Location) '.env'
$example = Join-Path (Get-Location) '.env.example'

if (-not (Test-Path $envPath)) {
  if (Test-Path $example) {
    Copy-Item $example $envPath -Force
    $text = Get-Content $envPath -Raw
    $text = $text -replace 'YOUR_VPS_IP', 'localhost'
    $text = $text -replace 'POSTGRES_PASSWORD=change-me-db-password', 'POSTGRES_PASSWORD=postgres'
    $text = $text -replace 'JWT_SECRET=change-me-long-random-secret', 'JWT_SECRET=local-dev-jwt-secret-change-me'
    $text = $text -replace 'IPTV_API_KEY=change-me-iptv-api-key', 'IPTV_API_KEY=local-dev-iptv-key'
    Set-Content -Path $envPath -Value $text.TrimEnd() -Encoding utf8
    Write-Host 'Created .env from .env.example for local use.' -ForegroundColor Yellow
  } else {
    @(
      'PUBLIC_BASE_URL=http://localhost:8081'
      'POSTGRES_PASSWORD=postgres'
      'HTTP_PORT=8081'
    ) | Set-Content -Path $envPath -Encoding utf8
    Write-Host 'Created minimal .env (POSTGRES_PASSWORD=postgres).' -ForegroundColor Yellow
  }
}

$pwLine = Get-Content $envPath | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
if (-not $pwLine) {
  # Match docker-compose default when key is absent
  $pw = 'postgres'
  Add-Content -Path $envPath -Value 'POSTGRES_PASSWORD=postgres'
  Write-Host 'POSTGRES_PASSWORD missing — defaulted to postgres.' -ForegroundColor Yellow
} else {
  $pw = ($pwLine -replace '^POSTGRES_PASSWORD=', '').Trim()
}

if ([string]::IsNullOrWhiteSpace($pw)) {
  Write-Error 'POSTGRES_PASSWORD in .env is empty'
}

$pwSql = $pw -replace "'", "''"

Write-Host 'Syncing Postgres password from .env...' -ForegroundColor Cyan
docker compose exec -T postgres psql -U postgres -c "ALTER USER postgres PASSWORD '$pwSql';"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Restarting backend...' -ForegroundColor Cyan
docker compose restart backend
Write-Host 'Done.' -ForegroundColor Green
