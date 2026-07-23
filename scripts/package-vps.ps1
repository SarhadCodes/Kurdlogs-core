# Create a ZIP for VPS upload (excludes node_modules and local data)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $root "docker-compose.yml"))) {
    $root = Split-Path -Parent $PSScriptRoot
}
$out = Join-Path $root "Kurdlogs_core-vps.zip"
$temp = Join-Path $env:TEMP "kurdlogs-vps-pack"

if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
New-Item -ItemType Directory -Path $temp | Out-Null

$exclude = @(
    "node_modules", "frontend\node_modules", "backend\node_modules",
    ".git", "streams", "uploads", "logs",
    "Kurdlogs_core-vps.zip", "*.log"
)

Write-Host "Packaging from: $root"
robocopy $root $temp /E /XD node_modules .git streams uploads logs /XF Kurdlogs_core-vps.zip *.log /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $out -Force
Remove-Item $temp -Recurse -Force

Write-Host "Created: $out"
Write-Host "Size: $([math]::Round((Get-Item $out).Length / 1MB, 1)) MB"
