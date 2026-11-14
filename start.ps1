<#
.SYNOPSIS
    Start Exoplanet Finder (backend on :8000, frontend on :5173) and open the browser.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\start.ps1
    powershell -ExecutionPolicy Bypass -File .\start.ps1 -NoBrowser
#>
[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    Write-Host "[X] Setup has not been run yet." -ForegroundColor Red
    Write-Host "    Run: powershell -ExecutionPolicy Bypass -File .\setup.ps1" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path 'frontend\node_modules')) {
    Write-Host "[X] Frontend dependencies are missing. Re-run setup.ps1." -ForegroundColor Red
    exit 1
}

function Test-PortInUse([int]$port) {
    try {
        $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        return [bool]$c
    } catch { return $false }
}
foreach ($p in @($BackendPort, $FrontendPort)) {
    if (Test-PortInUse $p) {
        Write-Host "[X] Port $p is already in use (Exoplanet Finder may already be running)." -ForegroundColor Red
        Write-Host "    Run .\stop.ps1 first, or close the program using port $p." -ForegroundColor Yellow
        exit 1
    }
}

New-Item -ItemType Directory -Force -Path logs, .run | Out-Null

Write-Host ""
Write-Host "  EXOPLANET FINDER" -ForegroundColor Magenta
Write-Host "  Starting backend  -> http://localhost:$BackendPort" -ForegroundColor Cyan
$backend = Start-Process -FilePath $venvPy `
    -ArgumentList @('-m', 'uvicorn', 'exofinder.api.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") `
    -WorkingDirectory (Join-Path $PSScriptRoot 'backend') `
    -RedirectStandardOutput (Join-Path $PSScriptRoot 'logs\backend.out.log') `
    -RedirectStandardError (Join-Path $PSScriptRoot 'logs\backend.log') `
    -WindowStyle Hidden -PassThru

Write-Host "  Starting frontend -> http://localhost:$FrontendPort" -ForegroundColor Cyan
# The Vite dev server proxies /api to this URL (frontend/vite.config.ts reads VITE_API_URL).
# 127.0.0.1, not localhost: Node may resolve localhost to the IPv6 address ::1 on Windows.
$env:VITE_API_URL = "http://127.0.0.1:$BackendPort"
$frontend = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList @('/c', "npm run dev -- --port $FrontendPort --strictPort") `
    -WorkingDirectory (Join-Path $PSScriptRoot 'frontend') `
    -RedirectStandardOutput (Join-Path $PSScriptRoot 'logs\frontend.log') `
    -RedirectStandardError (Join-Path $PSScriptRoot 'logs\frontend.err.log') `
    -WindowStyle Hidden -PassThru

@{ backend = $backend.Id; frontend = $frontend.Id; started = (Get-Date).ToString('s') } |
    ConvertTo-Json | Set-Content -Path '.run\pids.json' -Encoding UTF8

function Wait-Url([string]$url, [string]$name, $proc) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) { return $false }
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

Write-Host "  Waiting for services to become ready..." -ForegroundColor DarkGray
$okBackend = Wait-Url "http://127.0.0.1:$BackendPort/api/health" 'backend' $backend
if (-not $okBackend) {
    Write-Host "[X] The backend did not start. Last lines of logs\backend.log:" -ForegroundColor Red
    if (Test-Path 'logs\backend.log') { Get-Content 'logs\backend.log' -Tail 25 }
    & (Join-Path $PSScriptRoot 'stop.ps1') -Quiet
    exit 1
}
Write-Host "    [ok] backend ready" -ForegroundColor Green
$okFrontend = Wait-Url "http://localhost:$FrontendPort/" 'frontend' $frontend
if (-not $okFrontend) {
    Write-Host "[X] The frontend did not start. Last lines of logs\frontend.log:" -ForegroundColor Red
    if (Test-Path 'logs\frontend.log') { Get-Content 'logs\frontend.log' -Tail 25 }
    if (Test-Path 'logs\frontend.err.log') { Get-Content 'logs\frontend.err.log' -Tail 25 }
    & (Join-Path $PSScriptRoot 'stop.ps1') -Quiet
    exit 1
}
Write-Host "    [ok] frontend ready" -ForegroundColor Green

Write-Host ""
Write-Host "  App:      http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host "  API:      http://localhost:$BackendPort" -ForegroundColor Green
Write-Host "  API docs: http://localhost:$BackendPort/docs" -ForegroundColor Green
Write-Host "  Logs:     .\logs\" -ForegroundColor DarkGray
Write-Host "  Stop:     powershell -ExecutionPolicy Bypass -File .\stop.ps1" -ForegroundColor DarkGray
Write-Host ""
if (-not $NoBrowser) { Start-Process "http://localhost:$FrontendPort" }
