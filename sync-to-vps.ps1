# Upload KurdLogs from this PC to the VPS, then rebuild Docker.
# Usage: .\sync-to-vps.ps1 -VpsHost root@161.97.123.126 -RemotePath /opt/kurdlogs_core

param(
    [Parameter(Mandatory = $true)]
    [string]$VpsHost,
    [string]$RemotePath = "/opt/kurdlogs_core"
)

$ErrorActionPreference = "Stop"
$LocalRoot = $PSScriptRoot

Write-Host "Uploading $LocalRoot -> ${VpsHost}:${RemotePath}" -ForegroundColor Cyan
Write-Host "You will be asked for your VPS SSH password (or use SSH keys)." -ForegroundColor Yellow

# rsync via WSL if available; otherwise scp recursive
$rsync = Get-Command rsync -ErrorAction SilentlyContinue
if ($rsync) {
    rsync -avz --delete `
        --exclude node_modules `
        --exclude frontend/dist `
        --exclude backend/dist `
        --exclude .git `
        --exclude streams `
        --exclude uploads `
        "$LocalRoot/" "${VpsHost}:${RemotePath}/"
} else {
    Write-Host "rsync not found — using scp (slower). Install Git for Windows rsync or use WinSCP." -ForegroundColor Yellow
    ssh $VpsHost "mkdir -p $RemotePath"
    scp -r `
        "$LocalRoot\backend" `
        "$LocalRoot\frontend" `
        "$LocalRoot\docker" `
        "$LocalRoot\nginx" `
        "$LocalRoot\docker-compose.yml" `
        "$LocalRoot\deploy-vps.sh" `
        "${VpsHost}:${RemotePath}/"
}

Write-Host ""
Write-Host "Running deploy on VPS..." -ForegroundColor Cyan
ssh $VpsHost "cd $RemotePath && chmod +x deploy-vps.sh && sed -i 's/\r$//' deploy-vps.sh 2>/dev/null; ./deploy-vps.sh"

Write-Host ""
Write-Host "Done. Open your site and check sidebar for build: v18.5.4-stop-channel-output-urls" -ForegroundColor Green
Write-Host "Hard refresh: Ctrl+Shift+R" -ForegroundColor Green
