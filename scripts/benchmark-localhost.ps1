# Localhost benchmark helper for KurdLogs Core v12
# Requires backend running on localhost:3000 (or set $BaseUrl)

param(
    [ValidateSet(1, 5, 10, 20)]
    [int]$Channels = 1,
    [int]$Seconds = 30,
    [string]$BaseUrl = "http://localhost:3000/api",
    [string]$Token = $env:KURDLOGS_TOKEN
)

if (-not $Token) {
    Write-Error "Set KURDLOGS_TOKEN env var to a valid JWT, or pass -Token"
    exit 1
}

$headers = @{
    Authorization = "Bearer $Token"
    "Content-Type" = "application/json"
}

Write-Host "Running benchmark: $Channels channels, ${Seconds}s sample..."
$body = @{ channels = $Channels; seconds = $Seconds } | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/benchmark/run" -Method POST -Headers $headers -Body $body -TimeoutSec ($Seconds + 120)
} catch {
    Write-Error "Benchmark request failed: $_"
    exit 1
}

$report = $resp.data
$outFile = "benchmark-$($report.id).json"
$report | ConvertTo-Json -Depth 10 | Out-File -Encoding utf8 $outFile

Write-Host ""
Write-Host "=== Benchmark Report ==="
Write-Host "Target channels: $($report.targetChannels)"
Write-Host "Duration:        $($report.durationSec)s"
Write-Host "Avg CPU:         $($report.summary.avgSystemCpu)%"
Write-Host "Peak CPU:        $($report.summary.peakSystemCpu)%"
Write-Host "Avg RAM:         $($report.summary.avgRamPct)%"
Write-Host "Peak RAM:        $($report.summary.peakRamPct)%"
Write-Host "Disk write est:  $($report.summary.diskWriteEstimateKbPerSec) KB/s"
Write-Host "Recommendation:  $($report.recommendation)"
Write-Host ""
Write-Host "Full report saved to: $outFile"
